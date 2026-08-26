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
const mm = (value) => value * MM;
const INK = rgb(0.02, 0.05, 0.08);
const SOFT = rgb(0.90, 0.90, 0.90);
const CROP_CACHE = new Map();
const ROUTING_ICON_CACHE = new Map();

const Z = Object.freeze({
  top: 23,
  tracking: 20,
  receiver: 8.5,
  recipient: 23,
  sender: 12,
  sep: 2.5,
  title: 4.2,
  ident: 9.5,
  table: 13,
  items: 6,
  legal: 19.5,
});

const OBS_LEGAL = 'É contribuinte de ICMS qualquer pessoa física ou jurídica, que realize, com habitualidade ou em volume que caracterize intuito comercial, operações de circulação de mercadoria ou prestações de serviços de transportes interestadual e intermunicipal e de comunicação, ainda que as operações e prestações se iniciem no exterior, conforme art. 4º da Lei Complementar nº 87/96. Constitui crime contra a ordem tributária suprimir ou reduzir tributo, ou contribuição social e qualquer acessório: quando negar ou deixar de fornecer, quando obrigatório, nota fiscal ou documento equivalente, relativa a venda de mercadoria ou prestação de serviço, efetivamente realizada ou fornecê-la em desacordo com a legislação, sob pena de reclusão de dois a cinco anos, e multa, conforme inciso V do art. 1º da Lei nº 8.137/90.';

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

function moneyNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
  if (!text) return 0;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if ((text.match(/\./g) || []).length > 1) {
    text = text.replace(/\.(?=.*\.)/g, '');
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return moneyNumber(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

function declaredValue(object) {
  return moneyNumber(postalValue(object.postal, 'VALOR_DECLARADO', 'VALOR', 'VLR_DECLARADO', 'DECLARED_VALUE'));
}

function topY(topMm) {
  return mm(PAGE_H - topMm);
}

function rect(page, x, top, w, h, options = {}) {
  page.drawRectangle({
    x: mm(x),
    y: mm(PAGE_H - top - h),
    width: mm(w),
    height: mm(h),
    borderWidth: options.borderWidth ?? 0.45,
    borderColor: options.borderColor || INK,
    color: options.fill,
  });
}

function line(page, x1, y1, x2, y2, width = 0.4, dash) {
  page.drawLine({
    start: { x: mm(x1), y: topY(y1) },
    end: { x: mm(x2), y: topY(y2) },
    thickness: width,
    dashArray: dash?.map(mm),
    color: INK,
  });
}

function fitText(page, font, value, x, top, maxWidth, size = 8, minSize = 4.2, align = 'left', color = INK) {
  let text = String(value ?? '');
  let current = size;
  while (current > minSize && font.widthOfTextAtSize(text, current) > mm(maxWidth)) current -= 0.25;
  if (font.widthOfTextAtSize(text, current) > mm(maxWidth)) {
    while (text.length > 1 && font.widthOfTextAtSize(`${text}…`, current) > mm(maxWidth)) text = text.slice(0, -1);
    text += '…';
  }
  let xx = mm(x);
  const width = font.widthOfTextAtSize(text, current);
  if (align === 'center') xx = mm(x) + ((mm(maxWidth) - width) / 2);
  if (align === 'right') xx = mm(x) + mm(maxWidth) - width;
  page.drawText(text, { x: xx, y: topY(top) - current, color, font, size: current });
  return current;
}

function wrapText(font, value, size, maxWidth) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let row = '';
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= mm(maxWidth)) row = next;
    else {
      if (row) lines.push(row);
      row = word;
    }
  }
  if (row) lines.push(row);
  return lines;
}

function blockText(page, font, value, x, top, w, h, maxSize = 5.2, minSize = 3.5) {
  for (let size = maxSize; size >= minSize; size -= 0.2) {
    const lines = wrapText(font, value, size, w);
    const lineMm = size * 0.3528 * 1.12;
    if (lines.length * lineMm <= h) {
      lines.forEach((row, index) => page.drawText(row, {
        x: mm(x),
        y: topY(top + index * lineMm) - size,
        font,
        size,
        color: INK,
      }));
      return;
    }
  }
  fitText(page, font, value, x, top, w, minSize, minSize);
}

async function barcodeDataUrl(text, options = {}) {
  const canvas = document.createElement('canvas');
  bwipjs.toCanvas(canvas, {
    bcid: 'code128',
    text: String(text),
    scale: 2,
    height: options.height || 10,
    includetext: false,
    padding: 0,
  });
  return canvas.toDataURL('image/png');
}

function routingIconDataUrl(service) {
  const family = serviceFamily(service);
  if (ROUTING_ICON_CACHE.has(family)) return ROUTING_ICON_CACHE.get(family);
  if (!['PAC', 'SEDEX'].includes(family)) return '';

  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 180, 180);
  ctx.fillStyle = '#000';

  // Conferido nos PNGs oficiais dos Correios: PAC e o circulo cheio e
  // SEDEX e a onda formada por arco superior mais domo inferior.
  // Estavam invertidos ate a correcao de 24/08/2026.
  const isCircle = family === 'PAC';
  const isWave = family === 'SEDEX';
  if (isCircle) {
    ctx.beginPath();
    ctx.arc(90, 90, 62, 0, Math.PI * 2);
    ctx.fill();
  } else if (isWave) {
    ctx.beginPath();
    ctx.moveTo(31, 112);
    ctx.lineTo(31, 72);
    ctx.bezierCurveTo(31, 35, 57, 18, 90, 18);
    ctx.bezierCurveTo(123, 18, 149, 35, 149, 72);
    ctx.lineTo(149, 112);
    ctx.bezierCurveTo(132, 91, 111, 82, 90, 82);
    ctx.bezierCurveTo(69, 82, 48, 91, 31, 112);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(56, 151);
    ctx.arc(90, 151, 34, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  }

  const dataUrl = canvas.toDataURL('image/png');
  ROUTING_ICON_CACHE.set(family, dataUrl);
  return dataUrl;
}

async function matrixCrops(portalReturnId, trackingCodes, onProgress) {
  const assets = await getPortalReturnAssets(portalReturnId);
  if (!assets?.pdfFiles?.length) throw new Error('Os PDFs originais do Portal não estão disponíveis neste navegador. Reimporte o retorno no computador da produção.');
  const region = assets.labelSetup?.matrixRegion;
  if (!region) throw new Error('A área do Data Matrix ainda não foi configurada para este retorno.');
  const targets = [...new Set((trackingCodes || []).map(normalizeTracking).filter(Boolean))].sort();
  if (!targets.length) throw new Error('Nenhum SRO foi informado para gerar as etiquetas.');
  const cacheKey = `${portalReturnId}:${JSON.stringify(region)}:${targets.join("|")}`;
  if (CROP_CACHE.has(cacheKey)) return CROP_CACHE.get(cacheKey);

  const { pdfjsLib, ZXing } = await loadPostalVendors();
  const documents = await loadPdfDocuments(assets.pdfFiles, pdfjsLib);
  let audit;
  try {
    audit = await auditPdfDocuments(documents, ZXing, {
      region,
      onProgress,
      targetTrackingCodes: targets,
    });
  } finally {
    for (const item of documents) {
      try { await item.doc.destroy?.(); } catch {}
    }
  }
  const verified = await verifyCrops(audit.crops, ZXing);
  const failed = verified.filter((row) => !row.ok);
  const missing = targets.filter((code) => !audit.crops.has(code));
  if (failed.length || missing.length) {
    throw new Error(`${failed.length + missing.length} Data Matrix não puderam ser recuperados para a geração.`);
  }
  CROP_CACHE.set(cacheKey, audit.crops);
  return audit.crops;
}

async function image(pdf, dataUrl) {
  return /^data:image\/jpeg/i.test(String(dataUrl || '')) ? pdf.embedJpg(dataUrl) : pdf.embedPng(dataUrl);
}

async function drawPostageMark(page, pdf, dataUrl, top) {
  rect(page, M, top, 31, 18);
  if (!dataUrl) throw new Error('A chancela da etiqueta ainda não foi configurada.');
  const mark = await image(pdf, dataUrl);
  const maxW = 29;
  const maxH = 16;
  const scale = Math.min(mm(maxW) / mark.width, mm(maxH) / mark.height);
  const width = mark.width * scale;
  const height = mark.height * scale;
  const x = mm(M + 1) + (mm(maxW) - width) / 2;
  const y = mm(PAGE_H - top - 1) - height - (mm(maxH) - height) / 2;
  page.drawImage(mark, { x, y, width, height });
}

async function drawRoutingSymbol(page, pdf, fonts, service, modal, top) {
  const dataUrl = routingIconDataUrl(service);
  const x = 84;
  const w = 12;
  const h = 17;
  if (dataUrl) {
    const symbol = await image(pdf, dataUrl);
    const maxW = 10.5;
    const maxH = 14.5;
    const scale = Math.min(mm(maxW) / symbol.width, mm(maxH) / symbol.height);
    const width = symbol.width * scale;
    const height = symbol.height * scale;
    page.drawImage(symbol, {
      x: mm(x) + (mm(w) - width) / 2,
      y: mm(PAGE_H - top - h) + (mm(h) - height) / 2,
      width,
      height,
    });
  } else {
    rect(page, x, top, w, h, { fill: SOFT });
    fitText(page, fonts.bold, service, x + 0.5, top + 9, w - 1, 6.4, 4.2, 'center');
  }
  fitText(page, fonts.bold, modal, 81.5, top + 22, 15, 5.5, 4, 'center');
}

function recipientAddress(object) {
  const r = object.recipient || {};
  const a = r.address || {};
  return {
    document: r.document || r.cpfCnpj || '',
    documentType: r.documentType || '',
    name: r.name || '',
    street: a.street || '',
    number: a.number || '',
    complement: a.complement || '',
    district: a.district || '',
    city: a.city || '',
    uf: a.uf || '',
    zip: a.zip || '',
  };
}

function senderAddress(object) {
  const s = object.sender || {};
  const a = s.address || {};
  return {
    document: s.document || '',
    name: s.name || '',
    street: a.street || '',
    number: a.number || '',
    complement: a.complement || '',
    district: a.district || '',
    city: a.city || '',
    uf: a.uf || '',
    zip: a.zip || '',
  };
}

function drawReceiver(page, fonts, top) {
  fitText(page, fonts.regular, 'Recebedor:', M, top + 3, 18, 7, 5);
  line(page, M + 17, top + 3.1, 96, top + 3.1, 0.3);
  fitText(page, fonts.regular, 'Assinatura:', M, top + 7, 18, 7, 5);
  line(page, M + 17, top + 7.1, 50, top + 7.1, 0.3);
  fitText(page, fonts.regular, 'Documento:', 55, top + 7, 18, 7, 5);
  line(page, 75, top + 7.1, 96, top + 7.1, 0.3);
}

async function drawPostal(page, pdf, fonts, object, matrixDataUrl, postageMarkDataUrl) {
  const r = recipientAddress(object);
  const s = senderAddress(object);
  const service = upper(object.service);
  const defaults = serviceDefaults(service);
  const postal = object.postal || {};
  const stripe = String(object.matrix?.stripe || defaults.stripe);
  const modal = defaults.modal;
  let y = M;

  await drawPostageMark(page, pdf, postageMarkDataUrl, y);
  fitText(page, fonts.bold, `PP: ${postalValue(postal, 'CODIGO_PP', 'CARTAO_POSTAGEM', 'CARTAO') || '—'}`, 37, y + 4, 19, 6.5, 4.5);
  fitText(page, fonts.bold, 'À VISTA', 37, y + 9, 19, 7, 5);
  fitText(page, fonts.bold, service, 37, y + 14, 19, 7, 5);

  const dm = await image(pdf, matrixDataUrl);
  page.drawImage(dm, { x: mm(58), y: mm(PAGE_H - y - 25), width: mm(25), height: mm(25) });
  await drawRoutingSymbol(page, pdf, fonts, service, modal, y);

  y += Z.top;
  const tracking = normalizeTracking(object.trackingCode);
  fitText(page, fonts.bold, formatTracking(tracking), M + 3, y + 5, 86, 13, 8, 'center');
  const trackBarcode = await image(pdf, await barcodeDataUrl(tracking, { height: 9 }));
  page.drawImage(trackBarcode, { x: mm(10), y: mm(PAGE_H - y - 19), width: mm(80), height: mm(11.5) });

  y += Z.tracking;
  drawReceiver(page, fonts, y);
  y += Z.receiver;

  rect(page, M, y, 92, Z.recipient);
  rect(page, M, y, 30, 4.6, { fill: INK });
  fitText(page, fonts.bold, 'Destinatário', M + 2, y + 3.4, 26, 7, 5, 'center', rgb(1, 1, 1));
  fitText(page, fonts.regular, `${r.documentType === 'idOutros' ? 'Documento' : 'CPF/CNPJ'}: ${fmtDoc(r.document)}`, 36, y + 3.4, 20, 5, 4);
  fitText(page, fonts.bold, upper(r.name), M + 2, y + 9, 49, 10.5, 6);
  fitText(page, fonts.regular, upper([r.street, r.number].filter(Boolean).join(', ')), M + 2, y + 13.2, 49, 8, 5);
  fitText(page, fonts.regular, upper([r.complement, r.district].filter(Boolean).join(', ')), M + 2, y + 17, 49, 7, 4.5);
  fitText(page, fonts.bold, fmtCep(r.zip), M + 2, y + 21.2, 28, 10, 6);
  fitText(page, fonts.regular, upper(`${r.city} / ${r.uf}`), 34, y + 21.2, 20, 8, 5);
  if (digits(r.zip).length === 8) {
    const cepBarcode = await image(pdf, await barcodeDataUrl(digits(r.zip), { height: 10 }));
    page.drawImage(cepBarcode, { x: mm(56), y: mm(PAGE_H - y - 18.5), width: mm(40), height: mm(13) });
  }

  y += Z.recipient;
  rect(page, M, y, 92, Z.sender);
  fitText(page, fonts.bold, 'Remetente:', M + 1.5, y + 3, 18, 6.5, 4.5);
  fitText(page, fonts.bold, upper(s.name), M + 1.5, y + 6.2, 78, 7.2, 4.5);
  fitText(page, fonts.regular, upper([s.street, s.number, s.complement, s.district].filter(Boolean).join(', ')), M + 1.5, y + 8.9, 78, 6.4, 4);
  fitText(page, fonts.bold, upper(`${fmtCep(s.zip)} ${s.city}/${s.uf}`), M + 1.5, y + 11.2, 33, 6, 4);
  fitText(page, fonts.regular, `CNPJ/CPF: ${fmtDoc(s.document)}`, 40, y + 11.2, 40, 6, 4);
  rect(page, 88, y, 8, Z.sender, { fill: INK });
  fitText(page, fonts.bold, stripe, 88.5, y + 6.8, 7, 6, 4, 'center', rgb(1, 1, 1));

  y += Z.sender;
  line(page, M, y + Z.sep / 2, 96, y + Z.sep / 2, 0.45, [1.6, 1.2]);
  return y + Z.sep;
}

function drawPartyTable(page, fonts, object, top, issuer) {
  const r = recipientAddress(object);
  const s = issuer ? {
    document: issuer.cnpj || issuer.document || '',
    name: issuer.name || '',
    street: issuer.address?.street || '',
    number: issuer.address?.number || '',
    city: issuer.address?.city || '',
    uf: issuer.address?.uf || '',
  } : senderAddress(object);
  const half = 46;

  rect(page, M, top, 92, Z.table);
  rect(page, M, top, half, 3.7, { fill: SOFT });
  rect(page, M + half, top, half, 3.7, { fill: SOFT });
  fitText(page, fonts.bold, 'REMETENTE', M + 1, top + 2.8, half - 2, 6.2, 4.5, 'center');
  fitText(page, fonts.bold, 'DESTINATÁRIO', M + half + 1, top + 2.8, half - 2, 6.2, 4.5, 'center');

  const rows = [
    ['CNPJ/CPF:', fmtDoc(s.document), fmtDoc(r.document)],
    ['NOME:', upper(s.name), upper(r.name)],
    ['CIDADE-UF:', upper(`${s.city || ''}-${s.uf || ''}`), upper(`${r.city || ''}-${r.uf || ''}`)],
    ['ENDEREÇO:', upper([s.street, s.number].filter(Boolean).join(', ')), upper([r.street, r.number].filter(Boolean).join(', '))],
  ];
  rows.forEach((row, index) => {
    const yy = top + 5.3 + index * 2.35;
    fitText(page, fonts.regular, `${row[0]} ${row[1]}`, M + 1.2, yy, half - 2.4, 5, 3.7);
    fitText(page, fonts.regular, `${row[0]} ${row[2]}`, M + half + 1.2, yy, half - 2.4, 5, 3.7);
  });
}

function drawItems(page, fonts, object, top, items) {
  const value = items?.reduce((sum, item) => sum + Number(item.totalValue ?? (Number(item.quantity || 1) * Number(item.unitValue || 0))), 0) ?? declaredValue(object);
  const description = items?.map((item) => item.description).filter(Boolean).join('; ') || object.content || '-';
  const quantity = items?.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 1;

  rect(page, M, top, 92, Z.items);
  fitText(page, fonts.regular, 'DESCRIÇÃO DOS BENS OU MERCADORIAS', M + 1, top + 2, 55, 4.5, 3.5);
  fitText(page, fonts.regular, 'QTD', 62, top + 2, 10, 4.5, 3.5, 'center');
  fitText(page, fonts.regular, 'VALOR TOTAL', 73, top + 2, 22, 4.5, 3.5, 'right');
  fitText(page, fonts.bold, description, M + 1, top + 5.4, 55, 7.5, 4);
  fitText(page, fonts.bold, String(quantity), 62, top + 5.4, 10, 7, 4, 'center');
  fitText(page, fonts.bold, money(value), 73, top + 5.4, 22, 7, 4, 'right');
}

function drawSimplified(page, fonts, object, top) {
  rect(page, M, top, 92, Z.title);
  fitText(page, fonts.bold, 'DECLARAÇÃO SIMPLIFICADA DE CONTEÚDO', M + 1, top + 3.1, 90, 7.2, 5, 'center');
  top += Z.title;

  rect(page, M, top, 92, Z.ident, { fill: rgb(0.98, 0.98, 0.98) });
  fitText(page, fonts.bold, 'Documento operacional vinculado a esta postagem.', M + 2, top + 2.7, 88, 5.8, 4.2, 'center');
  fitText(page, fonts.bold, 'Não representa DC-e autorizada; não possui chave ou protocolo fiscal.', M + 2, top + 5.6, 88, 5.2, 3.8, 'center');
  fitText(page, fonts.regular, 'Conteúdo declarado pelo remetente para fins operacionais da postagem.', M + 2, top + 8.3, 88, 5.2, 3.8, 'center');
  top += Z.ident;

  drawPartyTable(page, fonts, object, top, null);
  top += Z.table;
  drawItems(page, fonts, object, top, null);
  top += Z.items;
  rect(page, M, top, 92, Z.legal);
  blockText(page, fonts.regular, 'Declaro, sob minha responsabilidade, que o conteúdo indicado nesta declaração corresponde ao objeto apresentado para postagem. Este documento possui finalidade operacional e não substitui documento fiscal ou DC-e quando estes forem legalmente exigidos.', M + 2, top + 2.5, 88, Z.legal - 3.5, 5.2, 3.8);
}

async function drawDace(page, pdf, fonts, object, top) {
  const d = object.dce || {};
  const issuer = d.issuer || object.sender || {};
  const items = d.items || null;

  rect(page, M, top, 92, Z.title);
  fitText(page, fonts.bold, 'DACE RESUMIDA - DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRÔNICA', M + 1, top + 3.1, 90, 6.8, 4.6, 'center');
  top += Z.title;
  rect(page, M, top, 92, Z.ident);
  fitText(page, fonts.regular, `Nº: ${String(d.number || 0).padStart(9, '0')}   SÉRIE: ${String(d.series || 0).padStart(3, '0')}`, M + 1, top + 2.8, 45, 5.6, 4);
  fitText(page, fonts.regular, `DATA EMISSÃO: ${String(d.authorizedAt || '').replace('T', ' ').slice(0, 19)}`, 51, top + 2.8, 44, 5.3, 3.8);
  fitText(page, fonts.regular, `PROTOCOLO AUTORIZAÇÃO: ${d.protocol}`, M + 1, top + 5.6, 55, 5.4, 3.8);
  fitText(page, fonts.regular, 'MODALIDADE DE TRANSPORTE: 0 - CORREIOS', M + 1, top + 8.3, 55, 5.2, 3.8);
  fitText(page, fonts.bold, `CHAVE: ${fmtKey(d.accessKey)}`, 60, top + 8.3, 35, 4.2, 3.4);
  top += Z.ident;

  drawPartyTable(page, fonts, object, top, issuer);
  top += Z.table;
  drawItems(page, fonts, object, top, items);
  top += Z.items;
  rect(page, M, top, 92, Z.legal);

  const qrUrl = String(d.qrCode || `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${digits(d.accessKey)}&tpAmb=${d.environment || '2'}`);
  const qrData = await QRCode.toDataURL(qrUrl, { margin: 0, width: 180, errorCorrectionLevel: 'M' });
  const qr = await image(pdf, qrData);
  page.drawImage(qr, { x: mm(M + 1.5), y: mm(PAGE_H - top - 14), width: mm(13), height: mm(13) });
  blockText(page, fonts.regular, OBS_LEGAL, M + 16, top + 2.1, 78, Z.legal - 3, 4.8, 3.3);
}

async function renderLabel(pdf, fonts, object, crop, postageMarkDataUrl) {
  const page = pdf.addPage([mm(PAGE_W), mm(PAGE_H)]);
  const top = await drawPostal(page, pdf, fonts, object, crop, postageMarkDataUrl);
  if (object.dce) await drawDace(page, pdf, fonts, object, top);
  else drawSimplified(page, fonts, object, top);
  return page;
}

async function buildPdf(data, onProgress) {
  if (data.senderIssues?.length) throw new Error(`Dados do remetente incompletos: ${data.senderIssues.join(' ')}`);
  const assets = await getPortalReturnAssets(data.portalReturnId);
  const postageMarkDataUrl = assets?.labelSetup?.postageMarkDataUrl;
  if (!assets?.labelSetup?.matrixRegion || !postageMarkDataUrl) throw new Error('Configure a área do Data Matrix e a chancela antes de gerar etiquetas.');

  const targetTrackingCodes = data.objects.map((object) => normalizeTracking(object.trackingCode));
  const crops = await matrixCrops(data.portalReturnId, targetTrackingCodes, (progress) => onProgress?.(`Localizando Data Matrix: ${progress.processed || 0}/${progress.totalPages || 0}`));
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  for (let index = 0; index < data.objects.length; index += 1) {
    const object = data.objects[index];
    const crop = crops.get(normalizeTracking(object.trackingCode));
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
  const data = await dataAction('production.documents.test', { campaignId, productionBatchId });
  const bytes = await buildPdf(data, onProgress);
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `etiqueta_teste_${String(data.objects[0]?.trackingCode || 'lote')}.pdf`);
  return data;
}

export async function generateProductionVolumePdf(campaignId, productionBatchId, volumeId, onProgress) {
  const data = await dataAction('production.documents.volume', { campaignId, productionBatchId, volumeId });
  const bytes = await buildPdf(data, onProgress);
  const volume = data.volume;
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `volume_${String(volume.number).padStart(2, '0')}_de_${String(volume.totalVolumes).padStart(2, '0')}_${volume.service}.pdf`);
  return data;
}
