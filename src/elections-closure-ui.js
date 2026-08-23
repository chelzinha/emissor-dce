import './elections-closure-ui.css';
import { dataAction } from './api.js';

const ROOT = document.querySelector('#elections-app');
const fmt = (value) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
function h(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function campaignId(){return document.querySelector('#campaign-select')?.value || '';}

function statusCopy(data){
  if(data.status==='CLOSED') return {label:'Encerrada',cls:'closed',text:'A operação está encerrada. Consultas e relatórios permanecem disponíveis, mas novas alterações operacionais ficam bloqueadas.'};
  if(data.status==='READY_WITH_RETURNS') return {label:'Pronta com devoluções',cls:'ready-return',text:'Todos os objetos chegaram a um estado terminal. Há devoluções registradas no fechamento.'};
  if(data.status==='READY') return {label:'Pronta para encerramento',cls:'ready',text:'Produção, postagem e rastreamento não possuem saldos operacionais pendentes.'};
  return {label:'Ainda não pronta',cls:'pending',text:'Existem saldos que precisam ser concluídos antes do encerramento.'};
}

function actionMarkup(data){
  if(data.status==='CLOSED') return `<div class="closure-actions"><button type="button" class="secondary" data-closure-reopen>Reabrir operação</button><small>Reabertura exige motivo e confirmação explícita.</small></div>`;
  if(data.ready) return `<div class="closure-actions"><button type="button" class="primary" data-closure-close>Encerrar operação</button><small>Depois do encerramento, o histórico continua disponível em modo de consulta.</small></div>`;
  return '';
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
    ${blockers?`<div class="closure-blockers"><strong>Pendências para encerramento</strong><ul>${blockers}</ul></div>`:`<div class="closure-ready-note">✓ Todos os gates operacionais estão concluídos. O encerramento só acontece por ação manual e explícita.</div>`}
    <div class="closure-tracking-detail"><span>Sem atualização <b>${fmt(tracking.awaitingUpdate)}</b></span><span>Em trânsito <b>${fmt(tracking.inTransit)}</b></span><span>Saiu para entrega <b>${fmt(tracking.outForDelivery)}</b></span><span>Ocorrências <b>${fmt(tracking.exception)}</b></span><span>Em devolução <b>${fmt(tracking.returning)}</b></span><span>Desconhecidos <b>${fmt(tracking.unknown)}</b></span></div>
    ${actionMarkup(data)}
    <small class="closure-note">${h(data.note||'Diagnóstico de prontidão calculado pelo backend.')}</small>
  </section>`;
}

async function refreshCard(page,id){
  const data=await dataAction('operation.closure.status',{campaignId:id});
  if(!page.isConnected||campaignId()!==id)return null;
  const existing=page.querySelector('[data-closure-card]');
  const anchor=page.querySelector('.report-middle')||page.querySelector('.report-stages')?.closest('.card');
  existing?.remove();
  if(!anchor)return null;
  anchor.insertAdjacentHTML('afterend',renderCard(data));
  const card=page.querySelector('[data-closure-card]');
  if(card){card.dataset.campaignId=id;bindActions(page,card,id,data);}
  return card;
}

function bindActions(page,card,id,data){
  card.querySelector('[data-closure-close]')?.addEventListener('click',async(event)=>{
    const confirmation=window.prompt('Para encerrar esta operação, digite ENCERRAR.');
    if(String(confirmation||'').trim().toUpperCase()!=='ENCERRAR')return;
    const button=event.currentTarget,original=button.textContent;
    button.disabled=true;button.textContent='Encerrando...';
    try{
      await dataAction('operation.closure.close',{campaignId:id,confirmation:'ENCERRAR'});
      await refreshCard(page,id);
    }catch(error){alert(error.message);button.disabled=false;button.textContent=original;}
  });
  card.querySelector('[data-closure-reopen]')?.addEventListener('click',async(event)=>{
    const reason=window.prompt('Informe o motivo da reabertura da operação.');
    if(!reason)return;
    if(String(reason).trim().length<10){alert('Informe um motivo com pelo menos 10 caracteres.');return;}
    const confirmation=window.prompt('Para reabrir esta operação, digite REABRIR.');
    if(String(confirmation||'').trim().toUpperCase()!=='REABRIR')return;
    const button=event.currentTarget,original=button.textContent;
    button.disabled=true;button.textContent='Reabrindo...';
    try{
      await dataAction('operation.closure.reopen',{campaignId:id,confirmation:'REABRIR',reason:String(reason).trim()});
      await refreshCard(page,id);
    }catch(error){alert(error.message);button.disabled=false;button.textContent=original;}
  });
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
    await refreshCard(page,id);
  }catch(error){
    if(!page.isConnected||campaignId()!==id)return;
    const anchor=page.querySelector('.report-middle');
    if(anchor&&!page.querySelector('[data-closure-card]'))anchor.insertAdjacentHTML('afterend',`<section class="card closure-card pending" data-closure-card><div class="notice warn">Não foi possível calcular a prontidão para encerramento: ${h(error.message)}</div></section>`);
  }finally{delete page.dataset.closureLoading;}
}

const observer=new MutationObserver(()=>queueMicrotask(enhance));
if(ROOT)observer.observe(ROOT,{childList:true,subtree:true});
enhance();
