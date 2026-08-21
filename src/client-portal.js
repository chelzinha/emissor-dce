import "./client-portal.css";
import { getUser, login, logout } from "@netlify/identity";
import { api, dataAction, fileToBase64 } from "./api.js";
import { buildAuthorizeBody, chunkDocuments, clearCertificateState, normalizeAuthorizationPackage, normalizeAuthorizationResults, pendingDocuments } from "./client-dce.js";

const app = document.querySelector("#client-portal");
const toastBox = document.querySelector("#client-toast");

const state = {
  user: null,
  operations: [],
  campaignId: "",
  view: "dashboard",
  dashboard: null,
  simulatorConfig: null,
  dcePackages: [],
  issuerProfile: null,
  certificateBase64: "",
  certificateName: "",
  passphrase: "",
  certificateInfo: null,
};

const NAV = Object.freeze([
  ["dashboard", "Dashboard", "<svg viewBox='0 0 24 24'><path d='M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z'/></svg>"],
  ["simulator", "Simulador", "<svg viewBox='0 0 24 24'><path d='M6 3h12v18H6zM9 7h6M9 11h2M13 11h2M9 15h2M13 15h2'/></svg>"],
  ["authorization", "Autorizar DC-e", "<svg viewBox='0 0 24 24'><path d='M12 3l7 3v5c0 4.6-2.9 8-7 10-4.1-2-7-5.4-7-10V6zM9 12l2 2 4-4'/></svg>"],
]);

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}
function fmt(value) { return new Intl.NumberFormat("pt-BR").format(Number(value || 0)); }
function money(cents) { return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(Number(cents || 0) / 100); }
function initials(value) { return String(value || "U").split(/\s|@/).filter(Boolean).slice(0,2).map((p) => p[0]).join("").toUpperCase(); }
function statusClass(value) {
  const status = String(value || "").toUpperCase();
  if (["READY", "ACTIVE", "AUTHORIZED", "DCE_AUTHORIZED", "FINISHED", "POSTED", "DELIVERED"].includes(status)) return "ok";
  if (["AWAITING_CLIENT_AUTHORIZATION", "READY_FOR_AUTHORIZATION", "PARTIAL", "PROCESSING", "PREPARED"].includes(status)) return "warn";
  if (["ERROR", "REJECTED", "BLOCKED", "REVIEW"].includes(status)) return "bad";
  return "";
}
function toast(message, type="info") {
  toastBox.textContent = message;
  toastBox.className = `client-toast show ${type}`;
  setTimeout(() => { toastBox.className = "client-toast"; }, 4200);
}
function busy(label="Processando…") {
  document.querySelector("#busy-overlay")?.remove();
  const overlay = document.createElement("div"); overlay.id="busy-overlay"; overlay.className="busy-overlay";
  overlay.innerHTML = `<div class="busy-card"><div class="spinner"></div><strong>${h(label)}</strong></div>`;
  document.body.appendChild(overlay); return () => overlay.remove();
}
function currentOperation() { return state.operations.find((item) => item.id === state.campaignId) || null; }

function renderAuth() {
  app.innerHTML = `<main class="client-auth">
    <section class="auth-copy">
      <div class="brand-lockup"><div class="brand-mark">AGF</div><div><strong>Operações Postais</strong><small>Acompanhamento do cliente</small></div></div>
      <p class="eyebrow">ACESSO DO CLIENTE</p>
      <h1>Visibilidade da operação, do planejamento à entrega.</h1>
      <p>Acompanhe seus lotes, simule PAC e SEDEX e autorize DC-e com o seu próprio certificado A1 quando houver documentos preparados para assinatura.</p>
      <div class="trust-row"><span>Somente 3 áreas principais</span><span>Certificado não é gravado</span><span>Dados operacionais isolados</span></div>
    </section>
    <section class="auth-panel"><h2>Entrar</h2><p>Use a conta vinculada à sua operação.</p>
      <form id="client-login" class="form-stack">
        <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="username" required></label>
        <label class="field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="primary" type="submit">Entrar com segurança</button>
      </form>
      ${location.hostname === "localhost" ? '<button id="local-client" class="ghost" style="width:100%;margin-top:10px">Visualizar ambiente local</button>' : ""}
    </section>
  </main>`;
  app.querySelector("#client-login").addEventListener("submit", async (event) => {
    event.preventDefault(); const stop = busy("Entrando…");
    try { const values=Object.fromEntries(new FormData(event.currentTarget)); state.user=await login(values.email,values.password); await start(); }
    catch(error){ toast(error.message,"error"); } finally { stop(); }
  });
  app.querySelector("#local-client")?.addEventListener("click", async () => {
    state.user={ id:"local-client-preview", email:"cliente@localhost" };
    state.operations=[{ id:"preview", name:"Operação demonstrativa", candidateName:"Cliente" , role:"CAMPAIGN_USER" }]; state.campaignId="preview";
    state.dashboard={ metrics:{addressReceived:1183,addressCleaned:1183,portalReturned:1183,labelsPac:183,labelsSedex:1000,labelsPrinted:1183,labelsHandedOff:1183,posted:1183,delivered:742,withoutDeliveryRecord:441}, timeline:[], productionStatus:{total:2,active:1,completed:1,blocked:0} };
    state.simulatorConfig={ configured:false, reason:"TABELA_NAO_CONFIGURADA" }; state.dcePackages=[]; renderCurrent();
  });
}

function shell(content) {
  const operation=currentOperation();
  app.innerHTML = `<div class="portal-shell">
    <aside class="portal-sidebar">
      <div class="portal-brand"><div class="brand-mark">AGF</div><div><strong>Operações Postais</strong><small>Portal do cliente</small></div></div>
      <nav class="portal-nav">${NAV.map(([id,label,icon])=>`<button data-view="${id}" class="${state.view===id?"active":""}">${icon}<span>${h(label)}</span></button>`).join("")}</nav>
      <div class="sidebar-note">A operação administrativa fica em ambiente separado. Aqui o cliente acompanha, simula e autoriza os documentos que exigem sua assinatura.</div>
    </aside>
    <main class="portal-workspace">
      <header class="portal-topbar">
        <div class="operation-select"><span>Operação</span><select id="operation-select">${state.operations.map((item)=>`<option value="${h(item.id)}" ${item.id===state.campaignId?"selected":""}>${h(item.name || item.candidateName || item.cnpj)}</option>`).join("")}</select></div>
        <div class="profile-wrap"><button id="avatar" class="avatar-button" aria-label="Abrir perfil">${h(initials(state.user?.email))}</button><div id="profile-menu" class="profile-menu"><div class="identity"><strong>${h(operation?.candidateName || operation?.name || "Cliente")}</strong><small>${h(state.user?.email || "")}</small></div><button id="fiscal-profile">Perfil fiscal da operação</button><button id="logout">Sair</button></div></div>
      </header>
      <section class="portal-content">${content}</section>
    </main>
  </div>`;
  app.querySelectorAll("[data-view]").forEach((button)=>button.addEventListener("click", async()=>{state.view=button.dataset.view; await renderCurrent();}));
  app.querySelector("#operation-select")?.addEventListener("change", async(event)=>{ state.campaignId=event.target.value; await refresh(); await renderCurrent(); });
  app.querySelector("#avatar")?.addEventListener("click",()=>app.querySelector("#profile-menu")?.classList.toggle("open"));
  app.querySelector("#fiscal-profile")?.addEventListener("click", openFiscalProfile);
  app.querySelector("#logout")?.addEventListener("click",async()=>{ clearCertificateState(state); await logout(); state.user=null; renderAuth(); });
}

function fiscalField(name,label,value="",options={}) {
  return `<label class="field ${options.wide?"wide":""}"><span>${h(label)}</span><input name="${h(name)}" value="${h(value)}" ${options.type?`type="${h(options.type)}"`:""} ${options.required?"required":""} ${options.readonly?"readonly":""}></label>`;
}

function openFiscalProfile() {
  document.querySelector("#fiscal-modal")?.remove();
  const operation=currentOperation() || {};
  const p=state.issuerProfile || {};
  const a=p.address || {};
  const modal=document.createElement("div"); modal.id="fiscal-modal"; modal.className="modal-backdrop";
  modal.innerHTML=`<section class="profile-modal" role="dialog" aria-modal="true" aria-labelledby="fiscal-title">
    <header><div><p class="page-eyebrow">PERFIL FISCAL</p><h2 id="fiscal-title">Dados do emitente da DC-e</h2><p>Esses dados serão usados pela agência apenas para preparar os documentos que você autorizará com o seu próprio A1.</p></div><button id="close-fiscal" class="ghost" type="button">Fechar</button></header>
    <div class="info-strip">O CNPJ fica vinculado à operação. Alterações feitas pela agência exigem nova confirmação do cliente antes de liberar um novo pacote fiscal.</div>
    <form id="fiscal-form" class="form-grid" style="margin-top:16px">
      ${fiscalField("cnpj","CNPJ",p.cnpj || operation.cnpj || "",{required:true,readonly:true})}
      ${fiscalField("name","Razão social",p.name || "",{required:true,wide:true})}
      ${fiscalField("series","Série DC-e",p.series ?? 0,{type:"number",required:true})}
      ${fiscalField("nextNumber","Próximo número DC-e",p.nextNumber ?? 1,{type:"number",required:true})}
      ${fiscalField("street","Logradouro",a.street || "",{required:true,wide:true})}
      ${fiscalField("number","Número",a.number || "",{required:true})}
      ${fiscalField("complement","Complemento",a.complement || "")}
      ${fiscalField("district","Bairro",a.district || "",{required:true})}
      ${fiscalField("city","Município",a.city || "",{required:true})}
      ${fiscalField("uf","UF",a.uf || "",{required:true})}
      ${fiscalField("zip","CEP",a.zip || "",{required:true})}
      ${fiscalField("cityCode","Código IBGE",a.cityCode || "",{required:true})}
      ${fiscalField("email","E-mail",p.email || a.email || "",{type:"email"})}
      ${fiscalField("phone","Telefone",p.phone || a.phone || "")}
      <div class="wide declaration-box"><label><input name="nonIcmsContributor" type="checkbox" ${p.nonIcmsContributor?"checked":""} required><span>Confirmo a declaração de não contribuinte do ICMS usada pelo emissor.</span></label><label><input name="operationWithoutInvoice" type="checkbox" ${p.operationWithoutInvoice?"checked":""} required><span>Confirmo a declaração de que estas remessas correspondem a operação sem nota fiscal, conforme o fluxo configurado.</span></label></div>
      <div class="wide modal-actions"><span class="status ${statusClass(p.status)}">${h(p.status || "NÃO CONFIRMADO")}</span><button class="primary" type="submit">Salvar e confirmar perfil fiscal</button></div>
    </form>
  </section>`;
  document.body.appendChild(modal);
  modal.querySelector("#close-fiscal").addEventListener("click",()=>modal.remove());
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
  modal.querySelector("#fiscal-form").addEventListener("submit",async(event)=>{
    event.preventDefault(); const stop=busy("Salvando perfil fiscal…");
    try {
      const v=Object.fromEntries(new FormData(event.currentTarget));
      const profile={
        cnpj:v.cnpj,name:v.name,series:Number(v.series),nextNumber:Number(v.nextNumber),email:v.email,phone:v.phone,
        nonIcmsContributor:v.nonIcmsContributor==="on",operationWithoutInvoice:v.operationWithoutInvoice==="on",
        address:{street:v.street,number:v.number,complement:v.complement,district:v.district,city:v.city,uf:String(v.uf||"").toUpperCase(),zip:v.zip,cityCode:v.cityCode,countryCode:"1058",country:"BRASIL",email:v.email,phone:v.phone}
      };
      state.issuerProfile=await dataAction("issuer.upsert",{campaignId:state.campaignId,profile,confirmDeclarations:true});
      toast("Perfil fiscal confirmado.","success"); modal.remove();
    } catch(error){ toast(error.message,"error"); } finally{ stop(); }
  });
}

function pageHead(eyebrow,title,description,extra="") { return `<div class="page-head"><div><p class="page-eyebrow">${h(eyebrow)}</p><h1>${h(title)}</h1><p>${h(description)}</p></div>${extra}</div>`; }

function dashboardView() {
  const m=state.dashboard?.metrics || {};
  const metrics=[["Cadastros recebidos",m.addressReceived],["Endereços preparados",m.addressCleaned],["Etiquetas PAC",m.labelsPac],["Etiquetas SEDEX",m.labelsSedex],["Impressas",m.labelsPrinted],["Entregues à operação",m.labelsHandedOff],["Postados",m.posted],["Entregues pelos Correios",m.delivered]];
  const base=Math.max(1,Number(m.addressReceived||0));
  shell(`${pageHead("VISÃO GERAL","Dashboard da operação","Indicadores consolidados do que já aconteceu na operação. A entrega postal é apresentada separadamente da entrega interna à equipe operacional.")}
    <div class="grid metrics">${metrics.map(([label,value])=>`<article class="card metric-card"><span>${h(label)}</span><strong>${fmt(value)}</strong><small>Acumulado</small></article>`).join("")}</div>
    <div class="grid two" style="margin-top:16px">
      <section class="card"><div class="section-title"><div><h2>Avanço operacional</h2><p>Comparação com a quantidade recebida.</p></div></div><div class="progress-list">${[["Preparados",m.addressCleaned],["Portal Postal",m.portalReturned],["Impressos",m.labelsPrinted],["Operação",m.labelsHandedOff],["Postados",m.posted],["Entregues",m.delivered]].map(([label,value])=>{const pct=Math.min(100,Math.round(Number(value||0)/base*100));return `<div class="progress-row"><span>${h(label)}</span><div class="progress-track"><i style="width:${pct}%"></i></div><strong>${pct}%</strong></div>`;}).join("")}</div></section>
      <section class="card"><div class="section-title"><div><h2>Últimas atualizações</h2><p>Sem exibir dados pessoais de destinatários.</p></div></div><div class="timeline">${(state.dashboard?.timeline||[]).slice(0,9).map((item)=>`<div class="timeline-item"><time>${h(String(item.occurredAt||"").replace("T"," ").slice(0,16))}</time><strong>${h(item.label||item.type)}</strong><span>${item.service?`${h(item.service)} · `:""}${fmt(item.quantity)}</span></div>`).join("") || '<div class="empty">Nenhuma atualização disponível.</div>'}</div></section>
    </div>`);
}

function simulatorView() {
  const config=state.simulatorConfig || {};
  shell(`${pageHead("PLANEJAMENTO","Simulador PAC / SEDEX","Consulta de preço e prazo usando exclusivamente a tabela à vista configurada para esta operação. O sistema não estima nem inventa tarifas.", config.configured?`<span class="status ok">Tabela ${h(config.version?.name || "ativa")}</span>`:`<span class="status warn">Tabela pendente</span>`)}
    <div class="simulator-layout">
      <section class="card"><div class="section-title"><div><h2>Dados do envio</h2><p>Informe CEPs, serviço, peso e dimensões.</p></div></div>
        <form id="quote-form" class="form-grid">
          <label class="field"><span>CEP de origem</span><input name="originCep" inputmode="numeric" maxlength="9" required value="${h(config.defaultOriginCep||"")}"></label>
          <label class="field"><span>CEP de destino</span><input name="destinationCep" inputmode="numeric" maxlength="9" required></label>
          <label class="field"><span>Serviço</span><select name="service"><option>PAC</option><option>SEDEX</option></select></label>
          <label class="field"><span>Peso (g)</span><input name="weightGrams" type="number" min="1" step="1" required></label>
          <label class="field"><span>Altura (cm)</span><input name="heightCm" type="number" min="0" step="0.1" value="0"></label>
          <label class="field"><span>Largura (cm)</span><input name="widthCm" type="number" min="0" step="0.1" value="0"></label>
          <label class="field"><span>Comprimento (cm)</span><input name="lengthCm" type="number" min="0" step="0.1" value="0"></label>
          <div class="wide info-strip">O resultado só é liberado quando existe uma faixa correspondente em uma tabela versionada e ativa. Sem tabela oficial carregada, o simulador permanece indisponível.</div>
          <div class="wide form-actions"><button class="primary" type="submit" ${config.configured?"":"disabled"}>Calcular preço e prazo</button></div>
        </form>
      </section>
      <section id="quote-result" class="card"><div class="quote-empty"><div><strong>${config.configured?"Preencha os dados para simular.":"Tabela de tarifas ainda não configurada."}</strong><p>${config.configured?"O preço e o prazo aparecerão aqui.":"A agência precisa vincular uma tabela à vista válida a esta operação antes de liberar valores."}</p></div></div></section>
    </div>`);
  app.querySelector("#quote-form")?.addEventListener("submit", runQuote);
}

async function runQuote(event) {
  event.preventDefault(); const stop=busy("Consultando tabela…");
  try {
    const v=Object.fromEntries(new FormData(event.currentTarget));
    const quote=await dataAction("simulator.quote",{ campaignId:state.campaignId,...v,weightGrams:Number(v.weightGrams),heightCm:Number(v.heightCm),widthCm:Number(v.widthCm),lengthCm:Number(v.lengthCm) });
    const slot=app.querySelector("#quote-result");
    if(!quote.matched){ slot.innerHTML=`<div class="quote-empty"><div><strong>Faixa não encontrada.</strong><p>Não existe uma tarifa configurada que corresponda exatamente aos dados informados.</p></div></div>`; return; }
    slot.innerHTML=`<div class="quote-result"><div class="section-title"><div><h2>Resultado</h2><p>${h(quote.service)} · tabela ${h(quote.version?.name||"")}</p></div><span class="status ok">Correspondência exata</span></div><div class="quote-hero"><div class="quote-box"><span>Preço à vista</span><strong>${money(quote.priceCents)}</strong></div><div class="quote-box"><span>Prazo configurado</span><strong>${fmt(quote.deadlineBusinessDays)} dia${Number(quote.deadlineBusinessDays)===1?"":"s"} útil${Number(quote.deadlineBusinessDays)===1?"":"eis"}</strong></div></div><div class="quote-meta"><div><span>Origem</span><strong>${h(quote.request.originCep)}</strong></div><div><span>Destino</span><strong>${h(quote.request.destinationCep)}</strong></div><div><span>Peso</span><strong>${fmt(quote.request.weightGrams)} g</strong></div><div><span>Validade da tabela</span><strong>${h(quote.version?.validFrom||"—")} a ${h(quote.version?.validTo||"—")}</strong></div></div></div>`;
  } catch(error){ toast(error.message,"error"); } finally{ stop(); }
}

function authorizationView() {
  shell(`${pageHead("ASSINATURA DO EMITENTE","Autorização de DC-e","A agência prepara os documentos. Você revisa o lote e autoriza com o seu próprio e-CNPJ A1. O certificado e a senha não são gravados no Apps Script nem no Google Drive.")}
    <div class="dce-list">${state.dcePackages.map((raw)=>{ const pkg=normalizeAuthorizationPackage(raw); const remaining=Math.max(0,pkg.total-pkg.authorized); return `<article class="dce-card" data-package="${h(pkg.id)}"><header><div><h3>Lote ${h(pkg.id.slice(0,8)||pkg.productionBatchId.slice(0,8))}</h3><p>${fmt(pkg.total)} DC-e · ambiente ${pkg.environment==="1"?"produção":"homologação"}</p></div><span class="status ${statusClass(pkg.status)}">${h(pkg.status||"PENDENTE")}</span></header><div class="dce-stats"><span><strong>${fmt(pkg.authorized)}</strong> autorizadas</span><span><strong>${fmt(pkg.rejected)}</strong> rejeitadas</span><span><strong>${fmt(remaining)}</strong> restantes</span></div><button class="secondary" data-open-package="${h(pkg.id)}">Revisar e autorizar</button><div class="dce-auth-panel" id="package-${h(pkg.id)}" hidden></div></article>`; }).join("") || '<div class="empty">Nenhuma DC-e aguardando sua autorização.</div>'}</div>`);
  app.querySelectorAll("[data-open-package]").forEach((button)=>button.addEventListener("click",()=>openPackage(button.dataset.openPackage)));
}

async function openPackage(packageId) {
  const slot=app.querySelector(`#package-${CSS.escape(packageId)}`); if(!slot) return;
  const stop=busy("Carregando documentos…");
  try {
    const pkg=normalizeAuthorizationPackage(await dataAction("client.dce.get",{campaignId:state.campaignId,packageId}));
    const remaining=pendingDocuments(pkg);
    slot.hidden=false;
    slot.innerHTML=`<div class="certificate-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3l7 3v5c0 4.6-2.9 8-7 10-4.1-2-7-5.4-7-10V6z"/></svg><span>O arquivo A1 e a senha ficam apenas no estado temporário desta tela e são enviados ao endpoint de autorização somente durante o processamento. O backend de dados recebe apenas os resultados e XMLs autorizados, nunca o certificado.</span></div>
      <div class="info-strip" style="margin-bottom:14px"><strong>${fmt(remaining.length)}</strong> documentos ainda precisam de processamento. A assinatura é feita em blocos pequenos para permitir retomada em caso de falha.</div>
      <div class="authorization-grid"><label class="field"><span>Certificado A1 (.pfx / .p12)</span><input id="certificate-${h(pkg.id)}" type="file" accept=".pfx,.p12,application/x-pkcs12" ${remaining.length?"required":"disabled"}></label><label class="field"><span>Senha do certificado</span><input id="passphrase-${h(pkg.id)}" type="password" ${remaining.length?"required":"disabled"}></label></div>
      ${pkg.environment==="1"?`<label class="production-check"><input id="production-${h(pkg.id)}" type="checkbox"><span>Confirmo que este lote será transmitido no ambiente de produção.</span></label>`:""}
      <div class="form-actions" style="margin-top:14px"><button class="primary" id="authorize-${h(pkg.id)}" ${remaining.length?"":"disabled"}>Autorizar ${fmt(remaining.length)} DC-e</button></div>`;
    slot.querySelector(`#authorize-${CSS.escape(pkg.id)}`)?.addEventListener("click",()=>authorizePackage(pkg));
  } catch(error){ toast(error.message,"error"); } finally{ stop(); }
}

async function authorizePackage(pkg) {
  const certInput=app.querySelector(`#certificate-${CSS.escape(pkg.id)}`); const passInput=app.querySelector(`#passphrase-${CSS.escape(pkg.id)}`);
  const file=certInput?.files?.[0]; if(!file) return toast("Selecione o certificado A1.","error");
  if(!passInput?.value) return toast("Informe a senha do certificado.","error");
  const confirmProduction=pkg.environment!=="1" || Boolean(app.querySelector(`#production-${CSS.escape(pkg.id)}`)?.checked);
  const stop=busy("Preparando autorização…");
  try {
    state.certificateBase64=await fileToBase64(file); state.certificateName=file.name; state.passphrase=passInput.value;
    const documents=pendingDocuments(pkg); const chunks=chunkDocuments(documents,5); let processed=0; let lastPackageState=null;
    for(let index=0;index<chunks.length;index+=1){
      const body=buildAuthorizeBody({documents:chunks[index],certificateBase64:state.certificateBase64,passphrase:state.passphrase,environment:pkg.environment,confirmProduction});
      document.querySelector(".busy-card strong").textContent=`Autorizando bloco ${index+1} de ${chunks.length}…`;
      const response=await api("/api/dce/authorize",{method:"POST",body:JSON.stringify(body)});
      const results=normalizeAuthorizationResults(response.results||[]);
      lastPackageState=await dataAction("client.dce.saveResults",{campaignId:state.campaignId,packageId:pkg.id,results});
      processed+=results.length;
    }
    toast(lastPackageState?.status==="AUTHORIZED" ? `${fmt(processed)} DC-e processadas. Lote liberado para a etiqueta de teste da agencia.` : `${fmt(processed)} DC-e processadas.`,"success");
    clearCertificateState(state); if(passInput) passInput.value=""; if(certInput) certInput.value="";
    await refresh(); authorizationView();
  } catch(error){ clearCertificateState(state); if(passInput) passInput.value=""; toast(error.message,"error"); } finally{ stop(); }
}

async function refresh() {
  if(!state.campaignId) return;
  const payload={campaignId:state.campaignId};
  const [dashboard,simulatorConfig,dcePackages,issuerProfile]=await Promise.all([
    dataAction("client.dashboard",payload), dataAction("simulator.config",payload), dataAction("client.dce.pending",payload), dataAction("issuer.get",payload)
  ]);
  Object.assign(state,{dashboard,simulatorConfig,dcePackages,issuerProfile});
}
async function loadOperations(){ state.operations=await dataAction("campaigns.list"); if(!state.campaignId&&state.operations.length) state.campaignId=state.operations[0].id; }
async function renderCurrent(){ if(state.view==="dashboard") dashboardView(); if(state.view==="simulator") simulatorView(); if(state.view==="authorization") authorizationView(); }
async function start(){ await loadOperations(); if(!state.operations.length){ app.innerHTML=`<div class="empty" style="margin:10vh auto;max-width:620px;background:white">Sua conta ainda não está vinculada a uma operação postal.</div>`; return; } await refresh(); await renderCurrent(); }

(async()=>{ try { state.user=await getUser(); if(state.user) await start(); else renderAuth(); } catch { renderAuth(); } })();
