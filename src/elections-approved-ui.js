import { dataAction } from "./api.js";

const ROOT = document.querySelector("#elections-app");

const NAV_LABELS = {
  dashboard: "Dashboard",
  campaigns: "Operacoes",
  bases: "Preparacao",
  portal: "Portal Postal",
  returns: "Retorno do Portal",
  production: "Producao",
};

const VIEW_STAGE = { dashboard: 0, campaigns: 0, bases: 1, portal: 3, returns: 4, production: 5, tracking: 7 };
const STAGES = [
  [1, "Receber base", "violet"], [2, "Higienizar", "violet"], [3, "Exportar Portal", "violet"],
  [4, "Retorno Portal", "orange"], [5, "Preparar documentos", "orange"], [6, "Impressao", "orange"],
  [7, "Volumes / acompanhamento", "green"],
];

function numberFromText(text) { const digits = String(text || "").replace(/\D/g, ""); return Number(digits || 0); }
function formatNumber(value) { return new Intl.NumberFormat("pt-BR").format(Number(value || 0)); }
function activeView() { const button=document.querySelector(".app-nav button.active"); return button?.dataset.approvedView || button?.dataset.view || "dashboard"; }

function decorateAuth() {
  const auth = ROOT?.querySelector(".elections-auth"); if (!auth) return;
  const pill = auth.querySelector(".brand-pill"); const title = auth.querySelector(".elections-auth-copy h1"); const copy = auth.querySelector(".elections-auth-copy p");
  if (pill) pill.textContent = "AGF OPERACOES POSTAIS";
  if (title) title.textContent = "Da base de enderecos a producao postal.";
  if (copy) copy.textContent = "Bases, Portal Postal, documentos, etiquetas, volumes e acompanhamento operacional em um unico fluxo.";
}

function decorateBrandAndNav() {
  const brand = ROOT?.querySelector(".app-brand");
  if (brand) { const strong = brand.querySelector("strong"); const small = brand.querySelector("small"); if (strong) strong.textContent = "Operacoes Postais"; if (small) small.textContent = "Painel da agencia"; }
  ROOT?.querySelectorAll(".app-nav button[data-view]").forEach((button) => {
    const view = button.dataset.view; const label = NAV_LABELS[view]; if (!label) return;
    button.textContent = label; button.classList.toggle("nav-prep", ["bases", "portal"].includes(view)); button.classList.toggle("nav-prod", ["returns", "production"].includes(view));
  });
}

function processMarkup(view) {
  const active = VIEW_STAGE[view] || 0;
  return `<section class="approved-process" aria-label="Etapas da operacao"><div class="approved-process-head"><div><strong>PASSO A PASSO DA OPERACAO</strong><span>O volume avanca por etapas e as baixas podem ser parciais.</span></div><div class="approved-process-legend"><i class="done"></i> concluido <i class="current"></i> atual <i class="pending"></i> pendente</div></div><div class="approved-steps">${STAGES.map(([number,label,color])=>{const state=active===0?"neutral":number<active?"done":number===active?"current":"pending";return `<div class="approved-step ${state} ${color}"><b>${number}</b><span>${label}</span></div>`;}).join("")}</div></section>`;
}

function addProcess() { const page=ROOT?.querySelector(".page"); const head=page?.querySelector(":scope > .page-head"); if(!page||!head||page.querySelector(":scope > .approved-process"))return; const view=activeView(); if(view==="campaigns")return; head.insertAdjacentHTML("afterend",processMarkup(view)); }
function metricValueByLabel(label){const card=[...(ROOT?.querySelectorAll(".metric-card")||[])].find(item=>item.querySelector("span")?.textContent.trim()===label);return numberFromText(card?.querySelector("strong")?.textContent)}
function addServiceSummary(){const page=ROOT?.querySelector(".page");const metrics=page?.querySelector(".grid.metrics");if(!page||!metrics||page.querySelector(".service-summary")||activeView()!=="dashboard")return;const pac=metricValueByLabel("PAC emitidos"),sedex=metricValueByLabel("SEDEX emitidos"),total=pac+sedex;metrics.insertAdjacentHTML("beforebegin",`<section class="service-summary"><article class="service-card pac"><div><span>PAC</span><small>Objetos emitidos</small></div><strong>${formatNumber(pac)}</strong></article><article class="service-card sedex"><div><span>SEDEX</span><small>Objetos emitidos</small></div><strong>${formatNumber(sedex)}</strong></article><article class="service-card total"><div><span>TOTAL</span><small>PAC + SEDEX emitidos</small></div><strong>${formatNumber(total)}</strong></article></section>`)}
function genericOperationLanguage(){if(activeView()!=="campaigns")return;const head=ROOT?.querySelector(".page-head");const title=head?.querySelector("h1");const description=head?.querySelector("p:not(.eyebrow)");const action=head?.querySelector("#new-campaign");if(title)title.textContent="Operacoes";if(description)description.textContent="Cada operacao mantem seus dados, usuarios, lotes e historico separados.";if(action)action.textContent="Nova operacao";ROOT?.querySelectorAll("[data-open-campaign]").forEach(button=>{button.textContent="Abrir operacao"})}
const NEXT_VIEW={bases:["portal","Seguir para Portal Postal"],portal:["returns","Seguir para Retorno do Portal"],returns:["production","Seguir para Producao"],production:["tracking","Seguir para Acompanhamento"]};
function addNextAction(){const page=ROOT?.querySelector(".page");if(!page||page.querySelector(".approved-next"))return;const next=NEXT_VIEW[activeView()];if(!next)return;page.insertAdjacentHTML("beforeend",`<div class="approved-next"><div><strong>Etapa concluida?</strong><span>Avance mantendo o mesmo contexto da operacao selecionada.</span></div><button class="primary" type="button" data-approved-next="${next[0]}">${next[1]} -></button></div>`)}
function keepChipsResponsive(){ROOT?.querySelectorAll(".status").forEach(chip=>{chip.title=chip.textContent.trim()})}

function addDcePreparationButtons(){
  if(activeView()!=="production")return;
  ROOT?.querySelectorAll(".card").forEach(card=>{
    const status=card.querySelector(".status")?.textContent.trim();
    const volumeButton=card.querySelector("[data-volumes]");
    if(status!=="AWAITING_DCE_PREPARATION"||!volumeButton||card.querySelector("[data-prepare-dce]"))return;
    volumeButton.insertAdjacentHTML("afterend",`<button class="primary" data-prepare-dce="${volumeButton.dataset.volumes}">Preparar lote DC-e</button>`);
  });
}

function openDcePreparationModal(batchId){
  document.querySelector("#approved-dce-modal")?.remove();
  const modal=document.createElement("div");modal.id="approved-dce-modal";modal.className="approved-dce-modal open";
  modal.innerHTML=`<section><div class="approved-modal-head"><div><h2>Preparar lote DC-e</h2><p>Pre-flight fiscal antes de liberar o lote para o cliente autorizar.</p></div><button type="button" data-close-dce>×</button></div><div class="approved-form-grid"><label class="wide"><span>Descricao do conteudo</span><input data-dce-description placeholder="Ex.: Material impresso" /></label><label><span>Quantidade por objeto</span><input data-dce-quantity type="number" min="1" value="1" /></label><label><span>Valor unitario declarado</span><input data-dce-value type="number" min="0.01" step="0.01" placeholder="0,01" /></label><label><span>NCM opcional</span><input data-dce-ncm maxlength="8" /></label></div><div class="approved-preflight-note">O lote so sera liberado se CPF/CNPJ do destinatario, endereco, codigo IBGE, conteudo e valor estiverem validos.</div><button class="primary" type="button" data-confirm-dce>Executar pre-flight e liberar lote</button></section>`;
  document.body.appendChild(modal);
  modal.querySelector("[data-close-dce]").addEventListener("click",()=>modal.remove());
  modal.querySelector("[data-confirm-dce]").addEventListener("click",async()=>{
    const campaignId=ROOT.querySelector("#campaign-select")?.value;
    const value=Number(String(modal.querySelector("[data-dce-value]").value).replace(",","."));
    const stopText=modal.querySelector("[data-confirm-dce]").textContent;modal.querySelector("[data-confirm-dce]").disabled=true;modal.querySelector("[data-confirm-dce]").textContent="Validando...";
    try{
      const result=await dataAction("production.dce.prepare",{campaignId,productionBatchId:batchId,itemDefaults:{description:modal.querySelector("[data-dce-description]").value.trim(),quantity:Number(modal.querySelector("[data-dce-quantity]").value||1),unitValue:value,ncm:modal.querySelector("[data-dce-ncm]").value.trim()}});
      modal.remove();
      alert(`Pre-flight concluido. ${result.total} documentos liberados para autorizacao do cliente.`);
      ROOT.querySelector('.app-nav button[data-view="production"]')?.click();
    }catch(error){alert(error.message);modal.querySelector("[data-confirm-dce]").disabled=false;modal.querySelector("[data-confirm-dce]").textContent=stopText;}
  });
}

function decorate(){decorateAuth();decorateBrandAndNav();genericOperationLanguage();addProcess();addServiceSummary();addNextAction();keepChipsResponsive();addDcePreparationButtons()}
ROOT?.addEventListener("click",event=>{const next=event.target.closest("[data-approved-next]");if(next){if(next.dataset.approvedNext==="tracking"){renderTrackingView();}else{ROOT.querySelector(`.app-nav button[data-view="${CSS.escape(next.dataset.approvedNext)}"]`)?.click();}return;}const prep=event.target.closest("[data-prepare-dce]");if(prep)openDcePreparationModal(prep.dataset.prepareDce)});
let scheduled=false;const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;decorate()})});if(ROOT)observer.observe(ROOT,{childList:true,subtree:true});decorate();

function isoDate(value){ return String(value || "").slice(0,10); }
function campaignIdFromShell(){ return ROOT?.querySelector("#campaign-select")?.value || ""; }

function localToday(){
  const date=new Date();
  const offset=date.getTimezoneOffset()*60000;
  return new Date(date.getTime()-offset).toISOString().slice(0,10);
}

async function applyDashboardOperationalDate(date){
  const campaignId=campaignIdFromShell();
  if(!campaignId) return;
  const [summary,events]=await Promise.all([
    dataAction("dashboard.daily",{campaignId,date}),
    dataAction("operations.list",{campaignId,date})
  ]);
  const m=summary?.metrics||{};
  const map={
    "Cadastros recebidos":m.addressReceived,
    "Higienizados":m.addressCleaned,
    "Enviados ao Portal":m.portalExported,
    "Retornados do Portal":m.portalReturned,
    "PAC emitidos":m.labelsPac,
    "SEDEX emitidos":m.labelsSedex,
    "Etiquetas impressas":m.labelsPrinted,
    "Entregues à operação":m.labelsHandedOff,
  };
  ROOT.querySelectorAll(".metric-card").forEach(card=>{
    const label=card.querySelector("span")?.textContent.trim();
    if(Object.prototype.hasOwnProperty.call(map,label)) card.querySelector("strong").textContent=formatNumber(map[label]);
    const small=card.querySelector("small"); if(small) small.textContent=date.split("-").reverse().join("/");
  });
  const pac=Number(m.labelsPac||0),sedex=Number(m.labelsSedex||0);
  const cards=ROOT.querySelectorAll(".service-summary .service-card strong");
  if(cards[0]) cards[0].textContent=formatNumber(pac);
  if(cards[1]) cards[1].textContent=formatNumber(sedex);
  if(cards[2]) cards[2].textContent=formatNumber(pac+sedex);
  const timeline=ROOT.querySelector(".timeline");
  if(timeline){
    timeline.innerHTML=events.slice(0,8).map(item=>`<div class="timeline-item"><time>${String(item.occurredAt||"").replace("T"," ").slice(0,16)}</time><strong>${String(item.type||"").replaceAll("_"," ")}</strong><span>${formatNumber(item.quantity)}</span></div>`).join("") || '<div class="empty">Nenhum evento nesta data.</div>';
  }
}

async function filterOperationalRows(view,date){
  const campaignId=campaignIdFromShell(); if(!campaignId)return;
  if(view==="bases"){
    const rows=await dataAction("addressLists.list",{campaignId});
    const dates={}; rows.forEach(row=>{dates[String(row.id)]=isoDate(row.createdAt)});
    ROOT.querySelectorAll("table tbody tr").forEach(tr=>{
      const id=tr.querySelector("[data-clean]")?.dataset.clean || tr.querySelector("[data-export]")?.dataset.export;
      if(!id)return; const rowDate=dates[String(id)]||""; tr.hidden=Boolean(date&&rowDate!==date);
      if(rowDate&&!tr.querySelector(".approved-row-date")){const cell=tr.querySelector("td");if(cell)cell.insertAdjacentHTML("beforeend",`<small class="approved-row-date">${rowDate.split("-").reverse().join("/")}</small>`)}
    });
  }
  if(view==="production"){
    const rows=await dataAction("production.list",{campaignId});
    const dates={}; rows.forEach(row=>{dates[String(row.ID||row.id)]=isoDate(row.CREATED_AT||row.createdAt)});
    ROOT.querySelectorAll("[data-volumes]").forEach(button=>{
      const card=button.closest(".card"); if(!card)return; const rowDate=dates[String(button.dataset.volumes)]||""; card.hidden=Boolean(date&&rowDate!==date);
      const title=card.querySelector(".section-title p"); if(title&&rowDate&&!title.querySelector(".approved-inline-date")) title.insertAdjacentHTML("beforeend",` <span class="approved-inline-date">• ${rowDate.split("-").reverse().join("/")}</span>`);
    });
  }
}

async function availableOperationalDates(view){
  const campaignId=campaignIdFromShell(); if(!campaignId)return[];
  if(view==="dashboard"){
    const events=await dataAction("operations.list",{campaignId});
    return [...new Set(events.map(item=>isoDate(item.occurredAt)).filter(Boolean))].sort().reverse();
  }
  if(view==="bases"){
    const rows=await dataAction("addressLists.list",{campaignId});
    return [...new Set(rows.map(item=>isoDate(item.createdAt)).filter(Boolean))].sort().reverse();
  }
  if(view==="production"){
    const rows=await dataAction("production.list",{campaignId});
    return [...new Set(rows.map(item=>isoDate(item.CREATED_AT||item.createdAt)).filter(Boolean))].sort().reverse();
  }
  return[];
}

async function addOperationalDateSelector(){
  const page=ROOT?.querySelector(".page"); if(!page||page.querySelector(".approved-date-filter")||page.dataset.approvedDateLoading==="1")return;
  const view=activeView(); if(!["dashboard","bases","production"].includes(view))return;
  page.dataset.approvedDateLoading="1";
  let dates=[];
  try { dates=await availableOperationalDates(view); }
  finally { delete page.dataset.approvedDateLoading; }
  if(!page.isConnected||page.querySelector(".approved-date-filter")||activeView()!==view)return;
  const selected=view==="dashboard"?(dates[0]||localToday()):"";
  const process=page.querySelector(":scope > .approved-process");
  const html=`<section class="approved-date-filter"><div><strong>DATA OPERACIONAL</strong><span>${view==="dashboard"?"Indicadores do dia selecionado":"Separe os lotes por data sem perder o acumulado da operação."}</span></div><select data-operational-date><option value="" ${selected?"":"selected"}>${view==="dashboard"?"Hoje / sem eventos":"Todas as datas"}</option>${dates.map(date=>`<option value="${date}" ${date===selected?"selected":""}>${date.split("-").reverse().join("/")}</option>`).join("")}</select></section>`;
  (process||page.querySelector(":scope > .page-head"))?.insertAdjacentHTML("afterend",html);
  const select=page.querySelector("[data-operational-date]");
  select?.addEventListener("change",async()=>{if(view==="dashboard"){const date=select.value||localToday();await applyDashboardOperationalDate(date)}else await filterOperationalRows(view,select.value)});
  if(view==="dashboard"&&selected) await applyDashboardOperationalDate(selected);
  if(view!=="dashboard") await filterOperationalRows(view,selected);
}

async function renderTrackingView(){
  const campaignId=campaignIdFromShell(); if(!campaignId)return;
  ROOT.querySelectorAll(".app-nav button").forEach(button=>button.classList.remove("active"));
  const button=ROOT.querySelector('[data-approved-view="tracking"]'); if(button)button.classList.add("active");
  const host=ROOT.querySelector(".app-main > section"); if(!host)return;
  host.innerHTML='<div class="page"><div class="approved-tracking-loading">Carregando acompanhamento...</div></div>';
  const [operations,productions,volumes]=await Promise.all([
    dataAction("operations.list",{campaignId}),
    dataAction("production.list",{campaignId}),
    dataAction("volumes.list",{campaignId})
  ]);
  const dates=[...new Set([...
    operations.map(item=>isoDate(item.occurredAt)),
    ...productions.map(item=>isoDate(item.CREATED_AT||item.createdAt))
  ].filter(Boolean))].sort().reverse();
  const selected=dates[0]||localToday();
  const page=host.querySelector(".page");
  const renderDate=(date)=>{
    const ev=operations.filter(item=>!date||isoDate(item.occurredAt)===date);
    const prod=productions.filter(item=>!date||isoDate(item.CREATED_AT||item.createdAt)===date);
    const prodIds=new Set(prod.map(item=>String(item.ID||item.id)));
    const vols=volumes.filter(item=>!date||prodIds.has(String(item.productionBatchId)));
    const qty=(type,service)=>ev.filter(item=>item.type===type&&(!service||item.service===service)).reduce((sum,item)=>sum+Number(item.quantity||0),0);
    const generatedPac=qty("LABEL_GENERATED","PAC"),generatedSedex=qty("LABEL_GENERATED","SEDEX");
    const printed=qty("LABEL_PRINTED"),handoff=qty("LABEL_HANDOFF"),posted=qty("POSTING_COMPLETED"),delivered=qty("TRACKING_DELIVERED");
    const volumeQty=vols.reduce((sum,item)=>sum+Number(item.quantity||0),0);
    page.innerHTML=`${processMarkup("tracking")}<section class="approved-date-filter"><div><strong>ACOMPANHAMENTO POR DATA</strong><span>Volumes, postagem e entrega do dia selecionado.</span></div><select data-track-date>${dates.map(d=>`<option value="${d}" ${d===date?"selected":""}>${d.split("-").reverse().join("/")}</option>`).join("")}</select></section><div class="page-head"><div><p class="eyebrow">ACOMPANHAMENTO</p><h1>Operação em andamento</h1><p>O acompanhamento começa depois da produção e mantém o histórico por data operacional.</p></div></div><section class="service-summary"><article class="service-card pac"><div><span>PAC</span><small>Preparados no dia</small></div><strong>${formatNumber(generatedPac)}</strong></article><article class="service-card sedex"><div><span>SEDEX</span><small>Preparados no dia</small></div><strong>${formatNumber(generatedSedex)}</strong></article><article class="service-card total"><div><span>TOTAL</span><small>Preparados no dia</small></div><strong>${formatNumber(generatedPac+generatedSedex)}</strong></article></section><section class="approved-track-grid"><article class="card"><div class="section-title"><div><h2>Baixas acumuladas</h2><p>Quantidades avançam sem apagar o total original.</p></div></div><div class="approved-track-bars">${[["Preparados",generatedPac+generatedSedex,"violet"],["Impressos",printed,"orange"],["Entregues à operação",handoff,"blue"],["Postados",posted,"navy"],["Entregues pelos Correios",delivered,"green"]].map(([label,value,color])=>`<div><span>${label}</span><div><i class="${color}" style="width:${Math.min(100,Math.round(value/Math.max(1,generatedPac+generatedSedex)*100))}%"></i></div><strong>${formatNumber(value)}</strong></div>`).join("")}</div></article><article class="card"><div class="section-title"><div><h2>Volumes físicos</h2><p>${formatNumber(vols.length)} volumes • ${formatNumber(volumeQty)} etiquetas.</p></div></div><div class="approved-volume-list">${vols.length?vols.map(v=>`<div><b>${v.number}/${v.totalVolumes}</b><span>${v.service}</span><strong>${formatNumber(v.quantity)}</strong><small>${v.status}</small></div>`).join(""):'<div class="empty">Nenhum volume nesta data.</div>'}</div></article></section>`;
    page.querySelector("[data-track-date]")?.addEventListener("change",event=>renderDate(event.target.value));
  };
  renderDate(selected);
}

function addTrackingNavigation(){
  const nav=ROOT?.querySelector(".app-nav"); if(!nav||nav.querySelector('[data-approved-view="tracking"]'))return;
  const button=document.createElement("button"); button.type="button";button.dataset.approvedView="tracking";button.className="nav-track";button.textContent="Acompanhamento";
  button.addEventListener("click",renderTrackingView);nav.appendChild(button);
}

const previousDecorate=decorate;
decorate=function(){previousDecorate();addTrackingNavigation();addOperationalDateSelector().catch(()=>{});};

decorate();
