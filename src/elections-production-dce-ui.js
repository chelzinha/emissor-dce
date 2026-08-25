import { dataAction } from "./api.js";

const ROOT = document.querySelector("#elections-app");

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
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
    const mode = [...card.querySelectorAll(".matrix-box")].find((box) => box.querySelector("span")?.textContent?.trim() === "Documento" || box.querySelector("span")?.textContent?.trim() === "Modo");
    const modeText = mode?.querySelector("strong")?.textContent || "";
    return card.querySelector("[data-volumes]") && (/DC-e/i.test(heading) || /DC-e/i.test(modeText));
  });
}

function issueMarkup(issues) {
  return `<div class="dce-preflight-issues"><strong>${issues.length} objeto(s) com pendências fiscais</strong>${issues.slice(0, 20).map((item) => `<div><code>${h(item.trackingCode)}</code><span>${h((item.issues || []).join(" "))}</span></div>`).join("")}${issues.length > 20 ? `<small>+ ${issues.length - 20} ocorrências</small>` : ""}</div>`;
}

function portalLinkMarkup(className = "ghost") {
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
      notify("O lote ainda possui pendências fiscais. Corrija os dados antes de liberá-lo ao cliente.", "info");
      return;
    }
    notify(`${result.total} documentos validados. O lote foi liberado para autorização do cliente.`, "success");
    refreshCurrentCampaign();
  } catch (error) {
    button.disabled = false;
    notify(error.message, "error");
  } finally {
    stop();
  }
}

function addClientPortalAccess(actions, batchId, message, className = "") {
  if (!actions || actions.querySelector(`[data-dce-client-access="${CSS.escape(batchId)}"]`)) return;
  const wrapper = document.createElement("div");
  wrapper.className = `dce-client-access ${className}`.trim();
  wrapper.dataset.dceClientAccess = batchId;
  wrapper.innerHTML = `<span>${h(message)}</span>${portalLinkMarkup("secondary")}`;
  actions.appendChild(wrapper);
}

function decorate() {
  dceCards().forEach((card) => {
    const volumeButton = card.querySelector("[data-volumes]");
    const batchId = volumeButton?.dataset.volumes;
    if (!batchId) return;
    const status = statusOf(card);
    const actions = volumeButton.closest(".actions") || card;

    card.querySelectorAll("[data-dce-preflight], [data-dce-client-access]").forEach((node) => node.remove());

    if (status === "AWAITING_DCE_PREPARATION") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary";
      button.dataset.dcePreflight = batchId;
      button.textContent = "Validar e preparar lote DC-e";
      button.title = "Valida destinatários, endereços, conteúdo, valor e códigos municipais antes de liberar o lote ao cliente.";
      button.addEventListener("click", () => prepare(card, batchId, button));
      actions.appendChild(button);
      return;
    }

    if (status === "DCE_PREPARED") {
      addClientPortalAccess(actions, batchId, "Lote aguardando autorização do cliente com e-CNPJ A1.", "warn");
      return;
    }

    if (status === "DCE_RESERVED") {
      addClientPortalAccess(actions, batchId, "Autorização fiscal iniciada pelo cliente. Ele pode continuar pelo Portal.", "info");
      return;
    }

    if (status === "DCE_PARTIAL") {
      addClientPortalAccess(actions, batchId, "Autorização parcial. O cliente deve abrir o Portal para concluir ou revisar rejeições.", "warn");
      return;
    }

    if (status === "READY_FOR_UNIFIED_LABEL") {
      addClientPortalAccess(actions, batchId, "DC-e autorizada. O lote retornou ao fluxo de impressão.", "ok");
    }
  });
}

const observer = new MutationObserver(() => queueMicrotask(decorate));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
decorate();
