import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import { dataAction, downloadBlob } from './api.js';
import { getPortalReturnAssets } from './portal-assets.js';
import { auditPdfDocuments, loadPdfDocuments, verifyCrops } from './matrix-engine.js';
import { loadPostalVendors } from './postal-vendors.js';

const MM = 72 / 25.4;
const PAGE_W = 100;
const PAGE_H = 150;
const M = 4;
const CW = 92;
const mm = (value) => value * MM;
const INK = rgb(0.02, 0.05, 0.08);
const SOFT = rgb(0.88, 0.88, 0.88);
const CROP_CACHE = new Map();
const SYMBOL_CACHE = new Map();

const F = Object.freeze({
  chanc: { w: 31, h: 18 },
  dm: { w: 25, h: 25 },
  simb: { w: 15, h: 17 },
  barObj: { w: 80, h: 11.5 },
  barCep: { w: 19.7, h: 13, x: 62 },
});
const Z = Object.freeze({ top: 23, tracking: 20, receiver: 8.5, recipient: 23, sender: 12, sep: 2.5, title: 4.2, ident: 9.5, table: 13, items: 6, legal: 19.5 });
const G = Object.freeze({
  top: { pp: 5, pay: 10, service: 15, modal: 22, fs: 8.5, modalFs: 6.5 },
  tracking: { text: 6, bar: 7.5, fs: 13 },
  receiver: { l1: 4, l2: 8, fs: 8 },
  recipient: { doc: 3.4, name: 9.8, address: 14, district: 17.8, zip: 21.9, bar: 5.4, fsDoc: 5, fsName: 10.5, fsAddress: 9, fsZip: 10.5, fsCity: 9 },
  sender: { label: 3, name: 6.3, address: 9, zip: 11.5, fsLabel: 7, fsName: 7.5, fsAddress: 6.8 },
  doc: { title: 3, titleFs: 7.4, l1: 3.2, l2: 6.2, l3: 8.9, fsLabel: 6.2, fsValue: 6.2 },
  table: { header: 4.4, fsHeader: 7, fsLabel: 6, fsValue: 6.6 },
  items: { label: 2.2, valueBottom: 1, fsLabel: 4.6, fsValue: 8.6 },
  legal: { top: 2.4, fsMax: 5.2, fsMin: 3.6 },
});

const OBS_LEGAL = 'É contribuinte de ICMS qualquer pessoa física ou jurídica, que realize, com habitualidade ou em volume que caracterize intuito comercial, operações de circulação de mercadoria ou prestações de serviços de transportes interestadual e intermunicipal e de comunicação, ainda que as operações e prestações se iniciem no exterior, conforme art. 4º da Lei Complementar nº 87/96. Constitui crime contra a ordem tributária suprimir ou reduzir tributo, ou contribuição social e qualquer acessório: quando negar ou deixar de fornecer, quando obrigatório, nota fiscal ou documento equivalente, relativa a venda de mercadoria ou prestação de serviço, efetivamente realizada ou fornecê-la em desacordo com a legislação, sob pena de reclusão de dois a cinco anos, e multa, conforme inciso V do art. 1º da Lei nº 8.137/90.';

function normalizeTracking(value) { return String(value || '').replace(/\s/g, '').toUpperCase(); }
function formatTracking(value) {
  const code = normalizeTracking(value);
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code)
    ? `${code.slice(0, 2)} ${code.slice(2, 5)} ${code.slice(5, 8)} ${code.slice(8, 11)} ${code.slice(11)}`
    : code;
}
function digits(value) { return String(value ?? '').replace(/\D/g, ''); }
function upper(value) { return String(value ?? '').trim().toUpperCase(); }
function moneyNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
  if (!text) return 0;
  const comma = text.lastIndexOf(','), dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  else if (comma >= 0) text = text.replace(/\./g, '').replace(',', '.');
  else if ((text.match(/\./g) || []).length > 1) text = text.replace(/\.(?=.*\.)/g, '');
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}
function money(value) { return moneyNumber(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtDoc(value) {
  const d = digits(value);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return d || '-';
}
function fmtCep(value) { const d = digits(value); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; }
function fmtKey(value) { return digits(value).match(/.{1,4}/g)?.join(' ') || ''; }
function serviceDefaults(service) { return upper(service).startsWith('SEDEX') ? { modal: 'EXPRESSA', stripe: 'SIM', family: 'SEDEX' } : { modal: 'STANDARD', stripe: 'IMP', family: 'PAC' }; }
function postalValue(postal, ...keys) { for (const key of keys) if (postal?.[key] != null && String(postal[key]).trim() !== '') return postal[key]; return ''; }
function declaredValue(object) { return moneyNumber(postalValue(object.postal, 'VALOR_DECLARADO', 'VALOR', 'VLR_DECLARADO', 'DECLARED_VALUE')); }
function topY(topMm) { return mm(PAGE_H - topMm); }
function rect(page, x, top, w, h, options = {}) { page.drawRectangle({ x: mm(x), y: mm(PAGE_H - top - h), width: mm(w), height: mm(h), borderWidth: options.borderWidth ?? 0.35, borderColor: options.borderColor || INK, color: options.fill }); }
function line(page, x1, y1, x2, y2, width = .35, dash) { page.drawLine({ start: { x: mm(x1), y: topY(y1) }, end: { x: mm(x2), y: topY(y2) }, thickness: width, dashArray: dash?.map(mm), color: INK }); }
function fitText(page, font, value, x, top, maxWidth, size = 8, minSize = 3, align = 'left', color = INK) {
  let text = String(value ?? ''), current = size;
  while (current > minSize && font.widthOfTextAtSize(text, current) > mm(maxWidth)) current -= .15;
  if (font.widthOfTextAtSize(text, current) > mm(maxWidth)) {
    while (text.length > 1 && font.widthOfTextAtSize(`${text}…`, current) > mm(maxWidth)) text = text.slice(0, -1);
    text += '…';
  }
  let xx = mm(x); const width = font.widthOfTextAtSize(text, current);
  if (align === 'center') xx = mm(x) - width / 2;
  if (align === 'right') xx = mm(x) - width;
  page.drawText(text, { x: xx, y: topY(top) - current, color, font, size: current });
}
function wrapText(font, value, size, maxWidth) {
  const words = String(value || '').split(/\s+/).filter(Boolean), lines = []; let row = '';
  for (const word of words) { const next = row ? `${row} ${word}` : word; if (font.widthOfTextAtSize(next, size) <= mm(maxWidth)) row = next; else { if (row) lines.push(row); row = word; } }
  if (row) lines.push(row); return lines;
}
function blockText(page, font, value, x, top, w, h, maxSize = 5.2, minSize = 3.5) {
  for (let size = maxSize; size >= minSize; size -= .1) {
    const lines = wrapText(font, value, size, w), lineMm = size * .3528 * 1.12;
    if (lines.length * lineMm <= h) { lines.forEach((row, i) => page.drawText(row, { x: mm(x), y: topY(top + i * lineMm) - size, font, size, color: INK })); return; }
  }
}
function labelValue(page, fonts, label, value, x, top, right, fsLabel = 6, fsValue = 6, bold = false) {
  fitText(page, fonts.regular, label, x, top, right - x, fsLabel, 3.5);
  const labelWidthMm = fonts.regular.widthOfTextAtSize(`${label} `, fsLabel) / MM;
  fitText(page, bold ? fonts.bold : fonts.regular, value, x + labelWidthMm, top, right - x - labelWidthMm, fsValue, 3.5);
}
async function barcodeDataUrl(text, options = {}) {
  const canvas = document.createElement('canvas');
  bwipjs.toCanvas(canvas, { bcid: 'code128', text: String(text), scale: 2, height: options.height || 10, includetext: false, padding: 0 });
  return canvas.toDataURL('image/png');
}
async function matrixCrops(portalReturnId, onProgress) {
  const assets = await getPortalReturnAssets(portalReturnId);
  if (!assets?.pdfFiles?.length) throw new Error('Os PDFs originais do Portal não estão disponíveis neste navegador. Reimporte o retorno no computador da produção.');
  const region = assets.labelSetup?.matrixRegion;
  if (!region) throw new Error('A área do Data Matrix ainda não foi configurada para este retorno.');
  const cacheKey = `${portalReturnId}:${JSON.stringify(region)}`;
  if (CROP_CACHE.has(cacheKey)) return CROP_CACHE.get(cacheKey);
  const { pdfjsLib, ZXing } = await loadPostalVendors();
  const documents = await loadPdfDocuments(assets.pdfFiles, pdfjsLib);
  const audit = await auditPdfDocuments(documents, ZXing, { region, onProgress });
  const verified = await verifyCrops(audit.crops, ZXing);
  const failed = verified.filter((row) => !row.ok);
  if (failed.length) throw new Error(`${failed.length} Data Matrix falharam na releitura antes da geração.`);
  CROP_CACHE.set(cacheKey, audit.crops);
  return audit.crops;
}
async function image(pdf, dataUrl) { return /^data:image\/jpeg/i.test(String(dataUrl || '')) ? pdf.embedJpg(dataUrl) : pdf.embedPng(dataUrl); }
function drawImageFit(page, embedded, x, top, w, h) {
  const scale = Math.min(mm(w) / embedded.width, mm(h) / embedded.height);
  const width = embedded.width * scale, height = embedded.height * scale;
  page.drawImage(embedded, { x: mm(x) + (mm(w) - width) / 2, y: mm(PAGE_H - top - h) + (mm(h) - height) / 2, width, height });
}
async function assetDataUrl(path) {
  if (SYMBOL_CACHE.has(path)) return SYMBOL_CACHE.get(path);
  const response = await fetch(path, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Não foi possível carregar o símbolo postal (${response.status}).`);
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  SYMBOL_CACHE.set(path, dataUrl); return dataUrl;
}
async function routingSymbolDataUrl(service) {
  const family = serviceDefaults(service).family;
  return assetDataUrl(family === 'SEDEX' ? '/icones_guia_sedex_preto.png' : '/icones_guia_pac_preto.png');
}
function verticalStripeDataUrl(text, wMm = 8, hMm = 12) {
  const scale = 14, canvas = document.createElement('canvas');
  canvas.width = Math.round(wMm * scale); canvas.height = Math.round(hMm * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(wMm * scale * .58)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(upper(text), 0, 0);
  return canvas.toDataURL('image/png');
}
async function drawPostageMark(page, pdf, dataUrl, top) {
  if (!dataUrl) throw new Error('A chancela da etiqueta ainda não foi configurada.');
  drawImageFit(page, await image(pdf, dataUrl), M, top, F.chanc.w, F.chanc.h);
}
function recipientAddress(object) { const r = object.recipient || {}, a = r.address || {}; return { document: r.document || r.cpfCnpj || '', name: r.name || '', street: a.street || '', number: a.number || '', complement: a.complement || '', district: a.district || '', city: a.city || '', uf: a.uf || '', zip: a.zip || '' }; }
function senderAddress(object) { const s = object.sender || {}, a = s.address || {}; return { document: s.document || '', name: s.name || '', street: a.street || '', number: a.number || '', complement: a.complement || '', district: a.district || '', city: a.city || '', uf: a.uf || '', zip: a.zip || '' }; }
function drawReceiver(page, fonts, top) {
  fitText(page, fonts.regular, 'Recebedor:', M, top + G.receiver.l1, 24, G.receiver.fs, 4);
  line(page, M + 20, top + G.receiver.l1 + .4, 96, top + G.receiver.l1 + .4, .25);
  fitText(page, fonts.regular, 'Assinatura:', M, top + G.receiver.l2, 24, G.receiver.fs, 4);
  line(page, M + 20, top + G.receiver.l2 + .4, M + 50, top + G.receiver.l2 + .4, .25);
  fitText(page, fonts.regular, 'Documento:', M + 54, top + G.receiver.l2, 24, G.receiver.fs, 4);
  line(page, M + 76, top + G.receiver.l2 + .4, 96, top + G.receiver.l2 + .4, .25);
}
async function drawPostal(page, pdf, fonts, object, matrixDataUrl, postageMarkDataUrl) {
  const r = recipientAddress(object), s = senderAddress(object), service = upper(object.service), defaults = serviceDefaults(service), postal = object.postal || {};
  const stripe = upper(object.matrix?.stripe || defaults.stripe), modal = defaults.modal;
  let y = M;
  await drawPostageMark(page, pdf, postageMarkDataUrl, y);
  const xSym = 96 - F.simb.w, xDm = xSym - 2 - F.dm.w, xTxt = M + F.chanc.w + 2, wTxt = xDm - xTxt - 2;
  fitText(page, fonts.bold, `PP: ${upper(postalValue(postal, 'CODIGO_PP', 'CARTAO_POSTAGEM', 'CARTAO') || '—')}`, xTxt, y + G.top.pp, wTxt, G.top.fs, 4.5);
  fitText(page, fonts.bold, 'À VISTA', xTxt, y + G.top.pay, wTxt, G.top.fs, 4.5);
  fitText(page, fonts.bold, service, xTxt, y + G.top.service, wTxt, G.top.fs, 4.5);
  drawImageFit(page, await image(pdf, matrixDataUrl), xDm, y, F.dm.w, F.dm.h);
  drawImageFit(page, await image(pdf, await routingSymbolDataUrl(service)), xSym, y + 1, F.simb.w, F.simb.h);
  fitText(page, fonts.bold, modal, xSym + F.simb.w / 2, y + G.top.modal, F.simb.w + 6, G.top.modalFs, 4, 'center');
  y += Z.top;

  const tracking = normalizeTracking(object.trackingCode);
  fitText(page, fonts.bold, formatTracking(tracking), M + CW / 2, y + G.tracking.text, CW - 6, G.tracking.fs, 8, 'center');
  const trackBarcode = await image(pdf, await barcodeDataUrl(tracking, { height: 9 }));
  page.drawImage(trackBarcode, { x: mm(M + (CW - F.barObj.w) / 2), y: mm(PAGE_H - (y + G.tracking.bar + F.barObj.h)), width: mm(F.barObj.w), height: mm(F.barObj.h) });
  y += Z.tracking;

  drawReceiver(page, fonts, y); y += Z.receiver;
  const de = y, xBar = M + F.barCep.x, wCol = xBar - M - 4;
  rect(page, M, de, CW, Z.recipient); rect(page, M, de, 30, 4.6, { fill: INK });
  fitText(page, fonts.bold, 'Destinatário', M + 15, de + 3.4, 27, 7.6, 5, 'center', rgb(1, 1, 1));
  fitText(page, fonts.regular, `CPF/CNPJ: ${r.document ? fmtDoc(r.document) : '-'}`, M + 32, de + G.recipient.doc, xBar - M - 34, G.recipient.fsDoc, 3.5);
  fitText(page, fonts.bold, upper(r.name), M + 2, de + G.recipient.name, wCol, G.recipient.fsName, 5);
  fitText(page, fonts.regular, upper(r.street) ? `${upper(r.street)}, ${r.number || 'S/N'}` : '', M + 2, de + G.recipient.address, wCol, G.recipient.fsAddress, 4.5);
  fitText(page, fonts.regular, [upper(r.complement), upper(r.district)].filter(Boolean).join(', '), M + 2, de + G.recipient.district, wCol, G.recipient.fsAddress, 4.5);
  fitText(page, fonts.bold, fmtCep(r.zip), M + 2, de + G.recipient.zip, 30, G.recipient.fsZip, 5);
  if (r.city) fitText(page, fonts.regular, `${upper(r.city)} / ${upper(r.uf)}`, M + 34, de + G.recipient.zip, wCol - 32, G.recipient.fsCity, 4.5);
  if (digits(r.zip).length === 8) {
    const cepBarcode = await image(pdf, await barcodeDataUrl(digits(r.zip), { height: 10 }));
    page.drawImage(cepBarcode, { x: mm(xBar), y: mm(PAGE_H - (de + G.recipient.bar + F.barCep.h)), width: mm(F.barCep.w), height: mm(F.barCep.h) });
  }
  y += Z.recipient;

  const re = y, wStripe = 8, wRem = CW - wStripe - 4;
  rect(page, M, re, CW, Z.sender);
  fitText(page, fonts.bold, 'Remetente:', M + 1.6, re + G.sender.label, 30, G.sender.fsLabel, 4);
  fitText(page, fonts.bold, upper(s.name), M + 1.6, re + G.sender.name, wRem, G.sender.fsName, 4);
  fitText(page, fonts.regular, upper([s.street, s.number, s.complement, s.district].filter(Boolean).join(', ')), M + 1.6, re + G.sender.address, wRem, G.sender.fsAddress, 3.8);
  fitText(page, fonts.bold, upper(`${fmtCep(s.zip)} ${s.city}/${s.uf}`), M + 1.6, re + G.sender.zip, 32, G.sender.fsAddress, 3.8);
  fitText(page, fonts.regular, `CNPJ/CPF: ${fmtDoc(s.document)}`, M + 36, re + G.sender.zip, wRem - 34, G.sender.fsAddress, 3.8);
  if (stripe) drawImageFit(page, await image(pdf, verticalStripeDataUrl(stripe, wStripe, Z.sender)), 96 - wStripe, re, wStripe, Z.sender);
  y += Z.sender;

  line(page, M, y + Z.sep / 2, 96, y + Z.sep / 2, .45, [1.6, 1.2]);
  return y + Z.sep;
}
function drawPartyTable(page, fonts, object, top, issuer) {
  const r = recipientAddress(object), s = issuer ? { document: issuer.cnpj || issuer.document || '', name: issuer.name || '', street: issuer.address?.street || '', number: issuer.address?.number || '', city: issuer.address?.city || '', uf: issuer.address?.uf || '' } : senderAddress(object);
  const half = CW / 2, header = G.table.header, body = Z.table - header, step = body / 4;
  rect(page, M, top, CW, Z.table); rect(page, M, top, half, header, { fill: SOFT }); rect(page, M + half, top, half, header, { fill: SOFT });
  fitText(page, fonts.bold, 'REMETENTE', M + half / 2, top + header - 1.3, half - 4, G.table.fsHeader, 4, 'center');
  fitText(page, fonts.bold, 'DESTINATÁRIO', M + half + half / 2, top + header - 1.3, half - 4, G.table.fsHeader, 4, 'center');
  const rows = [['CNPJ/CPF:', fmtDoc(s.document), fmtDoc(r.document)], ['NOME:', upper(s.name), upper(r.name)], ['CIDADE-UF:', upper(`${s.city || ''}-${s.uf || ''}`), upper(`${r.city || ''}-${r.uf || ''}`)], ['ENDEREÇO:', upper([s.street, s.number].filter(Boolean).join(', ')), upper([r.street, r.number].filter(Boolean).join(', '))]];
  rows.forEach((row, i) => { const yy = top + header + step * .72 + i * step; labelValue(page, fonts, row[0], row[1], M + 1.4, yy, M + half - 1.4, G.table.fsLabel, G.table.fsValue); labelValue(page, fonts, row[0], row[2], M + half + 1.4, yy, 96 - 1.4, G.table.fsLabel, G.table.fsValue); });
}
function drawItems(page, fonts, object, top, items) {
  const value = items?.reduce((sum, item) => sum + Number(item.totalValue ?? (Number(item.quantity || 1) * Number(item.unitValue || 0))), 0) ?? declaredValue(object);
  const description = items?.map((item) => item.description).filter(Boolean).join('; ') || object.content || '-';
  const quantity = items?.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 1;
  const k2 = 13, k3 = 22, k1 = CW - k2 - k3;
  rect(page, M, top, k1, Z.items); rect(page, M + k1, top, k2, Z.items); rect(page, M + k1 + k2, top, k3, Z.items);
  fitText(page, fonts.regular, 'DESCRIÇÃO DOS BENS OU MERCADORIAS', M + 1.4, top + G.items.label, k1 - 3, G.items.fsLabel, 3.2);
  fitText(page, fonts.regular, 'QTD', M + k1 + 1.4, top + G.items.label, k2 - 3, G.items.fsLabel, 3.2);
  fitText(page, fonts.regular, 'VALOR TOTAL', M + k1 + k2 + 1.4, top + G.items.label, k3 - 3, G.items.fsLabel, 3.2);
  fitText(page, fonts.bold, description, M + 1.4, top + Z.items - G.items.valueBottom, k1 - 3, G.items.fsValue, 4);
  fitText(page, fonts.bold, String(quantity), M + k1 + k2 / 2, top + Z.items - G.items.valueBottom, k2 - 3, G.items.fsValue, 4, 'center');
  fitText(page, fonts.bold, money(value), 96 - 1.4, top + Z.items - G.items.valueBottom, k3 - 3, G.items.fsValue, 4, 'right');
}
function drawSimplified(page, fonts, object, top) {
  rect(page, M, top, CW, Z.title);
  fitText(page, fonts.bold, 'DECLARAÇÃO SIMPLIFICADA DE CONTEÚDO', M + CW / 2, top + G.doc.title, CW - 4, G.doc.titleFs, 4.6, 'center');
  top += Z.title;
  rect(page, M, top, CW, Z.ident, { fill: rgb(.98, .98, .98) });
  fitText(page, fonts.bold, 'Documento operacional vinculado a esta postagem.', M + CW / 2, top + 2.7, CW - 4, 5.8, 4, 'center');
  fitText(page, fonts.bold, 'Não representa DC-e autorizada; não possui chave ou protocolo fiscal.', M + CW / 2, top + 5.6, CW - 4, 5.2, 3.8, 'center');
  fitText(page, fonts.regular, 'Conteúdo declarado pelo remetente para fins operacionais da postagem.', M + CW / 2, top + 8.3, CW - 4, 5.2, 3.8, 'center');
  top += Z.ident; drawPartyTable(page, fonts, object, top, null); top += Z.table; drawItems(page, fonts, object, top, null); top += Z.items;
  rect(page, M, top, CW, Z.legal);
  blockText(page, fonts.regular, 'Declaro, sob minha responsabilidade, que o conteúdo indicado nesta declaração corresponde ao objeto apresentado para postagem. Este documento possui finalidade operacional e não substitui documento fiscal ou DC-e quando estes forem legalmente exigidos.', M + 2, top + 2.5, CW - 4, Z.legal - 3.5, 5.2, 3.8);
}
async function drawDace(page, pdf, fonts, object, top) {
  const d = object.dce || {}, issuer = d.issuer || object.sender || {}, items = d.items || null;
  rect(page, M, top, CW, Z.title); fitText(page, fonts.bold, 'DACE RESUMIDA - DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRÔNICA', M + CW / 2, top + G.doc.title, CW - 4, G.doc.titleFs, 4.6, 'center');
  top += Z.title; rect(page, M, top, CW, Z.ident);
  labelValue(page, fonts, 'Nº:', String(d.number || 0).padStart(9, '0'), M + 1, top + G.doc.l1, M + 32, G.doc.fsLabel, G.doc.fsValue);
  labelValue(page, fonts, 'SÉRIE:', String(d.series || 0).padStart(3, '0'), M + 34, top + G.doc.l1, M + 58, G.doc.fsLabel, G.doc.fsValue);
  labelValue(page, fonts, 'DATA EMISSÃO:', String(d.authorizedAt || '').replace('T', ' ').slice(0, 19), M + 60, top + G.doc.l1, 95, G.doc.fsLabel, G.doc.fsValue);
  labelValue(page, fonts, 'PROTOCOLO AUTORIZAÇÃO:', String(d.protocol || ''), M + 1, top + G.doc.l2, M + 58, G.doc.fsLabel, G.doc.fsValue);
  labelValue(page, fonts, 'MODALIDADE DE TRANSPORTE:', '0 - CORREIOS', M + 1, top + G.doc.l3, M + 58, G.doc.fsLabel, G.doc.fsValue);
  fitText(page, fonts.bold, `CHAVE: ${fmtKey(d.accessKey)}`, M + 60, top + G.doc.l3, 35, 4.2, 3.4);
  top += Z.ident; drawPartyTable(page, fonts, object, top, issuer); top += Z.table; drawItems(page, fonts, object, top, items); top += Z.items;
  rect(page, M, top, CW, Z.legal);
  const qrUrl = `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${digits(d.accessKey)}&tpAmb=${d.environment || '2'}`;
  const qrData = await QRCode.toDataURL(qrUrl, { margin: 0, width: 180, errorCorrectionLevel: 'M' }), qr = await image(pdf, qrData);
  drawImageFit(page, qr, M + 1.5, top + 2, 13, 13);
  blockText(page, fonts.regular, OBS_LEGAL, M + 16, top + G.legal.top, 78, Z.legal - G.legal.top - .8, G.legal.fsMax, G.legal.fsMin);
}
async function renderLabel(pdf, fonts, object, crop, postageMarkDataUrl) {
  const page = pdf.addPage([mm(PAGE_W), mm(PAGE_H)]);
  const top = await drawPostal(page, pdf, fonts, object, crop, postageMarkDataUrl);
  if (object.dce) await drawDace(page, pdf, fonts, object, top); else drawSimplified(page, fonts, object, top);
}
async function buildPdf(data, onProgress) {
  if (data.senderIssues?.length) throw new Error(`Dados do remetente incompletos: ${data.senderIssues.join(' ')}`);
  const assets = await getPortalReturnAssets(data.portalReturnId), postageMarkDataUrl = assets?.labelSetup?.postageMarkDataUrl;
  if (!assets?.labelSetup?.matrixRegion || !postageMarkDataUrl) throw new Error('Configure a área do Data Matrix e a chancela antes de gerar etiquetas.');
  const crops = await matrixCrops(data.portalReturnId, (p) => onProgress?.(`Lendo Data Matrix: ${p.processed || 0}/${p.totalPages || 0}`));
  const pdf = await PDFDocument.create(), fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  for (let index = 0; index < data.objects.length; index += 1) {
    const object = data.objects[index], crop = crops.get(normalizeTracking(object.trackingCode));
    if (!crop) throw new Error(`Data Matrix original não localizado para ${object.trackingCode}.`);
    onProgress?.(`Montando etiqueta ${index + 1} de ${data.objects.length}`);
    await renderLabel(pdf, fonts, object, crop, postageMarkDataUrl);
    if (index % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  pdf.setTitle(data.documentMode === 'DCE_AUTHORIZED' ? 'Etiquetas unificadas DC-e' : 'Etiquetas com declaração simplificada');
  pdf.setProducer('AGF Operações Postais');
  return pdf.save();
}
export async function generateProductionTestPdf(campaignId, productionBatchId, onProgress) {
  const data = await dataAction('production.documents.test', { campaignId, productionBatchId }), bytes = await buildPdf(data, onProgress);
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `etiqueta_teste_${String(data.objects[0]?.trackingCode || 'lote')}.pdf`); return data;
}
export async function generateProductionVolumePdf(campaignId, productionBatchId, volumeId, onProgress) {
  const data = await dataAction('production.documents.volume', { campaignId, productionBatchId, volumeId }), bytes = await buildPdf(data, onProgress), v = data.volume;
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `volume_${String(v.number).padStart(2, '0')}_de_${String(v.totalVolumes).padStart(2, '0')}_${v.service}.pdf`); return data;
}
