const ROOT_SELECTOR = "#elections-app";
const EVENT_NAME = "portal-return:pdf-selection";
const STYLE_ID = "portal-return-multi-pdf-style";

let selectedFiles = [];
let selectedCampaignId = "";
let mountScheduled = false;
let synchronizing = false;
let mountedInput = null;

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char]));
}

export function portalPdfFileKey(file) {
  return [file?.name || "", Number(file?.size || 0), Number(file?.lastModified || 0)].join("::");
}

export function mergePortalPdfFiles(currentFiles = [], incomingFiles = []) {
  const map = new Map();
  for (const file of [...currentFiles, ...incomingFiles]) {
    const name = String(file?.name || "");
    const type = String(file?.type || "").toLowerCase();
    if (!name || (!name.toLowerCase().endsWith(".pdf") && type !== "application/pdf")) continue;
    map.set(portalPdfFileKey(file), file);
  }
  return [...map.values()];
}

function selectionSignature(files = selectedFiles) {
  return files.map(portalPdfFileKey).join("|");
}

function campaignId() {
  return document.querySelector("#campaign-select")?.value || "";
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .return-pdf-selection{margin-top:9px;padding:10px 11px;border:1px solid #d9e4ee;border-radius:11px;background:#f8fbfd}
    .return-pdf-selection-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px}
    .return-pdf-selection-head strong{font-size:12px;color:#213f5b}
    .return-pdf-selection-head button{border:0;background:transparent;color:#9b2c2c;font-size:11px;font-weight:750;cursor:pointer}
    .return-pdf-selection-list{display:grid;gap:6px}
    .return-pdf-selection-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 9px;border-radius:8px;background:#fff;color:#44576a;font-size:11px}
    .return-pdf-selection-item span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .return-pdf-selection-item button{flex:0 0 auto;border:0;background:#fff1f1;color:#9b2c2c;border-radius:7px;padding:4px 7px;font-size:10px;font-weight:750;cursor:pointer}
    .return-pdf-selection-empty{font-size:11px;color:#687b8d}
    .return-pdf-selection-note{display:block;margin-top:7px;font-size:10px;color:#637589;line-height:1.4}
  `;
  document.head.appendChild(style);
}

function syncNativeInput(input) {
  if (!input) return false;
  if (typeof DataTransfer !== "function") return false;
  const transfer = new DataTransfer();
  selectedFiles.forEach((file) => transfer.items.add(file));
  synchronizing = true;
  try {
    input.files = transfer.files;
  } finally {
    synchronizing = false;
  }
  return input.files?.length === selectedFiles.length;
}

function dispatchSelection() {
  document.dispatchEvent(new CustomEvent(EVENT_NAME, {
    detail: { files: [...selectedFiles] },
  }));
}

function clearStaleAnalysis() {
  document.querySelector("#portal-return-analysis")?.replaceChildren();
}

function updateAnalyzeButton() {
  const button = document.querySelector("#analyze-portal-return");
  if (!button) return;
  const setupReady = document.querySelector("#portal-label-setup-status")?.classList.contains("setup-ready");
  if (!selectedFiles.length) button.disabled = true;
  else if (setupReady) button.disabled = false;
}

function renderSelection(input) {
  const parent = input?.closest(".return-file") || input?.parentElement;
  if (!parent) return;
  let box = parent.querySelector("[data-portal-pdf-selection]");
  const signature = selectionSignature();
  if (box?.dataset.selectionSignature === signature) {
    updateAnalyzeButton();
    return;
  }
  if (!box) {
    box = document.createElement("div");
    box.dataset.portalPdfSelection = "1";
    box.className = "return-pdf-selection";
    parent.appendChild(box);
  }
  box.dataset.selectionSignature = signature;

  if (!selectedFiles.length) {
    box.innerHTML = `<div class="return-pdf-selection-empty">Nenhum PDF acumulado. Você pode adicionar os arquivos em seleções sucessivas.</div>`;
    updateAnalyzeButton();
    return;
  }

  box.innerHTML = `
    <div class="return-pdf-selection-head">
      <strong>${selectedFiles.length} PDF${selectedFiles.length > 1 ? "s" : ""} acumulado${selectedFiles.length > 1 ? "s" : ""}</strong>
      <button type="button" data-clear-portal-pdfs>Remover todos</button>
    </div>
    <div class="return-pdf-selection-list">
      ${selectedFiles.map((file) => `<div class="return-pdf-selection-item"><span title="${h(file.name)}">${h(file.name)}</span><button type="button" data-remove-portal-pdf="${h(portalPdfFileKey(file))}">Remover</button></div>`).join("")}
    </div>
    <small class="return-pdf-selection-note">Ao escolher outro PDF, ele será acrescentado aos anteriores em vez de substituí-los.</small>
  `;

  box.querySelector("[data-clear-portal-pdfs]")?.addEventListener("click", () => {
    selectedFiles = [];
    syncNativeInput(input);
    clearStaleAnalysis();
    renderSelection(input);
    dispatchSelection();
  });
  box.querySelectorAll("[data-remove-portal-pdf]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedFiles = selectedFiles.filter((file) => portalPdfFileKey(file) !== button.dataset.removePortalPdf);
      syncNativeInput(input);
      clearStaleAnalysis();
      renderSelection(input);
      dispatchSelection();
    });
  });
  updateAnalyzeButton();
}

function handleSelection(event) {
  if (synchronizing) return;
  const input = event.currentTarget;
  const incoming = [...(input.files || [])];
  if (!incoming.length) return;

  event.stopImmediatePropagation();
  selectedFiles = mergePortalPdfFiles(selectedFiles, incoming);
  const merged = syncNativeInput(input);
  clearStaleAnalysis();
  renderSelection(input);
  dispatchSelection();

  if (!merged) {
    const toast = document.querySelector("#elections-toast");
    if (toast) {
      toast.textContent = "Este navegador não permitiu acumular os PDFs. Selecione todos os arquivos de uma vez.";
      toast.className = "elections-toast show error";
    }
  }
}

function mount() {
  ensureStyle();
  const cid = campaignId();
  if (selectedCampaignId && cid !== selectedCampaignId) {
    selectedFiles = [];
    mountedInput = null;
  }
  selectedCampaignId = cid;

  const root = document.querySelector(ROOT_SELECTOR);
  const input = root?.querySelector("#portal-return-pdfs");
  if (!input) {
    mountedInput = null;
    return;
  }

  const isNewInput = input !== mountedInput;
  mountedInput = input;
  if (input.dataset.portalPdfAccumulatorReady !== "1") {
    input.dataset.portalPdfAccumulatorReady = "1";
    input.addEventListener("change", handleSelection, { capture: true });
  }

  if (isNewInput && selectedFiles.length) syncNativeInput(input);
  renderSelection(input);
  if (isNewInput && selectedFiles.length) dispatchSelection();
}

function scheduleMount() {
  if (mountScheduled) return;
  mountScheduled = true;
  queueMicrotask(() => {
    mountScheduled = false;
    mount();
  });
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  const observer = new MutationObserver(scheduleMount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleMount();
}
