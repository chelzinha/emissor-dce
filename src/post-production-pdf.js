import bwipjs from "bwip-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const MM = 72 / 25.4;
const PAGE_10X15 = [100 * MM, 150 * MM];
const A4 = [210 * MM, 297 * MM];

function safe(value) { return String(value ?? ""); }
function moneylessCnpj(value) {
  const d = safe(value).replace(/\D/g, "");
  if (d.length !== 14) return safe(value);
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

export async function createVolumeLabelsPdf(models) {
  if (!Array.isArray(models) || !models.length) throw new Error("Nenhum volume informado");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const model of models) {
    if (!['PAC','SEDEX'].includes(safe(model.service).toUpperCase())) throw new Error("Servico de volume invalido");
    if (!(Number(model.quantity) > 0 && Number(model.quantity) <= 250)) throw new Error("Volume deve conter de 1 a 250 objetos");
    const page = pdf.addPage(PAGE_10X15);
    const [w,h] = PAGE_10X15;
    const m = 6 * MM;
    page.drawRectangle({ x:m, y:m, width:w-2*m, height:h-2*m, borderColor:rgb(0,0,0), borderWidth:0.8 });
    page.drawRectangle({ x:m, y:h-m-15*MM, width:w-2*m, height:15*MM, color:rgb(0,0,0) });
    page.drawText("CONTROLE INTERNO DE VOLUME", { x:m+12*MM, y:h-m-10*MM, size:10.5, font:bold, color:rgb(1,1,1) });
    page.drawText(safe(model.operationName || "AGF Operacoes Postais"), { x:m+7*MM, y:h-m-27*MM, size:9, font:bold });
    page.drawText(`VOLUME ${model.volumeNumber}/${model.totalVolumes}`, { x:m+19*MM, y:h-m-52*MM, size:24, font:bold });
    page.drawRectangle({ x:m+7*MM, y:h-m-76*MM, width:w-2*m-14*MM, height:15*MM, color:rgb(.93,.93,.93) });
    page.drawText(safe(model.service), { x:m+34*MM, y:h-m-71*MM, size:18, font:bold });
    page.drawText("ETIQUETAS NESTE VOLUME", { x:m+6*MM, y:h-m-93*MM, size:8, font:regular });
    page.drawText(safe(model.quantity), { x:w-m-22*MM, y:h-m-95*MM, size:19, font:bold });
    page.drawLine({ start:{x:m+6*MM,y:h-m-107*MM}, end:{x:w-m-6*MM,y:h-m-107*MM}, thickness:.5 });
    page.drawText("PRIMEIRO SRO", { x:m+6*MM, y:h-m-116*MM, size:7, font:bold });
    page.drawText(safe(model.firstTrackingCode), { x:w-m-37*MM, y:h-m-116*MM, size:10, font:regular });
    page.drawText("ULTIMO SRO", { x:m+6*MM, y:h-m-129*MM, size:7, font:bold });
    page.drawText(safe(model.lastTrackingCode), { x:w-m-37*MM, y:h-m-129*MM, size:10, font:regular });
    if (model.productionBatchId) {
      const barcode = await bwipjs.toBuffer({ bcid:'code128', text:safe(model.productionBatchId).slice(0,40), scale:1.5, height:5, includetext:false, padding:0 });
      const img = await pdf.embedPng(barcode);
      page.drawImage(img, { x:m+42*MM, y:m+18*MM, width:38*MM, height:7*MM });
    }
    page.drawRectangle({ x:m, y:m, width:w-2*m, height:10*MM, color:rgb(.96,.96,.96) });
    page.drawText("USO INTERNO - NAO SUBSTITUI O PROTOCOLO DE POSTAGEM", { x:m+4*MM, y:m+5.9*MM, size:6.5, font:bold });
    page.drawText("Maximo 250 objetos por volume. PAC e SEDEX nunca sao misturados.", { x:m+4*MM, y:m+2.5*MM, size:5.8, font:regular });
  }
  pdf.setTitle("Etiquetas de volumes - controle interno");
  return pdf.save();
}

export async function createInternalHandoffPdf({ operationName, cnpj, productionBatchId, total, volumes, receiver = "", occurredAt = "" }) {
  if (!Array.isArray(volumes) || !volumes.length) throw new Error("Nenhum volume informado");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A4);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [w,h] = A4;
  const left = 18*MM, right = w-18*MM;
  let y = h-18*MM;
  page.drawText("CONTROLE INTERNO DE ENTREGA DE VOLUMES", { x:left, y, size:15, font:bold });
  page.drawText("Documento interno - nao e protocolo postal", { x:left, y:y-5*MM, size:7.5, font:regular });
  y -= 13*MM;
  page.drawLine({ start:{x:left,y}, end:{x:right,y}, thickness:.8 });
  y -= 8*MM;
  page.drawText("OPERACAO", { x:left, y, size:8, font:bold });
  page.drawText(safe(operationName), { x:left+28*MM, y, size:9, font:regular });
  page.drawText("LOTE", { x:left+120*MM, y, size:8, font:bold });
  page.drawText(safe(productionBatchId), { x:left+138*MM, y, size:9, font:regular });
  y -= 7*MM;
  page.drawText("CNPJ", { x:left, y, size:8, font:bold });
  page.drawText(moneylessCnpj(cnpj), { x:left+28*MM, y, size:9, font:regular });
  page.drawText("TOTAL", { x:left+120*MM, y, size:8, font:bold });
  page.drawText(`${Number(total || 0)} etiquetas / ${volumes.length} volumes`, { x:left+138*MM, y, size:8, font:regular });
  y -= 14*MM;
  const cols = [left, left+22*MM, left+52*MM, left+82*MM, left+114*MM, right];
  const headers = ["VOLUME","SERVICO","ETIQUETAS","PRIMEIRO SRO","ULTIMO SRO"];
  const rowH = 9*MM;
  page.drawRectangle({ x:left, y:y-rowH, width:right-left, height:rowH, color:rgb(0,0,0) });
  headers.forEach((head,index)=>page.drawText(head,{x:cols[index]+2*MM,y:y-5.7*MM,size:7.2,font:bold,color:rgb(1,1,1)}));
  y -= rowH;
  volumes.forEach((v,index)=>{
    if (index % 2 === 0) page.drawRectangle({x:left,y:y-rowH,width:right-left,height:rowH,color:rgb(.95,.95,.95)});
    const vals = [`${v.number}/${v.totalVolumes}`, safe(v.service), safe(v.quantity), safe(v.firstTrackingCode || v.trackingCodes?.[0]), safe(v.lastTrackingCode || v.trackingCodes?.at?.(-1))];
    vals.forEach((val,i)=>page.drawText(val,{x:cols[i]+2*MM,y:y-5.7*MM,size:7.8,font:regular}));
    y -= rowH;
  });
  y -= 13*MM;
  page.drawText("CONFIRMACAO DE ENTREGA FISICA", { x:left, y, size:9, font:bold });
  y -= 8*MM;
  page.drawText(`Recebido por: ${receiver || "____________________________________________"}`, { x:left, y, size:8, font:regular });
  page.drawText(`Data/hora: ${occurredAt || "________________________"}`, { x:left+112*MM, y, size:8, font:regular });
  y -= 16*MM;
  page.drawText("REGRA OPERACIONAL", { x:left, y, size:7.5, font:bold });
  const notes = [
    "- A geracao do PDF nao confirma impressao.",
    "- A entrega so e registrada depois da impressao integral e da aprovacao fisica da etiqueta de teste.",
    "- Este controle interno nao substitui o PROTOCOLO DE POSTAGEM A VISTA organizado pelas listas postais reais."
  ];
  notes.forEach((note,index)=>page.drawText(note,{x:left+3*MM,y:y-(5+index*5)*MM,size:7.2,font:regular}));
  pdf.setTitle("Controle interno de entrega de volumes");
  return pdf.save();
}
