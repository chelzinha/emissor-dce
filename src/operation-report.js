const NF = new Intl.NumberFormat('pt-BR');

function n(value){const number=Number(value||0);return Number.isFinite(number)?number:0;}
function field(row,...keys){for(const key of keys){if(row?.[key]!=null&&row[key]!=='')return row[key];}return 0;}
function sum(rows,...keys){return (rows||[]).reduce((total,row)=>total+n(field(row,...keys)),0);}

export function operationLocalDate(value,timeZone='America/Fortaleza'){
  const date=new Date(String(value||''));
  if(Number.isNaN(date.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function operationEventQuantity(events,type,service=''){
  const target=String(service||'').toUpperCase();
  return (events||[]).filter(event=>String(event.type||event.TYPE||'')===type).reduce((total,event)=>{
    const direct=String(event.service||event.SERVICE||'').toUpperCase();
    const meta=event.metadata||event.METADATA_JSON||{};
    if(!target)return total+n(event.quantity??event.QUANTITY);
    if(direct===target)return total+n(event.quantity??event.QUANTITY);
    if(!direct&&meta&&meta[target.toLowerCase()]!=null)return total+n(meta[target.toLowerCase()]);
    return total;
  },0);
}

export function buildOperationSnapshot({addressLists=[],portalExports=[],portalReturns=[],productionBatches=[],events=[],trackingSummary=null}={}){
  const received=sum(addressLists,'total','TOTAL_ROWS');
  const cleanReady=sum(addressLists,'ready','READY_ROWS');
  const cleanReview=sum(addressLists,'review','REVIEW_ROWS');
  const cleanRejected=sum(addressLists,'rejected','REJECTED_ROWS');
  const cleanPending=Math.max(0,received-cleanReady-cleanReview-cleanRejected);
  const exported=sum(portalExports,'TOTAL_ROWS','totalRows','total');
  const returned=sum(portalReturns,'TOTAL_ROWS','totalRows','total');
  const generatedPac=operationEventQuantity(events,'LABEL_GENERATED','PAC');
  const generatedSedex=operationEventQuantity(events,'LABEL_GENERATED','SEDEX');
  const generated=generatedPac+generatedSedex;
  const printed=operationEventQuantity(events,'LABEL_PRINTED');
  const handoff=operationEventQuantity(events,'LABEL_HANDOFF');
  const eventPosted=operationEventQuantity(events,'POSTING_COMPLETED');
  const eventDelivered=operationEventQuantity(events,'TRACKING_DELIVERED');
  const tracking=trackingSummary?.total||{};
  const posted=trackingSummary?Math.max(n(tracking.posted),eventPosted):eventPosted;
  const delivered=trackingSummary?Math.max(n(tracking.delivered),eventDelivered):eventDelivered;
  const dcePrepared=operationEventQuantity(events,'DCE_PREPARED');
  const dceAuthorized=operationEventQuantity(events,'DCE_AUTHORIZED');
  const productionTotal=sum(productionBatches,'TOTAL','total');
  const stages=[
    {key:'received',label:'Cadastros recebidos',total:received,completed:received,pending:0},
    {key:'cleaning',label:'Higienização',total:received,completed:cleanReady,review:cleanReview,rejected:cleanRejected,pending:cleanPending},
    {key:'exported',label:'Exportação Portal',total:cleanReady,completed:Math.min(exported,cleanReady||exported),pending:Math.max(0,cleanReady-exported)},
    {key:'returned',label:'Retorno Portal',total:exported,completed:Math.min(returned,exported||returned),pending:Math.max(0,exported-returned)},
    {key:'generated',label:'Etiquetas geradas',total:returned,completed:Math.min(generated,returned||generated),pending:Math.max(0,returned-generated)},
    {key:'printed',label:'Etiquetas impressas',total:generated,completed:Math.min(printed,generated||printed),pending:Math.max(0,generated-printed)},
    {key:'handoff',label:'Entrega interna',total:printed,completed:Math.min(handoff,printed||handoff),pending:Math.max(0,printed-handoff)},
    {key:'posted',label:'Postagem',total:handoff,completed:Math.min(posted,handoff||posted),pending:Math.max(0,handoff-posted)},
    {key:'delivered',label:'Entregues pelos Correios',total:posted,completed:Math.min(delivered,posted||delivered),pending:Math.max(0,posted-delivered)},
  ];
  return {received,cleanReady,cleanReview,cleanRejected,cleanPending,exported,returned,productionTotal,generated,generatedPac,generatedSedex,printed,handoff,posted,delivered,dcePrepared,dceAuthorized,tracking:{awaitingUpdate:n(tracking.awaitingUpdate),inTransit:n(tracking.inTransit),outForDelivery:n(tracking.outForDelivery),delivered:n(tracking.delivered),exception:n(tracking.exception),returning:n(tracking.returning),returned:n(tracking.returned),unknown:n(tracking.unknown)},stages};
}

function emptyDay(date){return{date,received:0,cleaningProcessed:0,exported:0,returned:0,generatedPac:0,generatedSedex:0,generated:0,printed:0,handoff:0,dcePrepared:0,dceAuthorized:0,posted:0,delivered:0};}

export function buildDailyActivity(events,{from='',to='',timeZone='America/Fortaleza'}={}){
  const days=new Map();
  for(const event of events||[]){
    const date=operationLocalDate(event.occurredAt||event.OCCURRED_AT,timeZone);
    if(!date||from&&date<from||to&&date>to)continue;
    if(!days.has(date))days.set(date,emptyDay(date));
    const row=days.get(date),type=String(event.type||event.TYPE||''),quantity=n(event.quantity??event.QUANTITY),service=String(event.service||event.SERVICE||'').toUpperCase();
    if(type==='ADDRESS_LIST_RECEIVED')row.received+=quantity;
    else if(type==='ADDRESS_CLEANING_COMPLETED')row.cleaningProcessed+=quantity;
    else if(type==='PORTAL_CSV_EXPORTED')row.exported+=quantity;
    else if(type==='PORTAL_RETURN_IMPORTED')row.returned+=quantity;
    else if(type==='LABEL_GENERATED'){row.generated+=quantity;if(service==='PAC')row.generatedPac+=quantity;if(service==='SEDEX')row.generatedSedex+=quantity;}
    else if(type==='LABEL_PRINTED')row.printed+=quantity;
    else if(type==='LABEL_HANDOFF')row.handoff+=quantity;
    else if(type==='DCE_PREPARED')row.dcePrepared+=quantity;
    else if(type==='DCE_AUTHORIZED')row.dceAuthorized+=quantity;
    else if(type==='POSTING_COMPLETED')row.posted+=quantity;
    else if(type==='TRACKING_DELIVERED')row.delivered+=quantity;
  }
  return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

function csvCell(value){const text=String(value??'');return /[;"\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;}
export function operationReportCsv(snapshot,daily){
  const lines=['RELATÓRIO OPERACIONAL','','RESUMO ATUAL','ETAPA;TOTAL;CONCLUÍDO;REVISÃO;REJEITADOS;PENDENTE'];
  for(const stage of snapshot?.stages||[])lines.push([stage.label,stage.total,stage.completed,stage.review||0,stage.rejected||0,stage.pending].map(csvCell).join(';'));
  lines.push('','','GERAÇÃO POR SERVIÇO',`PAC;${snapshot?.generatedPac||0}`,`SEDEX;${snapshot?.generatedSedex||0}`,'','ATIVIDADE DIÁRIA','DATA;RECEBIDOS;HIGIENIZAÇÃO PROCESSADA;EXPORTADOS;RETORNADOS;ETIQUETAS PAC;ETIQUETAS SEDEX;ETIQUETAS TOTAL;IMPRESSAS;ENTREGA INTERNA;DC-E PREPARADAS;DC-E AUTORIZADAS;POSTADOS;ENTREGUES');
  for(const row of daily||[])lines.push([row.date,row.received,row.cleaningProcessed,row.exported,row.returned,row.generatedPac,row.generatedSedex,row.generated,row.printed,row.handoff,row.dcePrepared,row.dceAuthorized,row.posted,row.delivered].map(csvCell).join(';'));
  return '\uFEFF'+lines.join('\r\n');
}

export function reportNumber(value){return NF.format(n(value));}
