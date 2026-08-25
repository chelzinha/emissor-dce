import { dataAction } from "./api.js";

const root = document.querySelector("#elections-app");
const cache = new Map();
let scheduled = false;
let applying = false;

function emptyMetrics() {
  return {
    addressReceived: 0,
    addressCleaned: 0,
    portalExported: 0,
    portalReturned: 0,
    labelsPac: 0,
    labelsSedex: 0,
    labelsPrinted: 0,
    labelsHandedOff: 0,
    dcePrepared: 0,
    dceAuthorized: 0,
    posted: 0,
    delivered: 0,
  };
}

function accumulateOperations(rows) {
  const metrics = emptyMetrics();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const quantity = Number(row.quantity || 0);
    const type = String(row.type || "").toUpperCase();
    const service = String(row.service || "").toUpperCase();
    const metadata = row.metadata || {};

    if (type === "ADDRESS_LIST_RECEIVED") metrics.addressReceived += quantity;
    if (type === "ADDRESS_CLEANING_COMPLETED") metrics.addressCleaned += quantity;
    if (type === "PORTAL_CSV_EXPORTED") metrics.portalExported += quantity;
    if (type === "PORTAL_RETURN_IMPORTED") metrics.portalReturned += quantity;
    if (type === "LABEL_GENERATED" && service === "PAC") metrics.labelsPac += quantity;
    if (type === "LABEL_GENERATED" && service === "SEDEX") metrics.labelsSedex += quantity;
    if (type === "LABEL_PRINTED") metrics.labelsPrinted += quantity;
    if (type === "LABEL_HANDOFF") metrics.labelsHandedOff += quantity;
    if (type === "DCE_PREPARED" && String(metadata.status || "") !== "AWAITING_DCE_PREPARATION") metrics.dcePrepared += quantity;
    if (type === "DCE_AUTHORIZED") metrics.dceAuthorized += quantity;
    if (type === "POSTING_COMPLETED") metrics.posted += quantity;
    if (type === "TRACKING_DELIVERED") metrics.delivered += quantity;
  });
  return metrics;
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function setText(node, value) {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}

function isDashboardVisible() {
  return Boolean(root?.querySelector(".page-head h1")?.textContent?.includes("Dashboard operacional"));
}

function campaignId() {
  return String(root?.querySelector("#campaign-select")?.value || "");
}

function metricByLabel(metrics, label) {
  const values = {
    "Cadastros recebidos": metrics.addressReceived,
    "Higienizados": metrics.addressCleaned,
    "Enviados ao Portal": metrics.portalExported,
    "Retornados do Portal": metrics.portalReturned,
    "PAC emitidos": metrics.labelsPac,
    "SEDEX emitidos": metrics.labelsSedex,
    "Etiquetas impressas": metrics.labelsPrinted,
    "Entregues à operação": metrics.labelsHandedOff,
    "Postados": metrics.posted,
    "Entregues pelos Correios": metrics.delivered,
  };
  return values[label];
}

function ensureExtraMetric(grid, label, key) {
  let card = grid.querySelector(`[data-cumulative-metric="${key}"]`);
  if (!card) {
    card = document.createElement("article");
    card.className = "card metric-card";
    card.dataset.cumulativeMetric = key;
    card.innerHTML = `<span>${label}</span><strong>0</strong><small>Acumulado</small>`;
    grid.appendChild(card);
  }
  return card;
}

function ensurePostedProgress(section) {
  const existing = [...section.querySelectorAll(".progress-row")].find((row) => row.querySelector("span")?.textContent === "Postados");
  if (existing) return existing;
  const row = document.createElement("div");
  row.className = "progress-row";
  row.dataset.cumulativeProgress = "posted";
  row.innerHTML = '<span>Postados</span><div class="progress-track"><i style="width:0%"></i></div><strong>0</strong>';
  section.appendChild(row);
  return row;
}

function applyDashboard(metrics, operations, tracking) {
  if (!isDashboardVisible()) return;
  applying = true;
  try {
    const head = root.querySelector(".page-head");
    setText(head?.querySelector(".eyebrow"), "OPERAÇÃO ACUMULADA");
    setText(head?.querySelector("h1"), "Dashboard operacional");
    setText(head?.querySelector("p:not(.eyebrow)"), "Resumo consolidado de tudo que está registrado na base desta operação.");

    const trackedPosted = Number(tracking?.total?.posted || 0);
    const trackedDelivered = Number(tracking?.total?.delivered || 0);
    metrics.posted = Math.max(metrics.posted, trackedPosted);
    metrics.delivered = Math.max(metrics.delivered, trackedDelivered);

    const grid = root.querySelector(".grid.metrics");
    if (grid) {
      ensureExtraMetric(grid, "Postados", "posted");
      ensureExtraMetric(grid, "Entregues pelos Correios", "delivered");
      grid.querySelectorAll(".metric-card").forEach((card) => {
        const label = card.querySelector("span")?.textContent || "";
        const value = metricByLabel(metrics, label);
        if (value !== undefined) setText(card.querySelector("strong"), formatNumber(value));
        setText(card.querySelector("small"), "Acumulado");
      });
    }

    const sections = root.querySelectorAll(".grid.two .card");
    const flow = sections[0];
    if (flow) {
      setText(flow.querySelector("h2"), "Fluxo acumulado");
      setText(flow.querySelector(".section-title p"), "Indicadores consolidados de todo o período da operação.");
      ensurePostedProgress(flow);
      const progressValues = {
        "Base recebida": metrics.addressReceived,
        "Higienizada": metrics.addressCleaned,
        "Portal": metrics.portalReturned,
        "Impressas": metrics.labelsPrinted,
        "Entregues": metrics.labelsHandedOff,
        "Postados": metrics.posted,
      };
      const base = Math.max(1, Number(metrics.addressReceived || 0));
      flow.querySelectorAll(".progress-row").forEach((row) => {
        const label = row.querySelector("span")?.textContent || "";
        const value = Number(progressValues[label] || 0);
        const pct = Math.min(100, Math.round(value / base * 100));
        const bar = row.querySelector("i");
        if (bar && bar.style.width !== `${pct}%`) bar.style.width = `${pct}%`;
        setText(row.querySelector("strong"), formatNumber(value));
      });
    }

    const timeline = sections[1];
    if (timeline) {
      setText(timeline.querySelector("h2"), "Histórico recente");
      setText(timeline.querySelector(".section-title p"), "Últimos eventos registrados em toda a operação.");
    }

    const dates = (Array.isArray(operations) ? operations : [])
      .map((item) => String(item.occurredAt || "").slice(0, 10))
      .filter(Boolean)
      .sort();
    if (dates.length && head) {
      let period = head.querySelector("[data-cumulative-period]");
      if (!period) {
        period = document.createElement("small");
        period.dataset.cumulativePeriod = "true";
        period.style.display = "block";
        period.style.marginTop = "8px";
        period.style.color = "#64748b";
        head.querySelector("div")?.appendChild(period);
      }
      const from = dates[0].split("-").reverse().join("/");
      const to = dates[dates.length - 1].split("-").reverse().join("/");
      setText(period, from === to ? `Dados acumulados em ${from}` : `Período acumulado: ${from} a ${to}`);
    }
  } finally {
    applying = false;
  }
}

async function refreshCumulativeDashboard() {
  if (!isDashboardVisible()) return;
  const id = campaignId();
  if (!id) return;

  const cached = cache.get(id);
  if (cached) applyDashboard(cached.metrics, cached.operations, cached.tracking);

  try {
    const [operations, tracking] = await Promise.all([
      dataAction("operations.list", { campaignId: id }),
      dataAction("tracking.summary", { campaignId: id }).catch(() => null),
    ]);
    const metrics = accumulateOperations(operations);
    cache.set(id, { metrics, operations, tracking });
    applyDashboard(metrics, operations, tracking);
  } catch (error) {
    console.warn("Não foi possível consolidar o dashboard acumulado.", error);
  }
}

function scheduleRefresh() {
  if (applying || scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    refreshCumulativeDashboard();
  }, 80);
}

root?.addEventListener("change", (event) => {
  if (event.target?.id === "campaign-select") {
    cache.delete(String(event.target.value || ""));
    scheduleRefresh();
  }
});

new MutationObserver(scheduleRefresh).observe(root, { childList: true, subtree: true });
scheduleRefresh();

export { accumulateOperations };
