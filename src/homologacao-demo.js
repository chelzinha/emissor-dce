import './homologacao-demo.css';
import { parseConsolidadorCsv } from './finance-import.js';
import { DEMO_CAMPAIGN,DEMO_TRACKING,DEMO_TRACKING_EVENTS,createDemoState,financeSummary,demoCharges } from './homologacao-data.js';

const root=document.querySelector('#homologacao-app');
const state=createDemoState();
let view='financeiro';
let preview=null;
let previewName='';
let reportFrom='2026-08-24';
let reportTo='2026-08-25';

const h=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const num=value=>new Intl.NumberFormat('pt-BR').format(Number(value||0));
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));
const dateLabel=value=>String(value||'').split('-').reverse().join('/');

function toast(message){
 let box=document.querySelector('.demo-toast');
 if(!box){box=document.createElement('div');box.className='demo-toast';document.body.appendChild(box)}
 box.textContent=message;box.classList.add('show');clearTimeout(box._timer);box._timer=setTimeout(()=>box.classList.remove('show'),3400);
}

function reallocate(){
 let credit=state.payments.reduce((sum,item)=>sum+Number(item.amount||0),0);
 state.daily.sort((a,b)=>a.date.localeCompare(b.date)).forEach(row=>{row.paid=Math.min(row.totalAmount,credit);row.balance=Math.max(0,row.totalAmount-row.paid);credit=Math.max(0,credit-row.paid)});
}

function bar(label,value,total,cls=''){
 const width=total?Math.min(100,Math.round(Number(value||0)/Number(total)*100)):0;
 return `<div class="bar-row ${cls}"><span>${h(label)}</span><div class="bar-track"><i style="width:${width}%"></i></div><b>${num(value)}</b></div>`;
}

function serviceTracking(name,data){
 return `<article class="card service-card"><div class="service-title"><strong>${name}</strong><b>${num(data.posted)}</b></div>${bar('Em trânsito',data.inTransit,data.posted)}${bar('Saiu para entrega',data.outForDelivery,data.posted)}${bar('Entregues',data.delivered,data.posted,'delivered')}${bar('Ocorrências',data.exception,data.posted,'warning')}${bar('Devolvidos',data.returned,data.posted,'returned')}</article>`;
}

function snapshot(data){
 const rows=[['Sem atualização',data.awaitingUpdate,'gray'],['Em trânsito',data.inTransit,''],['Saiu para entrega',data.outForDelivery,''],['Entregues',data.delivered,'green'],['Ocorrências',data.exception,'orange'],['Em devolução',data.returning,'orange'],['Devolvidos',data.returned,'red']];
 return `<div class="snapshot-list">${rows.map(([label,value,cls])=>`<div><i class="dot ${cls}"></i><span>${label}</span><b>${num(value)}</b></div>`).join('')}</div>`;
}

function acompanhamento(){
 const t=DEMO_TRACKING.total;
 return `<div class="demo-page-head"><div><span class="eyebrow">ACOMPANHAMENTO</span><h1>Rastreamento e situação postal</h1><p>Visão consolidada por SRO, serviço e último evento conhecido.</p></div><button class="secondary" data-demo-action="tracking">Simular atualização</button></div>
 <section class="kpi-grid"><article class="card kpi"><span>Objetos postados</span><strong>${num(t.posted)}</strong><small>PAC e SEDEX</small></article><article class="card kpi green"><span>Entregues</span><strong>${num(t.delivered)}</strong><small>${Math.round(t.delivered/t.posted*100)}% dos postados</small></article><article class="card kpi orange"><span>Em trânsito ou entrega</span><strong>${num(t.inTransit+t.outForDelivery)}</strong><small>Atualização mais recente</small></article><article class="card kpi purple"><span>Ocorrências e devoluções</span><strong>${num(t.exception+t.returning+t.returned)}</strong><small>Objetos que exigem atenção</small></article></section>
 <section class="grid-three">${serviceTracking('PAC',DEMO_TRACKING.pac)}${serviceTracking('SEDEX',DEMO_TRACKING.sedex)}<article class="card service-card"><div class="service-title"><strong>TOTAL</strong><b>${num(t.posted)}</b></div>${snapshot(t)}</article></section>
 <section class="card section"><div class="section-head"><div><h2>Eventos recentes por SRO</h2><p>Exemplo de histórico exibido sem redirecionar o cliente ao site dos Correios.</p></div><small class="muted">Atualizado em 25/08/2026 às 18:40</small></div><div class="timeline">${DEMO_TRACKING_EVENTS.map(item=>`<div class="timeline-row"><time>${h(new Date(item.eventAt).toLocaleString('pt-BR'))}</time><code>${h(item.trackingCode)}</code><span>${h(item.status)}<br><small class="muted">${h(item.location)}</small></span><span class="status ${item.category==='DELIVERED'?'ok':item.category==='EXCEPTION'||item.category==='RETURNING'?'warn':''}">${h(item.category.replaceAll('_',' '))}</span></div>`).join('')}</div></section>`;
}

function reportRows(){return state.daily.filter(row=>(!reportFrom||row.date>=reportFrom)&&(!reportTo||row.date<=reportTo))}
function reportTotals(){return reportRows().reduce((out,row)=>{out.objects+=row.totalQuantity;out.amount+=row.totalAmount;out.paid+=row.paid;out.balance+=row.balance;out.pac+=row.pacQuantity;out.sedex+=row.sedexQuantity;return out},{objects:0,amount:0,paid:0,balance:0,pac:0,sedex:0})}

function dailyTable(rows){
 return `<div class="table-wrap"><table class="demo-table"><thead><tr><th>Data</th><th>PAC</th><th>Valor PAC</th><th>SEDEX</th><th>Valor SEDEX</th><th>Total</th><th>Pago</th><th>Saldo</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${dateLabel(row.date)}</td><td>${num(row.pacQuantity)}</td><td>${money(row.pacAmount)}</td><td>${num(row.sedexQuantity)}</td><td>${money(row.sedexAmount)}</td><td><b>${money(row.totalAmount)}</b></td><td>${money(row.paid)}</td><td>${money(row.balance)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhuma movimentação no período.</td></tr>'}</tbody></table></div>`;
}

function relatorios(){
 const totals=reportTotals();
 return `<div class="demo-page-head"><div><span class="eyebrow">RELATÓRIOS</span><h1>Fechamento operacional e financeiro</h1><p>Quantidades, valores, pagamentos e rastreamento no período selecionado.</p></div><button class="primary" id="export-report">Baixar CSV demonstrativo</button></div>
 <section class="card section"><div class="filters"><label class="field"><span>De</span><input id="report-from" type="date" value="${h(reportFrom)}"></label><label class="field"><span>Até</span><input id="report-to" type="date" value="${h(reportTo)}"></label><button class="secondary" id="apply-report">Aplicar período</button></div></section>
 <section class="report-summary"><div><span>Objetos postados</span><b>${num(totals.objects)}</b></div><div><span>Valor postado</span><b>${money(totals.amount)}</b></div><div><span>Pago no período</span><b>${money(totals.paid)}</b></div><div><span>Saldo do período</span><b>${money(totals.balance)}</b></div></section>
 <section class="card section"><div class="section-head"><div><h2>Postagens financeiras por dia</h2><p>PAC e SEDEX com os valores trazidos pelo Consolidador.</p></div></div>${dailyTable(reportRows())}</section>
 <section class="grid-two"><article class="card section"><div class="section-head"><div><h2>Distribuição dos objetos</h2><p>Quantidade no intervalo selecionado.</p></div></div>${bar('PAC',totals.pac,Math.max(1,totals.objects))}${bar('SEDEX',totals.sedex,Math.max(1,totals.objects))}</article><article class="card section"><div class="section-head"><div><h2>Situação postal atual</h2><p>Último evento conhecido dos objetos postados.</p></div></div>${snapshot(DEMO_TRACKING.total)}</article></section>`;
}

function previewMarkup(){
 if(!preview)return '<div class="empty">Selecione um CSV do Consolidador para visualizar a leitura.</div>';
 const s=preview.summary||{};
 return `<div><strong>${h(previewName)}</strong><small class="muted">${num(preview.validRows.length)} linhas válidas e ${num(preview.invalidRows.length)} pendências</small></div><div class="upload-preview"><div><span>PAC</span><b>${num(s.pac?.objects)} objetos<br>${money(s.pac?.amount)}</b></div><div><span>SEDEX</span><b>${num(s.sedex?.objects)} objetos<br>${money(s.sedex?.amount)}</b></div><div><span>Total</span><b>${num(s.totalObjects)} objetos<br>${money(s.totalAmount)}</b></div><div><span>Ignoradas</span><b>${num(preview.skippedWithoutSro||0)} linha(s)</b></div></div><button class="primary" id="apply-import" ${preview.validRows.length?'':'disabled'}>Aplicar na demonstração</button>`;
}

function chargesTable(){
 const charges=demoCharges(state);
 return `<div class="table-wrap"><table class="demo-table"><thead><tr><th>Data</th><th>Serviço</th><th>Lista/OS</th><th>Objetos</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Situação</th></tr></thead><tbody>${charges.map(item=>`<tr><td>${dateLabel(item.date)}</td><td>${item.service}</td><td>${h(item.listId||'Sem lista')}</td><td>${num(item.quantity)}</td><td>${money(item.amount)}</td><td>${money(item.paid)}</td><td>${money(item.balance)}</td><td><span class="status ${item.balance<=0?'ok':item.paid>0?'warn':''}">${item.balance<=0?'Pago':item.paid>0?'Parcial':'Em aberto'}</span></td></tr>`).join('')}</tbody></table></div>`;
}

function financeiro(){
 const summary=financeSummary(state);
 return `<div class="demo-page-head"><div><span class="eyebrow">FINANCEIRO</span><h1>Postagens, pagamentos e saldo</h1><p>Controle por data, serviço, lista e SRO, com baixa parcial e crédito.</p></div></div>
 <section class="kpi-grid"><article class="card kpi"><span>Valor postado</span><strong>${money(summary.totalAmount)}</strong><small>${num(summary.totalObjects)} objetos</small></article><article class="card kpi green"><span>Recebido do cliente</span><strong>${money(summary.received)}</strong><small>${money(summary.allocated)} já alocados</small></article><article class="card kpi orange"><span>Saldo em aberto</span><strong>${money(summary.outstanding)}</strong><small>Postagens ainda não quitadas</small></article><article class="card kpi purple"><span>Crédito disponível</span><strong>${money(summary.credit)}</strong><small>Usado nas próximas postagens</small></article></section>
 <section class="card section"><div class="section-head"><div><h2>Postagens e valores por dia</h2><p>Dados do Consolidador separados entre PAC e SEDEX.</p></div></div>${dailyTable(state.daily)}</section>
 <section class="grid-two"><article class="card section"><div class="section-head"><div><h2>Importar Consolidador</h2><p>Leitura local para você testar o formato sem gravar dados.</p></div></div><div class="upload-box"><input id="finance-file" type="file" accept=".csv,.txt,text/csv,text/plain">${previewMarkup()}</div></article><article class="card section"><div class="section-head"><div><h2>Registrar pagamento</h2><p>A baixa é aplicada automaticamente às postagens mais antigas.</p></div></div><form id="payment-form" class="finance-form"><label class="field"><span>Data</span><input name="date" type="date" value="2026-08-26" required></label><label class="field"><span>Valor</span><input name="amount" inputmode="decimal" placeholder="0,00" required></label><label class="field"><span>Forma</span><select name="method"><option>PIX</option><option>TRANSFERÊNCIA</option><option>DINHEIRO</option><option>CARTÃO DE DÉBITO</option></select></label><label class="field"><span>Referência</span><input name="reference" placeholder="Comprovante ou observação"></label><button class="primary wide">Registrar e dar baixa</button></form></article></section>
 <section class="card section"><div class="section-head"><div><h2>Contas por data, serviço e lista</h2><p>O valor original permanece preservado após cada pagamento.</p></div></div>${chargesTable()}</section>
 <section class="grid-two"><article class="card section"><div class="section-head"><div><h2>Pagamentos recebidos</h2></div></div><div class="table-wrap"><table class="demo-table"><thead><tr><th>Data</th><th>Forma</th><th>Referência</th><th>Valor</th></tr></thead><tbody>${state.payments.map(item=>`<tr><td>${dateLabel(item.date)}</td><td>${h(item.method)}</td><td>${h(item.reference)}</td><td>${money(item.amount)}</td></tr>`).join('')}</tbody></table></div></article><article class="card section"><div class="section-head"><div><h2>Histórico de importações</h2></div></div>${state.imports.map(item=>`<div style="padding:11px 0;border-bottom:1px solid #edf2f6"><strong>${h(item.fileName)}</strong><br><small class="muted">${num(item.inserted)} inseridos · ${num(item.duplicates)} repetidos · ${num(item.conflicts)} conflitos · ${money(item.totalAmount)}</small></div>`).join('')}</article></section>`;
}

function shell(){
 const content=view==='acompanhamento'?acompanhamento():view==='relatorios'?relatorios():financeiro();
 root.innerHTML=`<div class="demo-shell"><aside class="demo-sidebar"><div class="demo-brand"><div class="demo-brand-mark">AGF</div><div><strong>Operações Postais</strong><small>Homologação visual</small></div></div><nav class="demo-nav"><button data-view="acompanhamento" class="${view==='acompanhamento'?'active':''}">Acompanhamento</button><button data-view="relatorios" class="${view==='relatorios'?'active':''}">Relatórios</button><button data-view="financeiro" class="${view==='financeiro'?'active':''}">Financeiro</button></nav><div class="demo-side-note"><b>Ambiente isolado</b><br>Nenhum dado desta tela é enviado ao Apps Script ou à planilha de produção.</div></aside><main class="demo-main"><header class="demo-topbar"><div><strong>${h(DEMO_CAMPAIGN.name)}</strong><small>${h(DEMO_CAMPAIGN.candidateName)} · ${h(DEMO_CAMPAIGN.office)}</small></div><div class="demo-top-actions"><a href="/portal-homologacao.html">Ver portal do cliente</a><button id="reset-demo">Restaurar exemplo</button></div></header><div class="demo-content"><div class="demo-banner"><div><b>Dados fictícios para avaliação visual</b><small>Importações e pagamentos funcionam somente nesta sessão e desaparecem ao atualizar a página.</small></div><span class="status warn">HOMOLOGAÇÃO</span></div>${content}</div></main></div>`;
 bind();
}

function exportCsv(){
 const rows=reportRows();
 const lines=['DATA;PAC OBJETOS;PAC VALOR;SEDEX OBJETOS;SEDEX VALOR;TOTAL OBJETOS;TOTAL VALOR;PAGO;SALDO',...rows.map(row=>[row.date,row.pacQuantity,row.pacAmount,row.sedexQuantity,row.sedexAmount,row.totalQuantity,row.totalAmount,row.paid,row.balance].join(';'))];
 const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='relatorio_homologacao.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function applyPreview(){
 if(!preview?.validRows?.length)return;
 const groups=new Map();
 preview.validRows.forEach(row=>{const key=`${row.postingDate}|${row.service}|${row.listId||'SEM_LISTA'}`;const current=groups.get(key)||{date:row.postingDate,service:row.service,listId:row.listId||'SEM_LISTA',quantity:0,amount:0};current.quantity+=row.quantity;current.amount+=row.amount;groups.set(key,current)});
 groups.forEach(item=>{let day=state.daily.find(row=>row.date===item.date);if(!day){day={date:item.date,pacQuantity:0,pacAmount:0,sedexQuantity:0,sedexAmount:0,totalQuantity:0,totalAmount:0,paid:0,balance:0,listId:item.listId};state.daily.push(day)}if(item.service==='PAC'){day.pacQuantity+=item.quantity;day.pacAmount+=item.amount}else{day.sedexQuantity+=item.quantity;day.sedexAmount+=item.amount}day.totalQuantity+=item.quantity;day.totalAmount+=item.amount;day.listId=item.listId});
 state.imports.unshift({id:`imp-${Date.now()}`,fileName:previewName,createdAt:new Date().toISOString(),inserted:preview.validRows.length,duplicates:0,conflicts:preview.invalidRows.length,totalAmount:preview.summary.totalAmount,status:'Concluída'});preview=null;previewName='';reallocate();toast('Arquivo aplicado somente à demonstração.');shell();
}

function bind(){
 root.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;shell()});
 root.querySelector('#reset-demo')?.addEventListener('click',()=>location.reload());
 root.querySelector('[data-demo-action="tracking"]')?.addEventListener('click',()=>toast('Simulação concluída: 12 novos eventos de rastreamento.'));
 root.querySelector('#apply-report')?.addEventListener('click',()=>{reportFrom=root.querySelector('#report-from').value;reportTo=root.querySelector('#report-to').value;shell()});
 root.querySelector('#export-report')?.addEventListener('click',exportCsv);
 root.querySelector('#finance-file')?.addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;previewName=file.name;preview=parseConsolidadorCsv(await file.text());shell()});
 root.querySelector('#apply-import')?.addEventListener('click',applyPreview);
 root.querySelector('#payment-form')?.addEventListener('submit',event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));const amount=Number(String(values.amount).replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,''));if(!(amount>0)){toast('Informe um valor de pagamento válido.');return}state.payments.unshift({id:`pay-${Date.now()}`,date:values.date,method:values.method,reference:values.reference||'Pagamento de homologação',amount});reallocate();toast('Pagamento registrado e baixa recalculada.');shell()});
}

reallocate();
shell();
