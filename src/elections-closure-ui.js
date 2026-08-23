import './elections-closure-ui.css';
import { dataAction } from './api.js';

const ROOT = document.querySelector('#elections-app');
const fmt = (value) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
function h(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function campaignId(){return document.querySelector('#campaign-select')?.value || '';}

function statusCopy(data){
  if(data.status==='CLOSED') return {label:'Encerrada',cls:'closed',text:'A operação já está marcada como encerrada.'};
  if(data.status==='READY_WITH_RETURNS') return {label:'Pronta com devoluções',cls:'ready-return',text:'Todos os objetos chegaram a um estado terminal. Há devoluções registradas no fechamento.'};
  if(data.status==='READY') return {label:'Pronta para encerramento',cls:'ready',text:'Produção, postagem e rastreamento não possuem saldos operacionais pendentes.'};
  return {label:'Ainda não pronta',cls:'pending',text:'Existem saldos que precisam ser concluídos antes do encerramento.'};
}

function renderCard(data){
  const copy=statusCopy(data),stats=data.stats||{},tracking=stats.tracking||{};
  const blockers=(data.blockers||[]).map(item=>`<li><span>${h(item.label)}</span><b>${fmt(item.quantity)}</b></li>`).join('');
  return `<section class="card closure-card ${copy.cls}" data-closure-card>
    <div class="closure-head"><div><p class="eyebrow">ENCERRAMENTO</p><h2>Prontidão para encerramento</h2><p>${h(copy.text)}</p></div><span class="closure-status ${copy.cls}">${h(copy.label)}</span></div>
    <div class="closure-stats">
      <div><span>Objetos da operação</span><b>${fmt(stats.totalObjects)}</b></div>
      <div><span>Postados</span><b>${fmt(stats.posted)}</b></div>
      <div class="ok"><span>Entregues</span><b>${fmt(stats.delivered)}</b></div>
      <div class="returned"><span>Devolvidos</span><b>${fmt(stats.returned)}</b></div>
      <div class="pending"><span>Rastreamento em aberto</span><b>${fmt(stats.unresolvedTracking)}</b></div>
    </div>
    ${blockers?`<div class="closure-blockers"><strong>Pendências para encerramento</strong><ul>${blockers}</ul></div>`:`<div class="closure-ready-note">✓ Todos os gates operacionais estão concluídos. O encerramento continuará sendo uma ação manual e explícita.</div>`}
    <div class="closure-tracking-detail"><span>Sem atualização <b>${fmt(tracking.awaitingUpdate)}</b></span><span>Em trânsito <b>${fmt(tracking.inTransit)}</b></span><span>Saiu para entrega <b>${fmt(tracking.outForDelivery)}</b></span><span>Ocorrências <b>${fmt(tracking.exception)}</b></span><span>Em devolução <b>${fmt(tracking.returning)}</b></span><span>Desconhecidos <b>${fmt(tracking.unknown)}</b></span></div>
    <small class="closure-note">${h(data.note||'Diagnóstico somente leitura.')}</small>
  </section>`;
}

async function enhance(){
  const page=ROOT?.querySelector('.reports-page');
  const id=campaignId();
  if(!page||!id)return;
  const existing=page.querySelector('[data-closure-card]');
  if(existing?.dataset.campaignId===id)return;
  if(page.dataset.closureLoading===id)return;
  page.dataset.closureLoading=id;
  try{
    const data=await dataAction('operation.closure.status',{campaignId:id});
    if(!page.isConnected||campaignId()!==id)return;
    existing?.remove();
    const anchor=page.querySelector('.report-middle')||page.querySelector('.report-stages')?.closest('.card');
    if(anchor){anchor.insertAdjacentHTML('afterend',renderCard(data));const card=page.querySelector('[data-closure-card]');if(card)card.dataset.campaignId=id;}
  }catch(error){
    if(!page.isConnected||campaignId()!==id)return;
    const anchor=page.querySelector('.report-middle');
    if(anchor&&!page.querySelector('[data-closure-card]'))anchor.insertAdjacentHTML('afterend',`<section class="card closure-card pending" data-closure-card><div class="notice warn">Não foi possível calcular a prontidão para encerramento: ${h(error.message)}</div></section>`);
  }finally{delete page.dataset.closureLoading;}
}

const observer=new MutationObserver(()=>queueMicrotask(enhance));
if(ROOT)observer.observe(ROOT,{childList:true,subtree:true});
enhance();
