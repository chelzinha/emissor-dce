import { buildUnifiedLabelLayout, DEFAULT_SIMPLIFIED_STATEMENT } from "./unified-label-layout.js";
import { DOCUMENT_MODES } from "./label-production.js";
import { ROUTING_SYMBOLS } from "./routing-symbols.js";

const MM_TO_PT = 72 / 25.4;
const mm = (value) => Number(value || 0) * MM_TO_PT;

function dataUrlBytes(dataUrl) {
  const [, payload = ""] = String(dataUrl || "").split(",", 2);
  const binary = globalThis.atob ? atob(payload) : Buffer.from(payload, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function joinNonEmpty(values, separator = " ") {
  return values.map(cleanText).filter(Boolean).join(separator);
}

function cropText(text, max = 120) {
  const value = cleanText(text);
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

async function barcodeDataUrl(text, options = {}) {
  if (!globalThis.document) throw new Error("Geracao de codigo de barras requer navegador.");
  const module = await import("bwip-js");
  const bwipjs = module.default || module;
  const canvas = document.createElement("canvas");
  bwipjs.toCanvas(canvas, {
    bcid: options.bcid || "code128",
    text: String(text || ""),
    scale: options.scale || 3,
    height: options.heightMm || 9,
    includetext: false,
    padding: 0,
    backgroundcolor: "FFFFFF",
  });
  return canvas.toDataURL("image/png");
}

function pdfRect(pageHeightMm, box) {
  return {
    x: mm(box.xMm),
    y: mm(pageHeightMm - box.yMm - box.heightMm),
    width: mm(box.widthMm),
    height: mm(box.heightMm),
  };
}

function topTextY(pageHeightMm, yMm, fontSizePt) {
  return mm(pageHeightMm - yMm) - fontSizePt;
}

function fitSize(font, text, widthMm, preferredPt, minPt = 4.2) {
  const value = cleanText(text);
  if (!value) return preferredPt;
  let size = preferredPt;
  while (size > minPt && font.widthOfTextAtSize(value, size) > mm(widthMm)) size -= 0.25;
  return size;
}

function drawLine(page, font, text, xMm, yMm, widthMm, pageHeightMm, preferredPt = 7, options = {}) {
  const value = cropText(text, options.maxChars || 160);
  if (!value) return;
  const size = fitSize(font, value, widthMm, preferredPt, options.minPt || 4.2);
  page.drawText(value, {
    x: mm(xMm),
    y: topTextY(pageHeightMm, yMm, size),
    size,
    font,
    rotate: options.rotate,
  });
}

function drawCentered(page, font, text, box, pageHeightMm, size = 7) {
  const value = cleanText(text);
  if (!value) return;
  const fitted = fitSize(font, value, box.widthMm - 2, size, 4.2);
  const width = font.widthOfTextAtSize(value, fitted);
  const rect = pdfRect(pageHeightMm, box);
  page.drawText(value, {
    x: rect.x + Math.max(0, (rect.width - width) / 2),
    y: rect.y + rect.height / 2 - fitted / 2 + 1,
    size: fitted,
    font,
  });
}

function drawBorder(page, box, pageHeightMm, lineWidth = 0.65) {
  page.drawRectangle({ ...pdfRect(pageHeightMm, box), borderWidth: lineWidth });
}

function drawHorizontal(page, x1Mm, x2Mm, yMm, pageHeightMm, lineWidth = 0.55, dashArray) {
  page.drawLine({
    start: { x: mm(x1Mm), y: mm(pageHeightMm - yMm) },
    end: { x: mm(x2Mm), y: mm(pageHeightMm - yMm) },
    thickness: lineWidth,
    dashArray,
  });
}

function drawWrapped(page, font, text, box, pageHeightMm, fontSizePt = 5.2, maxLines = 5) {
  const words = cleanText(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSizePt) <= mm(box.widthMm - 2.5)) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((item, index) => drawLine(page, font, item, box.xMm + 1.2, box.yMm + 2.2 + index * 2.45, box.widthMm - 2.4, pageHeightMm, fontSizePt));
}

async function qrDataUrl(text) {
  const value = String(text || "").trim();
  if (!/^https:\/\//i.test(value)) throw new Error("QR Code da DC-e ausente ou invalido.");
  const module = await import("qrcode");
  const QRCode = module.default || module;
  return QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: 256 });
}

function moneyBr(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dateTimeBr(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : text;
}

function keyMask(value) {
  return String(value || "").replace(/\D/g, "").match(/.{1,4}/g)?.join(" ") || "";
}

async function embedPng(pdfDoc, dataUrl) {
  if (!String(dataUrl || "").startsWith("data:image/png")) throw new Error("Imagem PNG invalida.");
  return pdfDoc.embedPng(dataUrlBytes(dataUrl));
}

async function drawBarcode(page, pdfDoc, text, box, pageHeightMm, options = {}) {
  const dataUrl = await barcodeDataUrl(text, options);
  const image = await embedPng(pdfDoc, dataUrl);
  page.drawImage(image, pdfRect(pageHeightMm, box));
}

function drawPostageHeader(page, fonts, model, layout, pageHeightMm, postalHeader = {}) {
  const box = layout.postal.postageMark;
  drawBorder(page, box, pageHeightMm);
  drawCentered(page, fonts.bold, postalHeader.title || "CHANCELA", { ...box, heightMm: 7.5 }, pageHeightMm, 8.5);
  const lines = postalHeader.lines || [];
  lines.slice(0, 3).forEach((line, index) => drawCentered(page, fonts.regular, line, {
    xMm: box.xMm + 1, yMm: box.yMm + 7.5 + index * 3.4, widthMm: box.widthMm - 2, heightMm: 3.4,
  }, pageHeightMm, 5.8));

  const header = layout.postal.headerText;
  drawLine(page, fonts.bold, postalHeader.pp ? `PP: ${postalHeader.pp}` : "", header.xMm, header.yMm + 4.2, header.widthMm, pageHeightMm, 7.2);
  drawLine(page, fonts.bold, postalHeader.payment || "", header.xMm, header.yMm + 9.0, header.widthMm, pageHeightMm, 7.2);
  drawLine(page, fonts.bold, model.service?.family || "", header.xMm, header.yMm + 14.2, header.widthMm, pageHeightMm, 7.5);
}

function drawRoutingSymbolFallback(page, fonts, model, layout, pageHeightMm) {
  const box = layout.postal.routingSymbol;
  drawBorder(page, box, pageHeightMm);
  drawCentered(page, fonts.bold, model.service?.family || "SERVICO", { ...box, heightMm: box.heightMm / 2 }, pageHeightMm, 6.2);
  drawCentered(page, fonts.bold, model.service?.routingClass || "", {
    xMm: box.xMm, yMm: box.yMm + box.heightMm / 2, widthMm: box.widthMm, heightMm: box.heightMm / 2,
  }, pageHeightMm, 4.5);
}

async function drawPostalZone(page, pdfDoc, fonts, model, layout, options) {
  const pageHeightMm = layout.page.heightMm;
  drawPostageHeader(page, fonts, model, layout, pageHeightMm, options.postalHeader || {});

  const matrix = await embedPng(pdfDoc, model.dataMatrixImage);
  page.drawImage(matrix, pdfRect(pageHeightMm, layout.postal.dataMatrix));

  if (options.routingSymbolDataUrl) {
    const symbol = await embedPng(pdfDoc, options.routingSymbolDataUrl);
    page.drawImage(symbol, pdfRect(pageHeightMm, layout.postal.routingSymbol));
  } else drawRoutingSymbolFallback(page, fonts, model, layout, pageHeightMm);

  const tracking = layout.zoneMap.zones.tracking;
  drawCentered(page, fonts.bold, model.trackingCodeFormatted, {
    xMm: tracking.xMm, yMm: tracking.yMm + 0.5, widthMm: tracking.widthMm, heightMm: 6.2,
  }, pageHeightMm, 11.5);
  await drawBarcode(page, pdfDoc, model.trackingCode, layout.postal.trackingBarcode, pageHeightMm, { heightMm: 9.5 });

  const receiver = layout.zoneMap.zones.receiver;
  drawLine(page, fonts.regular, "Recebedor:", receiver.xMm, receiver.yMm + 3.6, 20, pageHeightMm, 5.8);
  drawHorizontal(page, receiver.xMm + 20, receiver.xMm + receiver.widthMm, receiver.yMm + 4.0, pageHeightMm, 0.5);
  drawLine(page, fonts.regular, "Assinatura:", receiver.xMm, receiver.yMm + 7.4, 20, pageHeightMm, 5.8);
  drawLine(page, fonts.regular, "Documento:", receiver.xMm + 51, receiver.yMm + 7.4, 18, pageHeightMm, 5.8);

  const recipient = layout.zoneMap.zones.recipient;
  drawBorder(page, recipient, pageHeightMm);
  drawLine(page, fonts.bold, "DESTINATARIO", recipient.xMm + 1.5, recipient.yMm + 3.3, recipient.widthMm - 3, pageHeightMm, 6.4);
  drawLine(page, fonts.regular, `CPF/CNPJ: ${model.recipient.document || "-"}`, recipient.xMm + 34, recipient.yMm + 3.3, 28, pageHeightMm, 4.2);
  drawLine(page, fonts.bold, model.recipient.name, recipient.xMm + 2, recipient.yMm + 9.6, layout.postal.recipientText.widthMm - 2, pageHeightMm, 9.5);
  drawLine(page, fonts.regular, joinNonEmpty([model.recipient.street, model.recipient.number], ", "), recipient.xMm + 2, recipient.yMm + 14.1, layout.postal.recipientText.widthMm - 2, pageHeightMm, 7.5);
  drawLine(page, fonts.regular, joinNonEmpty([model.recipient.district, model.recipient.complement], " - "), recipient.xMm + 2, recipient.yMm + 18.0, layout.postal.recipientText.widthMm - 2, pageHeightMm, 7.0);
  drawLine(page, fonts.bold, model.recipient.zip, recipient.xMm + 2, recipient.yMm + 22.0, 28, pageHeightMm, 9.2);
  drawLine(page, fonts.regular, joinNonEmpty([model.recipient.city, model.recipient.uf], " / "), recipient.xMm + 35, recipient.yMm + 22.0, 30, pageHeightMm, 7.8);
  if (String(model.recipient.zip || "").replace(/\D/g, "").length === 8) {
    await drawBarcode(page, pdfDoc, String(model.recipient.zip).replace(/\D/g, ""), layout.postal.zipBarcode, pageHeightMm, { heightMm: 10 });
  }

  const sender = layout.zoneMap.zones.sender;
  drawBorder(page, sender, pageHeightMm);
  drawLine(page, fonts.bold, "Remetente:", sender.xMm + 1.5, sender.yMm + 3.0, sender.widthMm - 12, pageHeightMm, 5.8);
  drawLine(page, fonts.bold, model.sender.name, sender.xMm + 1.5, sender.yMm + 6.2, sender.widthMm - 12, pageHeightMm, 6.8);
  drawLine(page, fonts.regular, model.sender.addressLine, sender.xMm + 1.5, sender.yMm + 9.0, sender.widthMm - 12, pageHeightMm, 5.5);
  drawLine(page, fonts.bold, model.sender.cityLine, sender.xMm + 1.5, sender.yMm + 11.4, sender.widthMm - 32, pageHeightMm, 5.3);
  drawLine(page, fonts.regular, model.sender.document ? `CNPJ/CPF: ${model.sender.document}` : "", sender.xMm + 38, sender.yMm + 11.4, sender.widthMm - 48, pageHeightMm, 5.0);
  const stripe = layout.postal.senderStripe;
  const stripeRect = pdfRect(pageHeightMm, stripe);
  page.drawRectangle({ ...stripeRect, color: options.rgb(0, 0, 0) });
  const stripeText = cleanText(model.service?.stripe || "");
  if (stripeText) {
    const size = 8;
    page.drawText(stripeText, {
      x: stripeRect.x + stripeRect.width / 2 + size / 2 - 1,
      y: stripeRect.y + 1.5,
      size,
      font: fonts.bold,
      color: options.rgb(1, 1, 1),
      rotate: options.degrees(90),
    });
  }

  const separator = layout.zoneMap.zones.separator;
  drawHorizontal(page, separator.xMm, separator.xMm + separator.widthMm, separator.yMm + separator.heightMm / 2, pageHeightMm, 0.6, [3, 3]);
}

function drawSimplifiedDeclaration(page, fonts, model, layout, options) {
  const pageHeightMm = layout.page.heightMm;
  const title = layout.declaration.titleBox;
  drawBorder(page, title, pageHeightMm);
  drawCentered(page, fonts.bold, "DECLARACAO SIMPLIFICADA DE CONTEUDO", title, pageHeightMm, 7.0);

  const meta = layout.declaration.metaBox;
  drawBorder(page, meta, pageHeightMm);
  drawLine(page, fonts.bold, "Documento operacional vinculado a esta postagem.", meta.xMm + 1.5, meta.yMm + 3.3, meta.widthMm - 3, pageHeightMm, 5.4);
  drawLine(page, fonts.regular, DEFAULT_SIMPLIFIED_STATEMENT, meta.xMm + 1.5, meta.yMm + 6.1, meta.widthMm - 3, pageHeightMm, 4.7);
  drawLine(page, fonts.regular, "O Data Matrix acima e a imagem original recuperada do PDF do Portal Postal.", meta.xMm + 1.5, meta.yMm + 8.6, meta.widthMm - 3, pageHeightMm, 4.4);

  const parties = layout.declaration.partiesBox;
  drawBorder(page, parties, pageHeightMm);
  const middle = parties.xMm + parties.widthMm / 2;
  drawHorizontal(page, middle, middle, parties.yMm, pageHeightMm, 0); // no-op guard for compatibility
  page.drawLine({
    start: { x: mm(middle), y: mm(pageHeightMm - parties.yMm) },
    end: { x: mm(middle), y: mm(pageHeightMm - parties.yMm - parties.heightMm) },
    thickness: 0.55,
  });
  drawCentered(page, fonts.bold, "REMETENTE", { xMm: parties.xMm, yMm: parties.yMm, widthMm: parties.widthMm / 2, heightMm: 4.2 }, pageHeightMm, 6.0);
  drawCentered(page, fonts.bold, "DESTINATARIO", { xMm: middle, yMm: parties.yMm, widthMm: parties.widthMm / 2, heightMm: 4.2 }, pageHeightMm, 6.0);
  drawHorizontal(page, parties.xMm, parties.xMm + parties.widthMm, parties.yMm + 4.2, pageHeightMm, 0.55);
  drawLine(page, fonts.regular, `CNPJ/CPF: ${model.sender.document || "-"}`, parties.xMm + 1.4, parties.yMm + 6.7, parties.widthMm / 2 - 2, pageHeightMm, 4.2);
  drawLine(page, fonts.bold, model.sender.name, parties.xMm + 1.4, parties.yMm + 9.1, parties.widthMm / 2 - 2, pageHeightMm, 4.7);
  drawLine(page, fonts.regular, model.sender.cityLine, parties.xMm + 1.4, parties.yMm + 11.5, parties.widthMm / 2 - 2, pageHeightMm, 4.2);
  drawLine(page, fonts.regular, `CNPJ/CPF: ${model.recipient.document || "-"}`, middle + 1.4, parties.yMm + 6.7, parties.widthMm / 2 - 2, pageHeightMm, 4.2);
  drawLine(page, fonts.bold, model.recipient.name, middle + 1.4, parties.yMm + 9.1, parties.widthMm / 2 - 2, pageHeightMm, 4.7);
  drawLine(page, fonts.regular, joinNonEmpty([model.recipient.city, model.recipient.uf], " / "), middle + 1.4, parties.yMm + 11.5, parties.widthMm / 2 - 2, pageHeightMm, 4.2);

  const items = layout.declaration.itemsBox;
  drawBorder(page, items, pageHeightMm);
  drawLine(page, fonts.regular, "DESCRICAO DO CONTEUDO", items.xMm + 1.4, items.yMm + 2.0, items.widthMm - 3, pageHeightMm, 3.9);
  drawLine(page, fonts.bold, model.content || "CONTEUDO NAO INFORMADO", items.xMm + 1.4, items.yMm + 5.4, items.widthMm - 24, pageHeightMm, 7.1);
  drawLine(page, fonts.regular, "QTD", items.xMm + items.widthMm - 28, items.yMm + 2.0, 10, pageHeightMm, 3.9);
  drawLine(page, fonts.bold, "1", items.xMm + items.widthMm - 22, items.yMm + 5.4, 7, pageHeightMm, 6.3);
  drawLine(page, fonts.regular, "VALOR", items.xMm + items.widthMm - 13, items.yMm + 2.0, 11, pageHeightMm, 3.9);
  drawLine(page, fonts.bold, "R$ 0,00", items.xMm + items.widthMm - 13, items.yMm + 5.4, 12, pageHeightMm, 6.3);

  const legal = layout.declaration.legalBox;
  drawBorder(page, legal, pageHeightMm);
  drawLine(page, fonts.bold, "PROTOCOLO LOCAL PARA VALIDACAO VISUAL", legal.xMm + 1.4, legal.yMm + 3.2, legal.widthMm - 3, pageHeightMm, 5.2);
  drawWrapped(page, fonts.regular,
    "Esta etiqueta somente pode seguir para geracao em lote depois que o Data Matrix tiver sido verificado pelo proprio SRO e a etiqueta de teste tiver sido impressa e validada no leitor da agencia.",
    { xMm: legal.xMm + 0.2, yMm: legal.yMm + 3.8, widthMm: legal.widthMm - 0.4, heightMm: legal.heightMm - 4 }, pageHeightMm, 4.4, 5);
}

async function drawDceDeclaration(page, pdfDoc, fonts, model, layout) {
  const pageHeightMm = layout.page.heightMm;
  if (!model.declaration?.authorized) throw new Error(`DC-e nao autorizada: ${model.trackingCode}`);
  if (!model.declaration?.qrEligible) throw new Error(`QR Code da DC-e nao validado: ${model.trackingCode}`);

  const title = layout.declaration.titleBox;
  drawBorder(page, title, pageHeightMm);
  drawCentered(page, fonts.bold, "DACE - DECLARACAO AUXILIAR DE CONTEUDO ELETRONICA", title, pageHeightMm, 6.2);

  const meta = layout.declaration.metaBox;
  drawBorder(page, meta, pageHeightMm);
  const envLabel = model.declaration.environment === "2" ? " · HOMOLOGACAO" : "";
  drawLine(page, fonts.bold, `DC-e ${String(model.declaration.number || 0).padStart(9, "0")} · SERIE ${String(model.declaration.series || 0).padStart(3, "0")}${envLabel}`, meta.xMm + 1.4, meta.yMm + 2.5, meta.widthMm - 2.8, pageHeightMm, 4.7);
  drawLine(page, fonts.regular, `CHAVE ${keyMask(model.declaration.accessKey)}`, meta.xMm + 1.4, meta.yMm + 5.2, meta.widthMm - 2.8, pageHeightMm, 4.0, { minPt: 3.4 });
  drawLine(page, fonts.regular, `PROTOCOLO ${model.declaration.protocol} · EMI ${dateTimeBr(model.declaration.emissionDateTime)}`, meta.xMm + 1.4, meta.yMm + 7.9, meta.widthMm - 2.8, pageHeightMm, 4.0, { minPt: 3.5 });

  const parties = layout.declaration.partiesBox;
  drawBorder(page, parties, pageHeightMm);
  const middle = parties.xMm + parties.widthMm / 2;
  page.drawLine({
    start: { x: mm(middle), y: mm(pageHeightMm - parties.yMm) },
    end: { x: mm(middle), y: mm(pageHeightMm - parties.yMm - parties.heightMm) },
    thickness: 0.55,
  });
  drawCentered(page, fonts.bold, "EMITENTE", { xMm: parties.xMm, yMm: parties.yMm, widthMm: parties.widthMm / 2, heightMm: 3.7 }, pageHeightMm, 5.4);
  drawCentered(page, fonts.bold, "DESTINATARIO", { xMm: middle, yMm: parties.yMm, widthMm: parties.widthMm / 2, heightMm: 3.7 }, pageHeightMm, 5.4);
  drawHorizontal(page, parties.xMm, parties.xMm + parties.widthMm, parties.yMm + 3.7, pageHeightMm, 0.5);
  drawLine(page, fonts.bold, model.sender.name, parties.xMm + 1.2, parties.yMm + 6.2, parties.widthMm / 2 - 2.4, pageHeightMm, 4.6);
  drawLine(page, fonts.regular, `CNPJ ${model.sender.document || "-"}`, parties.xMm + 1.2, parties.yMm + 8.6, parties.widthMm / 2 - 2.4, pageHeightMm, 3.8);
  drawLine(page, fonts.regular, model.sender.cityLine, parties.xMm + 1.2, parties.yMm + 11.0, parties.widthMm / 2 - 2.4, pageHeightMm, 3.8);
  drawLine(page, fonts.bold, model.recipient.name, middle + 1.2, parties.yMm + 6.2, parties.widthMm / 2 - 2.4, pageHeightMm, 4.6);
  drawLine(page, fonts.regular, `CPF/CNPJ ${model.recipient.document || "-"}`, middle + 1.2, parties.yMm + 8.6, parties.widthMm / 2 - 2.4, pageHeightMm, 3.8);
  drawLine(page, fonts.regular, joinNonEmpty([model.recipient.city, model.recipient.uf], " / "), middle + 1.2, parties.yMm + 11.0, parties.widthMm / 2 - 2.4, pageHeightMm, 3.8);

  const items = layout.declaration.itemsBox;
  drawBorder(page, items, pageHeightMm);
  const firstItem = model.items?.[0] || { description: model.content, quantity: 0, unitValue: 0, totalValue: 0, ncm: "" };
  const extra = Math.max(0, Number(model.items?.length || 0) - 1);
  drawLine(page, fonts.regular, "CONTEUDO DC-e", items.xMm + 1.2, items.yMm + 1.8, 19, pageHeightMm, 3.6);
  drawLine(page, fonts.bold, `${firstItem.description || model.content || "CONTEUDO"}${extra ? ` (+${extra} item(ns))` : ""}`, items.xMm + 1.2, items.yMm + 4.9, items.widthMm - 35, pageHeightMm, 5.6);
  drawLine(page, fonts.regular, `QTD ${firstItem.quantity || "-"}`, items.xMm + items.widthMm - 31, items.yMm + 4.9, 12, pageHeightMm, 4.1);
  drawLine(page, fonts.regular, `NCM ${firstItem.ncm || "-"}`, items.xMm + items.widthMm - 18, items.yMm + 4.9, 16, pageHeightMm, 4.1);

  const legal = layout.declaration.legalBox;
  drawBorder(page, legal, pageHeightMm);
  const qrUrl = await qrDataUrl(model.declaration.qrCode);
  const qrImage = await embedPng(pdfDoc, qrUrl);
  const qrBox = { xMm: legal.xMm + 1.2, yMm: legal.yMm + 1.2, widthMm: 17, heightMm: 17 };
  page.drawImage(qrImage, pdfRect(pageHeightMm, qrBox));
  const total = Number((model.items || []).reduce((sum, item) => sum + Number(item.totalValue || 0), 0).toFixed(2));
  const textX = legal.xMm + 20;
  const textW = legal.widthMm - 21.5;
  drawLine(page, fonts.bold, `VALOR TOTAL ${moneyBr(total)}`, textX, legal.yMm + 3.2, textW, pageHeightMm, 5.0);
  drawLine(page, fonts.regular, `AUTORIZADA ${dateTimeBr(model.declaration.authorizedAt) || "-"}`, textX, legal.yMm + 6.0, textW, pageHeightMm, 4.0);
  drawLine(page, fonts.regular, `OBJETO ${model.trackingCodeFormatted}`, textX, legal.yMm + 8.7, textW, pageHeightMm, 4.0);
  drawWrapped(page, fonts.regular, "QR Code vinculado a DC-e autorizada. DACE integrada a etiqueta postal 10x15 para validacao operacional e fiscal antes da producao em lote.", { xMm: textX - 0.2, yMm: legal.yMm + 9.4, widthMm: textW + 0.2, heightMm: 7.8 }, pageHeightMm, 3.7, 3);
}

export async function generateUnifiedLabelPdf(models, options = {}) {
  if (!models?.length) throw new Error("Nenhuma etiqueta para gerar.");
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };

  for (const model of models) {
    const layout = buildUnifiedLabelLayout(model, { simplifiedStatement: options.simplifiedStatement });
    const page = pdfDoc.addPage([mm(layout.page.widthMm), mm(layout.page.heightMm)]);
    await drawPostalZone(page, pdfDoc, fonts, model, layout, {
      ...options,
      rgb,
      degrees,
      routingSymbolDataUrl: options.routingSymbols?.[model.service?.family] || ROUTING_SYMBOLS[model.service?.family] || "",
    });
    if (model.declaration.mode === DOCUMENT_MODES.SIMPLIFIED) drawSimplifiedDeclaration(page, fonts, model, layout, options);
    else await drawDceDeclaration(page, pdfDoc, fonts, model, layout);
  }

  pdfDoc.setTitle(options.title || "AGF Operacoes Postais - Etiquetas");
  pdfDoc.setProducer("AGF Operacoes Postais");
  return pdfDoc.save();
}

export async function generateTestLabelPdf(models, options = {}) {
  const bytes = await generateUnifiedLabelPdf(models, { ...options, title: "AGF Operacoes Postais - Etiqueta Teste" });
  return new Blob([bytes], { type: "application/pdf" });
}

export async function generateBatchLabelPdf(models, options = {}) {
  const bytes = await generateUnifiedLabelPdf(models, { ...options, title: "AGF Operacoes Postais - Lote de Etiquetas" });
  return new Blob([bytes], { type: "application/pdf" });
}
