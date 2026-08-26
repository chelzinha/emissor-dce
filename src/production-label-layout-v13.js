import { rgb } from 'pdf-lib';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';

const MM = 72 / 25.4;
const mm = (value) => value * MM;
const INK = rgb(0, 0, 0);
const SOFT = rgb(0.88, 0.88, 0.88);

/**
 * Fonte de verdade do layout 10 x 15, portada de etiqueta-dace-v13.html.
 * As coordenadas são milímetros medidos a partir do topo da página.
 */
export const FORMAT_10X15 = Object.freeze({
  W: 100,
  H: 150,
  M: 4,
  barObj: Object.freeze({ w: 80, h: 11.5 }),
  barCep: Object.freeze({ w: 19.7, h: 13, x: 62 }),
  chanc: Object.freeze({ w: 31, h: 18 }),
  dm: Object.freeze({ w: 25, h: 25 }),
  simb: Object.freeze({ w: 15, h: 17 }),
  Z: Object.freeze({
    topo: 23,
    objeto: 20,
    receb: 8.5,
    dest: 23,
    rem: 12,
    sep: 2.5,
    daceTit: 4.2,
    daceIde: 9.5,
    tabela: 13,
    itens: 6,
    legal: 19.5,
  }),
});

export const LABEL_GRID = Object.freeze({
  topo: Object.freeze({ pp: 5.0, pgto: 10.0, serv: 15.0, modal: 22.0, fs: 8.5, fsModal: 6.5 }),
  objeto: Object.freeze({ txt: 6.0, bar: 7.5, fs: 13 }),
  receb: Object.freeze({ l1: 4.0, l2: 8.0, fs: 8 }),
  dest: Object.freeze({
    doc: 3.4,
    nome: 9.8,
    end: 14.0,
    bairro: 17.8,
    cep: 21.9,
    bar: 5.4,
    fsDoc: 5,
    fsNome: 10.5,
    fsEnd: 9,
    fsCep: 10.5,
    fsCidade: 9,
  }),
  rem: Object.freeze({ rot: 3.0, nome: 6.3, end: 9.0, cep: 11.5, fsRot: 7, fsNome: 7.5, fsEnd: 6.8 }),
  dace: Object.freeze({ tit: 3.0, fsTit: 7.4, l1: 3.2, l2: 6.2, l3: 8.9, fsRot: 6.2, fsVal: 6.2 }),
  tabela: Object.freeze({ cab: 4.4, fsCab: 7, fsRot: 6, fsVal: 6.6 }),
  itens: Object.freeze({ rot: 2.2, val: 1.0, fsRot: 4.6, fsVal: 8.6 }),
  legal: Object.freeze({ topo: 2.4, fsMax: 5.2, fsMin: 3.6, lh: 1.12 }),
});

export const DEFAULT_LABEL_FONT_SCALE = 0.8;

const OBS_LEGAL = 'É contribuinte de ICMS qualquer pessoa física ou jurídica, que realize, com habitualidade ou em volume que caracterize intuito comercial, operações de circulação de mercadoria ou prestações de serviços de transportes interestadual e intermunicipal e de comunicação, ainda que as operações e prestações se iniciem no exterior, conforme art. 4º da Lei Complementar nº 87/96. Constitui crime contra a ordem tributária suprimir ou reduzir tributo, ou contribuição social e qualquer acessório: quando negar ou deixar de fornecer, quando obrigatório, nota fiscal ou documento equivalente, relativa a venda de mercadoria ou prestação de serviço, efetivamente realizada ou fornecê-la em desacordo com a legislação, sob pena de reclusão de dois a cinco anos, e multa, conforme inciso V do art. 1º da Lei nº 8.137/90.';

const SIMPLIFIED_LEGAL = 'Declaro, sob minha responsabilidade, que o conteúdo indicado nesta declaração corresponde ao objeto apresentado para postagem. Este documento possui finalidade operacional e não substitui documento fiscal ou DC-e quando estes forem legalmente exigidos.';

export function normalizeUnifiedLabelFontScale(value, fallback = DEFAULT_LABEL_FONT_SCALE) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const parsed = Number(normalized);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(1.1, Math.max(0.8, base));
}

function normalizeTracking(value) {
  return String(value || '').replace(/\s/g, '').toUpperCase();
}

function formatTracking(value) {
  const code = normalizeTracking(value);
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code)) return code;
  return `${code.slice(0, 2)} ${code.slice(2, 5)} ${code.slice(5, 8)} ${code.slice(8, 11)} ${code.slice(11)}`;
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function upper(value) {
  return String(value ?? '').toUpperCase();
}

function fmtDoc(value) {
  const raw = String(value || '').trim();
  if (raw && !/^[\d./-]+$/.test(raw)) return raw;
  const d = digits(value);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return d || '-';
}

function fmtCep(value) {
  const d = digits(value);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

function fmtKey(value) {
  return digits(value).match(/.{1,4}/g)?.join(' ') || '';
}

function moneyNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
  if (!text) return 0;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = text.replace(/\./g, '').replace(',', '.');
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return moneyNumber(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function serviceFamily(service) {
  const s = upper(service);
  if (s.startsWith('SEDEX')) return 'SEDEX';
  if (s.startsWith('PAC') || s.startsWith('MINI')) return 'PAC';
  return s;
}

function serviceDefaults(service) {
  return serviceFamily(service) === 'SEDEX'
    ? { modal: 'EXPRESSA', stripe: 'SIM' }
    : { modal: 'STANDARD', stripe: 'IMP' };
}

function postalValue(postal, ...keys) {
  for (const key of keys) {
    if (postal?.[key] != null && String(postal[key]).trim() !== '') return postal[key];
  }
  return '';
}

function recipientAddress(object) {
  const recipient = object.recipient || {};
  const address = recipient.address || {};
  return {
    document: recipient.document || recipient.cpfCnpj || '',
    documentType: recipient.documentType || '',
    name: recipient.name || '',
    street: address.street || '',
    number: address.number || '',
    complement: address.complement || '',
    district: address.district || '',
    city: address.city || '',
    uf: address.uf || '',
    zip: address.zip || '',
  };
}

function senderAddress(object) {
  const sender = object.sender || {};
  const address = sender.address || {};
  return {
    document: sender.document || sender.cnpj || '',
    name: sender.name || '',
    street: address.street || '',
    number: address.number || '',
    complement: address.complement || '',
    district: address.district || '',
    city: address.city || '',
    uf: address.uf || '',
    zip: address.zip || '',
  };
}

function topY(topMm) {
  return mm(FORMAT_10X15.H - topMm);
}

function rect(page, x, top, width, height, options = {}) {
  page.drawRectangle({
    x: mm(x),
    y: mm(FORMAT_10X15.H - top - height),
    width: mm(width),
    height: mm(height),
    borderWidth: options.borderWidth ?? 0.35,
    borderColor: options.borderColor || INK,
    color: options.fill,
  });
}

function rule(page, x, top, width, thickness = 0.3) {
  page.drawLine({
    start: { x: mm(x), y: topY(top) },
    end: { x: mm(x + width), y: topY(top) },
    thickness,
    color: INK,
  });
}

function dashedRule(page, x1, top, x2) {
  page.drawLine({
    start: { x: mm(x1), y: topY(top) },
    end: { x: mm(x2), y: topY(top) },
    thickness: 0.5,
    dashArray: [mm(1.6), mm(1.2)],
    color: INK,
  });
}

/** Uma linha em posição fixa. A fonte encolhe, mas nunca desloca as linhas seguintes. */
function line(page, font, value, x, yBase, maxWidth, size, options = {}) {
  if (value === '' || value == null) return;
  const text = String(value);
  const scale = normalizeUnifiedLabelFontScale(options.scale, 1);
  let current = size * scale;
  while (font.widthOfTextAtSize(text, current) > mm(maxWidth) && current > 3) current -= 0.15;
  const textWidth = font.widthOfTextAtSize(text, current);
  let xx = mm(x);
  if (options.align === 'center') xx -= textWidth / 2;
  if (options.align === 'right') xx -= textWidth;
  page.drawText(text, {
    x: xx,
    y: topY(yBase),
    font,
    size: current,
    color: options.color || INK,
  });
}

function labelValue(page, fonts, label, value, x, yBase, xLimit, labelSize, valueSize, options = {}) {
  const scale = normalizeUnifiedLabelFontScale(options.scale, 1);
  const labelFont = fonts.regular;
  const labelPt = labelSize * scale;
  page.drawText(label, { x: mm(x), y: topY(yBase), font: labelFont, size: labelPt, color: INK });
  const dx = labelFont.widthOfTextAtSize(`${label} `, labelPt) / MM;
  if (value) line(page, options.bold === false ? fonts.regular : fonts.bold, value, x + dx, yBase, xLimit - (x + dx), valueSize, { scale });
}

function wrapText(font, value, size, maxWidth) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const rows = [];
  let row = '';
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= mm(maxWidth)) row = next;
    else {
      if (row) rows.push(row);
      row = word;
    }
  }
  if (row) rows.push(row);
  return rows;
}

function textBlock(page, font, value, x, top, width, height, maxSize, minSize, lineHeightFactor, scale) {
  for (let size = maxSize * scale; size >= minSize * scale; size -= 0.1) {
    const rows = wrapText(font, value, size, width);
    const lineMm = size * 0.3528 * lineHeightFactor;
    if (rows.length * lineMm <= height) {
      rows.forEach((row, index) => page.drawText(row, {
        x: mm(x),
        y: topY(top + index * lineMm),
        font,
        size,
        color: INK,
      }));
      return true;
    }
  }
  return false;
}

async function barcodeDataUrl(text, height = 10) {
  const canvas = document.createElement('canvas');
  bwipjs.toCanvas(canvas, {
    bcid: 'code128',
    text: String(text),
    scale: 3,
    height,
    includetext: false,
    padding: 0,
  });
  return canvas.toDataURL('image/png');
}

async function embedImage(pdf, dataUrl) {
  return /^data:image\/jpeg/i.test(String(dataUrl || '')) ? pdf.embedJpg(dataUrl) : pdf.embedPng(dataUrl);
}

async function fitImage(page, pdf, dataUrl, x, top, width, height) {
  if (!dataUrl) return;
  const image = await embedImage(pdf, dataUrl);
  const factor = Math.min(mm(width) / image.width, mm(height) / image.height);
  const renderedWidth = image.width * factor;
  const renderedHeight = image.height * factor;
  page.drawImage(image, {
    x: mm(x) + (mm(width) - renderedWidth) / 2,
    y: mm(FORMAT_10X15.H - top - height) + (mm(height) - renderedHeight) / 2,
    width: renderedWidth,
    height: renderedHeight,
  });
}

function routingIconDataUrl(service) {
  const family = serviceFamily(service);
  if (!['PAC', 'SEDEX'].includes(family)) return '';
  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 180, 180);
  context.fillStyle = '#000';
  if (family === 'PAC') {
    context.beginPath();
    context.arc(90, 90, 62, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(31, 112);
    context.lineTo(31, 72);
    context.bezierCurveTo(31, 35, 57, 18, 90, 18);
    context.bezierCurveTo(123, 18, 149, 35, 149, 72);
    context.lineTo(149, 112);
    context.bezierCurveTo(132, 91, 111, 82, 90, 82);
    context.bezierCurveTo(69, 82, 48, 91, 31, 112);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(56, 151);
    context.arc(90, 151, 34, Math.PI, 0);
    context.closePath();
    context.fill();
  }
  return canvas.toDataURL('image/png');
}

async function drawRoutingSymbol(page, pdf, fonts, service, modal, x, top, scale) {
  const dataUrl = routingIconDataUrl(service);
  if (dataUrl) await fitImage(page, pdf, dataUrl, x, top + 1, FORMAT_10X15.simb.w, FORMAT_10X15.simb.h);
  line(page, fonts.bold, modal, x + FORMAT_10X15.simb.w / 2, top + LABEL_GRID.topo.modal, FORMAT_10X15.simb.w + 6, LABEL_GRID.topo.fsModal, { align: 'center', scale });
}

function drawReceiver(page, fonts, top, scale) {
  const X0 = FORMAT_10X15.M;
  const width = FORMAT_10X15.W - (2 * X0);
  const grid = LABEL_GRID.receb;
  line(page, fonts.regular, 'Recebedor:', X0, top + grid.l1, 24, grid.fs, { scale });
  rule(page, X0 + 20, top + grid.l1 + 0.4, width - 20);
  line(page, fonts.regular, 'Assinatura:', X0, top + grid.l2, 24, grid.fs, { scale });
  rule(page, X0 + 20, top + grid.l2 + 0.4, 30);
  line(page, fonts.regular, 'Documento:', X0 + 54, top + grid.l2, 24, grid.fs, { scale });
  rule(page, X0 + 76, top + grid.l2 + 0.4, width - 76);
}

async function drawPostal(page, pdf, fonts, object, matrixDataUrl, postageMarkDataUrl, scale) {
  const format = FORMAT_10X15;
  const X0 = format.M;
  const X1 = format.W - format.M;
  const width = X1 - X0;
  const zones = format.Z;
  const recipient = recipientAddress(object);
  const sender = senderAddress(object);
  const service = upper(object.service);
  const defaults = serviceDefaults(service);
  const stripe = String(object.matrix?.stripe || defaults.stripe);
  const postal = object.postal || {};
  let y = X0;

  const topGrid = LABEL_GRID.topo;
  await fitImage(page, pdf, postageMarkDataUrl, X0, y, format.chanc.w, format.chanc.h);
  const symbolX = X1 - format.simb.w;
  const matrixX = symbolX - 2 - format.dm.w;
  const textX = X0 + format.chanc.w + 2;
  const textWidth = matrixX - textX - 2;
  const pp = postalValue(postal, 'CODIGO_PP', 'CARTAO_POSTAGEM', 'CARTAO');
  if (pp) line(page, fonts.bold, `PP: ${upper(pp)}`, textX, y + topGrid.pp, textWidth, topGrid.fs, { scale });
  line(page, fonts.bold, 'À VISTA', textX, y + topGrid.pgto, textWidth, topGrid.fs, { scale });
  line(page, fonts.bold, service, textX, y + topGrid.serv, textWidth, topGrid.fs, { scale });
  await fitImage(page, pdf, matrixDataUrl, matrixX, y, format.dm.w, format.dm.h);
  await drawRoutingSymbol(page, pdf, fonts, service, defaults.modal, symbolX, y, scale);
  y += zones.topo;

  const trackingGrid = LABEL_GRID.objeto;
  const tracking = normalizeTracking(object.trackingCode);
  line(page, fonts.bold, formatTracking(tracking), X0 + width / 2, y + trackingGrid.txt, width - 6, trackingGrid.fs, { align: 'center', scale });
  const trackingBarcode = await embedImage(pdf, await barcodeDataUrl(tracking, 9));
  page.drawImage(trackingBarcode, {
    x: mm(X0 + (width - format.barObj.w) / 2),
    y: mm(format.H - y - trackingGrid.bar - format.barObj.h),
    width: mm(format.barObj.w),
    height: mm(format.barObj.h),
  });
  y += zones.objeto;

  drawReceiver(page, fonts, y, scale);
  y += zones.receb;

  const destinationTop = y;
  const destinationGrid = LABEL_GRID.dest;
  rect(page, X0, destinationTop, width, zones.dest, { borderWidth: 0.4 });
  rect(page, X0, destinationTop, 30, 4.6, { fill: INK, borderWidth: 0.4 });
  line(page, fonts.bold, 'Destinatário', X0 + 15, destinationTop + 3.4, 26, 7.6, { align: 'center', color: rgb(1, 1, 1), scale });
  const barcodeX = X0 + format.barCep.x;
  const textColumnWidth = barcodeX - X0 - 4;
  const documentLabel = recipient.documentType === 'idOutros' ? 'Documento' : 'CPF/CNPJ';
  line(page, fonts.regular, `${documentLabel}: ${fmtDoc(recipient.document)}`, X0 + 32, destinationTop + destinationGrid.doc, barcodeX - X0 - 34, destinationGrid.fsDoc, { scale });
  line(page, fonts.bold, upper(recipient.name), X0 + 2, destinationTop + destinationGrid.nome, textColumnWidth, destinationGrid.fsNome, { scale });
  line(page, fonts.regular, upper([recipient.street, recipient.number].filter(Boolean).join(', ')), X0 + 2, destinationTop + destinationGrid.end, textColumnWidth, destinationGrid.fsEnd, { scale });
  line(page, fonts.regular, upper([recipient.complement, recipient.district].filter(Boolean).join(', ')), X0 + 2, destinationTop + destinationGrid.bairro, textColumnWidth, destinationGrid.fsEnd, { scale });
  line(page, fonts.bold, fmtCep(recipient.zip), X0 + 2, destinationTop + destinationGrid.cep, 30, destinationGrid.fsCep, { scale });
  line(page, fonts.regular, upper(`${recipient.city} / ${recipient.uf}`), X0 + 34, destinationTop + destinationGrid.cep, textColumnWidth - 32, destinationGrid.fsCidade, { scale });
  if (digits(recipient.zip).length === 8) {
    const cepBarcode = await embedImage(pdf, await barcodeDataUrl(digits(recipient.zip), 10));
    page.drawImage(cepBarcode, {
      x: mm(barcodeX),
      y: mm(format.H - destinationTop - destinationGrid.bar - format.barCep.h),
      width: mm(format.barCep.w),
      height: mm(format.barCep.h),
    });
  }
  y += zones.dest;

  const senderTop = y;
  const senderGrid = LABEL_GRID.rem;
  const stripeWidth = 8;
  const senderWidth = width - stripeWidth - 4;
  rect(page, X0, senderTop, width, zones.rem);
  line(page, fonts.bold, 'Remetente:', X0 + 1.6, senderTop + senderGrid.rot, 30, senderGrid.fsRot, { scale });
  line(page, fonts.bold, upper(sender.name), X0 + 1.6, senderTop + senderGrid.nome, senderWidth, senderGrid.fsNome, { scale });
  line(page, fonts.regular, upper([sender.street, sender.number, sender.complement, sender.district].filter(Boolean).join(', ')), X0 + 1.6, senderTop + senderGrid.end, senderWidth, senderGrid.fsEnd, { scale });
  line(page, fonts.bold, upper(`${fmtCep(sender.zip)} ${sender.city}/${sender.uf}`), X0 + 1.6, senderTop + senderGrid.cep, 32, senderGrid.fsEnd, { scale });
  line(page, fonts.regular, `CNPJ/CPF: ${fmtDoc(sender.document)}`, X0 + 36, senderTop + senderGrid.cep, senderWidth - 34, senderGrid.fsEnd, { scale });
  rect(page, X1 - stripeWidth, senderTop, stripeWidth, zones.rem, { fill: INK });
  line(page, fonts.bold, stripe, X1 - stripeWidth / 2, senderTop + 6.8, 7, 6, { align: 'center', color: rgb(1, 1, 1), scale });
  y += zones.rem;

  dashedRule(page, X0, y + zones.sep / 2, X1);
  return y + zones.sep;
}

function partySender(object, issuer) {
  if (!issuer) return senderAddress(object);
  const address = issuer.address || {};
  return {
    document: issuer.cnpj || issuer.document || '',
    name: issuer.name || '',
    street: address.street || '',
    number: address.number || '',
    city: address.city || '',
    uf: address.uf || '',
  };
}

function drawPartyTable(page, fonts, object, top, issuer, scale) {
  const format = FORMAT_10X15;
  const X0 = format.M;
  const X1 = format.W - format.M;
  const width = X1 - X0;
  const half = width / 2;
  const grid = LABEL_GRID.tabela;
  const recipient = recipientAddress(object);
  const sender = partySender(object, issuer);

  rect(page, X0, top, width, format.Z.tabela);
  rect(page, X0, top, half, grid.cab, { fill: SOFT });
  rect(page, X0 + half, top, half, grid.cab, { fill: SOFT });
  line(page, fonts.bold, 'REMETENTE', X0 + half / 2, top + grid.cab - 1.3, half - 4, grid.fsCab, { align: 'center', scale });
  line(page, fonts.bold, 'DESTINATÁRIO', X0 + half + half / 2, top + grid.cab - 1.3, half - 4, grid.fsCab, { align: 'center', scale });

  const bodyTop = top + grid.cab;
  const bodyHeight = format.Z.tabela - grid.cab;
  const step = bodyHeight / 4;
  rect(page, X0, bodyTop, half, bodyHeight);
  rect(page, X0 + half, bodyTop, half, bodyHeight);
  const rows = [
    ['CNPJ/CPF:', fmtDoc(sender.document), fmtDoc(recipient.document)],
    ['NOME:', upper(sender.name), upper(recipient.name)],
    ['CIDADE-UF:', upper(`${sender.city || ''}-${sender.uf || ''}`), upper(`${recipient.city || ''}-${recipient.uf || ''}`)],
    ['ENDEREÇO:', upper([sender.street, sender.number].filter(Boolean).join(', ')), upper([recipient.street, recipient.number].filter(Boolean).join(', '))],
  ];
  rows.forEach(([label, senderValue, recipientValue], index) => {
    const baseline = bodyTop + (step * 0.72) + (index * step);
    labelValue(page, fonts, label, senderValue, X0 + 1.4, baseline, X0 + half - 1.4, grid.fsRot, grid.fsVal, { scale, bold: false });
    labelValue(page, fonts, label, recipientValue, X0 + half + 1.4, baseline, X1 - 1.4, grid.fsRot, grid.fsVal, { scale, bold: false });
  });
}

function declaredValue(object) {
  return moneyNumber(postalValue(object.postal || {}, 'VALOR_DECLARADO', 'VALOR', 'VLR_DECLARADO', 'DECLARED_VALUE'));
}

function itemData(object, items) {
  return {
    description: items?.map((item) => item.description).filter(Boolean).join('; ') || object.content || '-',
    quantity: items?.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 1,
    value: items?.reduce((sum, item) => sum + Number(item.totalValue ?? (Number(item.quantity || 1) * Number(item.unitValue || 0))), 0) ?? declaredValue(object),
  };
}

function drawItems(page, fonts, object, top, items, scale) {
  const format = FORMAT_10X15;
  const X0 = format.M;
  const X1 = format.W - format.M;
  const width = X1 - X0;
  const grid = LABEL_GRID.itens;
  const column2 = 13;
  const column3 = 22;
  const column1 = width - column2 - column3;
  const data = itemData(object, items);

  rect(page, X0, top, column1, format.Z.itens);
  rect(page, X0 + column1, top, column2, format.Z.itens);
  rect(page, X0 + column1 + column2, top, column3, format.Z.itens);
  line(page, fonts.regular, 'DESCRIÇÃO DOS BENS OU MERCADORIAS', X0 + 1.4, top + grid.rot, column1 - 3, grid.fsRot, { scale });
  line(page, fonts.regular, 'QTD', X0 + column1 + 1.4, top + grid.rot, column2 - 3, grid.fsRot, { scale });
  line(page, fonts.regular, 'VALOR TOTAL', X0 + column1 + column2 + 1.4, top + grid.rot, column3 - 3, grid.fsRot, { scale });
  line(page, fonts.bold, data.description, X0 + 1.4, top + format.Z.itens - grid.val, column1 - 3, grid.fsVal, { scale });
  line(page, fonts.bold, String(data.quantity), X0 + column1 + column2 / 2, top + format.Z.itens - grid.val, column2 - 3, grid.fsVal, { align: 'center', scale });
  line(page, fonts.bold, money(data.value), X1 - 1.4, top + format.Z.itens - grid.val, column3 - 3, grid.fsVal, { align: 'right', scale });
}

function drawSimplified(page, fonts, object, top, scale) {
  const format = FORMAT_10X15;
  const X0 = format.M;
  const X1 = format.W - format.M;
  const width = X1 - X0;
  const grid = LABEL_GRID.dace;

  rect(page, X0, top, width, format.Z.daceTit);
  line(page, fonts.bold, 'DECLARAÇÃO SIMPLIFICADA DE CONTEÚDO', X0 + width / 2, top + grid.tit, width - 4, grid.fsTit, { align: 'center', scale });
  top += format.Z.daceTit;

  rect(page, X0, top, width, format.Z.daceIde, { fill: rgb(0.98, 0.98, 0.98) });
  line(page, fonts.bold, 'Documento operacional vinculado a esta postagem.', X0 + width / 2, top + grid.l1, width - 4, 5.8, { align: 'center', scale });
  line(page, fonts.bold, 'Não representa DC-e autorizada; não possui chave ou protocolo fiscal.', X0 + width / 2, top + grid.l2, width - 4, 5.2, { align: 'center', scale });
  line(page, fonts.regular, 'Conteúdo declarado pelo remetente para fins operacionais da postagem.', X0 + width / 2, top + grid.l3, width - 4, 5.2, { align: 'center', scale });
  top += format.Z.daceIde;

  drawPartyTable(page, fonts, object, top, null, scale);
  top += format.Z.tabela;
  drawItems(page, fonts, object, top, null, scale);
  top += format.Z.itens;
  rect(page, X0, top, width, format.Z.legal);
  textBlock(page, fonts.regular, SIMPLIFIED_LEGAL, X0 + 2, top + LABEL_GRID.legal.topo, width - 4, format.Z.legal - LABEL_GRID.legal.topo - 0.8, LABEL_GRID.legal.fsMax, LABEL_GRID.legal.fsMin, LABEL_GRID.legal.lh, scale);
}

async function drawDace(page, pdf, fonts, object, top, scale) {
  const format = FORMAT_10X15;
  const X0 = format.M;
  const X1 = format.W - format.M;
  const width = X1 - X0;
  const grid = LABEL_GRID.dace;
  const dce = object.dce || {};
  const issuer = dce.issuer || object.sender || {};
  const items = dce.items || null;

  rect(page, X0, top, width, format.Z.daceTit);
  line(page, fonts.bold, 'DACE RESUMIDA - DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRÔNICA', X0 + width / 2, top + grid.tit, width - 4, grid.fsTit, { align: 'center', scale });
  top += format.Z.daceTit;

  rect(page, X0, top, width, format.Z.daceIde);
  labelValue(page, fonts, 'Nº:', String(dce.number || '').padStart(9, '0'), X0 + 1, top + grid.l1, X0 + 32, grid.fsRot, grid.fsVal, { scale });
  labelValue(page, fonts, 'SÉRIE:', String(dce.series || '').padStart(3, '0'), X0 + 34, top + grid.l1, X0 + 58, grid.fsRot, grid.fsVal, { scale });
  labelValue(page, fonts, 'DATA EMISSÃO:', String(dce.authorizedAt || '').replace('T', ' ').slice(0, 19), X0 + 60, top + grid.l1, X1 - 1, grid.fsRot, grid.fsVal, { scale });
  labelValue(page, fonts, 'PROTOCOLO AUTORIZAÇÃO:', dce.protocol || '', X0 + 1, top + grid.l2, X0 + 58, grid.fsRot, grid.fsVal, { scale });
  labelValue(page, fonts, 'MODALIDADE DE TRANSPORTE:', '0 - CORREIOS', X0 + 1, top + grid.l3, X0 + 58, grid.fsRot, grid.fsVal, { scale });
  if (digits(dce.accessKey).length === 44) {
    line(page, fonts.regular, 'CHAVE:', X0 + 60, top + grid.l3, 35, 4.6, { scale });
    line(page, fonts.bold, fmtKey(dce.accessKey), X0 + 60, top + grid.l3 + 2.2, 35, 4.2, { scale });
  }
  top += format.Z.daceIde;

  drawPartyTable(page, fonts, object, top, issuer, scale);
  top += format.Z.tabela;
  drawItems(page, fonts, object, top, items, scale);
  top += format.Z.itens;
  rect(page, X0, top, width, format.Z.legal);

  const qrUrl = String(dce.qrCode || `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${digits(dce.accessKey)}&tpAmb=${dce.environment || '2'}`);
  const qrData = await QRCode.toDataURL(qrUrl, { margin: 0, width: 180, errorCorrectionLevel: 'M' });
  await fitImage(page, pdf, qrData, X0 + 1.6, top + (format.Z.legal - 12) / 2, 12, 12);
  const textX = X0 + 15.6;
  textBlock(page, fonts.regular, OBS_LEGAL, textX, top + LABEL_GRID.legal.topo, X1 - textX - 1.6, format.Z.legal - LABEL_GRID.legal.topo - 0.8, LABEL_GRID.legal.fsMax, LABEL_GRID.legal.fsMin, LABEL_GRID.legal.lh, scale);
}

export async function renderUnifiedLabelV13({ pdf, fonts, object, matrixDataUrl, postageMarkDataUrl, fontScale }) {
  const scale = normalizeUnifiedLabelFontScale(fontScale);
  const page = pdf.addPage([mm(FORMAT_10X15.W), mm(FORMAT_10X15.H)]);
  const contentTop = await drawPostal(page, pdf, fonts, object, matrixDataUrl, postageMarkDataUrl, scale);
  if (object.dce) await drawDace(page, pdf, fonts, object, contentTop, scale);
  else drawSimplified(page, fonts, object, contentTop, scale);
  return page;
}
