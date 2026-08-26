import { dataAction } from "./api.js";

const ROOT = document.querySelector("#elections-app");

function h(value) {
  return String(value ?? "").replace(/[&<>'\"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;"
  }[char]));
}

function campaignId() {
  return document.querySelector("#campaign-select")?.value || "";
}

function notify(message, type = "info") {
  const box = document.querySelector("#elections-toast");
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._dceTimer);
  box._dceTimer = setTimeout(() => { box.className = "elections-toast"; }, 4800);
}

function setBusy(label) {
  document.querySelector("#dce-preflight-busy")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "dce-preflight-busy";
  overlay.className = "busy-overlay";
  overlay.innerHTML = `<div class="busy-card"><div class="spinner"></div><strong>${h(label)}</strong></div>`;
  document.body.appendChild(overlay);
  return () => overlay.remove();
}

function statusOf(card) {
  const chip = card.querySelector(".status");
  return String(chip?.dataset.statusCode || chip?.textContent || "").trim().toUpperCase();
}

function dceCards() {
  return [...(ROOT?.querySelectorAll(".page .card") || [])].filter((card) => {
    const heading = card.querySelector("h2")?.textContent || "";
    const mode = [...card.querySelectorAll(".matrix-box")].find((box) => {
      const label = box.querySelector("span")?.textContent?.trim();
      return label === "Documento" || label === "Modo";
    });
    const modeText = mode?.querySelector("strong")?.textContent || "";
    return card.querySelector("[data-volumes]") && (/DC-e/i.test(heading) || /DC-e/i.test(modeText));
  });
}

function issueMarkup(issues) {
  return `<div class="dce-preflight-issues"><strong>${issues.length} objeto(s) com pendências fiscais</strong>${issues.slice(0, 20).map((item) => `<div><code>${h(item.trackingCode)}</code><span>${h((item.issues || []).join(" "))}</span></div>`).join("")}${issues.length > 20 ? `<small>+ ${issues.length - 20} ocorrências</small>` : ""}</div>`;
}

function clientPortalLinkMarkup(className = "ghost") {
  return `<a class="${className}" data-client-portal-link href="/portal" target="_blank" rel="noopener">Abrir Portal do Cliente</a>`;
}

function refreshCurrentCampaign() {
  const select = document.querySelector("#campaign-select");
  if (select) select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function prepare(card, batchId, button) {
  const cid = campaignId();
  if (!cid) return notify("Selecione uma operação.", "error");
  const stop = setBusy("Validando os dados fiscais do lote...");
  button.disabled = true;
  try {
    const result = await dataAction("productionDce.preflight", {
      campaignId: cid,
      productionBatchId: batchId,
    });
    card.querySelector(".dce-preflight-issues")?.remove();
    if (!result.ready) {
      button.disabled = false;
      button.textContent = "Revisar pendências da DC-e";
      button.insertAdjacentHTML("afterend", issueMarkup(result.issues || []));
      notify("O lote ainda possui pendências fiscais. Corrija os dados antes de liberá-lo para autorização.", "info");
      return;
    }
    notify(`${result.total} documentos validados. O lote fiscal está preparado.`, "success");
    refreshCurrentCampaign();
  } catch (error) {
    button.disabled = false;
    notify(error.message, "error");
  } finally {
    stop();
  }
}

function ensureClientState(actions, batchId, status, message, className = "", showClientPortal = false) {
  if (!actions) return;
  const existing = actions.querySelector(`[data-dce-client-access="${CSS.escape(batchId)}"]`);
  if (existing?.dataset.dceState === status) return;
  existing?.remove();
  const wrapper = document.createElement("div");
  wrapper.className = `dce-client-access ${className}`.trim();
  wrapper.dataset.dceClientAccess = batchId;
  wrapper.dataset.dceState = status;
  wrapper.innerHTML = `<span>${h(message)}</span>${showClientPortal ? clientPortalLinkMarkup("secondary") : ""}`;
  actions.appendChild(wrapper);
}

function authorizationMessage(status) {
  if (status === "DCE_PARTIAL") {
    return "Autorização fiscal parcial registrada. O cliente pode entrar no Portal do Cliente para continuar somente os documentos pendentes com o próprio e-CNPJ A1.";
  }
  if (status === "DCE_RESERVED") {
    return "Autorização fiscal iniciada. O cliente pode entrar no Portal do Cliente para continuar o lote com o próprio e-CNPJ A1.";
  }
  return "Lote fiscal validado pela agência. O cliente já pode entrar no Portal do Cliente e autorizar a DC-e com o próprio e-CNPJ A1.";
}

function decorate() {
  dceCards().forEach((card) => {
    const volumeButton = card.querySelector("[data-volumes]");
    const batchId = volumeButton?.dataset.volumes;
    if (!batchId) return;
    const status = statusOf(card);
    const actions = volumeButton.closest(".actions") || card;
    const preflight = actions.querySelector(`[data-dce-preflight="${CSS.escape(batchId)}"]`);
    const access = actions.querySelector(`[data-dce-client-access="${CSS.escape(batchId)}"]`);

    if (status === "AWAITING_DCE_PREPARATION") {
      access?.remove();
      if (preflight) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary";
      button.dataset.dcePreflight = batchId;
      button.textContent = "Validar e preparar lote DC-e";
      button.title = "Valida destinatários, endereços, conteúdo, valor e códigos municipais antes de preparar o lote fiscal.";
      button.addEventListener("click", () => prepare(card, batchId, button));
      actions.appendChild(button);
      return;
    }

    preflight?.remove();

    if (["DCE_PREPARED", "DCE_RESERVED", "DCE_PARTIAL"].includes(status)) {
      ensureClientState(actions, batchId, status, authorizationMessage(status), status === "DCE_PARTIAL" ? "warn" : "info", true);
      return;
    }

    if (status === "READY_FOR_UNIFIED_LABEL") {
      ensureClientState(actions, batchId, status, "DC-e autorizada. O lote está liberado e retornou ao fluxo de produção da etiqueta unificada.", "ok", false);
      return;
    }

    access?.remove();
  });
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    decorate();
  });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
decorate();
