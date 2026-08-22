import "./client-portal.css";
import { getUser, logout } from "@netlify/identity";
import { api, dataAction, fileToBase64 } from "./api.js";

const root = document.querySelector("#client-portal");
const toastBox = document.querySelector("#client-toast");

const state = {
  user: null,
  campaigns: [],
  campaignId: "",
  view: "dashboard",
  operations: [],
  productions: [],
  dceLots: [],
  company: null,
  certificateBase64: "",
  certificateName: "",
  certificateInfo: null,
  passphrase: "",
  environment: "2",
  from: "",
  to: "",
};

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function digits(value) { return String(value || "").replace(/\D/g, ""); }
function n(value) { return Number(value || 0); }
function fmt(value) { return new Intl.NumberFormat("pt-BR").format(n(value)); }
function money(value) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n(value)); }

function toast(message, type = "info") {
  toastBox.textContent = message;
  toastBox.className = `client-toast show ${type}`;
  clearTimeout(toastBox._timer);
  toastBox._timer = setTimeout(() => { toastBox.className = "client-toast"; }, 4500);
}

function busy(label = "Processando...") {
  document.querySelector("#client-busy")?.remove();
  const node = document.createElement("div");
  node.id = "client-busy";
  node.className = "client-busy";
  node.innerHTML = `<div><span class="spinner"></span><strong>${h(label)}</strong></div>`;
  document.body.appendChild(node);
  return () => node.remove();
}

function currentCampaign() {
  return state.campaigns.find((item) => String(item.id) === String(state.campaignId)) || null;
}

function portalUsername() {
  const metadata = state.user?.user_metadata || state.user?.userMetadata || {};
  return String(metadata.username || metadata.user_name || metadata.login || String(state.user?.email || "usuario").split("@")[0] || "usuario");
}

function dateOnly(value) {
  const raw = String(value || "");
  return raw.slice(0, 10);
}

function defaultDateRange() {
  if (state.from && state.to) return;
  const dates = state.operations.map((item) => dateOnly(item.occurredAt)).filter(Boolean).sort();
  const today = new Date().toISOString().slice(0, 10);
  state.from = dates[0] || today;
  state.to = dates[dates.length - 1] || today;
}

function filteredOperations() {
  return state.operations.filter((item) => {
    const date = dateOnly(item.occurredAt);
    return (!state.from || date >= state.from) && (!state.to || date <= state.to);
  });
}

function eventQuantity(event, service) {
  if (!service) return n(event.quantity);
  const direct = String(event.service || "").toUpperCase();
  if (direct === service) return n(event.quantity);
  const meta = event.metadata || {};
  if (!direct && service === "PAC" && meta.pac != null) return n(meta.pac);
  if (!direct && service === "SEDEX" && meta.sedex != null) return n(meta.sedex);
  return 0;
}

function sumType(type, service) {
  return filteredOperations().filter((event) => String(event.type) === type)
    .reduce((total, event) => total + eventQuantity(event, service), 0);
}

function stageValues(service) {
  const prepared = sumType("LABEL_GENERATED", service);
  const handed = sumType("LABEL_HANDOFF", service);
  const posted = sumType("POSTING_COMPLETED", service);
  const delivered = sumType("TRACKING_DELIVERED", service);
  return {
    prepared,
    handed,
    posted,
    inTransit: Math.max(0, posted - delivered),
    delivered,
  };
}

function renderLogin() {
  root.innerHTML = `<main class="login-screen">
    <section class="login-card">
      <div class="login-brand">
        <img src="https://minhaagenciaonline.com.br/assets/logo-agf-jose-bonifacio.png" alt="AGF Jose Bonifacio e Correios">
      </div>
      <h1>Acessar Portal</h1>
      <form id="client-login" class="login-form">
        <label><span>Usuario</span><div class="login-input"><b>U</b><input name="username" type="text" autocomplete="username" placeholder="Digite seu usuario" required></div></label>
        <label><span>Senha</span><div class="login-input"><b>•</b><input id="client-password" name="password" type="password" autocomplete="current-password" placeholder="Digite sua senha" required><button id="toggle-password" type="button" aria-label="Mostrar ou ocultar senha">◉</button></div></label>
        <button class="login-submit" type="submit">Entrar <strong>›</strong></button>
      </form>
    </section>
  </main>`;
  root.querySelector("#toggle-password").addEventListener("click", () => {
    const input = root.querySelector("#client-password");
    input.type = input.type === "password" ? "text" : "password";
  });
  root.querySelector("#client-login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const stop = busy("Entrando...");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/api/portal/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: values.username.trim(), password: values.password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Usuario ou senha invalidos.");
      window.location.reload();
    } catch (error) { toast(error.message, "error"); }
    finally { stop(); }
  });
}

const NAV = [
  ["dashboard", "▥", "Dashboard"],
  ["simulator", "▦", "Simulador"],
  ["authorization", "✓", "Autorizar DC-e"],
];

function shell(content) {
  const campaign = currentCampaign();
  root.innerHTML = `<div class="client-app">
    <aside class="client-sidebar">
      <div class="client-brand"><img src="https://minhaagenciaonline.com.br/assets/logo-agf-jose-bonifacio.png" alt="AGF Jose Bonifacio"></div>
      <nav>${NAV.map(([id, icon, label]) => `<button data-view="${id}" class="${state.view === id ? "active" : ""}"><i>${icon}</i>${label}</button>`).join("")}</nav>
      <div class="client-side-note">Perfil fiscal e preferencias ficam no menu do usuario.</div>
    </aside>
    <main class="client-main">
      <header class="client-top"><div><button id="mobile-menu" class="mobile-menu" type="button">☰</button><strong>${h(NAV.find(([id]) => id === state.view)?.[2] || "Portal")}</strong></div><div class="client-profile"><span>${h(campaign?.name || campaign?.candidateName || "Operacao")}</span><button id="profile-button" type="button">${h(portalUsername().slice(0, 2).toUpperCase())}</button></div></header>
      <section class="client-content">${content}</section>
    </main>
    <nav class="mobile-tabs">${NAV.map(([id, icon, label]) => `<button data-view="${id}" class="${state.view === id ? "active" : ""}"><i>${icon}</i><span>${label}</span></button>`).join("")}</nav>
    <div id="profile-menu" class="profile-menu"><button data-profile="fiscal">Perfil fiscal da operacao</button><button data-profile="logout">Sair</button></div>
    <div id="client-modal" class="client-modal"></div>
  </div>`;

  root.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", async () => {
    state.view = button.dataset.view;
    await renderCurrent();
  }));
  root.querySelector("#profile-button").addEventListener("click", () => root.querySelector("#profile-menu").classList.toggle("open"));
  root.querySelector('[data-profile="logout"]').addEventListener("click", async () => {
    await logout(); state.user = null; renderLogin();
  });
  root.querySelector('[data-profile="fiscal"]').addEventListener("click", async () => {
    root.querySelector("#profile-menu").classList.remove("open");
    await openFiscalProfile();
  });
}

function filtersMarkup() {
  return `<section class="filters">
    <label><span>Operacao</span><select id="campaign-filter">${state.campaigns.map((campaign) => `<option value="${h(campaign.id)}" ${String(campaign.id) === String(state.campaignId) ? "selected" : ""}>${h(campaign.name || campaign.candidateName || campaign.cnpj)}</option>`).join("")}</select></label>
    <label><span>De</span><input id="date-from" type="date" value="${h(state.from)}"></label>
    <label><span>Ate</span><input id="date-to" type="date" value="${h(state.to)}"></label>
    <button id="apply-filter" class="ghost">Aplicar</button>
  </section>`;
}

function metricRows(values) {
  const max = Math.max(1, values.prepared);
  const rows = [
    ["Preparados", values.prepared, "violet"],
    ["Entregues a operacao", values.handed, "blue"],
    ["Postados", values.posted, "orange"],
    ["Em transito", values.inTransit, "navy"],
    ["Entregues pelos Correios", values.delivered, "green"],
  ];
  return rows.map(([label, value, color]) => `<div class="metric-row"><span>${label}</span><div class="metric-track"><i class="${color}" style="width:${Math.min(100, Math.round(value / max * 100))}%"></i></div><strong>${fmt(value)}</strong><small>${values.prepared ? Math.round(value / values.prepared * 100) : 0}%</small></div>`).join("");
}

function serviceCard(name, values, className) {
  return `<article class="service-card ${className}"><div class="service-head"><div><i>${name === "PAC" ? "P" : name === "SEDEX" ? "S" : "Σ"}</i><strong>${name}</strong></div><span>Em andamento</span></div><div class="metric-list">${metricRows(values)}</div></article>`;
}

function dashboardView() {
  defaultDateRange();
  const pac = stageValues("PAC");
  const sedex = stageValues("SEDEX");
  const total = {
    prepared: pac.prepared + sedex.prepared,
    handed: sumType("LABEL_HANDOFF"),
    posted: sumType("POSTING_COMPLETED"),
    delivered: sumType("TRACKING_DELIVERED"),
  };
  total.inTransit = Math.max(0, total.posted - total.delivered);
  const events = filteredOperations().slice().sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, 8);
  const posted = Math.max(1, total.posted);
  const deliveredPct = Math.round(total.delivered / posted * 100);
  const transitPct = Math.round(total.inTransit / posted * 100);
  shell(`${filtersMarkup()}
    <section class="client-hero"><div><h1>Visao geral da operacao</h1><p>Acompanhe preparacao, postagem e entrega sem misturar entrega interna com entrega dos Correios.</p></div><span>● Operacao ativa</span></section>
    <section class="service-grid">${serviceCard("PAC", pac, "pac")}${serviceCard("SEDEX", sedex, "sedex")}${serviceCard("TOTAL", total, "total")}</section>
    <section class="dashboard-lower">
      <article class="panel"><div class="panel-title"><h2>Linha do tempo operacional</h2><p>Principais marcos registrados pela agencia.</p></div><div class="timeline">${events.length ? events.map((event, index) => `<div class="timeline-row"><i>${index + 1}</i><div><strong>${h(event.type.replaceAll("_", " "))}</strong><small>${h(String(event.occurredAt || "").replace("T", " ").slice(0, 16))}</small></div><b>${fmt(event.quantity)}</b></div>`).join("") : '<div class="empty">Nenhum evento no periodo.</div>'}</div></article>
      <aside class="panel"><div class="panel-title"><h2>Destaques</h2><p>Situacao dos objetos ja postados.</p></div><div class="donut-wrap"><div class="donut" style="--delivered:${deliveredPct * 3.6}deg"><div><strong>${deliveredPct}%</strong><span>entregues</span></div></div><div class="legend"><div><i class="green"></i><span>Entregues</span><strong>${fmt(total.delivered)}</strong><small>${deliveredPct}%</small></div><div><i class="navy"></i><span>Em transito</span><strong>${fmt(total.inTransit)}</strong><small>${transitPct}%</small></div></div></div></aside>
    </section>`);
  bindFilters();
}

function bindFilters() {
  root.querySelector("#apply-filter")?.addEventListener("click", async () => {
    const campaignId = root.querySelector("#campaign-filter").value;
    state.from = root.querySelector("#date-from").value;
    state.to = root.querySelector("#date-to").value;
    if (campaignId !== state.campaignId) {
      state.campaignId = campaignId;
      await loadCampaignContext();
    }
    await renderCurrent();
  });
}

function simulatorConfig() {
  const profile = currentCampaign()?.profile || {};
  return profile.simulator || profile.tariffs || null;
}

function simulatorView() {
  const cfg = simulatorConfig();
  shell(`<section class="client-hero"><div><h1>Simulador PAC e SEDEX</h1><p>Compare custo e prazo com a tabela vinculada a esta operacao.</p></div><span class="${cfg ? "" : "warn"}">${cfg ? "Tabela configurada" : "Tabela ainda nao configurada"}</span></section>
    <section class="simulator-grid"><article class="panel form-panel"><label><span>CEP de origem</span><input id="sim-origin" value="${h(cfg?.originZip || "")}" placeholder="00000-000"></label><label><span>CEP de destino</span><input id="sim-destination" placeholder="00000-000"></label><label><span>Peso (g)</span><input id="sim-weight" type="number" min="1" value="350"></label><label><span>Quantidade</span><input id="sim-quantity" type="number" min="1" value="100"></label><button id="simulate" class="primary" ${cfg ? "" : "disabled"}>Simular PAC e SEDEX</button></article><article class="panel result-panel"><div class="panel-title"><h2>Resultado</h2><p>Comparativo da tabela cadastrada.</p></div><div id="sim-result" class="empty">${cfg ? "Informe os dados e clique em Simular." : "A agencia ainda precisa vincular a tabela oficial de precos e prazos a esta operacao."}</div></article></section>`);
  root.querySelector("#simulate")?.addEventListener("click", () => runSimulation(cfg));
}

function tariffResult(service, cfg, weight, quantity) {
  const data = cfg?.services?.[service] || cfg?.[service.toLowerCase()] || null;
  if (!data) return null;
  const kg = Math.max(1, Math.ceil(weight / 1000));
  const unit = n(data.base) + Math.max(0, kg - 1) * n(data.perKg);
  return { unit, total: unit * quantity, days: data.days || data.deadline || "-" };
}

function runSimulation(cfg) {
  const weight = n(root.querySelector("#sim-weight").value);
  const quantity = n(root.querySelector("#sim-quantity").value);
  const pac = tariffResult("PAC", cfg, weight, quantity);
  const sedex = tariffResult("SEDEX", cfg, weight, quantity);
  const slot = root.querySelector("#sim-result");
  if (!pac && !sedex) { slot.className = "empty"; slot.textContent = "A tabela vinculada nao possui parametros calculaveis."; return; }
  slot.className = "sim-results";
  slot.innerHTML = [
    pac ? ["PAC", pac] : null,
    sedex ? ["SEDEX", sedex] : null,
  ].filter(Boolean).map(([name, result]) => `<div><div><strong>${name}</strong><small>${h(result.days)} dia(s) util(eis)</small></div><span><b>${money(result.unit)}</b><small>por objeto</small></span><span><b>${money(result.total)}</b><small>total</small></span></div>`).join("");
}

function lotStatus(lot) {
  if (lot.status === "READY_FOR_UNIFIED_LABEL" || (lot.counts.authorized === lot.total && lot.total > 0)) return ["Autorizado", "ok"];
  if (lot.status === "DCE_PREPARED") return ["Aguardando autorizacao", "warn"];
  if (lot.status === "DCE_PARTIAL") return ["Autorizacao parcial", "bad"];
  if (lot.status === "DCE_REVIEW") return ["Revisao pela agencia", "bad"];
  return ["Em preparacao pela agencia", "info"];
}

function authorizationView() {
  shell(`<section class="client-hero"><div><h1>Autorizar DC-e</h1><p>Autorize somente os lotes preparados pela agencia usando o e-CNPJ A1 da propria operacao.</p></div><span>Certificado nao e armazenado</span></section>
    <section class="authorization-grid"><div class="lots">${state.dceLots.length ? state.dceLots.map((lot) => {
      const [label, tone] = lotStatus(lot);
      const canAuthorize = lot.status === "DCE_PREPARED" || lot.status === "DCE_PARTIAL";
      return `<article class="lot-card"><div class="lot-top"><div><h3>Lote DC-e #${h(String(lot.id).slice(0, 10))}</h3><p>Preparado pela agencia ${lot.createdAt ? `• ${h(String(lot.createdAt).replace("T", " ").slice(0, 16))}` : ""}</p></div><span class="pill ${tone}">${label}</span></div><div class="lot-stats"><div><span>Documentos</span><strong>${fmt(lot.total)}</strong></div><div><span>PAC</span><strong>${fmt(lot.pac)}</strong></div><div><span>SEDEX</span><strong>${fmt(lot.sedex)}</strong></div><div><span>Autorizados</span><strong>${fmt(lot.counts.authorized)}</strong></div></div>${canAuthorize ? `<button class="primary authorize-lot" data-lot="${h(lot.id)}">Autorizar este lote</button>` : ""}</article>`;
    }).join("") : '<div class="empty">Nenhum lote DC-e disponivel para esta operacao.</div>'}</div>
      <aside class="panel certificate-panel"><div class="panel-title"><h2>Certificado A1</h2><p>Usado somente nesta autorizacao.</p></div><label class="certificate-upload"><input id="certificate" type="file" accept=".pfx,.p12,application/x-pkcs12"><strong>${h(state.certificateName || "Selecionar certificado .PFX / .P12")}</strong><small>O arquivo permanece somente na memoria da sessao.</small></label><label><span>Senha do certificado</span><input id="certificate-password" type="password" value="${h(state.passphrase)}" placeholder="Digite somente ao autorizar"></label><div class="env-row"><label><input type="radio" name="environment" value="2" ${state.environment === "2" ? "checked" : ""}> Homologacao</label><label><input type="radio" name="environment" value="1" ${state.environment === "1" ? "checked" : ""}> Producao</label></div><label class="production-check ${state.environment === "1" ? "" : "hidden"}"><input id="confirm-production" type="checkbox"> Confirmo emissao fiscal em producao.</label><div class="security-note">✓ Certificado e senha nao sao gravados no portal, no Apps Script ou no armazenamento local.</div></aside>
    </section>`);
  bindAuthorization();
}

function bindAuthorization() {
  root.querySelector("#certificate")?.addEventListener("change", inspectCertificate);
  root.querySelector("#certificate-password")?.addEventListener("change", (event) => { state.passphrase = event.target.value; });
  root.querySelectorAll('[name="environment"]').forEach((input) => input.addEventListener("change", (event) => {
    state.environment = event.target.value;
    authorizationView();
  }));
  root.querySelectorAll(".authorize-lot").forEach((button) => button.addEventListener("click", () => authorizeProductionLot(button.dataset.lot)));
}

async function inspectCertificate(event) {
  const file = event.target.files[0];
  if (!file) return;
  state.certificateName = file.name;
  state.certificateBase64 = await fileToBase64(file);
  state.passphrase = root.querySelector("#certificate-password")?.value || "";
  if (!state.passphrase) { toast("Informe a senha do certificado antes de validar.", "info"); return; }
  const stop = busy("Validando certificado...");
  try {
    state.certificateInfo = await api("/api/dce/certificate", { method: "POST", body: JSON.stringify({ certificateBase64: state.certificateBase64, passphrase: state.passphrase }) });
    const campaign = currentCampaign();
    if (campaign?.cnpj && digits(state.certificateInfo.cnpj).slice(0, 8) !== digits(campaign.cnpj).slice(0, 8)) throw new Error("O e-CNPJ nao corresponde ao CNPJ desta operacao.");
    toast("Certificado A1 validado.", "success");
  } catch (error) { state.certificateInfo = null; toast(error.message, "error"); }
  finally { stop(); }
}

async function authorizeProductionLot(productionBatchId) {
  state.passphrase = root.querySelector("#certificate-password")?.value || state.passphrase;
  if (!state.certificateBase64 || !state.passphrase) return toast("Selecione o certificado A1 e informe a senha.", "error");
  const confirmProduction = state.environment === "1" ? Boolean(root.querySelector("#confirm-production")?.checked) : false;
  if (state.environment === "1" && !confirmProduction) return toast("Confirme a emissao em producao.", "error");
  const stop = busy("Reservando a numeracao do lote...");
  try {
    const certificateInfo = await api("/api/dce/certificate", { method: "POST", body: JSON.stringify({ certificateBase64: state.certificateBase64, passphrase: state.passphrase }) });
    const campaign = currentCampaign();
    if (campaign?.cnpj && digits(certificateInfo.cnpj).slice(0, 8) !== digits(campaign.cnpj).slice(0, 8)) throw new Error("O e-CNPJ nao corresponde ao CNPJ desta operacao.");
    const service = await api("/api/dce/status", { method: "POST", body: JSON.stringify({ certificateBase64: state.certificateBase64, passphrase: state.passphrase, environment: state.environment }) });
    if (service.cStat !== "107") throw new Error(`Autorizador indisponivel: ${service.cStat} ${service.reason}`);
    const reserved = await dataAction("production.dce.reserve", { campaignId: state.campaignId, productionBatchId, environment: state.environment });
    const fiscalBatchId = String(reserved.fiscalBatch.ID || reserved.fiscalBatch.id || "");
    const pending = reserved.documents.filter((doc) => ["", "PREPARED", "ERROR"].includes(String(doc.status || "")));
    if (!pending.length) throw new Error("Este lote nao possui documentos pendentes para autorizacao.");
    let allResults = [];
    for (let index = 0; index < pending.length; index += 5) {
      const documents = pending.slice(index, index + 5);
      document.querySelector("#client-busy strong").textContent = `Autorizando ${index + 1} a ${Math.min(index + 5, pending.length)} de ${pending.length}...`;
      const response = await api("/api/dce/authorize", { method: "POST", body: JSON.stringify({ documents, certificateBase64: state.certificateBase64, passphrase: state.passphrase, confirmProduction }) });
      allResults = allResults.concat(response.results || []);
      await dataAction("production.dce.saveResults", { campaignId: state.campaignId, productionBatchId, fiscalBatchId, results: response.results || [] });
    }
    const authorized = allResults.filter((item) => item.status === "AUTHORIZED").length;
    toast(`${authorized} de ${allResults.length} DC-e autorizadas.`, authorized === allResults.length ? "success" : "info");
    await loadCampaignContext();
    authorizationView();
  } catch (error) { toast(error.message, "error"); }
  finally { stop(); }
}

async function openFiscalProfile() {
  const campaign = currentCampaign();
  const modal = root.querySelector("#client-modal");
  const company = state.company || {};
  const p = company.profile || {};
  const a = p.address || {};
  modal.className = "client-modal open";
  modal.innerHTML = `<section><div class="modal-head"><div><h2>Perfil fiscal da operacao</h2><p>Dados usados na preparacao e autorizacao da DC-e.</p></div><button id="close-modal" type="button">×</button></div><form id="fiscal-form" class="fiscal-grid"><label><span>CNPJ</span><input name="cnpj" value="${h(campaign?.cnpj || p.cnpj || "")}" readonly required></label><label class="wide"><span>Razao social</span><input name="name" value="${h(p.name || company.name || "")}" required></label><label><span>Serie DC-e</span><input name="series" type="number" min="0" max="999" value="${h(p.series ?? company.series ?? 0)}" required></label><label><span>Proximo numero</span><input name="nextNumber" type="number" min="1" value="${h(company.nextNumber || 1)}" required></label><label class="wide"><span>Logradouro</span><input name="street" value="${h(a.street || "")}" required></label><label><span>Numero</span><input name="number" value="${h(a.number || "")}" required></label><label><span>Complemento</span><input name="complement" value="${h(a.complement || "")}"></label><label><span>Bairro</span><input name="district" value="${h(a.district || "")}" required></label><label><span>Municipio</span><input name="city" value="${h(a.city || "")}" required></label><label><span>UF</span><input name="uf" maxlength="2" value="${h(a.uf || "")}" required></label><label><span>CEP</span><input name="zip" value="${h(a.zip || "")}" required></label><label><span>Codigo IBGE</span><input name="cityCode" value="${h(a.cityCode || "")}" required></label><label class="wide check"><input name="nonIcmsContributor" type="checkbox" ${p.nonIcmsContributor ? "checked" : ""} required> Declaro que a empresa nao e contribuinte do ICMS.</label><label class="wide check"><input name="operationWithoutInvoice" type="checkbox" ${p.operationWithoutInvoice ? "checked" : ""} required> Declaro que as remessas nao correspondem a operacao que exige nota fiscal.</label><div class="wide"><button class="primary" type="submit">Salvar alteracoes</button></div></form></section>`;
  modal.querySelector("#close-modal").addEventListener("click", () => { modal.className = "client-modal"; modal.innerHTML = ""; });
  modal.querySelector("#fiscal-form").addEventListener("submit", saveFiscalProfile);
}

async function saveFiscalProfile(event) {
  event.preventDefault();
  const v = Object.fromEntries(new FormData(event.currentTarget));
  const profile = {
    cnpj: digits(v.cnpj), name: v.name, series: n(v.series),
    nonIcmsContributor: v.nonIcmsContributor === "on",
    operationWithoutInvoice: v.operationWithoutInvoice === "on",
    address: { street: v.street, number: v.number, complement: v.complement, district: v.district, city: v.city, uf: String(v.uf).toUpperCase(), zip: digits(v.zip), cityCode: digits(v.cityCode), countryCode: "1058", country: "BRASIL" }
  };
  const stop = busy("Salvando perfil fiscal...");
  try {
    state.company = await dataAction("campaign.company.upsert", { campaignId: state.campaignId, profile, nextNumber: n(v.nextNumber) });
    toast("Perfil fiscal salvo.", "success");
    const modal = root.querySelector("#client-modal"); modal.className = "client-modal"; modal.innerHTML = "";
  } catch (error) { toast(error.message, "error"); }
  finally { stop(); }
}

async function renderCurrent() {
  if (state.view === "dashboard") return dashboardView();
  if (state.view === "simulator") return simulatorView();
  if (state.view === "authorization") return authorizationView();
}

async function loadCampaignContext() {
  if (!state.campaignId) return;
  const payload = { campaignId: state.campaignId };
  const [operations, productions, dceLots, company] = await Promise.all([
    dataAction("operations.list", payload),
    dataAction("production.list", payload),
    dataAction("production.dce.list", payload),
    dataAction("campaign.company.get", payload).catch(() => null),
  ]);
  state.operations = operations || [];
  state.productions = productions || [];
  state.dceLots = dceLots || [];
  state.company = company;
  state.from = ""; state.to = "";
}

async function startPortal() {
  const stop = busy("Abrindo seu portal...");
  try {
    state.campaigns = (await dataAction("campaigns.list")) || [];
    const clientCampaigns = state.campaigns.filter((item) => item.role === "CAMPAIGN_USER");
    if (clientCampaigns.length) state.campaigns = clientCampaigns;
    if (!state.campaigns.length) throw new Error("Nenhuma operacao foi vinculada a este usuario.");
    if (!state.campaignId || !state.campaigns.some((item) => item.id === state.campaignId)) state.campaignId = state.campaigns[0].id;
    await loadCampaignContext();
    await renderCurrent();
  } catch (error) { toast(error.message, "error"); renderLogin(); }
  finally { stop(); }
}

(async function boot() {
  try { state.user = await getUser(); } catch { state.user = null; }
  if (!state.user) renderLogin(); else await startPortal();
})();
