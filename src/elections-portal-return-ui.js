import "./elections-portal-return.css";
import { analyzePortalReturn, savePortalReturn } from "./portal-return-service.js";
import { cachePortalReturnAssets } from "./portal-assets.js";
import { loadPostalVendors } from "./postal-vendors.js";

const ROOT_SELECTOR = "#elections-app";
let currentAnalysis = null;
let currentFiles = null;
let mountedFor = null;

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function number(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function campaignId() {
  return document.querySelector("#campaign-select")?.value || "";
}

function notify(message, type = "info") {
  const box = document.querySelector("#elections-toast");
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  setTimeout(() => { box.className = "elections-toast"; }, 4800);
}

function setProgress(message, detail = "") {
  const status = document.querySelector("#portal-return-live-status");
  if (!status) return;
  status.innerHTML = `<span class="return-spinner"></span><div><strong>${h(message)}</strong>${detail ? `<small>${h(detail)}</small>` : ""}</div>`;
  status.hidden = false;
}

function clearProgress() {
  const status = document.querySelector("#portal-return-live-status");
  if (status) status.hidden = true;
}

function matrixLabel(status) {
  const labels = {
    AUTO_VERIFIED: "Autoverificado",
    VERIFIED: "Verificado",
    TEXT_ONLY: "Identificado pelo texto",
    MANUAL_REVIEW: "Revisao manual",
    MISSING: "Ausente",
    DIVERGENT: "Divergente",
  };
  return labels[status] || status || "—";
}

function matrixClass(status) {
  if (["AUTO_VERIFIED", "VERIFIED"].includes(status)) return "ok";
  if (["TEXT_ONLY", "MANUAL_REVIEW"].includes(status)) return "warn";
  return "bad";
}

function renderAnalysis(analysis) {
  const slot = document.querySelector("#portal-return-analysis");
  if (!slot) return;
  const summary = analysis.summary || {};
  const rows = analysis.rows || [];
  const problems = rows.filter((row) => row.errors?.length || ["MISSING", "DIVERGENT"].includes(row.matrix?.status));
  const sample = rows.slice(0, 12);
  const diagnostics = analysis.matrixResult?.diagnostics || {};

  slot.innerHTML = `<div class="return-analysis">
    <div class="return-analysis-head">
      <div><p class="eyebrow">AUDITORIA CONCLUIDA</p><h3>${number(summary.total)} objetos encontrados</h3><p>CSV, paginas dos PDFs e Data Matrix foram cruzados pelo SRO.</p></div>
      <span class="return-ready ${summary.readyForProduction ? "ok" : "bad"}">${summary.readyForProduction ? "PRONTO PARA REGISTRO" : "REVISAR PENDENCIAS"}</span>
    </div>
    <div class="return-metrics">
      <div><span>Total</span><strong>${number(summary.total)}</strong></div>
      <div><span>PAC</span><strong>${number(summary.pac)}</strong></div>
      <div><span>SEDEX</span><strong>${number(summary.sedex)}</strong></div>
      <div><span>Autoverificados</span><strong>${number(summary.autoVerified)}</strong></div>
      <div><span>Texto / manual</span><strong>${number((summary.textOnly || 0) + (summary.manualReview || 0))}</strong></div>
      <div class="${summary.missing ? "metric-bad" : ""}"><span>Data Matrix ausente</span><strong>${number(summary.missing)}</strong></div>
      <div class="${summary.divergent ? "metric-bad" : ""}"><span>Divergentes</span><strong>${number(summary.divergent)}</strong></div>
      <div class="${summary.invalid ? "metric-bad" : ""}"><span>CSV invalido</span><strong>${number(summary.invalid)}</strong></div>
    </div>
    <div class="return-diagnostic-note">Leitura reforcada em ${number(diagnostics.reinforced)} paginas. Identificados pelo proprio Data Matrix: ${number(diagnostics.byCode)}.</div>
    ${problems.length ? `<div class="return-problems"><strong>${number(problems.length)} objetos exigem atencao antes da producao.</strong><div class="problem-list">${problems.slice(0, 20).map((row) => `<span>${h(row.trackingCode || `linha ${row.rowNumber}`)} — ${h([...new Set([...(row.errors || []), row.matrix?.status].filter(Boolean))].join(", "))}</span>`).join("")}</div>${problems.length > 20 ? `<small>+ ${number(problems.length - 20)} ocorrencias</small>` : ""}</div>` : ""}
    <div class="table-wrap return-sample"><table><thead><tr><th>SRO</th><th>Servico</th><th>Destinatario</th><th>Data Matrix</th><th>Origem</th><th>Pagina</th></tr></thead><tbody>${sample.map((row) => `<tr><td><code>${h(row.trackingCode)}</code></td><td>${h(row.service)}</td><td>${h(row.recipient?.name || "—")}</td><td><span class="status ${matrixClass(row.matrix?.status)}">${h(matrixLabel(row.matrix?.status))}</span></td><td>${h(row.matrix?.fileName || "—")}</td><td>${h(row.matrix?.page || "—")}</td></tr>`).join("")}</tbody></table></div>
    <div class="return-actions">
      <button id="save-portal-return" class="primary">Registrar retorno no sistema</button>
      <button id="reanalyze-portal-return" class="ghost">Analisar novamente</button>
    </div>
    <p class="return-footnote">O registro pode ser salvo com pendencias para auditoria, mas somente um retorno <strong>READY</strong> sera liberado para Declaracao Simplificada ou DC-e.</p>
  </div>`;

  slot.querySelector("#save-portal-return")?.addEventListener("click", saveCurrentAnalysis);
  slot.querySelector("#reanalyze-portal-return")?.addEventListener("click", () => runAnalysis());
}

async function runAnalysis() {
  const csvFile = document.querySelector("#portal-return-csv")?.files?.[0];
  const pdfFiles = document.querySelector("#portal-return-pdfs")?.files;
  if (!csvFile) return notify("Selecione o CSV das postagens exportado pelo Portal Postal.", "error");
  if (!pdfFiles?.length) return notify("Selecione o PDF ou PDFs das etiquetas do Portal Postal.", "error");

  currentAnalysis = null;
  currentFiles = { csvFile, pdfFiles: [...pdfFiles] };
  const slot = document.querySelector("#portal-return-analysis");
  if (slot) slot.innerHTML = "";

  try {
    setProgress("Carregando leitor local", "Preparando pdf.js e ZXing no navegador");
    const { pdfjsLib, ZXing } = await loadPostalVendors();
    setProgress("Auditando etiquetas", "Lendo paginas e tentando decodificar o Data Matrix");
    currentAnalysis = await analyzePortalReturn({
      csvFile,
      pdfFiles,
      pdfjsLib,
      ZXing,
      onProgress: (progress) => {
        if (progress.stage === "matrix") {
          setProgress("Auditando Data Matrix", `${number(progress.processed)} de ${number(progress.totalPages)} paginas`);
        } else if (progress.message) setProgress(progress.message);
      },
    });
    renderAnalysis(currentAnalysis);
    notify("Auditoria concluida. Confira o resultado antes de registrar o retorno.", currentAnalysis.summary?.readyForProduction ? "success" : "info");
  } catch (error) {
    notify(error.message, "error");
    if (slot) slot.innerHTML = `<div class="notice warn">${h(error.message)}</div>`;
  } finally { clearProgress(); }
}

async function saveCurrentAnalysis() {
  const cid = campaignId();
  if (!cid) return notify("Selecione uma campanha.", "error");
  if (!currentAnalysis || !currentFiles) return notify("Analise o retorno antes de salvar.", "error");
  const portalExportId = document.querySelector("#portal-export-link")?.value || "";
  const button = document.querySelector("#save-portal-return");
  if (button) button.disabled = true;
  try {
    setProgress("Registrando retorno", "Salvando objetos e auditoria no diario operacional");
    const saved = await savePortalReturn({
      campaignId: cid,
      portalExportId,
      csvFile: currentFiles.csvFile,
      analysis: currentAnalysis,
      onProgress: (progress) => setProgress(progress.message || "Registrando retorno"),
    });
    try {
      await cachePortalReturnAssets({
        portalReturnId: saved.id,
        campaignId: cid,
        csvFile: currentFiles.csvFile,
        pdfFiles: currentFiles.pdfFiles,
        csvSha256: currentAnalysis.csvSha256,
      });
    } catch (cacheError) {
      console.warn("Nao foi possivel manter os PDFs no cache local", cacheError);
    }
    notify(`Retorno registrado: ${number(saved.total)} objetos, status ${saved.status}.`, saved.status === "READY" ? "success" : "info");
    setTimeout(() => location.reload(), 900);
  } catch (error) {
    notify(error.message, "error");
    if (button) button.disabled = false;
  } finally { clearProgress(); }
}

function uploadTemplate() {
  const exports = [...document.querySelectorAll("[data-download-export]")].map((button) => ({
    id: button.dataset.downloadExport,
    label: button.closest("tr")?.querySelector("td:nth-child(2)")?.textContent?.trim() || button.dataset.downloadExport,
  }));
  return `<section class="card portal-return-upload" id="portal-return-upload-card">
    <div class="section-title"><div><h2>Importar retorno do Portal Postal</h2><p>Selecione o CSV das postagens e o PDF das etiquetas originais.</p></div><span class="return-security">Processamento dos PDFs no navegador</span></div>
    <div class="return-upload-grid">
      <label class="return-file"><span>1. CSV das postagens</span><input id="portal-return-csv" type="file" accept=".csv,text/csv"><small>Contem SRO, destinatario, endereco, servico e dados da postagem.</small></label>
      <label class="return-file"><span>2. PDF das etiquetas</span><input id="portal-return-pdfs" type="file" accept=".pdf,application/pdf" multiple><small>O Data Matrix sera recortado das etiquetas originais e associado pelo SRO.</small></label>
    </div>
    <div class="return-link-row"><label class="field"><span>Relacionar a exportacao anterior (opcional)</span><select id="portal-export-link"><option value="">Sem vinculo manual</option>${exports.map((item) => `<option value="${h(item.id)}">${h(item.label)}</option>`).join("")}</select></label><button id="analyze-portal-return" class="primary">Analisar CSV + PDF</button></div>
    <div id="portal-return-live-status" class="return-live-status" hidden></div>
    <div id="portal-return-analysis"></div>
  </section>`;
}

function mount() {
  const root = document.querySelector(ROOT_SELECTOR);
  if (!root) return;
  const heading = [...root.querySelectorAll("h1")].find((node) => node.textContent?.trim() === "PDF + CSV das postagens");
  if (!heading) { mountedFor = null; return; }
  const page = heading.closest(".page");
  if (!page || page.querySelector("#portal-return-upload-card")) return;
  const cid = campaignId();
  const key = `${cid}:returns`;
  mountedFor = key;
  const firstCard = page.querySelector(":scope > .card");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = uploadTemplate();
  const upload = wrapper.firstElementChild;
  if (firstCard) page.insertBefore(upload, firstCard);
  else page.appendChild(upload);
  page.querySelector(".notice.warn")?.remove();
  upload.querySelector("#analyze-portal-return")?.addEventListener("click", runAnalysis);
}

const observer = new MutationObserver(() => queueMicrotask(mount));
observer.observe(document.documentElement, { childList: true, subtree: true });
mount();
