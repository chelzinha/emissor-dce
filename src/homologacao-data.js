export const DEMO_CAMPAIGN={id:'demo-eleicoes-2026',name:'Campanha Ceará 2026 - Demonstração',candidateName:'Candidato Demonstrativo',cnpj:'12.345.678/0001-90',office:'Governador do Ceará'};

export const DEMO_TRACKING={updatedAt:'2026-08-25T18:40:00-03:00',pac:{posted:622,awaitingUpdate:0,inTransit:180,outForDelivery:20,delivered:390,exception:12,returning:10,returned:10},sedex:{posted:440,awaitingUpdate:0,inTransit:116,outForDelivery:11,delivered:294,exception:8,returning:6,returned:5},total:{posted:1062,awaitingUpdate:0,inTransit:296,outForDelivery:31,delivered:684,exception:20,returning:16,returned:15}};

export const DEMO_TRACKING_EVENTS=[
 {eventAt:'2026-08-25T18:32:00-03:00',trackingCode:'QN909523035BR',status:'Entregue ao destinatário',category:'DELIVERED',location:'Fortaleza - CE'},
 {eventAt:'2026-08-25T18:18:00-03:00',trackingCode:'OY855189170BR',status:'Objeto em trânsito',category:'IN_TRANSIT',location:'Unidade de Tratamento - CE'},
 {eventAt:'2026-08-25T17:44:00-03:00',trackingCode:'QN909522918BR',status:'Saiu para entrega',category:'OUT_FOR_DELIVERY',location:'Caucaia - CE'},
 {eventAt:'2026-08-25T16:20:00-03:00',trackingCode:'OY855188925BR',status:'Endereço insuficiente',category:'EXCEPTION',location:'Maracanaú - CE'},
 {eventAt:'2026-08-25T15:55:00-03:00',trackingCode:'QN909522805BR',status:'Objeto em devolução',category:'RETURNING',location:'Sobral - CE'},
 {eventAt:'2026-08-25T15:31:00-03:00',trackingCode:'OY855188770BR',status:'Entregue ao destinatário',category:'DELIVERED',location:'Juazeiro do Norte - CE'}
];

export const DEMO_OPERATION_EVENTS=[
 {type:'ADDRESS_LIST_RECEIVED',quantity:1200,occurredAt:'2026-08-20T09:00:00-03:00',service:'',metadata:{}},
 {type:'ADDRESS_CLEANING_COMPLETED',quantity:1148,occurredAt:'2026-08-21T11:30:00-03:00',service:'',metadata:{}},
 {type:'PORTAL_CSV_EXPORTED',quantity:1062,occurredAt:'2026-08-22T14:10:00-03:00',service:'',metadata:{}},
 {type:'PORTAL_RETURN_IMPORTED',quantity:1062,occurredAt:'2026-08-23T10:25:00-03:00',service:'',metadata:{}},
 {type:'LABEL_GENERATED',quantity:440,occurredAt:'2026-08-24T08:30:00-03:00',service:'SEDEX',metadata:{}},
 {type:'LABEL_HANDOFF',quantity:440,occurredAt:'2026-08-24T10:40:00-03:00',service:'SEDEX',metadata:{}},
 {type:'POSTING_COMPLETED',quantity:440,occurredAt:'2026-08-24T16:15:00-03:00',service:'SEDEX',metadata:{sedex:440}},
 {type:'LABEL_GENERATED',quantity:622,occurredAt:'2026-08-25T08:10:00-03:00',service:'PAC',metadata:{}},
 {type:'LABEL_HANDOFF',quantity:622,occurredAt:'2026-08-25T10:20:00-03:00',service:'PAC',metadata:{}},
 {type:'POSTING_COMPLETED',quantity:622,occurredAt:'2026-08-25T16:40:00-03:00',service:'PAC',metadata:{pac:622}},
 {type:'TRACKING_DELIVERED',quantity:684,occurredAt:'2026-08-25T18:40:00-03:00',service:'',metadata:{pac:390,sedex:294}}
];

export function createDemoState(){
 return{
  daily:[
   {date:'2026-08-24',pacQuantity:0,pacAmount:0,sedexQuantity:440,sedexAmount:12144,totalQuantity:440,totalAmount:12144,paid:5000,balance:7144,listId:'191540'},
   {date:'2026-08-25',pacQuantity:622,pacAmount:17120,sedexQuantity:0,sedexAmount:0,totalQuantity:622,totalAmount:17120,paid:10000,balance:7120,listId:'191787'}
  ],
  payments:[
   {id:'pay-2',date:'2026-08-25',method:'PIX',reference:'Pagamento parcial 25/08',amount:10000},
   {id:'pay-1',date:'2026-08-24',method:'TRANSFERÊNCIA',reference:'Adiantamento inicial',amount:5000}
  ],
  imports:[{id:'imp-1',fileName:'consolidador_postagens_25-08.csv',createdAt:'2026-08-25T17:05:00-03:00',inserted:1062,duplicates:0,conflicts:0,totalAmount:29264,status:'Concluída'}]
 };
}

export function financeSummary(state){
 const totalObjects=state.daily.reduce((sum,row)=>sum+Number(row.totalQuantity||0),0);
 const totalAmount=state.daily.reduce((sum,row)=>sum+Number(row.totalAmount||0),0);
 const received=state.payments.reduce((sum,row)=>sum+Number(row.amount||0),0);
 const allocated=Math.min(totalAmount,received);
 return{totalObjects,totalAmount,received,allocated,outstanding:Math.max(0,totalAmount-allocated),credit:Math.max(0,received-totalAmount),daily:state.daily,pac:{quantity:state.daily.reduce((s,r)=>s+Number(r.pacQuantity||0),0),amount:state.daily.reduce((s,r)=>s+Number(r.pacAmount||0),0)},sedex:{quantity:state.daily.reduce((s,r)=>s+Number(r.sedexQuantity||0),0),amount:state.daily.reduce((s,r)=>s+Number(r.sedexAmount||0),0)}};
}

export function demoCharges(state){
 return state.daily.flatMap(row=>{
  const rows=[];
  if(row.pacQuantity)rows.push({date:row.date,service:'PAC',listId:row.listId,quantity:row.pacQuantity,amount:row.pacAmount,paid:Math.min(row.paid,row.pacAmount),balance:Math.max(0,row.pacAmount-row.paid)});
  if(row.sedexQuantity)rows.push({date:row.date,service:'SEDEX',listId:row.listId,quantity:row.sedexQuantity,amount:row.sedexAmount,paid:Math.min(row.paid,row.sedexAmount),balance:Math.max(0,row.sedexAmount-row.paid)});
  return rows;
 });
}
