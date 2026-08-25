import "./elections-cumulative-dashboard.css";
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

function manualMetricsFromCampaign(campaign) {
  const source = campaign?.profile?.manualMetrics || {};
  const read = (key) => {
    if (source[key] === "" || source[key] == null) return null;
    const number = Number(source[key]);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  return {
    addressReceived: read("addressReceived"),
    addressCleaned: read("addressCleaned"),
    updatedAt: String(source.updatedAt || ""),
  };
}

function applyManualOverrides(autoMetrics, campaign) {
  const metrics = { ...autoMetrics };
  const manual = manualMetricsFromCampaign(campaign);
  if (manual.addressReceived != null) metrics.addressReceived = manual.addressReceived;
  if (manual.addressCleaned != null) metrics.addressCleaned = manual.addressCleaned;
  return { metrics, manual };
}

function dailyOperationRows(rows) {
  const groups = new Map();
  const ensure = (date) => {
    if (!groups.has(date)) {
      groups.set(date, {
        date,
        generated: { pac: 0, sedex: 0 },
        posted: { pac: 0, sedex: 0, hasBreakdown: false },
      });
    }
    return groups.get(date);
  };

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = String(row.occurredAt || row.createdAt || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const quantity = Number(row.quantity || 0);
    const type = String(row.type || "").toUpperCase();
    const service = String(row.service || "").toUpperCase();
    const metadata = row.metadata || {};
    const group = ensure(date);

    if (type === "LABEL_GENERATED") {
      if (service === "PAC") group.generated.pac += quantity;
      if (service === "SEDEX") group.generated.sedex += quantity;
    }

    if (type === "POSTING_COMPLETED") {
      const metaPac = Number(metadata.pac || metadata.labelsPac || 0);
      const metaSedex = Number(metadata.sedex || metadata.labelsSedex || 0);
      if (metaPac || metaSedex) {
        group.posted.pac += metaPac;
        group.posted.sedex += metaSedex;
        group.posted.hasBreakdown = true;
      } else if (service === "PAC") {
        group.posted.pac += quantity;
        group.posted.hasBreakdown = true;
      } else if (service === "SEDEX") {
        group.posted.sedex += quantity;
        group.posted.hasBreakdown = true;
      }
    }
  });

  return [...groups.values()]
    .map((group) => {
      const source = group.posted.hasBreakdown ? group.posted : group.generated;
      const pac = Number(source.pac || 0);
      const sedex = Number(source.sedex || 0);
      return { date: group.date, pac, sedex, total: pac + sedex };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function formatDate(value) {
  const text = String(value || "");
  const date = text.slice(0, 10);
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}/${month}/${year}` : text;
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

function notify(message, type = "info") {
  const box = document.querySelector("#elections-toast");
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._manualMetricsTimer);
  box._manualMetricsTimer = setTimeout(() => { box.className = "elections-toast"; }, 4200);
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

function manualMetricForLabel(manual, label) {
  if (label === "Cadastros recebidos") return manual.addressReceived;
  if (label === "Higienizados") return manual.addressCleaned;
  return null;
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

function renderDailyDiary(section, operations) {
  if (!section) return;
  setText(section.querySelector("h2"), "Diário da operação");
  setText(section.querySelector(".section-title p"), "Produção diária consolidada por serviço.");

  const rows = dailyOperationRows(operations);
  const totals = rows.reduce((sum, row) => ({
    pac: sum.pac + row.pac,
    sedex: sum.sedex + row.sedex,
    total: sum.total + row.total,
  }), { pac: 0, sedex: 0, total: 0 });

  const markup = rows.length
    ? `<div class="daily-diary-table-wrap"><table class="daily-diary-table" aria-label="Diário acumulado da operação">
        <thead><tr><th>Data</th><th>PAC</th><th>SEDEX</th><th>Total</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${formatDate(row.date)}</td><td>${formatNumber(row.pac)}</td><td>${formatNumber(row.sedex)}</td><td><strong>${formatNumber(row.total)}</strong></td></tr>`).join("")}</tbody>
        <tfoot><tr><th>TOTAL GERAL</th><th>${formatNumber(totals.pac)}</th><th>${formatNumber(totals.sedex)}</th><th>${formatNumber(totals.total)}</th></tr></tfoot>
      </table></div>`
    : '<div class="empty">Nenhum quantitativo diário registrado.</div>';

  let diary = section.querySelector("[data-daily-diary]");
  if (!diary) {
    section.querySelector(".timeline")?.remove();
    diary = document.createElement("div");
    diary.dataset.dailyDiary = "true";
    section.appendChild(diary);
  }
  if (diary.innerHTML !== markup) diary.innerHTML = markup;
}

function manualEditorMarkup(campaign, manual) {
  const updated = manual.updatedAt ? `Última atualização: ${formatDate(manual.updatedAt)}` : "Ainda não atualizado manualmente";
  return `<section class="manual-metrics-panel" data-manual-metrics-panel>
    <div class="manual-metrics-copy">
      <strong>Indicadores manuais</strong>
      <span>Use estes campos para números que não vêm automaticamente dos lotes.</span>
      <small>${updated}</small>
    </div>
    <form data-manual-metrics-form>
      <label><span>Base recebida</span><input name="addressReceived" type="number" min="0" step="1" value="${manual.addressReceived ?? ""}" placeholder="Automático"></label>
      <label><span>Higienizados</span><input name="addressCleaned" type="number" min="0" step="1" value="${manual.addressCleaned ?? ""}" placeholder="Automático"></label>
      <button type="submit" class="primary">Salvar indicadores</button>
    </form>
    <button type="button" class="manual-metrics-toggle" data-manual-metrics-toggle aria-expanded="false">Atualizar indicadores manuais</button>
  </section>`;
}

function ensureManualEditor(campaign, manual) {
  const page = root?.querySelector(".page");
  const head = page?.querySelector(":scope > .page-head");
  if (!page || !head) return;
  let panel = page.querySelector("[data-manual-metrics-panel]");
  if (!panel) {
    const holder = document.createElement("div");
    holder.innerHTML = manualEditorMarkup(campaign, manual);
    panel = holder.firstElementChild;
    head.insertAdjacentElement("afterend", panel);

    panel.querySelector("[data-manual-metrics-toggle]")?.addEventListener("click", (event) => {
      const expanded = panel.classList.toggle("is-open");
      event.currentTarget.setAttribute("aria-expanded", String(expanded));
      event.currentTarget.textContent = expanded ? "Fechar edição" : "Atualizar indicadores manuais";
    });

    panel.querySelector("[data-manual-metrics-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button[type='submit']");
      const values = Object.fromEntries(new FormData(form));
      const parse = (value) => {
        if (String(value).trim() === "") return null;
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) throw new Error("Informe valores inteiros iguais ou maiores que zero.");
        return Math.round(number);
      };

      button.disabled = true;
      button.textContent = "Salvando…";
      try {
        const addressReceived = parse(values.addressReceived);
        const addressCleaned = parse(values.addressCleaned);
        const profile = {
          ...(campaign.profile || {}),
          manualMetrics: {
            addressReceived,
            addressCleaned,
            updatedAt: new Date().toISOString(),
            source: "DASHBOARD_MANUAL",
          },
        };
        const updatedCampaign = await dataAction("campaign.upsert", {
          id: campaign.id,
          name: campaign.name,
          cnpj: campaign.cnpj,
          candidateName: campaign.candidateName,
          office: campaign.office,
          status: campaign.status,
          profile,
        });
        const id = campaignId();
        const cached = cache.get(id);
        if (cached) {
          cached.campaign = updatedCampaign;
          cache.set(id, cached);
        }
        panel.remove();
        notify("Indicadores manuais atualizados.", "success");
        scheduleRefresh();
      } catch (error) {
        notify(error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = "Salvar indicadores";
      }
    });
  }
}

function applyDashboard(autoMetrics, operations, tracking, campaign) {
  if (!isDashboardVisible()) return;
  applying = true;
  try {
    const head = root.querySelector(".page-head");
    setText(head?.querySelector(".eyebrow"), "OPERAÇÃO ACUMULADA");
    setText(head?.querySelector("h1"), "Dashboard operacional");
    setText(head?.querySelector("p:not(.eyebrow)"), "Resumo consolidado de tudo que está registrado na base desta operação.");

    const { metrics, manual } = applyManualOverrides(autoMetrics, campaign);
    const trackedPosted = Number(tracking?.total?.posted || 0);
    const trackedDelivered = Number(tracking?.total?.delivered || 0);
    metrics.posted = Math.max(metrics.posted, trackedPosted);
    metrics.delivered = Math.max(metrics.delivered, trackedDelivered);

    ensureManualEditor(campaign, manual);

    const grid = root.querySelector(".grid.metrics");
    if (grid) {
      ensureExtraMetric(grid, "Postados", "posted");
      ensureExtraMetric(grid, "Entregues pelos Correios", "delivered");
      grid.querySelectorAll(".metric-card").forEach((card) => {
        const label = card.querySelector("span")?.textContent || "";
        const value = metricByLabel(metrics, label);
        if (value !== undefined) setText(card.querySelector("strong"), formatNumber(value));
        const manualValue = manualMetricForLabel(manual, label);
        card.classList.toggle("is-manual", manualValue != null);
        setText(card.querySelector("small"), manualValue != null ? "Informado manualmente" : "Acumulado automático");
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

    renderDailyDiary(sections[1], operations);

    const dates = (Array.isArray(operations) ? operations : [])
      .map((item) => String(item.occurredAt || "").slice(0, 10))
      .filter(Boolean)
      .sort();
    if (dates.length && head) {
      let period = head.querySelector("[data-cumulative-period]");
      if (!period) {
        period = document.createElement("small");
        period.dataset.cumulativePeriod = "true";
        period.className = "cumulative-period";
        head.querySelector("div")?.appendChild(period);
      }
      const from = formatDate(dates[0]);
      const to = formatDate(dates[dates.length - 1]);
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
  if (cached) applyDashboard(cached.metrics, cached.operations, cached.tracking, cached.campaign);

  try {
    const [operations, tracking, campaign] = await Promise.all([
      dataAction("operations.list", { campaignId: id }),
      dataAction("tracking.summary", { campaignId: id }).catch(() => null),
      dataAction("campaign.get", { campaignId: id }),
    ]);
    const metrics = accumulateOperations(operations);
    cache.set(id, { metrics, operations, tracking, campaign });
    applyDashboard(metrics, operations, tracking, campaign);
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
    root.querySelector("[data-manual-metrics-panel]")?.remove();
    scheduleRefresh();
  }
});

new MutationObserver(scheduleRefresh).observe(root, { childList: true, subtree: true });
scheduleRefresh();

export { accumulateOperations, dailyOperationRows, applyManualOverrides };
