import "./elections.css";
import "./elections-cumulative-dashboard.css";
import Papa from "papaparse";
import { getUser, login, logout } from "@netlify/identity";
import { dataAction, textDownload } from "./api.js";

const app = document.querySelector("#elections-app");
const toastBox = document.querySelector("#elections-toast");

const state = {
  user: null,
  campaigns: [],
  campaignId: "",
  campaign: null,
  tracking: null,
  view: "dashboard",
  addressLists: [],
  portalExports: [],
  portalReturns: [],
  productions: [],
  operations: [],
  dashboard: null,
};

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function toast(message, type = "info") {
  toastBox.textContent = message;
  toastBox.className = `elections-toast show ${type}`;
  setTimeout(() => { toastBox.className = "elections-toast"; }, 4200);
}

function busy(label = "Processando…") {
  document.querySelector("#busy-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "busy-overlay";
  overlay.className = "busy-overlay";
  overlay.innerHTML = `<div class="busy-card"><div class="spinner"></div><strong>${h(label)}</strong></div>`;
  document.body.appendChild(overlay);
  return () => overlay.remove();
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function formatDate(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value || "");
}

function statusClass(status) {
  const text = String(status || "").toUpperCase();
  if (["READY", "ACTIVE", "FINISHED", "EXPORTED", "IN_PRODUCTION", "READY_FOR_UNIFIED_LABEL"].includes(text)) return "ok";
  if (["REVIEW", "UPLOADING", "CLEANING", "AWAITING_DCE_PREPARATION"].includes(text)) return "warn";
  if (["ERROR", "REJECTED", "BLOCKED"].includes(text)) return "bad";
  return "";
}

function emptyOperationMetrics() {
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

function accumulatedOperationMetrics(rows) {
  const metrics = emptyOperationMetrics();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const quantity = Number(row.quantity || row.QUANTITY || 0);
    const type = String(row.type || row.TYPE || "").toUpperCase();
    const service = String(row.service || row.SERVICE || "").toUpperCase();
    const metadata = row.metadata || row.METADATA_JSON || {};

    if (type === "ADDRESS_LIST_RECEIVED") metrics.addressReceived += quantity;
    if (type === "ADDRESS_CLEANING_COMPLETED") metrics.addressCleaned += quantity;
    if (type === "PORTAL_CSV_EXPORTED") metrics.portalExported += quantity;
    if (type === "PORTAL_RETURN_IMPORTED") metrics.portalReturned += quantity;
    if (type === "LABEL_GENERATED" && service === "PAC") metrics.labelsPac += quantity;
    if (type === "LABEL_GENERATED" && service === "SEDEX") metrics.labelsSedex += quantity;
    if (type === "LABEL_PRINTED") metrics.labelsPrinted += quantity;
    if (type === "LABEL_HANDOFF") metrics.labelsHandedOff += quantity;
    if (type === "DCE_PREPARED" && String(metadata?.status || "") !== "AWAITING_DCE_PREPARATION") metrics.dcePrepared += quantity;
    if (type === "DCE_AUTHORIZED") metrics.dceAuthorized += quantity;
    if (type === "POSTING_COMPLETED") metrics.posted += quantity;
    if (type === "TRACKING_DELIVERED") metrics.delivered += quantity;
  });
  return metrics;
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
    const date = String(row.occurredAt || row.OCCURRED_AT || row.createdAt || row.CREATED_AT || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const quantity = Number(row.quantity || row.QUANTITY || 0);
    const type = String(row.type || row.TYPE || "").toUpperCase();
    const service = String(row.service || row.SERVICE || "").toUpperCase();
    const metadata = row.metadata || row.METADATA_JSON || {};
    const group = ensure(date);

    if (type === "LABEL_GENERATED") {
      if (service === "PAC") group.generated.pac += quantity;
      if (service === "SEDEX") group.generated.sedex += quantity;
    }

    if (type === "POSTING_COMPLETED") {
      const metaPac = Number(metadata?.pac || metadata?.labelsPac || 0);
      const metaSedex = Number(metadata?.sedex || metadata?.labelsSedex || 0);
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

function manualMetrics() {
  const source = state.campaign?.profile?.manualMetrics || {};
  const normalize = (value) => {
    if (value === "" || value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  };
  return {
    addressReceived: normalize(source.addressReceived),
    addressCleaned: normalize(source.addressCleaned),
    updatedAt: source.updatedAt || "",
  };
}

function renderAuth() {
  app.innerHTML = `<main class="elections-auth">
    <section class="elections-auth-copy">
      <span class="brand-pill">AGF ELEIÇÕES 2026</span>
      <h1>Da base de endereços à produção postal.</h1>
      <p>Campanhas, higienização, Portal Postal, declarações, etiquetas, volumes e acompanhamento operacional em um único fluxo.</p>
    </section>
    <section class="elections-auth-card">
      <h2>Acesso da agência</h2><p>Entre com a conta autorizada para operar as campanhas.</p>
      <form id="login-form" class="form-stack">
        <label class="field"><span>E-mail</span><input name="email" type="email" required></label>
        <label class="field"><span>Senha</span><input name="password" type="password" required></label>
        <button class="primary" type="submit">Entrar</button>
      </form>
      ${location.hostname === "localhost" ? '<button id="local-login" class="ghost" style="margin-top:12px;width:100%">Ambiente local</button>' : ""}
    </section>
  </main>`;
  app.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const stop = busy("Entrando…");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      state.user = await login(values.email, values.password);
      await start();
    } catch (error) { toast(error.message, "error"); }
    finally { stop(); }
  });
  app.querySelector("#local-login")?.addEventListener("click", async () => {
    state.user = { id: "local-development", email: "dev@localhost" };
    await start();
  });
}

const NAV = [
  ["dashboard", "Dashboard"], ["campaigns", "Campanhas"], ["bases", "Bases"],
  ["portal", "Portal Postal"], ["returns", "Retorno Portal"], ["production", "Produção"],
];

function shell(content) {
  const current = state.campaigns.find((item) => item.id === state.campaignId);
  app.innerHTML = `<div class="app-layout">
    <aside class="app-sidebar">
      <div class="app-brand"><div class="app-brand-mark">AGF</div><div><strong>Eleições 2026</strong><small>Operação postal</small></div></div>
      <nav class="app-nav">${NAV.map(([id, label]) => `<button type="button" data-view="${id}" class="${state.view === id ? "active" : ""}">${h(label)}</button>`).join("")}</nav>
      <div class="sidebar-foot">Modo conectado<br>Contingência local permanecerá independente.</div>
    </aside>
    <main class="app-main">
      <header class="app-topbar">
        <div class="campaign-picker"><strong>Campanha</strong><select id="campaign-select"><option value="">Selecione</option>${state.campaigns.map((c) => `<option value="${h(c.id)}" ${c.id === state.campaignId ? "selected" : ""}>${h(c.name || c.candidateName || c.cnpj)}</option>`).join("")}</select></div>
        <div class="user-box"><span>${h(current?.candidateName || "")}</span><span>${h(state.user?.email || "")}</span><button id="signout" class="ghost">Sair</button></div>
      </header>
      <section>${content}</section>
    </main>
  </div>`;
  app.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  app.querySelector("#campaign-select").addEventListener("change", async (event) => {
    state.campaignId = event.target.value;
    await refreshCampaignData();
    await renderCurrent();
  });
  app.querySelector("#signout").addEventListener("click", async () => { await logout(); state.user = null; renderAuth(); });
}

async function switchView(view) {
  state.view = view;
  await renderCurrent();
}

function pageHead(eyebrow, title, description, action = "") {
  return `<div class="page-head"><div><p class="eyebrow">${h(eyebrow)}</p><h1>${h(title)}</h1><p>${h(description)}</p></div>${action}</div>`;
}

async function loadCampaigns() {
  state.campaigns = await dataAction("campaigns.list");
  if (!state.campaignId && state.campaigns.length) state.campaignId = state.campaigns[0].id;
}

async function refreshCampaignData() {
  if (!state.campaignId) return;
  const payload = { campaignId: state.campaignId };
  const [addressLists, portalExports, portalReturns, productions, operations, campaign, tracking] = await Promise.all([
    dataAction("addressLists.list", payload),
    dataAction("portal.exports.list", payload),
    dataAction("portalReturns.list", payload),
    dataAction("production.list", payload),
    dataAction("operations.list", payload),
    dataAction("campaign.get", payload),
    dataAction("tracking.summary", payload).catch(() => null),
  ]);
  Object.assign(state, { addressLists, portalExports, portalReturns, productions, operations, campaign, tracking, dashboard: null });
}

function requireCampaign() {
  if (state.campaignId) return true;
  shell(`<div class="page">${pageHead("OPERAÇÃO", "Selecione uma campanha", "Crie ou selecione uma campanha para acessar os módulos operacionais.")}<div class="empty">Nenhuma campanha selecionada.</div></div>`);
  return false;
}

function manualMetricsPanelMarkup(manual) {
  const updated = manual.updatedAt ? `Última atualização: ${new Date(manual.updatedAt).toLocaleString("pt-BR")}` : "Os valores podem ser atualizados a qualquer momento.";
  return `<section class="manual-metrics-panel" data-manual-metrics-panel>
    <div class="manual-metrics-copy">
      <strong>Indicadores manuais</strong>
      <span>Use estes campos somente para números que não vêm automaticamente dos lotes.</span>
      <small>${h(updated)}</small>
    </div>
    <button type="button" class="manual-metrics-toggle" data-manual-metrics-toggle aria-expanded="false">Atualizar indicadores manuais</button>
    <form data-manual-metrics-form>
      <label><span>Base recebida</span><input name="addressReceived" type="number" min="0" step="1" value="${manual.addressReceived ?? ""}" placeholder="Automático"></label>
      <label><span>Higienizados</span><input name="addressCleaned" type="number" min="0" step="1" value="${manual.addressCleaned ?? ""}" placeholder="Automático"></label>
      <button type="submit" class="primary">Salvar indicadores</button>
    </form>
  </section>`;
}

function dashboardView() {
  if (!requireCampaign()) return;

  const automatic = accumulatedOperationMetrics(state.operations);
  const manual = manualMetrics();
  const metrics = {
    ...automatic,
    addressReceived: manual.addressReceived ?? automatic.addressReceived,
    addressCleaned: manual.addressCleaned ?? automatic.addressCleaned,
  };
  metrics.posted = Math.max(metrics.posted, Number(state.tracking?.total?.posted || 0));
  metrics.delivered = Math.max(metrics.delivered, Number(state.tracking?.total?.delivered || 0));

  const dates = state.operations
    .map((item) => String(item.occurredAt || item.OCCURRED_AT || item.createdAt || item.CREATED_AT || "").slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  const period = dates.length
    ? dates[0] === dates[dates.length - 1]
      ? `Dados acumulados em ${formatDate(dates[0])}`
      : `Período acumulado: ${formatDate(dates[0])} a ${formatDate(dates[dates.length - 1])}`
    : "Nenhum período operacional registrado";

  const metricCards = [
    ["Cadastros recebidos", metrics.addressReceived, manual.addressReceived != null],
    ["Higienizados", metrics.addressCleaned, manual.addressCleaned != null],
    ["Enviados ao Portal", metrics.portalExported, false],
    ["Retornados do Portal", metrics.portalReturned, false],
    ["PAC emitidos", metrics.labelsPac, false],
    ["SEDEX emitidos", metrics.labelsSedex, false],
    ["Etiquetas impressas", metrics.labelsPrinted, false],
    ["Entregues à operação", metrics.labelsHandedOff, false],
    ["Postados", metrics.posted, false],
    ["Entregues pelos Correios", metrics.delivered, false],
  ];

  const flowRows = [
    ["Base recebida", metrics.addressReceived],
    ["Higienizada", metrics.addressCleaned],
    ["Portal", metrics.portalReturned],
    ["Impressas", metrics.labelsPrinted],
    ["Entregues", metrics.labelsHandedOff],
    ["Postados", metrics.posted],
  ];
  const base = Math.max(1, Number(metrics.addressReceived || 0));

  const daily = dailyOperationRows(state.operations);
  const totals = daily.reduce((sum, row) => ({ pac: sum.pac + row.pac, sedex: sum.sedex + row.sedex, total: sum.total + row.total }), { pac: 0, sedex: 0, total: 0 });
  const diary = daily.length
    ? `<div class="daily-diary-table-wrap"><table class="daily-diary-table" aria-label="Diário acumulado da operação">
        <thead><tr><th>Data</th><th>PAC</th><th>SEDEX</th><th>Total</th></tr></thead>
        <tbody>${daily.map((row) => `<tr><td>${formatDate(row.date)}</td><td>${formatNumber(row.pac)}</td><td>${formatNumber(row.sedex)}</td><td><strong>${formatNumber(row.total)}</strong></td></tr>`).join("")}</tbody>
        <tfoot><tr><th>TOTAL GERAL</th><th>${formatNumber(totals.pac)}</th><th>${formatNumber(totals.sedex)}</th><th>${formatNumber(totals.total)}</th></tr></tfoot>
      </table></div>`
    : '<div class="empty">Nenhum quantitativo diário registrado.</div>';

  shell(`<div class="page" data-native-cumulative-dashboard>
    ${pageHead("OPERAÇÃO ACUMULADA", "Dashboard operacional", "Resumo consolidado de tudo que está registrado na base desta operação.")}
    <small class="cumulative-period">${h(period)}</small>
    ${manualMetricsPanelMarkup(manual)}
    <div class="grid metrics">${metricCards.map(([label, value, isManual]) => `<article class="card metric-card ${isManual ? "is-manual" : ""}"><span>${h(label)}</span><strong>${formatNumber(value)}</strong><small>${isManual ? "Informado manualmente" : "Acumulado automático"}</small></article>`).join("")}</div>
    <div class="grid two" style="margin-top:16px">
      <section class="card"><div class="section-title"><div><h2>Fluxo acumulado</h2><p>Indicadores consolidados de todo o período da operação.</p></div></div>
        ${flowRows.map(([label, value]) => {
          const pct = Math.min(100, Math.round(Number(value || 0) / base * 100));
          return `<div class="progress-row"><span>${h(label)}</span><div class="progress-track"><i style="width:${pct}%"></i></div><strong>${formatNumber(value)}</strong></div>`;
        }).join("")}
      </section>
      <section class="card"><div class="section-title"><div><h2>Diário da operação</h2><p>Produção diária consolidada por serviço.</p></div></div>${diary}</section>
    </div>
  </div>`);

  const panel = app.querySelector("[data-manual-metrics-panel]");
  panel?.querySelector("[data-manual-metrics-toggle]")?.addEventListener("click", (event) => {
    const expanded = panel.classList.toggle("is-open");
    event.currentTarget.setAttribute("aria-expanded", String(expanded));
    event.currentTarget.textContent = expanded ? "Fechar edição" : "Atualizar indicadores manuais";
  });
  panel?.querySelector("[data-manual-metrics-form]")?.addEventListener("submit", saveManualMetrics);
}

async function saveManualMetrics(event) {
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
    const campaign = state.campaign || state.campaigns.find((item) => item.id === state.campaignId);
    if (!campaign) throw new Error("Operação não encontrada.");
    const profile = {
      ...(campaign.profile || {}),
      manualMetrics: {
        ...(campaign.profile?.manualMetrics || {}),
        addressReceived: parse(values.addressReceived),
        addressCleaned: parse(values.addressCleaned),
        updatedAt: new Date().toISOString(),
        source: "DASHBOARD_MANUAL",
      },
    };
    const updated = await dataAction("campaign.upsert", {
      id: campaign.id,
      name: campaign.name,
      cnpj: campaign.cnpj,
      candidateName: campaign.candidateName,
      office: campaign.office,
      status: campaign.status,
      profile,
    });
    state.campaign = updated;
    state.campaigns = state.campaigns.map((item) => item.id === updated.id ? updated : item);
    toast("Indicadores manuais atualizados.", "success");
    dashboardView();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Salvar indicadores";
  }
}

function campaignsView() {
  shell(`<div class="page">
    ${pageHead("ADMINISTRAÇÃO", "Campanhas", "Cada campanha isola candidato, CNPJ, usuários e toda a operação postal.", '<button id="new-campaign" class="primary">Nova campanha</button>')}
    <div class="grid three">${state.campaigns.map((c) => `<article class="card"><div class="section-title"><div><h2>${h(c.name)}</h2><p>${h(c.candidateName || "Candidato não informado")}</p></div><span class="status ${statusClass(c.status)}">${h(c.status)}</span></div><p><strong>CNPJ:</strong> ${h(c.cnpj || "—")}</p><p><strong>Cargo:</strong> ${h(c.office || "—")}</p><button class="secondary" data-open-campaign="${h(c.id)}">Abrir operação</button></article>`).join("") || '<div class="empty">Cadastre a primeira campanha.</div>'}</div>
    <div id="campaign-form-slot"></div>
  </div>`);
  app.querySelector("#new-campaign").addEventListener("click", renderCampaignForm);
  app.querySelectorAll("[data-open-campaign]").forEach((button) => button.addEventListener("click", async () => { state.campaignId = button.dataset.openCampaign; state.view = "dashboard"; await refreshCampaignData(); dashboardView(); }));
}

function renderCampaignForm() {
  const slot = app.querySelector("#campaign-form-slot");
  slot.innerHTML = `<section class="card" style="margin-top:18px"><div class="section-title"><h2>Nova campanha</h2></div><form id="campaign-form" class="form-grid">
    <label class="field"><span>Nome da campanha</span><input name="name" required></label>
    <label class="field"><span>CNPJ eleitoral</span><input name="cnpj"></label>
    <label class="field"><span>Candidato</span><input name="candidateName"></label>
    <label class="field"><span>Cargo</span><input name="office"></label>
    <div class="wide"><button class="primary">Salvar campanha</button></div>
  </form></section>`;
  slot.querySelector("#campaign-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const stop = busy("Salvando campanha…");
    try { const values = Object.fromEntries(new FormData(event.currentTarget)); const created = await dataAction("campaign.upsert", values); await loadCampaigns(); state.campaignId = created.id; toast("Campanha criada.", "success"); campaignsView(); }
    catch (error) { toast(error.message, "error"); } finally { stop(); }
  });
}

function basesView() {
  if (!requireCampaign()) return;
  shell(`<div class="page">
    ${pageHead("BASES E HIGIENIZAÇÃO", "Preparação de endereços", "A base original é preservada. A limpeza ocorre em baixas parciais antes da exportação ao Portal Postal.")}
    <section class="card"><div class="section-title"><div><h2>Receber nova base</h2><p>Primeira versão da interface aceita CSV; o núcleo do backend preserva as linhas originais.</p></div></div>
      <div class="upload-box"><input id="base-file" type="file" accept=".csv,text/csv"><label class="field"><span>Serviço padrão</span><select id="base-service"><option>PAC</option><option>SEDEX</option></select></label><label class="field"><span>Conteúdo padrão</span><input id="base-content" value="PANFLETOS E ADESIVOS DA CAMPANHA"></label><button id="upload-base" class="primary">Importar base</button></div>
    </section>
    <section class="card" style="margin-top:16px"><div class="section-title"><div><h2>Bases recebidas</h2><p>Limpeza em blocos de até 200 registros.</p></div></div><div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Status</th><th>Total</th><th>Prontos</th><th>Revisar</th><th>Ações</th></tr></thead><tbody>${state.addressLists.map((row) => `<tr><td>${h(row.fileName)}</td><td><span class="status ${statusClass(row.status)}">${h(row.status)}</span></td><td>${formatNumber(row.total)}</td><td>${formatNumber(row.ready)}</td><td>${formatNumber(row.review)}</td><td><div class="actions"><button class="secondary" data-clean="${h(row.id)}">Limpar próximo bloco</button><button class="ghost" data-export="${h(row.id)}" data-service="PAC">CSV PAC</button><button class="ghost" data-export="${h(row.id)}" data-service="SEDEX">CSV SEDEX</button></div></td></tr>`).join("") || '<tr><td colspan="6"><div class="empty">Nenhuma base recebida.</div></td></tr>'}</tbody></table></div></section>
  </div>`);
  app.querySelector("#upload-base").addEventListener("click", uploadBaseCsv);
  app.querySelectorAll("[data-clean]").forEach((button) => button.addEventListener("click", () => cleanBatch(button.dataset.clean)));
  app.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", () => exportPortal(button.dataset.export, button.dataset.service)));
}

async function uploadBaseCsv() {
  const file = app.querySelector("#base-file").files[0];
  if (!file) return toast("Selecione um CSV.", "error");
  const stop = busy("Importando base…");
  try {
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: (value) => value.trim() });
    if (parsed.errors?.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
    const service = app.querySelector("#base-service").value;
    const content = app.querySelector("#base-content").value.trim();
    const rows = parsed.data.map((row) => ({ ...row, SERVICO: row.SERVICO || service, CONTEUDO: row.CONTEUDO || content }));
    const started = await dataAction("addressList.start", { campaignId: state.campaignId, fileName: file.name, metadata: { delimiter: parsed.meta.delimiter } });
    for (let index = 0; index < rows.length; index += started.chunkSize || 200) await dataAction("addressList.append", { campaignId: state.campaignId, addressListId: started.id, rows: rows.slice(index, index + (started.chunkSize || 200)) });
    await dataAction("addressList.finish", { campaignId: state.campaignId, addressListId: started.id });
    await refreshCampaignData(); toast(`${formatNumber(rows.length)} cadastros recebidos.`, "success"); basesView();
  } catch (error) { toast(error.message, "error"); } finally { stop(); }
}

async function cleanBatch(addressListId) {
  const stop = busy("Higienizando próximo bloco…");
  try { const result = await dataAction("cleaning.process", { campaignId: state.campaignId, addressListId }); await refreshCampaignData(); toast(`${result.summary.ready} prontos; ${result.summary.review} para revisão.`, "success"); basesView(); }
  catch (error) { toast(error.message, "error"); } finally { stop(); }
}

async function exportPortal(addressListId, service) {
  const stop = busy(`Gerando CSV ${service}…`);
  try { const result = await dataAction("portal.export", { campaignId: state.campaignId, addressListId, service }); textDownload(result.csv, result.fileName, "text/csv;charset=utf-8"); await refreshCampaignData(); toast(`${result.total} registros exportados para ${service}.`, "success"); basesView(); }
  catch (error) { toast(error.message, "error"); } finally { stop(); }
}

function portalView() {
  if (!requireCampaign()) return;
  shell(`<div class="page">${pageHead("PORTAL POSTAL", "Arquivos enviados ao Portal", "Os CSVs seguem o layout real de 28 colunas, com separador ponto e vírgula.")}
    <section class="card"><div class="table-wrap"><table><thead><tr><th>Serviço</th><th>Arquivo</th><th>Objetos</th><th>Hash</th><th>Ação</th></tr></thead><tbody>${state.portalExports.map((row) => `<tr><td><strong>${h(row.SERVICE)}</strong></td><td>${h(row.FILE_NAME)}</td><td>${formatNumber(row.TOTAL_ROWS)}</td><td><code>${h(String(row.SHA256 || "").slice(0,16))}…</code></td><td><button class="secondary" data-download-export="${h(row.ID)}">Baixar CSV</button></td></tr>`).join("") || '<tr><td colspan="5"><div class="empty">Nenhuma exportação ainda.</div></td></tr>'}</tbody></table></div></section>
    <div class="notice" style="margin-top:16px">Após importar o CSV no Portal Postal, gere as etiquetas e retorne com os dois arquivos: <strong>PDF das etiquetas</strong> e <strong>CSV das postagens</strong>.</div>
  </div>`);
  app.querySelectorAll("[data-download-export]").forEach((button) => button.addEventListener("click", async () => {
    const stop = busy("Recuperando CSV…"); try { const file = await dataAction("portal.export.file", { campaignId: state.campaignId, exportId: button.dataset.downloadExport }); textDownload(file.content, file.fileName, "text/csv;charset=utf-8"); } catch (error) { toast(error.message, "error"); } finally { stop(); }
  }));
}

function returnsView() {
  if (!requireCampaign()) return;
  shell(`<div class="page">${pageHead("RETORNO DO PORTAL", "PDF + CSV das postagens", "O retorno será cruzado por SRO e o Data Matrix original será auditado antes de liberar a produção.")}
    <section class="card"><div class="section-title"><div><h2>Retornos já processados</h2><p>Somente lotes READY podem seguir para uma modalidade documental.</p></div></div><div class="table-wrap"><table><thead><tr><th>CSV</th><th>Status</th><th>Total</th><th>PAC</th><th>SEDEX</th><th>Pendências</th><th>Ações</th></tr></thead><tbody>${state.portalReturns.map((row) => `<tr><td>${h(row.CSV_FILE_NAME || "Retorno Portal")}</td><td><span class="status ${statusClass(row.STATUS)}">${h(row.STATUS)}</span></td><td>${formatNumber(row.TOTAL_ROWS)}</td><td>${formatNumber(row.PAC_ROWS)}</td><td>${formatNumber(row.SEDEX_ROWS)}</td><td>${formatNumber(row.INVALID_ROWS)}</td><td><div class="actions"><button class="secondary" data-mode="SIMPLIFIED_DECLARATION" data-return="${h(row.ID)}" ${row.STATUS !== "READY" ? "disabled" : ""}>Declaração simplificada</button><button class="secondary" data-mode="DCE_AUTHORIZED" data-return="${h(row.ID)}" ${row.STATUS !== "READY" ? "disabled" : ""}>DC-e com e-CNPJ</button></div></td></tr>`).join("") || '<tr><td colspan="7"><div class="empty">Nenhum retorno processado ainda.</div></td></tr>'}</tbody></table></div></section>
    <div class="notice warn" style="margin-top:16px">A tela de leitura direta dos PDFs será conectada ao motor local de Data Matrix no próximo bloco. O backend de retorno, auditoria e produção já está preparado.</div>
  </div>`);
  app.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => chooseMode(button.dataset.return, button.dataset.mode)));
}

async function chooseMode(portalReturnId, documentMode) {
  const stop = busy("Preparando lote de produção…");
  try { const result = await dataAction("production.prepare", { campaignId: state.campaignId, portalReturnId, documentMode }); await refreshCampaignData(); toast(`Lote criado com ${result.total} objetos e ${result.volumes.length} volumes.`, "success"); state.view = "production"; productionView(); }
  catch (error) { toast(error.message, "error"); } finally { stop(); }
}

function productionView() {
  if (!requireCampaign()) return;
  shell(`<div class="page">${pageHead("PRODUÇÃO", "Lotes documentais e volumes", "Cada lote escolhe uma das duas modalidades e mantém volumes físicos separados por serviço, com máximo de 250 etiquetas.")}
    <div class="grid two">${state.productions.map((row) => `<article class="card"><div class="section-title"><div><h2>${row.DOCUMENT_MODE === "DCE_AUTHORIZED" ? "DC-e com e-CNPJ" : "Declaração simplificada"}</h2><p>Lote ${h(String(row.ID).slice(0,8))}</p></div><span class="status ${statusClass(row.STATUS)}">${h(row.STATUS)}</span></div><div class="matrix-grid"><div class="matrix-box"><span>Total</span><strong>${formatNumber(row.TOTAL)}</strong></div><div class="matrix-box"><span>PAC</span><strong>${formatNumber(row.PAC)}</strong></div><div class="matrix-box"><span>SEDEX</span><strong>${formatNumber(row.SEDEX)}</strong></div><div class="matrix-box"><span>Modo</span><strong>${row.DOCUMENT_MODE === "DCE_AUTHORIZED" ? "DC-e" : "Simpl."}</strong></div></div><div class="actions" style="margin-top:15px"><button class="secondary" data-volumes="${h(row.ID)}">Ver volumes</button></div><div id="volumes-${h(row.ID)}"></div></article>`).join("") || '<div class="empty">Nenhum lote de produção.</div>'}</div>
  </div>`);
  app.querySelectorAll("[data-volumes]").forEach((button) => button.addEventListener("click", () => loadVolumes(button.dataset.volumes)));
}

async function loadVolumes(productionBatchId) {
  const stop = busy("Carregando volumes…");
  try {
    const rows = await dataAction("volumes.list", { campaignId: state.campaignId, productionBatchId });
    const slot = app.querySelector(`#volumes-${CSS.escape(productionBatchId)}`);
    slot.innerHTML = `<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Volume</th><th>Serviço</th><th>Etiquetas</th><th>Status</th></tr></thead><tbody>${rows.map((v) => `<tr><td>${v.number}/${v.totalVolumes}</td><td>${h(v.service)}</td><td>${formatNumber(v.quantity)}</td><td><span class="status ${statusClass(v.status)}">${h(v.status)}</span></td></tr>`).join("")}</tbody></table></div>`;
  } catch (error) { toast(error.message, "error"); } finally { stop(); }
}

async function renderCurrent() {
  if (state.view === "dashboard") return dashboardView();
  if (state.view === "campaigns") return campaignsView();
  if (state.view === "bases") return basesView();
  if (state.view === "portal") return portalView();
  if (state.view === "returns") return returnsView();
  if (state.view === "production") return productionView();
}

async function start() {
  const stop = busy("Carregando campanhas…");
  try { await loadCampaigns(); await refreshCampaignData(); await renderCurrent(); }
  catch (error) { toast(error.message, "error"); shell(`<div class="page"><div class="notice warn">${h(error.message)}</div></div>`); }
  finally { stop(); }
}

(async function boot() {
  try { state.user = await getUser(); } catch { state.user = null; }
  if (!state.user && location.hostname === "localhost") state.user = { id: "local-development", email: "dev@localhost" };
  if (!state.user) renderAuth(); else await start();
})();
