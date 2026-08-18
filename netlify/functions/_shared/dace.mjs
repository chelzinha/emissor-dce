import bwipjs from "bwip-js";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { LEGAL_NOTICE_1, LEGAL_NOTICE_2 } from "./constants.mjs";

const A4 = [595.28, 841.89];
const INK = rgb(0.05, 0.12, 0.2);
const MUTED = rgb(0.34, 0.4, 0.48);
const LINE = rgb(0.78, 0.82, 0.87);
const SOFT = rgb(0.95, 0.97, 0.99);

function splitText(text, font, size, width) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function text(page, value, x, y, options = {}) {
  const { font, size = 8, color = INK, maxWidth, lineHeight = size * 1.25 } = options;
  const lines = maxWidth ? splitText(value, font, size, maxWidth) : [String(value || "")];
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, size, font, color }));
  return y - lines.length * lineHeight;
}

function box(page, x, y, width, height, fill = null) {
  page.drawRectangle({ x, y: y - height, width, height, borderColor: LINE, borderWidth: 0.7, color: fill || undefined });
}

function address(value) {
  const a = value || {};
  return [a.street, a.number, a.complement, a.district, `${a.city || ""}/${a.uf || ""}`, a.zip]
    .filter(Boolean).join(", ");
}

function keyMask(key) {
  return String(key || "").match(/.{1,4}/g)?.join(" ") || "";
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function emissionDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}:${match[6]}` : String(value || "");
}

async function renderPage(pdf, fonts, entry, items, pageNumber, pageCount, continuation) {
  const { regular, bold } = fonts;
  const { document, result } = entry;
  const total = result.total ?? (document.items || []).reduce((sum, item) => sum + Number(item.totalValue || (Number(item.quantity) * Number(item.unitValue))), 0);
  const qrCode = result.qrCode || `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${result.accessKey}&tpAmb=${document.identification.environment}`;
  const page = pdf.addPage(A4);
  const width = page.getWidth();
  const left = 28;
  const contentWidth = width - 56;
  let y = page.getHeight() - 28;

  if (String(document.identification.environment) === "2") {
    page.drawText("EMITIDA EM HOMOLOGAÇÃO", {
      x: 86, y: 390, size: 34, font: bold, color: rgb(0.92, 0.92, 0.92), rotate: degrees(35),
    });
  }

  text(page, continuation ? "DACE - FOLHA ADICIONAL" : "DACE", left, y, { font: bold, size: 18 });
  text(page, "DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRÔNICA", left, y - 22, { font: bold, size: 8.5, color: MUTED });
  text(page, `Nº ${String(document.identification.number).padStart(9, "0")}  SÉRIE ${String(document.identification.series).padStart(3, "0")}  FOLHA ${String(pageNumber).padStart(2, "0")}/${String(pageCount).padStart(2, "0")}`, left, y - 38, { font: regular, size: 8 });

  const barcode = await bwipjs.toBuffer({ bcid: "code128", text: result.accessKey, scale: 2, height: 9, includetext: false, padding: 0 });
  const barcodeImage = await pdf.embedPng(barcode);
  page.drawImage(barcodeImage, { x: 310, y: y - 42, width: 245, height: 34 });
  text(page, keyMask(result.accessKey), 314, y - 49, { font: regular, size: 7.2 });
  y -= 66;

  box(page, left, y, contentWidth, 38, SOFT);
  text(page, "DATA DE EMISSÃO", left + 8, y - 10, { font: bold, size: 6.5, color: MUTED });
  text(page, emissionDate(document.identification.emissionDateTime), left + 8, y - 24, { font: regular, size: 8 });
  text(page, "PROTOCOLO DE AUTORIZAÇÃO", left + 192, y - 10, { font: bold, size: 6.5, color: MUTED });
  text(page, result.protocolNumber || "", left + 192, y - 24, { font: regular, size: 8 });
  text(page, "MODALIDADE", left + 390, y - 10, { font: bold, size: 6.5, color: MUTED });
  text(page, "0 - CORREIOS", left + 390, y - 24, { font: regular, size: 8 });
  y -= 46;

  const party = (title, person, documentLabel) => {
    box(page, left, y, contentWidth, 64);
    text(page, title, left + 8, y - 10, { font: bold, size: 7, color: MUTED });
    text(page, `${documentLabel}: ${person.cnpj || person.document || ""}`, left + 8, y - 27, { font: bold, size: 8 });
    text(page, person.name, left + 210, y - 27, { font: bold, size: 8, maxWidth: 305 });
    text(page, address(person.address), left + 8, y - 43, { font: regular, size: 7.2, maxWidth: contentWidth - 16 });
    y -= 72;
  };
  party("IDENTIFICAÇÃO DO REMETENTE (USUÁRIO EMITENTE)", document.issuer, "CNPJ");
  party("IDENTIFICAÇÃO DO DESTINATÁRIO", document.recipient, document.recipient.documentType || "CPF/CNPJ");
  box(page, left, y, contentWidth, 42, SOFT);
  text(page, "IDENTIFICAÇÃO DA EMPRESA COM EMISSÃO PRÓPRIA", left + 8, y - 10, { font: bold, size: 7, color: MUTED });
  text(page, `CNPJ: ${document.issuer.cnpj}`, left + 8, y - 27, { font: bold, size: 8 });
  text(page, document.issuer.name, left + 210, y - 27, { font: bold, size: 8, maxWidth: 305 });
  y -= 50;

  text(page, "IDENTIFICAÇÃO DOS BENS OU MERCADORIAS", left, y, { font: bold, size: 8 });
  y -= 9;
  box(page, left, y, contentWidth, 18, SOFT);
  text(page, "ITEM", left + 7, y - 12, { font: bold, size: 6.5 });
  text(page, "DESCRIÇÃO", left + 48, y - 12, { font: bold, size: 6.5 });
  text(page, "NCM", left + 335, y - 12, { font: bold, size: 6.5 });
  text(page, "QUANTIDADE", left + 382, y - 12, { font: bold, size: 6.5 });
  text(page, "VALOR", left + 468, y - 12, { font: bold, size: 6.5 });
  y -= 18;
  items.forEach(({ item, index }) => {
    box(page, left, y, contentWidth, 18);
    text(page, String(index + 1), left + 7, y - 12, { font: regular, size: 7 });
    text(page, item.description, left + 48, y - 12, { font: regular, size: 7, maxWidth: 278 });
    text(page, item.ncm || "", left + 335, y - 12, { font: regular, size: 7 });
    text(page, String(item.quantity), left + 400, y - 12, { font: regular, size: 7 });
    text(page, money(item.totalValue), left + 457, y - 12, { font: regular, size: 7 });
    y -= 18;
  });

  if (pageNumber === pageCount) {
    box(page, left, y, contentWidth, 20, SOFT);
    text(page, "VALOR TOTAL", left + 335, y - 13, { font: bold, size: 7 });
    text(page, money(total), left + 457, y - 13, { font: bold, size: 7 });
    y -= 28;

    text(page, "DADOS ADICIONAIS", left, y, { font: bold, size: 8 });
    y -= 9;
    const qr = await QRCode.toBuffer(qrCode, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 180 });
    const qrImage = await pdf.embedPng(qr);
    page.drawImage(qrImage, { x: left, y: y - 104, width: 96, height: 96 });
    text(page, document.additionalInfo || `${document.service || ""} ${document.trackingCode || ""}`.trim(), left + 108, y - 7, { font: regular, size: 7, maxWidth: contentWidth - 116 });
    let noticeY = y - 34;
    noticeY = text(page, LEGAL_NOTICE_1, left + 108, noticeY, { font: regular, size: 5.8, maxWidth: contentWidth - 116, lineHeight: 7.1 });
    text(page, LEGAL_NOTICE_2, left + 108, noticeY - 5, { font: regular, size: 5.8, maxWidth: contentWidth - 116, lineHeight: 7.1 });
  }
  text(page, `Chave: ${keyMask(result.accessKey)}`, left, 18, { font: regular, size: 6, color: MUTED });
}

export async function createDacePdf(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 20) {
    throw new Error("Informe de 1 a 20 documentos por PDF");
  }
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  for (const entry of entries) {
    if (!/^\d{44}$/.test(String(entry.result?.accessKey || ""))) throw new Error("DC-e sem chave de acesso válida");
    if (entry.result?.status !== "AUTHORIZED") throw new Error("A DACE só pode ser gerada para DC-e autorizada");
    const indexed = (entry.document.items || []).map((item, index) => ({ item, index }));
    const chunks = [];
    for (let index = 0; index < indexed.length; index += 10) chunks.push(indexed.slice(index, index + 10));
    if (!chunks.length) chunks.push([]);
    for (let index = 0; index < chunks.length; index += 1) {
      await renderPage(pdf, fonts, entry, chunks[index], index + 1, chunks.length, index > 0);
    }
  }
  pdf.setTitle("DACE - Declaração Auxiliar de Conteúdo Eletrônica");
  pdf.setProducer("Emissor DC-e");
  return pdf.save();
}
