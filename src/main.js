import "./styles.css";
import { acceptInvite, getUser, handleAuthCallback, login, logout, requestPasswordRecovery, signup, updateUser } from "@netlify/identity";
import { api, dataAction, downloadBlob, fileToBase64, textDownload } from "./api.js";
import { detectMapping, FIELD_DEFINITIONS, mapRows, parseImportFiles } from "./importers.js";
import { digits, normalizeName, validateRemittance } from "./validation.js";

const app = document.querySelector("#app");
const toastElement = document.querySelector("#toast");
const state = {
  user: null, view: "company", company: null, rawRows: [], headers: [], mapping: {}, fileNames: [],
  remittances: [], importPage: 1, selectedIds: new Set(), batch: null, results: [],
  certificateBase64: "", certificateName: "", certificateInfo: null, passphrase: "", environment: "2",
  busy: false, history: [], batches: [],
};

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function toast(message, type = "info") {
  toastElement.textContent = message;
  toastElement.className = `toast show ${type}`;
  setTimeout(() => { toastElement.className = "toast"; }, 4_500);
}

function setBusy(value, label = "Processando…") {
  state.busy = value;
  document.body.classList.toggle("is-busy", value);
  let overlay = document.querySelector("#busy-overlay");
  if (value && !overlay) {
    overlay = document.createElement("div"); overlay.id = "busy-overlay"; overlay.className = "busy-overlay";
    overlay.innerHTML = `<div class="spinner"></div><strong>${h(label)}</strong>`; document.body.appendChild(overlay);
  } else if (value && overlay) overlay.querySelector("strong").textContent = label;
  else overlay?.remove();
}

function field(name, label, value = "", options = {}) {
  const type = options.type || "text";
  return `<label class="field ${options.wide ? "wide" : ""}"><span>${h(label)}${options.required ? " *" : ""}</span><input name="${h(name)}" type="${type}" value="${h(value)}" ${options.required ? "required" : ""} ${options.placeholder ? `placeholder="${h(options.placeholder)}"` : ""} ${options.min ? `min="${h(options.min)}"` : ""}></label>`;
}

function renderAuth(message = "") {
  app.innerHTML = `<main class="auth-shell"><section class="auth-copy"><div class="brand-mark">DC</div><p class="eyebrow">EMISSÃO PRÓPRIA</p><h1>DC-e pronta para acompanhar seu PAC ou SEDEX.</h1><p>Importe as etiquetas dos Correios, complete os dados fiscais e assine cada declaração com o e-CNPJ da sua empresa.</p><div class="trust-row"><span>Certificado só em memória</span><span>Homologação primeiro</span></div></section><section class="auth-card"><div class="segmented"><button data-auth-tab="login" class="active">Entrar</button><button data-auth-tab="signup">Criar conta</button></div>${message ? `<div class="alert">${h(message)}</div>` : ""}<form id="auth-form"><input type="hidden" name="mode" value="login">${field("email", "E-mail", "", { type: "email", required: true, wide: true })}${field("password", "Senha", "", { type: "password", required: true, wide: true })}<label class="field wide signup-name hidden"><span>Nome</span><input name="name"></label><button class="primary wide" type="submit">Entrar com segurança</button></form><button id="forgot-password" class="link-button">Esqueci minha senha</button>${location.hostname === "localhost" ? '<button id="local-login" class="link-button">Entrar no ambiente local</button>' : ""}<p class="fineprint">O acesso protege cadastros, numeração, XML e histórico de cada empresa.</p></section></main>`;
  app.querySelectorAll("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => {
    app.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item === button));
    const signupMode = button.dataset.authTab === "signup";
    app.querySelector("[name=mode]").value = signupMode ? "signup" : "login";
    app.querySelector(".signup-name").classList.toggle("hidden", !signupMode);
    app.querySelector("[type=submit]").textContent = signupMode ? "Criar minha conta" : "Entrar com segurança";
  }));
  app.querySelector("#auth-form").addEventListener("submit", handleAuth);
  app.querySelector("#forgot-password").addEventListener("click", requestRecovery);
  app.querySelector("#local-login")?.addEventListener("click", () => { state.user = { id: "local-development", email: "dev@localhost" }; startApp(); });
}

async function requestRecovery() {
  const email = app.querySelector("[name=email]").value.trim();
  if (!email) return toast("Informe o e-mail da conta.", "error");
  setBusy(true, "Enviando recuperação…");
  try { await requestPasswordRecovery(email); renderAuth("Enviamos um link para redefinir sua senha."); }
  catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

function renderCredentialSetup(callback) {
  const invite = callback.type === "invite";
  app.innerHTML = `<main class="auth-shell"><section class="auth-copy"><div class="brand-mark">DC</div><p class="eyebrow">ACESSO SEGURO</p><h1>${invite ? "Ative sua conta." : "Defina uma nova senha."}</h1><p>${invite ? "O convite foi reconhecido. Crie a senha que usará para acessar o emissor." : "O link de recuperação foi validado."}</p></section><section class="auth-card"><h2>${invite ? "Aceitar convite" : "Redefinir senha"}</h2><form id="credential-form">${field("newPassword", "Nova senha", "", { type: "password", required: true, wide: true })}${field("confirmation", "Repita a senha", "", { type: "password", required: true, wide: true })}<button class="primary wide" type="submit">Salvar senha</button></form></section></main>`;
  app.querySelector("#credential-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.newPassword !== values.confirmation) return toast("As senhas não coincidem.", "error");
    setBusy(true, "Ativando acesso…");
    try {
      state.user = invite ? await acceptInvite(callback.token, values.newPassword) : await updateUser({ password: values.newPassword });
      await startApp();
    } catch (error) { toast(error.message, "error"); }
    finally { setBusy(false); }
  });
}

async function handleAuth(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  setBusy(true, values.mode === "signup" ? "Criando conta…" : "Entrando…");
  try {
    if (values.mode === "signup") {
      const user = await signup(values.email, values.password, { full_name: values.name });
      if (!user.emailVerified) { renderAuth("Conta criada. Confirme o e-mail recebido antes de entrar."); return; }
      state.user = user;
    } else state.user = await login(values.email, values.password);
    await startApp();
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

function shell(content) {
  const nav = [["company", "Empresa"], ["import", "Importar"], ["issue", "Emitir"], ["history", "Documentos"]];
  app.innerHTML = `<div class="app-shell"><aside><div class="logo"><span>DC</span><div>DC-e Fácil<small>Emissão própria</small></div></div><nav>${nav.map(([id, label], index) => `<button data-view="${id}" class="${state.view === id ? "active" : ""}"><b>0${index + 1}</b>${label}</button>`).join("")}</nav><div class="side-note"><strong>PAC e SEDEX à vista</strong><span>Para PJ não contribuinte do ICMS, quando a operação não exige NF.</span></div></aside><main class="workspace"><header><div><p class="eyebrow">AMBIENTE DO EMITENTE</p><strong>${h(state.user?.email || "Usuário")}</strong></div><button id="sign-out" class="ghost">Sair</button></header><section id="content">${content}</section></main></div>`;
  app.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  app.querySelector("#sign-out").addEventListener("click", async () => { await logout(); state.user = null; renderAuth(); });
}

async function switchView(view) {
  state.view = view;
  if (view === "company") renderCompany();
  if (view === "import") renderImport();
  if (view === "issue") await renderIssue(true);
  if (view === "history") await renderHistory(true);
}

function renderCompany() {
  const p = state.company?.profile || {};
  const a = p.address || {};
  shell(`<div class="page-head"><div><p class="eyebrow">PASSO 1</p><h1>Empresa emitente</h1><p>Esses dados formam o grupo do usuário emitente. O certificado A1 deverá pertencer ao mesmo CNPJ-base.</p></div><span class="status-chip ${state.company ? "ok" : ""}">${state.company ? "Cadastro salvo" : "Pendente"}</span></div><form id="company-form" class="card form-grid">${field("cnpj", "CNPJ", p.cnpj || state.company?.cnpj, { required: true })}${field("name", "Razão social", p.name || state.company?.name, { required: true, wide: true })}${field("email", "E-mail", p.email, { type: "email" })}${field("phone", "Telefone", p.phone)}${field("series", "Série DC-e", p.series ?? state.company?.series ?? 0, { type: "number", required: true, min: 0 })}${field("nextNumber", "Próximo número", state.company?.nextNumber || 1, { type: "number", required: true, min: 1 })}<div class="divider wide"><span>Endereço do emitente</span></div>${field("street", "Logradouro", a.street, { required: true, wide: true })}${field("number", "Número", a.number, { required: true })}${field("complement", "Complemento", a.complement)}${field("district", "Bairro", a.district, { required: true })}${field("city", "Município", a.city, { required: true })}${field("uf", "UF", a.uf, { required: true })}${field("zip", "CEP", a.zip, { required: true })}${field("cityCode", "Código IBGE", a.cityCode, { required: true })}<div class="declarations wide"><label><input type="checkbox" name="nonIcmsContributor" ${p.nonIcmsContributor ? "checked" : ""} required><span>Declaro que a empresa não é contribuinte do ICMS.</span></label><label><input type="checkbox" name="operationWithoutInvoice" ${p.operationWithoutInvoice ? "checked" : ""} required><span>Declaro que estas remessas não correspondem a operação que exige nota fiscal.</span></label></div><div class="form-actions wide"><button class="primary" type="submit">Salvar empresa</button></div></form>`);
  app.querySelector("#company-form").addEventListener("submit", saveCompany);
}

async function saveCompany(event) {
  event.preventDefault();
  const v = Object.fromEntries(new FormData(event.currentTarget));
  const profile = { cnpj: v.cnpj, name: v.name, email: v.email, phone: v.phone, series: Number(v.series), nonIcmsContributor: v.nonIcmsContributor === "on", operationWithoutInvoice: v.operationWithoutInvoice === "on", address: { street: v.street, number: v.number, complement: v.complement, district: v.district, city: v.city, uf: v.uf.toUpperCase(), zip: digits(v.zip), cityCode: digits(v.cityCode), countryCode: "1058", country: "BRASIL", phone: digits(v.phone) } };
  setBusy(true, "Salvando empresa…");
  try { state.company = await dataAction("company.upsert", { profile, nextNumber: Number(v.nextNumber) }); toast("Cadastro da empresa salvo.", "success"); renderCompany(); }
  catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

function renderImport() {
  const hasRows = state.rawRows.length > 0;
  shell(`<div class="page-head"><div><p class="eyebrow">PASSO 2</p><h1>Importar etiquetas</h1><p>A quantidade é livre. CSV e XML podem ser carregados juntos, com união pelo código SRO.</p></div><span class="status-chip">${state.remittances.length || state.rawRows.length} remessas</span></div><div class="card upload-zone"><input id="files" type="file" accept=".csv,.xml,text/csv,application/xml" multiple><div><strong>Solte ou selecione os arquivos dos Correios</strong><span>CSV de etiquetas e XML de objetos postais. Nenhum limite fixo de linhas foi codificado.</span></div></div>${hasRows ? mappingTemplate() : '<div class="empty"><b>Comece pelos arquivos de etiqueta</b><span>Depois você poderá revisar o mapeamento, completar CPF/CNPJ, valor, quantidade, NCM e código IBGE.</span></div>'}${state.remittances.length ? remittanceTemplate() : ""}`);
  app.querySelector("#files").addEventListener("change", loadFiles);
  app.querySelector("#apply-mapping")?.addEventListener("click", applyMapping);
  bindRemittanceEvents();
}

function mappingTemplate() {
  return `<section class="card"><div class="section-title"><div><h2>Mapeamento das colunas</h2><p>${state.rawRows.length} linhas lidas de ${state.fileNames.map(h).join(", ")}</p></div><button id="apply-mapping" class="secondary">Aplicar mapeamento</button></div><div class="mapping-grid">${FIELD_DEFINITIONS.map(([key, label, required]) => `<label><span>${h(label)}${required ? " *" : ""}</span><select data-map="${key}"><option value="">Não informado</option>${state.headers.map((header) => `<option value="${h(header)}" ${state.mapping[key] === header ? "selected" : ""}>${h(header)}</option>`).join("")}</select></label>`).join("")}</div><div class="defaults"><strong>Padrões para colunas ausentes</strong>${field("defaultDescription", "Conteúdo", "")}${field("defaultQuantity", "Quantidade", 1, { type: "number", min: 1 })}${field("defaultValue", "Valor unitário", "", { type: "number" })}${field("defaultNcm", "NCM opcional", "")}</div></section>`;
}

async function loadFiles(event) {
  setBusy(true, "Lendo arquivos…");
  try {
    const parsed = await parseImportFiles(event.target.files);
    state.rawRows = parsed.rows; state.fileNames = parsed.fileNames;
    const detected = detectMapping(parsed.rows); state.headers = detected.headers; state.mapping = detected.mapping;
    state.remittances = []; renderImport(); toast(`${parsed.rows.length} registros preparados.`, "success");
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

function applyMapping() {
  document.querySelectorAll("[data-map]").forEach((select) => { state.mapping[select.dataset.map] = select.value; });
  const defaults = { description: document.querySelector("[name=defaultDescription]").value, quantity: document.querySelector("[name=defaultQuantity]").value, unitValue: document.querySelector("[name=defaultValue]").value, ncm: document.querySelector("[name=defaultNcm]").value };
  state.remittances = mapRows(state.rawRows, state.mapping, defaults); state.importPage = 1; renderImport();
}

function remittanceTemplate() {
  const pageSize = 50; const pages = Math.max(1, Math.ceil(state.remittances.length / pageSize));
  state.importPage = Math.min(state.importPage, pages); const start = (state.importPage - 1) * pageSize;
  const rows = state.remittances.slice(start, start + pageSize);
  const valid = state.remittances.filter((row) => validateRemittance(row).length === 0).length;
  return `<section class="card table-card"><div class="section-title"><div><h2>Revisão fiscal</h2><p><b>${valid}</b> prontos · <b>${state.remittances.length - valid}</b> com pendências</p></div><div class="button-row"><button id="resolve-cities" class="secondary">Resolver códigos IBGE</button><button id="save-import" class="primary">Salvar importação</button></div></div><div class="bulk"><span>Preencher vazios em todas:</span><input id="bulk-description" placeholder="Conteúdo"><input id="bulk-quantity" type="number" min="1" placeholder="Quantidade"><input id="bulk-value" type="number" min="0.01" step="0.01" placeholder="Valor"><input id="bulk-ncm" placeholder="NCM"><button id="apply-bulk" class="ghost">Aplicar</button></div><div class="table-scroll"><table class="edit-table"><thead><tr><th>Status</th><th>SRO</th><th>Serviço</th><th>Destinatário</th><th>CPF/CNPJ</th><th>Logradouro</th><th>Nº</th><th>Complemento</th><th>Bairro</th><th>Município</th><th>UF</th><th>CEP</th><th>IBGE</th><th>Conteúdo</th><th>NCM</th><th>Qtd.</th><th>Valor</th></tr></thead><tbody>${rows.map((row, localIndex) => rowTemplate(row, start + localIndex)).join("")}</tbody></table></div><div class="pagination"><button data-page="${state.importPage - 1}" ${state.importPage === 1 ? "disabled" : ""}>Anterior</button><span>Página ${state.importPage} de ${pages}</span><button data-page="${state.importPage + 1}" ${state.importPage === pages ? "disabled" : ""}>Próxima</button></div></section>`;
}

function rowTemplate(row, index) {
  const r = row.document.recipient; const a = r.address; const item = row.document.items[0]; const errors = validateRemittance(row);
  const input = (path, value, type = "text") => `<input class="cell-input" data-row="${index}" data-path="${path}" type="${type}" value="${h(value)}">`;
  return `<tr class="${errors.length ? "invalid" : "valid"}"><td><span class="row-status" title="${h(errors.join(", "))}">${errors.length ? `${errors.length} pend.` : "Pronta"}</span></td><td>${input("trackingCode", row.trackingCode)}</td><td><select class="cell-input" data-row="${index}" data-path="service"><option ${row.service === "PAC" ? "selected" : ""}>PAC</option><option ${row.service === "SEDEX" ? "selected" : ""}>SEDEX</option></select></td><td>${input("document.recipient.name", r.name)}</td><td>${input("document.recipient.document", r.document)}</td><td>${input("document.recipient.address.street", a.street)}</td><td>${input("document.recipient.address.number", a.number)}</td><td>${input("document.recipient.address.complement", a.complement)}</td><td>${input("document.recipient.address.district", a.district)}</td><td>${input("document.recipient.address.city", a.city)}</td><td>${input("document.recipient.address.uf", a.uf)}</td><td>${input("document.recipient.address.zip", a.zip)}</td><td>${input("document.recipient.address.cityCode", a.cityCode)}</td><td>${input("document.items.0.description", item.description)}</td><td>${input("document.items.0.ncm", item.ncm)}</td><td>${input("document.items.0.quantity", item.quantity, "number")}</td><td>${input("document.items.0.unitValue", item.unitValue, "number")}</td></tr>`;
}

function setPath(object, path, value) {
  const parts = path.split("."); let target = object;
  for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]];
  const key = parts.at(-1); target[key] = ["quantity", "unitValue"].includes(key) ? Number(value) : value;
  const item = object.document?.items?.[0]; if (item) item.totalValue = Number((Number(item.quantity) * Number(item.unitValue)).toFixed(2));
  const doc = object.document?.recipient?.document; if (doc) object.document.recipient.documentType = digits(doc).length === 14 ? "CNPJ" : "CPF";
}

function bindRemittanceEvents() {
  app.querySelectorAll(".cell-input").forEach((input) => input.addEventListener("change", () => { setPath(state.remittances[Number(input.dataset.row)], input.dataset.path, input.value.trim()); renderImport(); }));
  app.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => { state.importPage = Number(button.dataset.page); renderImport(); }));
  app.querySelector("#apply-bulk")?.addEventListener("click", applyBulk);
  app.querySelector("#resolve-cities")?.addEventListener("click", resolveCities);
  app.querySelector("#save-import")?.addEventListener("click", saveImport);
}

function applyBulk() {
  const description = document.querySelector("#bulk-description").value.trim(); const quantity = Number(document.querySelector("#bulk-quantity").value);
  const value = Number(document.querySelector("#bulk-value").value); const ncm = digits(document.querySelector("#bulk-ncm").value);
  state.remittances.forEach((row) => { const item = row.document.items[0]; if (description && !item.description) item.description = description; if (quantity > 0 && !(item.quantity > 0)) item.quantity = quantity; if (value > 0 && !(item.unitValue > 0)) item.unitValue = value; if (ncm && !item.ncm) item.ncm = ncm; item.totalValue = Number((item.quantity * item.unitValue).toFixed(2)); });
  renderImport();
}

async function resolveCities() {
  const ufs = [...new Set(state.remittances.map((row) => row.document.recipient.address.uf).filter(Boolean))];
  if (!ufs.length) return toast("Informe as UFs antes de buscar os municípios.", "error");
  setBusy(true, "Consultando municípios no IBGE…");
  try {
    const cities = await api(`/api/municipalities?ufs=${encodeURIComponent(ufs.join(","))}`);
    const lookup = new Map(cities.map((city) => [`${city.uf}:${normalizeName(city.name)}`, city.id]));
    let found = 0;
    state.remittances.forEach((row) => { const a = row.document.recipient.address; if (!a.cityCode) { a.cityCode = lookup.get(`${a.uf}:${normalizeName(a.city)}`) || ""; if (a.cityCode) found += 1; } });
    renderImport(); toast(`${found} códigos municipais preenchidos.`, found ? "success" : "info");
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

async function saveImport() {
  if (!state.company) return toast("Salve a empresa emitente primeiro.", "error");
  setBusy(true, "Salvando importação…");
  try {
    if (state.remittances.every((row) => row.id)) {
      for (let index = 0; index < state.remittances.length; index += 200) {
        const rows = state.remittances.slice(index, index + 200).map(({ id, reference, trackingCode, service, document }) => ({ id, reference, trackingCode, service, document }));
        await dataAction("remittances.update", { rows });
      }
      state.remittances = await dataAction("remittances.list", {});
      toast("Correções salvas.", "success"); state.view = "issue"; await renderIssue(false); return;
    }
    const started = await dataAction("import.start", { fileName: state.fileNames.join(" + ").slice(0, 160), fileType: state.fileNames.every((name) => name.toLowerCase().endsWith(".xml")) ? "XML" : "CSV" });
    for (let index = 0; index < state.remittances.length; index += started.chunkSize) {
      const rows = state.remittances.slice(index, index + started.chunkSize).map(({ reference, trackingCode, service, document }) => ({ reference, trackingCode, service, document }));
      await dataAction("import.append", { importId: started.id, rows });
      setBusy(true, `Salvando ${Math.min(index + rows.length, state.remittances.length)} de ${state.remittances.length}…`);
    }
    const summary = await dataAction("import.finish", { importId: started.id });
    state.remittances = await dataAction("remittances.list", { importId: started.id });
    toast(`Importação salva: ${summary.valid} prontas e ${summary.invalid} com pendências.`, "success");
    state.view = "issue"; await renderIssue(false);
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

async function renderIssue(load = false) {
  if (load || !state.remittances.some((row) => row.id)) {
    try { [state.remittances, state.batches] = await Promise.all([dataAction("remittances.list", {}), dataAction("batches.list", {})]); } catch (error) { toast(error.message, "error"); }
  }
  const ready = state.remittances.filter((row) => row.status === "READY");
  const pendingBatch = state.batches.find((batch) => ["PREPARED", "PROCESSING", "PARTIAL"].includes(String(batch.STATUS)));
  if (!state.selectedIds.size) ready.forEach((row) => state.selectedIds.add(row.id));
  shell(`<div class="page-head"><div><p class="eyebrow">PASSO 3</p><h1>Assinar e autorizar</h1><p>O serviço oficial recebe uma DC-e por requisição. O aplicativo percorre toda a seleção em blocos controlados, sem limite total fixo.</p></div><span class="status-chip ${ready.length ? "ok" : ""}">${ready.length} prontas</span></div><div class="issue-grid"><section class="card"><div class="section-title"><div><h2>Remessas prontas</h2><p>Somente registros sem pendências podem receber numeração.</p></div><label class="check"><input id="select-all-ready" type="checkbox" ${ready.length && ready.every((row) => state.selectedIds.has(row.id)) ? "checked" : ""}>Todas</label></div><div class="compact-list">${ready.length ? ready.map((row) => `<label><input class="issue-select" type="checkbox" value="${h(row.id)}" ${state.selectedIds.has(row.id) ? "checked" : ""}><span><b>${h(row.trackingCode)}</b><small>${h(row.document.recipient.name)} · ${h(row.service)}</small></span></label>`).join("") : '<div class="empty small"><b>Nenhuma remessa pronta</b><span>Importe e corrija os registros no passo anterior.</span></div>'}</div></section><section class="card certificate-card"><div class="section-title"><div><h2>e-CNPJ A1</h2><p>.pfx ou .p12 do mesmo CNPJ-base do emitente</p></div><span class="secure">Não armazenado</span></div><label class="file-card"><input id="certificate" type="file" accept=".pfx,.p12,application/x-pkcs12"><span>${h(state.certificateName || "Selecionar certificado A1")}</span></label>${field("passphrase", "Senha do certificado", state.passphrase, { type: "password", wide: true })}${state.certificateInfo ? `<div class="cert-info"><b>${h(state.certificateInfo.commonName)}</b><span>Válido até ${new Date(state.certificateInfo.validTo).toLocaleDateString("pt-BR")}</span></div>` : ""}<div class="environment"><label><input type="radio" name="environment" value="2" ${state.environment === "2" ? "checked" : ""}> Homologação</label><label><input type="radio" name="environment" value="1" ${state.environment === "1" ? "checked" : ""}> Produção</label></div><label class="check"><input id="confirm-eligibility" type="checkbox">Confirmo que as remessas selecionadas não exigem nota fiscal e o emitente não é contribuinte do ICMS.</label><label class="check production-confirm ${state.environment === "1" ? "" : "hidden"}"><input id="confirm-production" type="checkbox">Confirmo emissão fiscal em produção.</label><button id="authorize" class="primary wide" ${ready.length ? "" : "disabled"}>Numerar, assinar e autorizar</button></section></div>${resultTemplate()}`);
  if (pendingBatch) {
    app.querySelector(".page-head").insertAdjacentHTML("afterend", `<div class="resume-banner"><div><b>Existe um lote interrompido</b><span>${h(pendingBatch.ID)} · ${h(pendingBatch.TOTAL)} documentos</span></div><button id="resume-batch" data-batch="${h(pendingBatch.ID)}" class="secondary">Retomar lote</button></div>`);
  }
  bindIssueEvents();
}

function bindIssueEvents() {
  app.querySelectorAll(".issue-select").forEach((input) => input.addEventListener("change", () => input.checked ? state.selectedIds.add(input.value) : state.selectedIds.delete(input.value)));
  app.querySelector("#select-all-ready")?.addEventListener("change", (event) => { state.remittances.filter((row) => row.status === "READY").forEach((row) => event.target.checked ? state.selectedIds.add(row.id) : state.selectedIds.delete(row.id)); renderIssue(false); });
  app.querySelector("#certificate")?.addEventListener("change", inspectCertificate);
  app.querySelector("[name=passphrase]")?.addEventListener("change", (event) => { state.passphrase = event.target.value; });
  app.querySelectorAll("[name=environment]").forEach((input) => input.addEventListener("change", () => { state.environment = input.value; renderIssue(false); }));
  app.querySelector("#authorize")?.addEventListener("click", authorizeBatch);
  app.querySelector("#resume-batch")?.addEventListener("click", (event) => resumeBatch(event.currentTarget.dataset.batch));
  app.querySelector("#download-dace")?.addEventListener("click", downloadDaces);
  app.querySelectorAll("[data-xml]").forEach((button) => button.addEventListener("click", () => { const result = state.results[Number(button.dataset.xml)]; textDownload(result.processedXml || result.signedXml, `${result.accessKey || result.trackingCode}-procDCe.xml`); }));
}

async function resumeBatch(batchId) {
  state.passphrase = document.querySelector("[name=passphrase]").value;
  if (!state.certificateBase64 || !state.passphrase) return toast("Selecione o certificado A1 e informe a senha.", "error");
  if (!document.querySelector("#confirm-eligibility")?.checked) return toast("Confirme a elegibilidade das remessas para DC-e.", "error");
  setBusy(true, "Recuperando lote…");
  try {
    const stored = await dataAction("batch.get", { batchId });
    state.environment = String(stored.batch.ENVIRONMENT);
    const confirmProduction = state.environment === "1" ? window.confirm("Confirma a retomada deste lote em produção?") : false;
    if (state.environment === "1" && !confirmProduction) throw new Error("Retomada em produção não confirmada.");
    state.batch = { id: batchId, documents: stored.documents };
    const pending = stored.documents.filter((document) => ["PREPARED", "ERROR"].includes(document.status));
    if (!pending.length) throw new Error("O lote não possui documentos pendentes para retransmissão.");
    const certificateInfo = await api("/api/dce/certificate", { method: "POST", body: JSON.stringify({ certificateBase64: state.certificateBase64, passphrase: state.passphrase }) });
    if (!certificateInfo.cnpj || digits(certificateInfo.cnpj).slice(0, 8) !== digits(state.company?.cnpj).slice(0, 8)) throw new Error("O CNPJ-base do certificado não corresponde ao emitente.");
    const service = await api("/api/dce/status", { method: "POST", body: JSON.stringify({ certificateBase64: state.certificateBase64, passphrase: state.passphrase, environment: state.environment }) });
    if (service.cStat !== "107") throw new Error(`Autorizador indisponível: ${service.cStat} ${service.reason}`);
    state.results = [];
    for (let index = 0; index < pending.length; index += 5) {
      const documents = pending.slice(index, index + 5);
      setBusy(true, `Retomando ${index + 1} a ${Math.min(index + 5, pending.length)} de ${pending.length}…`);
      const response = await api("/api/dce/authorize", { method: "POST", body: JSON.stringify({ documents, certificateBase64: state.certificateBase64, passphrase: state.passphrase, confirmProduction }) });
      state.results.push(...response.results);
      await dataAction("batch.saveResults", { batchId, results: response.results });
    }
    toast("Lote retomado e resultados gravados.", "success");
    await renderIssue(true);
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

async function inspectCertificate(event) {
  const file = event.target.files[0]; if (!file) return;
  state.certificateName = file.name; state.certificateBase64 = await fileToBase64(file);
  state.passphrase = document.querySelector("[name=passphrase]").value;
  setBusy(true, "Validando certificado…");
  try { state.certificateInfo = await api("/api/dce/certificate", { method: "POST", body: JSON.stringify({ certificateBase64: state.certificateBase64, passphrase: state.passphrase }) }); toast("Certificado A1 válido.", "success"); renderIssue(false); }
  catch (error) { state.certificateInfo = null; toast(error.message, "error"); }
  finally { setBusy(false); }
}

async function authorizeBatch() {
  state.passphrase = document.querySelector("[name=passphrase]").value;
  const ids = [...state.selectedIds].filter((id) => state.remittances.some((row) => row.id === id && row.status === "READY"));
  if (!ids.length) return toast("Selecione ao menos uma remessa pronta.", "error");
  if (!state.certificateBase64 || !state.passphrase) return toast("Selecione o certificado A1 e informe a senha.", "error");
  if (!document.querySelector("#confirm-eligibility")?.checked) return toast("Confirme a elegibilidade das remessas para DC-e.", "error");
  const confirmProduction = state.environment === "1" ? document.querySelector("#confirm-production")?.checked : false;
  if (state.environment === "1" && !confirmProduction) return toast("Confirme a emissão em produção.", "error");
  setBusy(true, "Reservando a numeração…");
  try {
    setBusy(true, "Conferindo o e-CNPJ…");
    const certificateInfo = await api("/api/dce/certificate", { method: "POST", body: JSON.stringify({ certificateBase64: state.certificateBase64, passphrase: state.passphrase }) });
    if (!certificateInfo.cnpj) throw new Error("Não foi possível identificar o CNPJ no certificado digital.");
    if (digits(certificateInfo.cnpj).slice(0, 8) !== digits(state.company?.cnpj).slice(0, 8)) throw new Error("O CNPJ-base do certificado não corresponde ao emitente.");
    state.certificateInfo = certificateInfo;
    setBusy(true, "Verificando o serviço autorizador…");
    const service = await api("/api/dce/status", { method: "POST", body: JSON.stringify({ certificateBase64: state.certificateBase64, passphrase: state.passphrase, environment: state.environment }) });
    if (service.cStat !== "107") throw new Error(`Autorizador indisponível: ${service.cStat} ${service.reason}`);
    state.batch = await dataAction("batch.prepare", { remittanceIds: ids, environment: state.environment });
    state.results = [];
    const size = 5;
    for (let index = 0; index < state.batch.documents.length; index += size) {
      const documents = state.batch.documents.slice(index, index + size);
      setBusy(true, `Autorizando ${index + 1} a ${Math.min(index + size, state.batch.documents.length)} de ${state.batch.documents.length}…`);
      const response = await api("/api/dce/authorize", { method: "POST", body: JSON.stringify({ documents, certificateBase64: state.certificateBase64, passphrase: state.passphrase, confirmProduction }) });
      state.results.push(...response.results);
      await dataAction("batch.saveResults", { batchId: state.batch.id, results: response.results });
    }
    const authorized = state.results.filter((result) => result.status === "AUTHORIZED").length;
    toast(`${authorized} de ${state.results.length} DC-e autorizadas.`, authorized === state.results.length ? "success" : "info");
    await renderIssue(true);
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

function resultTemplate() {
  if (!state.results.length) return "";
  return `<section class="card results"><div class="section-title"><div><h2>Resultado do lote</h2><p>${state.results.filter((r) => r.status === "AUTHORIZED").length} autorizadas de ${state.results.length}</p></div><button id="download-dace" class="secondary">Baixar DACE</button></div><div class="result-list">${state.results.map((result, index) => `<div class="result-row"><span class="dot ${result.status.toLowerCase()}"></span><div><b>${h(result.trackingCode || result.reference)}</b><small>${h(result.reason || result.error || result.status)}</small></div><code>${h(result.accessKey || "")}</code>${result.signedXml ? `<button class="ghost" data-xml="${index}">XML</button>` : ""}</div>`).join("")}</div></section>`;
}

async function downloadDaces() {
  const authorized = state.results.filter((result) => result.status === "AUTHORIZED");
  if (!authorized.length || !state.batch) return;
  setBusy(true, "Montando DACE…");
  try {
    for (let index = 0; index < authorized.length; index += 5) {
      const results = authorized.slice(index, index + 5);
      const entries = results.map((result) => ({ result: { status: result.status, accessKey: result.accessKey, protocolNumber: result.protocolNumber, total: result.total, qrCode: result.qrCode }, document: state.batch.documents.find((doc) => doc.reference === result.reference) }));
      const response = await api("/api/dce/dace", { method: "POST", body: JSON.stringify({ entries }) });
      downloadBlob(await response.blob(), `dace-lote-${state.batch.id}-${Math.floor(index / 5) + 1}.pdf`);
    }
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

async function renderHistory(load = false) {
  if (load) {
    try { [state.history, state.batches] = await Promise.all([dataAction("dce.list", {}), dataAction("batches.list", {})]); }
    catch (error) { toast(error.message, "error"); }
  }
  const rows = state.history.map((row) => {
    const batch = state.batches.find((item) => String(item.ID) === String(row.BATCH_ID));
    const environment = String(batch?.ENVIRONMENT || "2");
    return `<tr><td><span class="status-chip ${row.STATUS === "AUTHORIZED" ? "ok" : ""}">${h(row.STATUS)}</span></td><td>${h(row.SERIES)}/${h(row.NUMBER)}</td><td><code>${h(row.ACCESS_KEY)}</code></td><td>${h(row.PROTOCOL)}</td><td>${h(row.REASON)}</td><td><div class="button-row">${row.ACCESS_KEY ? `<button class="ghost" data-query="${h(row.ID)}" data-env="${environment}">Consultar</button>` : ""}${row.STATUS === "AUTHORIZED" ? `<button class="ghost" data-history-dace="${h(row.ID)}">DACE</button><button class="ghost danger" data-cancel="${h(row.ID)}" data-env="${environment}">Cancelar</button>` : ""}${row.PROCESSED_XML_FILE_ID ? `<button class="ghost" data-file="${h(row.PROCESSED_XML_FILE_ID)}" data-name="${h(row.ACCESS_KEY)}-procDCe.xml">XML proc.</button>` : ""}${row.SIGNED_XML_FILE_ID ? `<button class="ghost" data-file="${h(row.SIGNED_XML_FILE_ID)}" data-name="${h(row.ACCESS_KEY)}-dce.xml">XML</button>` : ""}</div></td></tr>`;
  }).join("");
  shell(`<div class="page-head"><div><p class="eyebrow">ARQUIVO FISCAL</p><h1>Documentos emitidos</h1><p>Consulte, cancele e recupere os XML assinados ou processados que ficaram organizados no Drive.</p></div><span class="status-chip">${state.history.length} documentos</span></div><section class="card history-tools"><div><h2>Certificado para consulta e evento</h2><p>O arquivo continua somente na memória desta sessão.</p></div><label class="file-card"><input id="history-certificate" type="file" accept=".pfx,.p12,application/x-pkcs12"><span>${h(state.certificateName || "Selecionar e-CNPJ A1")}</span></label>${field("historyPassphrase", "Senha", state.passphrase, { type: "password" })}</section><section class="card table-card"><div class="table-scroll"><table><thead><tr><th>Status</th><th>Número</th><th>Chave</th><th>Protocolo</th><th>Motivo</th><th>Ações</th></tr></thead><tbody>${rows || '<tr><td colspan="6"><div class="empty small">Nenhum documento emitido.</div></td></tr>'}</tbody></table></div></section>`);
  app.querySelectorAll("[data-file]").forEach((button) => button.addEventListener("click", async () => { try { const file = await dataAction("file.get", { fileId: button.dataset.file }); textDownload(file.content, button.dataset.name); } catch (error) { toast(error.message, "error"); } }));
  app.querySelector("#history-certificate")?.addEventListener("change", readHistoryCertificate);
  app.querySelector("[name=historyPassphrase]")?.addEventListener("change", (event) => { state.passphrase = event.target.value; });
  app.querySelectorAll("[data-query]").forEach((button) => button.addEventListener("click", () => queryDce(button.dataset.query, button.dataset.env)));
  app.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", () => cancelDce(button.dataset.cancel, button.dataset.env)));
  app.querySelectorAll("[data-history-dace]").forEach((button) => button.addEventListener("click", () => downloadHistoryDace(button.dataset.historyDace)));
}

async function downloadHistoryDace(id) {
  const row = state.history.find((item) => String(item.ID) === String(id));
  setBusy(true, "Montando DACE…");
  try {
    const stored = await dataAction("batch.get", { batchId: row.BATCH_ID });
    const document = stored.documents.find((item) => String(item.reference) === String(row.REMITTANCE_ID));
    if (!document) throw new Error("Dados da remessa não encontrados.");
    const result = { status: "AUTHORIZED", accessKey: row.ACCESS_KEY, protocolNumber: row.PROTOCOL };
    const response = await api("/api/dce/dace", { method: "POST", body: JSON.stringify({ entries: [{ document, result }] }) });
    downloadBlob(await response.blob(), `${row.ACCESS_KEY}-DACE.pdf`);
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

async function readHistoryCertificate(event) {
  const file = event.target.files[0]; if (!file) return;
  state.passphrase = document.querySelector("[name=historyPassphrase]")?.value || state.passphrase;
  state.certificateName = file.name; state.certificateBase64 = await fileToBase64(file);
  toast("Certificado carregado para esta sessão.", "success"); renderHistory(false);
}

function historyCredentials() {
  state.passphrase = document.querySelector("[name=historyPassphrase]")?.value || state.passphrase;
  if (!state.certificateBase64 || !state.passphrase) throw new Error("Selecione o e-CNPJ A1 e informe a senha.");
  return { certificateBase64: state.certificateBase64, passphrase: state.passphrase };
}

async function queryDce(id, environment) {
  const row = state.history.find((item) => String(item.ID) === String(id));
  try {
    const credentials = historyCredentials(); setBusy(true, "Consultando o Ambiente Nacional…");
    const result = await api("/api/dce/consult", { method: "POST", body: JSON.stringify({ ...credentials, environment, accessKey: row.ACCESS_KEY }) });
    await dataAction("dce.recordEvent", { dceId: id, type: "QUERY", event: { ...result, status: "QUERY" } });
    toast(`${result.cStat}: ${result.reason}`, "success");
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

async function cancelDce(id, environment) {
  const row = state.history.find((item) => String(item.ID) === String(id));
  const reason = window.prompt("Justificativa do cancelamento, entre 15 e 255 caracteres:");
  if (reason == null) return;
  try {
    const credentials = historyCredentials();
    if (environment === "1" && !window.confirm("Confirma o cancelamento desta DC-e em produção?")) return;
    setBusy(true, "Transmitindo evento de cancelamento…");
    const result = await api("/api/dce/cancel", { method: "POST", body: JSON.stringify({ ...credentials, environment, confirmProduction: environment === "1", accessKey: row.ACCESS_KEY, issuerCnpj: row.CNPJ, protocolNumber: row.PROTOCOL, reason }) });
    await dataAction("dce.recordEvent", { dceId: id, type: "CANCELLATION", event: result });
    toast(`${result.cStat}: ${result.reason}`, result.status === "CANCELLED" ? "success" : "error");
    await renderHistory(true);
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(false); }
}

async function startApp() {
  setBusy(true, "Abrindo seu ambiente…");
  try { state.company = await dataAction("company.get", {}); renderCompany(); }
  catch (error) { toast(error.message, "error"); renderCompany(); }
  finally { setBusy(false); }
}

async function init() {
  try {
    const callback = await handleAuthCallback();
    if (callback && ["invite", "recovery"].includes(callback.type)) { renderCredentialSetup(callback); return; }
    state.user = await getUser();
  }
  catch (error) { toast(error.message, "error"); }
  if (state.user) await startApp(); else renderAuth();
}

init();
