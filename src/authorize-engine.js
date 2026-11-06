// Motor da autorização guiada (rota /autorizar).
// Divide o lote em rodadas pequenas, tenta de novo em falhas passageiras e retoma lotes interrompidos.
// Sem dependência de tela: recebe as funções de rede por parâmetro para poder ser testado.

export const ROUND_SIZE = 200;      // remessas numeradas por reserva (batch.prepare)
export const AUTHORIZE_SIZE = 5;    // DC-e por chamada ao autorizador (limite do gateway)
export const SAVE_SIZE = 2;         // resultados gravados por chamada ao Apps Script (cada um cria 2 XML no Drive)
const PENDING_BATCH_STATUS = ["PREPARED", "PROCESSING", "PARTIAL"];
const RETRY_DOCUMENT_STATUS = ["PREPARED", "ERROR"];

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
  const report = (stage) => onProgress({ stage, done, expected, ...totals, elapsedMs: now() - started });

  async function processDocuments(batchId, documents) {
    for (const group of chunk(documents, AUTHORIZE_SIZE)) {
      let response;
      try { response = await withRetry(() => deps.authorize(group), { wait }); }
      catch (error) { throw new PauseError("A comunicação com a SEFAZ falhou. Nenhuma declaração foi perdida.", error); }
      const results = response.results || [];
      for (const part of chunk(results, SAVE_SIZE)) {
        try { await withRetry(() => deps.saveResults(batchId, part), { wait }); }
        catch (error) {
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
