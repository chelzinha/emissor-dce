import "./operations-production.css";
import "./offline-sync.css";
import { dataAction, downloadBlob } from "./api.js";
import { loadPostalVendors } from "./postal-vendors.js";
import { resolveProductionAssets, rebuildVerifiedMatrixCrops, matrixCoverageForObjects } from "./production-assets.js";
import {
  selectTestRows,
  buildProductionModels,
  validateTestModels,
  approvalStateFromOperations,
  batchGenerationGate,
} from "./production-workflow.js";
import { generateBatchLabelPdf, generateTestLabelPdf } from "./unified-label-pdf.js";
import { DOCUMENT_MODES } from "./label-production.js";
import { dceLabelContextReadiness, senderFromDceIssuer } from "./dce-label-data.js";
import { mountOfflineSyncPanel } from "./offline-sync-ui.js";
import { openAgencyDcePreparation } from "./agency-dce-preparation-panel.js";

const ROOT_SELECTOR = "#elections-app";
const sessions = new Map();
let mounting = false;

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}
function pick(row, ...keys) { for (const key of keys) if (row?.[key] != null && row[key] !== "") return row[key]; return ""; }
function number(value) { return new Intl.NumberFormat("pt-BR").format(Number(value || 0)); }
function campaignId() { return document.querySelector("#campaign-select")?.value || ""; }
function notify(message, type = "info") {
  const box = document.querySelector("#elections-toast"); if (!box) return;
  box.textContent = message; box.className = `elections-toast show ${type}`;
  setTimeout(() => { box.className = "elections-toast"; }, 4800);
}
function batchValue(batch, key) { return pick(batch, key, key.toUpperCase()); }
function batchId(batch) { return String(batchValue(batch, "ID") || batchValue(batch, "id")); }
function portalReturnId(batch) { return String(batchValue(batch, "PORTAL_RETURN_ID") || batchValue(batch, "portalReturnId")); }
function documentMode(batch) { return String(batchValue(batch, "DOCUMENT_MODE") || batchValue(batch, "documentMode")); }
function batchStatus(batch) { return String(batchValue(batch, "STATUS") || batchValue(batch, "status") || "").toUpperCase(); }

async function allPostalObjects(cid, returnId) {
  const rows = []; const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const chunk = await dataAction("postalObjects.list", { campaignId: cid, portalReturnId: returnId, limit: pageSize, offset });
    rows.push(...chunk); if (chunk.length < pageSize) break;
    if (rows.length > 100000) throw new Error("Lote acima do limite de seguranca para processamento no navegador.");
  }
  return rows;
}

async function allDceLabelRows(cid, productionBatchId) {
  const rows = []; const pageSize = 250; let context = null;
  for (let offset = 0; ; offset += pageSize) {
    const page = await dataAction("production.dceLabelData", { campaignId: cid, productionBatchId, offset, limit: pageSize });
    context = context || { batch: page.batch, package: page.package };
    rows.push(...(page.rows || [])); const total = Number(page.total || 0);
    if (rows.length >= total || (page.rows || []).length < pageSize) break;
    if (rows.length > 100000) throw new Error("Lote DC-e acima do limite de seguranca do navegador.");
  }
  return { ...context, rows };
}

function savedSender(cid) { try { return JSON.parse(localStorage.getItem(`agf-postal-sender:${cid}`) || "{}"); } catch { return {}; } }
function senderFromCard(card) {
  return { name: card.querySelector("[data-sender-name]")?.value?.trim() || "", document: card.querySelector("[data-sender-document]")?.value?.trim() || "", addressLine: card.querySelector("[data-sender-address]")?.value?.trim() || "", cityLine: card.querySelector("[data-sender-city]")?.value?.trim() || "" };
}
function postalHeaderFromCard(card) { return { title: "CHANCELA", pp: card.querySelector("[data-postal-pp]")?.value?.trim() || "", payment: card.querySelector("[data-postal-payment]")?.value?.trim() || "" }; }
function persistSender(cid, sender) { try { localStorage.setItem(`agf-postal-sender:${cid}`, JSON.stringify(sender)); } catch {} }
function modeLabel(mode) { return mode === DOCUMENT_MODES.DCE ? "DC-e autorizada" : "Declaracao simplificada"; }

function batchCard(batch, cid) {
  const id = batchId(batch); const mode = documentMode(batch); const status = batchStatus(batch); const saved = savedSender(cid);
  const total = batchValue(batch, "TOTAL"); const pac = batchValue(batch, "PAC"); const sedex = batchValue(batch, "SEDEX");
  const dceReady = mode !== DOCUMENT_MODES.DCE || ["READY_FOR_LABEL_TEST", "DCE_AUTHORIZED"].includes(status);
  const dceNeedsPreparation = mode === DOCUMENT_MODES.DCE && status === "AWAITING_DCE_PREPARATION";
  const badgeText = dceNeedsPreparation ? "PREPARO FISCAL PENDENTE" : (mode === DOCUMENT_MODES.DCE && !dceReady ? "AGUARDANDO AUTORIZACAO" : "AGUARDANDO TESTE");
  const senderFields = mode === DOCUMENT_MODES.DCE ? `<div class="wide production-dce-source"><strong>Remetente fiscal vinculado ao pacote DC-e</strong><small>Nome, CNPJ e endereco serao carregados do perfil fiscal confirmado pelo cliente. Esses dados nao podem ser alterados manualmente na producao.</small></div>` : `
      <label>Remetente<input data-sender-name value="${h(saved.name || "")}" placeholder="Nome/razao social"></label>
      <label>CNPJ/CPF<input data-sender-document value="${h(saved.document || "")}" placeholder="Documento do remetente"></label>
      <label class="wide">Endereco do remetente<input data-sender-address value="${h(saved.addressLine || "")}" placeholder="Logradouro, numero, complemento"></label>
      <label>Cidade/UF e CEP<input data-sender-city value="${h(saved.cityLine || "")}" placeholder="Fortaleza / CE · 60000-000"></label>`;
  const initialStatus = dceNeedsPreparation ? "O lote ainda precisa passar pelo pre-flight fiscal da agencia antes de ser enviado ao cliente para autorizacao." : (mode === DOCUMENT_MODES.DCE && !dceReady ? "A producao sera liberada automaticamente quando 100% das DC-es estiverem autorizadas com chave, protocolo e QR Code validos." : "O lote completo fica bloqueado ate a auditoria 100% do Data Matrix e a aprovacao da etiqueta teste.");
  return `<article class="production-batch" data-production-batch="${h(id)}" data-portal-return="${h(portalReturnId(batch))}" data-document-mode="${h(mode)}" data-batch-status="${h(status)}">
    <div class="production-batch-top"><div><h3>${h(modeLabel(mode))}</h3><p>Lote ${h(id.slice(0, 8))} · retorno ${h(portalReturnId(batch).slice(0, 8))}</p></div><span class="production-workflow-badge warn" data-batch-badge>${h(badgeText)}</span></div>
    <div class="production-batch-stats"><span>Total ${number(total)}</span><span>PAC ${number(pac)}</span><span>SEDEX ${number(sedex)}</span><span>Status ${h(status || "-")}</span></div>
    <div class="production-config">${senderFields}
      <label>PP / identificador postal<input data-postal-pp placeholder="Opcional"></label>
      <label>Modalidade de pagamento<input data-postal-payment value="A VISTA" placeholder="Ex.: A VISTA"></label>
      ${mode === DOCUMENT_MODES.SIMPLIFIED ? '<label class="wide"><span><input type="checkbox" data-simplified-confirm style="width:auto;margin-right:7px">Confirmo o uso operacional da Declaracao Simplificada neste lote. Ela nao sera apresentada pelo sistema como DC-e autorizada.</span></label>' : ""}
    </div>
    <div class="production-files" data-reselect-files hidden><strong>Os PDFs originais nao estao mais no cache deste navegador.</strong><small>Selecione novamente exatamente os PDFs de etiquetas usados neste retorno. Eles serao reauditados pelo SRO antes de qualquer geracao.</small><input type="file" accept=".pdf,application/pdf" multiple data-pdf-reselect></div>
    <div class="production-actions">${dceNeedsPreparation ? '<button class="secondary" data-prepare-dce>Preparar pacote DC-e</button>' : ""}<button class="primary" data-prepare-test ${dceReady ? "" : "disabled"}>Gerar etiqueta de teste</button><button class="success" data-approve-tests disabled>Aprovar teste no leitor</button><button class="secondary" data-generate-batch disabled>Gerar lote completo</button></div>
    <div class="production-status" data-production-status>${h(initialStatus)}</div><div class="production-tests" data-test-list></div><div class="production-gate" data-gate></div>
  </article>`;
}

async function renderWorkflow(slot) {
  const cid = campaignId(); if (!cid) return; const batches = await dataAction("production.list", { campaignId: cid });
  slot.innerHTML = `<section class="production-workflow"><div class="production-workflow-head"><div><p class="eyebrow">CONTROLE DE PRODUCAO</p><h2>Teste fisico antes do lote</h2><p>O PDF em volume so e liberado depois que todos os Data Matrix forem verificados e uma amostra por servico presente no lote passar no leitor.</p></div><span class="production-workflow-badge">GATE DE SEGURANCA</span></div><div class="production-workflow-body">${batches.map((batch) => batchCard(batch, cid)).join("") || '<div class="empty">Nenhum lote documental preparado.</div>'}</div></section>`;
  slot.querySelectorAll("[data-production-batch]").forEach(bindBatch);
}
function setStatus(card, message, type = "") { const box = card.querySelector("[data-production-status]"); box.className = `production-status ${type}`; box.innerHTML = message; }
function setBusy(card, message) { setStatus(card, `<span class="production-progress"><span class="production-spinner"></span><span>${h(message)}</span></span>`); }
function renderTests(card, session, approvals = null) {
  const list = card.querySelector("[data-test-list]");
  list.innerHTML = session.testModels.map((model) => { const approved = approvals?.approvals?.find((item) => item.trackingCode === model.trackingCode)?.approved; return `<div class="production-test ${approved ? "approved" : ""}" data-test-sro="${h(model.trackingCode)}"><strong>${h(model.service.family)} · ${h(model.trackingCodeFormatted)}</strong><small>${approved ? "Aprovado no leitor e registrado" : "Imprima esta pagina e leia o codigo SRO no equipamento da agencia"}</small><label>Leitura do SRO<input data-test-scan="${h(model.trackingCode)}" value="${approved ? h(model.trackingCode) : ""}" placeholder="Leia o codigo da etiqueta" ${approved ? "disabled" : ""}></label></div>`; }).join("");
  card.querySelector("[data-approve-tests]").disabled = session.testModels.length === 0 || approvals?.ready === true;
}
function renderGate(card, gate) {
  const slot = card.querySelector("[data-gate]"); const checks = [[gate.counts.matrixBlocked === 0, "Data Matrix 100%"],[gate.counts.cropMissing === 0, "Recortes presentes"]];
  if (card.dataset.documentMode === DOCUMENT_MODES.DCE) { checks.push([gate.counts.dcePending === 0, "DC-e autorizada 100%"]); checks.push([gate.counts.qrPending === 0, "QR Code DC-e 100%"]); }
  checks.push([gate.counts.testsApproved === gate.counts.testsExpected && gate.counts.testsExpected > 0, `Teste ${gate.counts.testsApproved}/${gate.counts.testsExpected}`]);
  slot.innerHTML = checks.map(([ok,label]) => `<span class="${ok ? "ok" : "bad"}">${ok ? "OK" : "PENDENTE"} · ${h(label)}</span>`).join("");
  card.querySelector("[data-generate-batch]").disabled = !gate.ready; const badge = card.querySelector("[data-batch-badge]"); badge.textContent = gate.ready ? "LOTE LIBERADO" : "LOTE BLOQUEADO"; badge.className = `production-workflow-badge ${gate.ready ? "" : "warn"}`;
}

async function prepareTest(card) {
  const cid = campaignId(); const id = card.dataset.productionBatch; const returnId = card.dataset.portalReturn; const mode = card.dataset.documentMode;
  if (mode === DOCUMENT_MODES.DCE && !["READY_FOR_LABEL_TEST", "DCE_AUTHORIZED"].includes(String(card.dataset.batchStatus || "").toUpperCase())) return setStatus(card, "Aguardando a autorizacao integral das DC-es pelo cliente.", "warn");
  let sender = mode === DOCUMENT_MODES.DCE ? null : senderFromCard(card);
  if (mode === DOCUMENT_MODES.SIMPLIFIED && (!sender.name || !sender.addressLine || !sender.cityLine)) return setStatus(card, "Preencha os dados do remetente antes de gerar a etiqueta teste.", "bad");
  if (mode === DOCUMENT_MODES.SIMPLIFIED && !card.querySelector("[data-simplified-confirm]")?.checked) return setStatus(card, "Confirme a modalidade Declaracao Simplificada para este lote.", "warn");
  if (mode === DOCUMENT_MODES.SIMPLIFIED) persistSender(cid, sender);
  const reselected = [...(card.querySelector("[data-pdf-reselect]")?.files || [])]; setBusy(card, mode === DOCUMENT_MODES.DCE ? "Carregando DC-es autorizadas e PDFs originais..." : "Carregando objetos e PDFs originais...");
  try {
    let objects; let dceContext = null;
    if (mode === DOCUMENT_MODES.DCE) {
      dceContext = await allDceLabelRows(cid, id); const readiness = dceLabelContextReadiness(dceContext);
      if (!readiness.ready) throw new Error(`DC-e ainda nao liberada para etiqueta: ${[...readiness.global, ...readiness.perRow.flatMap((item) => item.problems.map((problem) => `${item.trackingCode}:${problem}`))].join(", ")}`);
      objects = readiness.rows; sender = senderFromDceIssuer(objects[0]?.issuer || {});
      if (!sender.name || !sender.document || !sender.addressLine || !sender.cityLine) throw new Error("Perfil fiscal do emitente esta incompleto para a etiqueta DACE.");
    } else objects = await allPostalObjects(cid, returnId);
    const assets = await resolveProductionAssets({ portalReturnId: returnId, campaignId: cid, reselectedPdfFiles: reselected });
    if (!assets.pdfFiles?.length) { card.querySelector("[data-reselect-files]").hidden = false; setStatus(card, "O cache local nao contem mais os PDFs deste retorno. Selecione novamente os arquivos originais e clique em Gerar etiqueta de teste.", "warn"); return; }
    card.querySelector("[data-reselect-files]").hidden = true; const { pdfjsLib, ZXing } = await loadPostalVendors(); setBusy(card, `Reauditando Data Matrix de ${number(objects.length)} objetos...`);
    const matrix = await rebuildVerifiedMatrixCrops({ pdfFiles: assets.pdfFiles, pdfjsLib, ZXing, onProgress: (progress) => setBusy(card, `Reauditando pagina ${number(progress.processed)} de ${number(progress.totalPages)}...`) });
    const coverage = matrixCoverageForObjects(objects, { ...matrix, crops: matrix.verifiedCrops });
    if (!coverage.fullyCovered || matrix.verifiedCrops.size < objects.length) { setStatus(card, `Producao bloqueada: ${number(coverage.decoded)} de ${number(objects.length)} objetos foram novamente validados pelo proprio SRO no Data Matrix.`, "bad"); return; }
    const testRows = selectTestRows(objects); const testModels = buildProductionModels(testRows, matrix.verifiedCrops, { documentMode: mode, sender, format: "10x15" });
    const validation = validateTestModels(testModels, { allowSimplified: mode === DOCUMENT_MODES.SIMPLIFIED });
    if (!validation.ready) throw new Error(validation.problems.map((item) => `${item.trackingCode}:${item.problem}`).join("; "));
    const testPdf = await generateTestLabelPdf(testModels, { postalHeader: postalHeaderFromCard(card) }); downloadBlob(testPdf, `etiqueta_teste_${mode === DOCUMENT_MODES.DCE ? "dace_" : ""}${id.slice(0, 8)}.pdf`);
    const operations = await dataAction("operations.list", { campaignId: cid }); const session = { cid, id, returnId, mode, sender, objects, matrix, testModels, postalHeader: postalHeaderFromCard(card), dceContext }; sessions.set(id, session);
    const approvals = approvalStateFromOperations(operations, id, testModels); renderTests(card, session, approvals);
    const gate = batchGenerationGate({ rows: objects, crops: matrix.verifiedCrops, documentMode: mode, sender, testModels, operations, productionBatchId: id, allowSimplified: mode === DOCUMENT_MODES.SIMPLIFIED }); renderGate(card, gate);
    const detail = mode === DOCUMENT_MODES.DCE ? "A amostra ja contem a DACE integrada com chave, protocolo, dados fiscais e QR Code da DC-e autorizada." : "Foi gerada uma amostra para cada servico presente.";
    setStatus(card, `PDF de teste gerado com ${number(testModels.length)} pagina(s). ${detail} Imprima, leia no equipamento e so depois aprove.`, "ok");
  } catch (error) { setStatus(card, h(error.message || error), "bad"); }
}

async function approveTests(card) {
  const id = card.dataset.productionBatch; const session = sessions.get(id); if (!session) return setStatus(card, "Gere novamente a etiqueta de teste nesta sessao antes de aprovar.", "warn");
  const scans = session.testModels.map((model) => ({ model, scanned: String(card.querySelector(`[data-test-scan="${CSS.escape(model.trackingCode)}"]`)?.value || "").replace(/\s/g, "").toUpperCase() }));
  const divergent = scans.find(({model,scanned}) => scanned !== String(model.trackingCode || "").replace(/\s/g, "").toUpperCase()); if (divergent) return setStatus(card, `Leitura divergente para ${h(divergent.model.service.family)}. O SRO lido precisa ser exatamente o da etiqueta de teste.`, "warn");
  setBusy(card, "Validando e registrando a leitura fisica da etiqueta teste...");
  try {
    for (const {model,scanned} of scans) await dataAction("production.labelTest.approve", { campaignId: session.cid, productionBatchId: session.id, service: model.service.family, expectedTrackingCode: model.trackingCode, scannedTrackingCode: scanned });
    const operations = await dataAction("operations.list", { campaignId: session.cid }); const approvals = approvalStateFromOperations(operations, id, session.testModels); renderTests(card, session, approvals);
    const gate = batchGenerationGate({ rows: session.objects, crops: session.matrix.verifiedCrops, documentMode: session.mode, sender: session.sender, testModels: session.testModels, operations, productionBatchId: id, allowSimplified: session.mode === DOCUMENT_MODES.SIMPLIFIED }); renderGate(card, gate);
    setStatus(card, gate.ready ? "Etiqueta teste aprovada. O lote completo esta liberado para geracao." : `Ainda ha pendencias: ${gate.problems.join(", ")}`, gate.ready ? "ok" : "warn");
  } catch (error) { setStatus(card, h(error.message || error), "bad"); }
}

async function generateBatch(card) {
  const id = card.dataset.productionBatch; const session = sessions.get(id); if (!session) return setStatus(card, "Por seguranca, gere novamente a etiqueta teste nesta sessao antes do lote completo.", "warn"); setBusy(card, `Montando ${number(session.objects.length)} etiquetas...`);
  try {
    const operations = await dataAction("operations.list", { campaignId: session.cid });
    const gate = batchGenerationGate({ rows: session.objects, crops: session.matrix.verifiedCrops, documentMode: session.mode, sender: session.sender, testModels: session.testModels, operations, productionBatchId: id, allowSimplified: session.mode === DOCUMENT_MODES.SIMPLIFIED }); renderGate(card, gate);
    if (!gate.ready) throw new Error(`Lote ainda bloqueado: ${gate.problems.join(", ")}`);
    const models = buildProductionModels(session.objects, session.matrix.verifiedCrops, { documentMode: session.mode, sender: session.sender, format: "10x15" });
    const pdf = await generateBatchLabelPdf(models, { postalHeader: session.postalHeader }); downloadBlob(pdf, `lote_etiquetas_${id.slice(0, 8)}_${models.length}.pdf`); setStatus(card, `Lote gerado com ${number(models.length)} etiquetas. A impressao e a entrega a operacao continuam sendo eventos separados e devem ser registradas somente quando ocorrerem.`, "ok");
  } catch (error) { setStatus(card, h(error.message || error), "bad"); }
}

async function prepareDcePackage(card) {
  const cid = campaignId(); const id = card.dataset.productionBatch; if (!cid || !id) return;
  await openAgencyDcePreparation({ campaignId: cid, productionBatchId: id, toast: notify, busy: (message) => { setBusy(card, message); return () => {}; }, onDone: async () => { const slot = document.querySelector("#production-workflow-slot"); if (slot) await renderWorkflow(slot); } });
}
function bindBatch(card) { card.querySelector("[data-prepare-dce]")?.addEventListener("click", () => prepareDcePackage(card)); card.querySelector("[data-prepare-test]").addEventListener("click", () => prepareTest(card)); card.querySelector("[data-approve-tests]").addEventListener("click", () => approveTests(card)); card.querySelector("[data-generate-batch]").addEventListener("click", () => generateBatch(card)); }
async function mount() {
  if (mounting) return; const root = document.querySelector(ROOT_SELECTOR); if (!root) return; const heading = [...root.querySelectorAll("h1")].find((node) => node.textContent?.trim() === "Lotes documentais e volumes"); if (!heading) return; const page = heading.closest(".page"); if (!page || page.querySelector("#production-workflow-slot")) return; mounting = true;
  try { const slot = document.createElement("div"); slot.id = "production-workflow-slot"; const firstGrid = page.querySelector(":scope > .grid"); if (firstGrid) page.insertBefore(slot, firstGrid); else page.appendChild(slot); await renderWorkflow(slot); mountOfflineSyncPanel(slot, { campaignId }); }
  catch (error) { notify(error.message || String(error), "error"); } finally { mounting = false; }
}
const observer = new MutationObserver(() => queueMicrotask(mount)); observer.observe(document.documentElement, { childList: true, subtree: true }); mount();
