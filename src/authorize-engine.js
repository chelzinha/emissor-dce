// Motor da autorização guiada (rota /autorizar).
// Divide o lote em rodadas pequenas, tenta de novo em falhas passageiras e retoma lotes interrompidos.
// Sem dependência de tela: recebe as funções de rede por parâmetro para poder ser testado.

export const ROUND_SIZE = 200;      // remessas numeradas por reserva (batch.prepare)
export const AUTHORIZE_SIZE = 5;    // DC-e por chamada ao autorizador (limite do gateway)
export const SAVE_SIZE = 2;         // resultados gravados por chamada ao Apps Script (cada um cria 2 XML no Drive)
const PENDING_BATCH_STATUS = ["PREPARED", "PROCESSING", "PARTIAL"];
const RETRY_DOCUMENT_STATUS = ["PREPARED", "ERROR"];
// Recusas de horário (703 data futura, 704 data atrasada) não dependem dos dados da remessa:
// a mesma DC-e é reenviada com dhEmi novo. Ficam como ERROR para o lote continuar retomável.
const TIMING_REJECTIONS = ["703", "704"];

export function normalizeResult(result) {
  if (result?.status === "REJECTED" && TIMING_REJECTIONS.includes(String(result.cStat || ""))) {
    return { ...result, status: "ERROR", reason: `${result.cStat} ${result.reason || ""}`.trim() };
  }
  return result;
}

export class PauseError extends Error {
  constructor(message, cause) { super(message); this.name = "PauseError"; this.cause = cause; }
}

export function chunk(list, size) {
  const result = [];
  for (let index = 0; index < list.length; index += size) result.push(list.slice(index, index + size));
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(task, { attempts = 3, delays = [1500, 4000, 8000], wait = sleep } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await task(); }
    catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(delays[Math.min(attempt, delays.length - 1)]);
    }
  }
  throw lastError;
}

export function remittanceValue(row) {
  return (row?.document?.items || []).reduce((total, item) => total + Number(item.quantity || 0) * Number(item.unitValue || 0), 0);
}

/** Resumo do que a AGF deixou pronto para autorizar. */
export function summarizeReady(remittances = []) {
  const ready = remittances.filter((row) => row.status === "READY");
  const byService = {};
  ready.forEach((row) => { byService[row.service || "SEM SERVIÇO"] = (byService[row.service || "SEM SERVIÇO"] || 0) + 1; });
  return {
    ready,
    total: ready.length,
    byService,
    totalValue: Number(ready.reduce((sum, row) => sum + remittanceValue(row), 0).toFixed(2)),
    authorized: remittances.filter((row) => row.status === "AUTHORIZED").length,
    pendingFix: remittances.filter((row) => ["INVALID", "REJECTED"].includes(row.status)).length,
  };
}

// ---------- Lotes (cada arquivo importado pela AGF é um lote) ----------
// Ritmo medido em produção nos lotes do AABNB (assinatura + SEFAZ + XML no Drive): 16 a 19 min por 100, cerca de 10 s por declaração.
export const PER_DOC_ESTIMATE_MS = 10000;
const AMBITO_ORDER = ["LOCAL", "ESTADUAL", "NACIONAL"];
const OPEN_STATUS = ["READY", "RESERVED", "ERROR"];

function lotNameParts(fileName = "", services = []) {
  const name = String(fileName || "").toUpperCase();
  const fromName = AMBITO_ORDER.find((ambito) => name.includes(ambito));
  const fromService = AMBITO_ORDER.find((ambito) => services.some((service) => String(service || "").toUpperCase().includes(ambito)));
  const match = name.match(/LOTE[_\s-]*(\d+)/);
  return { ambito: fromName || fromService || "", number: match ? Number(match[1]) : 0 };
}

/**
 * Agrupa as remessas por arquivo importado e define a ordem de autorização:
 * LOCAL, ESTADUAL e NACIONAL; dentro de cada um, pelo número do lote no nome do arquivo.
 * O lote atual é o primeiro que ainda tem declaração pronta, reservada ou com erro.
 */
export function buildLots(remittances = [], imports = []) {
  const importsById = new Map((imports || []).map((item) => [String(item.ID), item]));
  const groups = new Map();
  remittances.forEach((row) => {
    const id = String(row.importId || "");
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  });
  const lots = [...groups.entries()].map(([id, rows]) => {
    const info = importsById.get(id) || {};
    const fileName = String(info.FILE_NAME || "");
    const { ambito, number } = lotNameParts(fileName, rows.map((row) => row.service));
    const count = (statuses) => rows.filter((row) => statuses.includes(String(row.status))).length;
    const ready = count(["READY"]);
    const open = count(OPEN_STATUS);
    return {
      id, fileName, ambito, number, createdAt: String(info.CREATED_AT || ""),
      label: number ? `Lote ${String(number).padStart(2, "0")}` : /TESTE/i.test(fileName) ? "Lote de teste" : (fileName.replace(/\.[a-z0-9]+$/i, "") || "Lote"),
      total: rows.length, ready, open, authorized: count(["AUTHORIZED"]), pendingFix: count(["INVALID", "REJECTED"]),
      readyRows: rows.filter((row) => row.status === "READY"),
    };
  }).filter((lot) => lot.authorized + lot.open > 0);
  lots.sort((a, b) => {
    const ia = AMBITO_ORDER.indexOf(a.ambito); const ib = AMBITO_ORDER.indexOf(b.ambito);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || a.number - b.number || a.createdAt.localeCompare(b.createdAt);
  });
  lots.forEach((lot) => { lot.state = lot.open ? "open" : "done"; });
  const current = lots.find((lot) => lot.open) || null;
  if (current) current.state = "current";
  lots.forEach((lot, index) => { lot.position = index + 1; });
  return { lots, current };
}

export function pendingBatchesFor(batches = [], environment) {
  return batches.filter((batch) => PENDING_BATCH_STATUS.includes(String(batch.STATUS)) && String(batch.ENVIRONMENT) === String(environment));
}

/** Estimativa em segundos a partir do ritmo medido até agora. */
export function estimateSeconds(remaining, elapsedMs, done, fallbackPerDocMs = 1400) {
  const perDoc = done > 0 ? elapsedMs / done : fallbackPerDocMs;
  return Math.max(0, Math.round((remaining * perDoc) / 1000));
}

/**
 * Executa a autorização completa.
 * deps: { getBatch(batchId), prepare(ids), authorize(documents), saveResults(batchId, results) }
 * Retoma primeiro os lotes interrompidos do mesmo ambiente e depois numera as remessas prontas em rodadas.
 */
export async function runAuthorization({ readyIds = [], pendingBatches = [], deps, onProgress = () => {}, wait = sleep, now = () => Date.now() }) {
  const totals = { authorized: 0, rejected: 0, errors: 0, rejections: [] };
  const started = now();
  let done = 0;
  let expected = readyIds.length;
  let xmlSaveFailed = null;
  const report = (stage) => onProgress({ stage, done, expected, ...totals, elapsedMs: now() - started });

  async function processDocuments(batchId, documents) {
    for (const group of chunk(documents, AUTHORIZE_SIZE)) {
      let response;
      try { response = await withRetry(() => deps.authorize(group), { wait }); }
      catch (error) { throw new PauseError("A comunicação com a SEFAZ falhou. Nenhuma declaração foi perdida.", error); }
      const results = (response.results || []).map(normalizeResult);
      for (const part of chunk(results, SAVE_SIZE)) {
        try {
          if (xmlSaveFailed) throw xmlSaveFailed;
          await withRetry(() => deps.saveResults(batchId, part), { wait });
        }
        catch (error) {
          // Apps Script antigo (MimeType.XML inexistente) nunca grava XML: o resto da sessão vai direto sem XML.
          if (/mimeType/i.test(String(error?.message || ""))) xmlSaveFailed = error;
          // Plano B: grava status, chave e protocolo sem os arquivos XML. Os XML ficam
          // guardados na sessão (keepXml) para não se perderem.
          const slim = part.map(({ signedXml, processedXml, ...rest }) => rest);
          try {
            await withRetry(() => deps.saveResults(batchId, slim), { wait });
            deps.keepXml?.(part, error);
          } catch (slimError) {
            const detail = slimError?.message || error?.message || "erro desconhecido";
            throw new PauseError(`Não foi possível registrar o resultado (${detail}). Nenhuma declaração foi perdida.`, slimError);
          }
        }
      }
      results.forEach((result) => {
        if (result.status === "AUTHORIZED") totals.authorized += 1;
        else if (result.status === "REJECTED" || result.status === "INVALID") {
          // Recusa da SEFAZ ou dado inválido: não adianta reenviar sem correção da AGF.
          totals.rejected += 1;
          const source = group.find((doc) => String(doc.reference) === String(result.reference));
          const reason = result.status === "INVALID" ? `Dados inválidos: ${(result.errors || []).join("; ")}` : `${result.cStat || ""} ${result.reason || ""}`.trim();
          totals.rejections.push({ reference: result.reference, name: source?.recipient?.realName || source?.recipient?.name || "", reason });
        } else totals.errors += 1;
      });
      done += group.length;
      report("authorizing");
    }
  }

  // 1. Lotes interrompidos: só os documentos ainda não concluídos.
  const resumed = [];
  for (const batch of pendingBatches) {
    const stored = await withRetry(() => deps.getBatch(String(batch.ID)), { wait });
    const pending = (stored.documents || []).filter((doc) => RETRY_DOCUMENT_STATUS.includes(String(doc.status)));
    resumed.push({ batchId: String(batch.ID), documents: pending });
  }
  expected += resumed.reduce((sum, item) => sum + item.documents.length, 0);
  report("starting");
  for (const item of resumed) if (item.documents.length) await processDocuments(item.batchId, item.documents);

  // 2. Remessas prontas, numeradas em rodadas.
  for (const ids of chunk(readyIds, ROUND_SIZE)) {
    report("reserving");
    let batch;
    try { batch = await deps.prepare(ids); }
    catch (error) { throw new PauseError("Não foi possível reservar a numeração desta etapa. Nenhuma declaração foi perdida.", error); }
    await processDocuments(batch.id, batch.documents || []);
  }

  report("finished");
  return { ...totals, done, expected, elapsedMs: now() - started };
}
