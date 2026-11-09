// Etiqueta própria da Mala Direta Postal Básica (MDPB) 10 x 15 cm com DACE resumida.
// Modelo aprovado em 03/11/2026 (APROVACAO_CHANCELA_MDPB_AABNB.pdf):
// - chancela 25 x 35 mm no canto superior direito (Guia Técnico de Endereçamento v1.4);
// - marca Correios versão Traço Positiva com 18 mm de largura (mínimo do manual: 16 mm);
// - CEPNet de 47 barras (Guia Técnico CEPNet e Código Bidimensional, 27/04/2021);
// - "Fechamento autorizado - pode ser aberto pelos Correios" (Termo 01/08/2025, 9.1.3 e 15.9.3.2);
// - DACE resumida abaixo da linha tracejada.
// O módulo é isomórfico: roda no navegador e nos testes Node, sem depender do Portal Postal.

import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import QRCode from "qrcode";

const MM = 72 / 25.4;
const mm = (value) => value * MM;
export const LABEL_SIZE = [mm(100), mm(150)];
const A4 = [595.28, 841.89];
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GREY_BAND = rgb(0.867, 0.867, 0.867);
const MUTED = rgb(0.37, 0.42, 0.49);
const NAVY = rgb(0.043, 0.192, 0.333);
const LINE = rgb(0.84, 0.86, 0.9);
const SOFT = rgb(0.953, 0.965, 0.98);

export const MDPB_AMBITOS = ["LOCAL", "ESTADUAL", "NACIONAL"];
export const LABELS_PER_FILE = 500;
export const LABEL_FORMATS = { A4: "A4_6", THERMAL: "10x15", THERMAL_FRANKING: "10x15_SC" };
/** Formatos sem chancela: o porte sai pela máquina de franquear. */
export const FRANKING_FORMATS = [LABEL_FORMATS.A4, LABEL_FORMATS.THERMAL_FRANKING];
// A4 com 6 etiquetas (2 x 3, células de 105 x 99 mm). 600 por arquivo = 100 folhas.
export const A4_PER_SHEET = 6;
export const A4_PER_FILE = 600;
// Área útil dentro da célula: 5 mm nas laterais e 9 mm em cima e embaixo.
// Cabe na margem física de impressoras laser e dentro de folhas de 6 etiquetas
// 99,1 x 93,1 mm (padrão Avery L7166) e de folhas lisas para recorte.
export const A4_CELL = { width: 105, height: 99, insetX: 5, insetY: 9 };
export const QR_BASE_URL = "https://www.fazenda.pr.gov.br/dce/qrcode";
export const PLACEHOLDER_DOCUMENT = "NAO-INFORMADO";

// Textos legais do modelo aprovado (DACE resumida).
const LEGAL_LINES = [
  "É contribuinte de ICMS qualquer pessoa física ou jurídica que realize, com habitualidade",
  "ou em volume que caracterize intuito comercial, operações de circulação de mercadoria",
  "ou prestações de serviços de transporte interestadual e intermunicipal e de comunicação,",
  "ainda que se iniciem no exterior, conforme art. 4º da Lei Complementar nº 87/96.",
  "Constitui crime contra a ordem tributária suprimir ou reduzir tributo, ou contribuição social",
  "e qualquer acessório, conforme inciso V do art. 1º da Lei nº 8.137/90.",
];

// ===================== Dados =====================

export const digitsOnly = (value) => String(value ?? "").replace(/\D/g, "");

export function ambitoOf(service) {
  const match = String(service || "").toUpperCase().match(/^MDPB (LOCAL|ESTADUAL|NACIONAL)$/);
  return match ? match[1] : "";
}

export function formatCep(value) {
  const d = digitsOnly(value).padStart(8, "0").slice(-8);
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function formatCnpj(value) {
  const raw = digitsOnly(value);
  const d = raw.length >= 12 && raw.length < 14 ? raw.padStart(14, "0") : raw;
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : String(value || "");
}

export function formatRecipientDocument(recipient = {}) {
  const raw = String(recipient.document || "").trim();
  if (!raw || raw.toUpperCase() === PLACEHOLDER_DOCUMENT) return "NÃO INFORMADO";
  const d = digitsOnly(raw);
  if (recipient.documentType === "CPF" && d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (recipient.documentType === "CNPJ") return formatCnpj(d);
  return raw;
}

export function formatDceNumber(value) {
  return String(Number(value) || 0).padStart(9, "0").replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3");
}

export function formatAccessKey(value) {
  return digitsOnly(value).match(/.{1,4}/g)?.join(" ") || "";
}

/** Data de emissão a partir do horário de autorização (mesmo dia do dhEmi, gerado segundos antes). */
export function formatEmissionDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

export function qrCodeUrl(accessKey, environment) {
  return `${QR_BASE_URL}?chDCe=${digitsOnly(accessKey)}&tpAmb=${String(environment) === "1" ? "1" : "2"}`;
}

const upper = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

function streetLine(address = {}, withDistrict = false) {
  const base = [upper(address.street), upper(address.number) || "S/N"].filter(Boolean).join(", ");
  const parts = [base];
  if (upper(address.complement)) parts.push(upper(address.complement));
  if (withDistrict && upper(address.district)) parts.push(upper(address.district));
  return parts.join(withDistrict ? ", " : " - ");
}

/**
 * Junta lotes, documentos e linhas DC-e em etiquetas.
 * Só entra DC-e AUTORIZADA de MDPB; duplicadas pela chave são descartadas.
 * Ordenação: âmbito e CEP crescente (Termo de Condições Comerciais, 9.8.1).
 */
export function buildLabelEntries({ batches = [], documentsByBatch = {}, dceRows = [] }) {
  const rowsByKey = new Map();
  dceRows.forEach((row) => rowsByKey.set(`${row.BATCH_ID}|${row.REMITTANCE_ID}`, row));
  const seen = new Set();
  const entries = [];
  const skipped = { notAuthorized: 0, notMdpb: 0, duplicated: 0, invalidZip: 0 };
  batches.forEach((batch) => {
    (documentsByBatch[batch.ID] || []).forEach((document) => {
      const row = rowsByKey.get(`${batch.ID}|${document.reference}`) || {};
      const status = String(row.STATUS || document.status || "");
      const accessKey = digitsOnly(row.ACCESS_KEY || document.accessKey);
      if (status !== "AUTHORIZED" || accessKey.length !== 44) { skipped.notAuthorized += 1; return; }
      const ambito = ambitoOf(document.service);
      if (!ambito) { skipped.notMdpb += 1; return; }
      if (seen.has(accessKey)) { skipped.duplicated += 1; return; }
      if (digitsOnly(document.recipient?.address?.zip).length !== 8) { skipped.invalidZip += 1; return; }
      seen.add(accessKey);
      entries.push({
        ambito,
        environment: String(batch.ENVIRONMENT || document.identification?.environment || "2"),
        accessKey,
        protocol: String(row.PROTOCOL || ""),
        authorizedAt: String(row.AUTHORIZED_AT || ""),
        number: Number(row.NUMBER || document.identification?.number || 0),
        series: Number(row.SERIES ?? document.identification?.series ?? 0),
        reference: String(document.reference || ""),
        issuer: document.issuer || {},
        recipient: document.recipient || {},
      });
    });
  });
  entries.sort((a, b) => MDPB_AMBITOS.indexOf(a.ambito) - MDPB_AMBITOS.indexOf(b.ambito)
    || digitsOnly(a.recipient.address?.zip).localeCompare(digitsOnly(b.recipient.address?.zip))
    || upper(a.recipient.name).localeCompare(upper(b.recipient.name)));
  return { entries, skipped };
}

export function groupByAmbito(entries) {
  return MDPB_AMBITOS.map((ambito) => ({ ambito, entries: entries.filter((entry) => entry.ambito === ambito) }))
    .filter((group) => group.entries.length);
}

/** Divide um âmbito em arquivos de até LABELS_PER_FILE etiquetas, mantendo a ordem por CEP. */
export function splitParts(entries, size = LABELS_PER_FILE) {
  const parts = [];
  for (let index = 0; index < entries.length; index += size) parts.push({ start: index, entries: entries.slice(index, index + size) });
  return parts.map((part, index) => ({ ...part, index: index + 1, total: parts.length }));
}

// ===================== Configuração da chancela =====================

// Contratos já aprovados. A tela permite editar e lembra a última configuração por CNPJ.
export const CHANCELA_PRESETS = {
  "07260680000121": {
    contract: "9912398647", contractYear: "2016", dr: "CE", sigla: "AABNB", postingCard: "72340509",
    weightGrams: "100", senderName: "AABNB - ASSOC. DOS APOSENTADOS DO BANCO DO NORDESTE",
  },
};

export function defaultChancelaConfig(issuer = {}) {
  const preset = CHANCELA_PRESETS[digitsOnly(issuer.cnpj).padStart(14, "0")] || {};
  return {
    contract: "", contractYear: "", dr: upper(issuer.address?.uf) || "CE", sigla: "", postingCard: "",
    weightGrams: "100", senderName: upper(issuer.name), ...preset,
  };
}

export function validateChancelaConfig(config = {}) {
  const errors = [];
  if (!/^\d{6,12}$/.test(digitsOnly(config.contract))) errors.push("Número do contrato inválido.");
  if (!/^\d{4}$/.test(String(config.contractYear || ""))) errors.push("Ano do contrato deve ter 4 dígitos.");
  if (!/^[A-Z]{2,3}$/.test(upper(config.dr))) errors.push("DR deve ser a sigla (ex.: CE).");
  if (!upper(config.sigla) || upper(config.sigla).length > 14) errors.push("Sigla do cliente obrigatória (até 14 caracteres).");
  const weight = Number(config.weightGrams);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 500) errors.push("Peso unitário deve estar entre 1 e 500 g.");
  if (!upper(config.senderName)) errors.push("Nome do remetente na etiqueta obrigatório.");
  return errors;
}

export function chancelaContractLine(config) {
  return `${digitsOnly(config.contract)}/${config.contractYear} - DR/${upper(config.dr)}`;
}

// ===================== CEPNet =====================

const POSTNET = { 0: "11000", 1: "00011", 2: "00101", 3: "00110", 4: "01001", 5: "01010", 6: "01100", 7: "10001", 8: "10010", 9: "10100" };

export function cepnetCheckDigit(cep) {
  const sum = digitsOnly(cep).split("").reduce((total, d) => total + Number(d), 0);
  return (10 - (sum % 10)) % 10;
}

/** 47 barras: guarda + 9 dígitos (CEP + DV) x 5 barras + guarda. "1" = barra longa. */
export function cepnetBars(cep) {
  const d = digitsOnly(cep);
  if (d.length !== 8) throw new Error(`CEP inválido para CEPNet: ${cep}`);
  return `1${(d + cepnetCheckDigit(d)).split("").map((digit) => POSTNET[digit]).join("")}1`;
}

export const CEPNET = { pitch: 1.15, barWidth: 0.5, tall: 3.2, short: 1.3 };

function drawCepnet(page, x, y, cep) {
  cepnetBars(cep).split("").forEach((bit, index) => {
    page.drawRectangle({ x: x + mm(index * CEPNET.pitch), y, width: mm(CEPNET.barWidth), height: mm(bit === "1" ? CEPNET.tall : CEPNET.short), color: BLACK });
  });
}

// ===================== Texto seguro (WinAnsi) =====================

function makeSafe(font) {
  const cache = new Map();
  return (value) => Array.from(String(value ?? "").normalize("NFC")).map((char) => {
    if (cache.has(char)) return cache.get(char);
    let out = char;
    try { font.encodeText(char); } catch {
      const stripped = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
      try { font.encodeText(stripped); out = stripped; } catch { out = /[‐-―]/.test(char) ? "-" : /[‘’]/.test(char) ? "'" : /[“”]/.test(char) ? '"' : ""; }
    }
    cache.set(char, out);
    return out;
  }).join("");
}

function fit(font, value, size, maxWidth, minSize) {
  let current = size;
  while (current > minSize && font.widthOfTextAtSize(value, current) > maxWidth) current -= 0.25;
  if (font.widthOfTextAtSize(value, current) <= maxWidth) return { text: value, size: current, cut: false };
  let text = value;
  while (text.length > 1 && font.widthOfTextAtSize(text, current) > maxWidth) text = text.slice(0, -1);
  return { text: text.trimEnd(), size: current, cut: true };
}

function makeWriter(page, fonts, report) {
  const write = (value, x, y, { font = fonts.regular, size = 8, maxWidth = 0, minSize = size, align = "left", color = BLACK } = {}) => {
    const safe = font === fonts.bold ? fonts.safeBold : font === fonts.mono ? fonts.safeMono : fonts.safeRegular;
    let text = safe(value);
    let finalSize = size;
    if (maxWidth) {
      const fitted = fit(font, text, size, maxWidth, minSize);
      text = fitted.text; finalSize = fitted.size;
      if (fitted.cut && report) report.cut += 1;
    }
    const width = font.widthOfTextAtSize(text, finalSize);
    const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    page.drawText(text, { x: left, y, size: finalSize, font, color });
    return width;
  };
  return write;
}

async function embedFonts(pdf) {
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.CourierBold);
  return { regular, bold, mono, safeRegular: makeSafe(regular), safeBold: makeSafe(bold), safeMono: makeSafe(mono) };
}

function drawQr(page, text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const quiet = 2;
  const cell = size / (count + quiet * 2);
  for (let row = 0; row < count; row += 1) {
    let col = 0;
    while (col < count) {
      if (!qr.modules.get(row, col)) { col += 1; continue; }
      let end = col;
      while (end + 1 < count && qr.modules.get(row, end + 1)) end += 1;
      page.drawRectangle({ x: x + (quiet + col) * cell, y: y + size - (quiet + row + 1) * cell, width: (end - col + 1) * cell + 0.05, height: cell + 0.05, color: BLACK });
      col = end + 1;
    }
  }
}

// ===================== Etiqueta 10 x 15 =====================

/** Campos da DACE resumida, na ordem do modelo oficial. null = respiro entre blocos. */
export function daceRows(entry) {
  const issuer = entry.issuer || {};
  const issuerAddress = issuer.address || {};
  const dest = entry.recipient || {};
  const destAddress = dest.address || {};
  return [
    `Nº ${formatDceNumber(entry.number)}   SÉRIE ${String(entry.series).padStart(3, "0")}`,
    `DATA DE EMISSÃO: ${formatEmissionDate(entry.authorizedAt)}`,
    `PROTOCOLO DE AUTORIZAÇÃO: ${entry.protocol}`,
    "MODALIDADE DO TRANSPORTE: 0 - CORREIOS",
    null,
    `CNPJ REMETENTE (USUÁRIO EMITENTE): ${formatCnpj(issuer.cnpj)}`,
    `NOME REMETENTE: ${upper(issuer.name)}`,
    `CIDADE-UF REMETENTE: ${upper(issuerAddress.city)}-${upper(issuerAddress.uf)}`,
    `ENDEREÇO REMETENTE: ${streetLine(issuerAddress, true)}`,
    null,
    `CPF/CNPJ DESTINATÁRIO: ${formatRecipientDocument(dest)}`,
    `NOME DESTINATÁRIO: ${upper(dest.name)}`,
    `CIDADE-UF DESTINATÁRIO: ${upper(destAddress.city)}-${upper(destAddress.uf)}`,
    `ENDEREÇO DESTINATÁRIO: ${streetLine(destAddress, true)}`,
  ];
}

function drawLabel(page, fonts, logo, entry, config, report) {
  const W = mm(100);
  const H = mm(150);
  const top = H - mm(3);
  const write = makeWriter(page, fonts, report);
  const { bold, regular, mono } = fonts;
  const dest = entry.recipient || {};
  const destAddress = dest.address || {};
  const issuer = entry.issuer || {};
  const issuerAddress = issuer.address || {};

  // Fechamento autorizado (lateral esquerda)
  page.drawText(fonts.safeBold("FECHAMENTO AUTORIZADO - PODE SER ABERTO PELOS CORREIOS"), { x: mm(5), y: mm(74), size: 5.6, font: bold, color: BLACK, rotate: degrees(90) });

  // Serviço, âmbito e peso
  write("MALA DIRETA POSTAL BÁSICA", mm(9), top - mm(5), { font: bold, size: 8 });
  write(entry.ambito, mm(9), top - mm(12.5), { font: bold, size: 16 });
  write(`Peso: ${Number(config.weightGrams)} g`, mm(9), top - mm(17.5), { size: 7 });

  // Chancela 25 x 35 mm
  const cw = mm(35); const ch = mm(25); const cx = W - mm(3) - cw; const cy = top - ch; const ccx = cx + cw / 2;
  page.drawRectangle({ x: cx, y: cy, width: cw, height: ch, borderColor: BLACK, borderWidth: 1.1 });
  write("MALA DIRETA", ccx, cy + ch - mm(5), { font: bold, size: 6.4, align: "center" });
  write("POSTAL BÁSICA", ccx, cy + ch - mm(8), { font: bold, size: 6.4, align: "center" });
  write(chancelaContractLine(config), ccx, cy + ch - mm(12), { size: 5.8, align: "center", maxWidth: cw - mm(3), minSize: 4.8 });
  write(upper(config.sigla), ccx, cy + ch - mm(15.8), { font: bold, size: 7, align: "center", maxWidth: cw - mm(3), minSize: 5 });
  const lw = mm(18);
  page.drawImage(logo, { x: cx + (cw - lw) / 2, y: cy + mm(2.6), width: lw, height: lw * logo.height / logo.width });

  // Destinatário + CEPNet
  const bx = mm(8); const by = mm(87); const bw = W - mm(11); const bh = mm(31); const inner = bw - mm(5);
  page.drawRectangle({ x: bx, y: by, width: bw, height: bh, borderColor: BLACK, borderWidth: 1 });
  page.drawRectangle({ x: bx, y: by + bh - mm(5), width: mm(30), height: mm(5), color: BLACK });
  write("DESTINATÁRIO", bx + mm(2), by + bh - mm(3.7), { font: bold, size: 8, color: WHITE });
  write(upper(dest.name), bx + mm(2.5), by + bh - mm(9.8), { font: bold, size: 10, maxWidth: inner, minSize: 7 });
  write(streetLine(destAddress), bx + mm(2.5), by + bh - mm(14.2), { size: 9.5, maxWidth: inner, minSize: 6.8 });
  write(upper(destAddress.district), bx + mm(2.5), by + bh - mm(18.4), { size: 9.5, maxWidth: inner, minSize: 6.8 });
  write(formatCep(destAddress.zip), bx + mm(2.5), by + bh - mm(23.2), { font: bold, size: 10.5 });
  write(`${upper(destAddress.city)} / ${upper(destAddress.uf)}`, bx + mm(26), by + bh - mm(23.2), { size: 9.5, maxWidth: bw - mm(28), minSize: 6.8 });
  drawCepnet(page, bx + mm(2.5), by + mm(1.8), destAddress.zip);

  // Remetente
  const ry = by - mm(3.6);
  const senderWidth = W - mm(20);
  write("REMETENTE", mm(8), ry, { font: bold, size: 6.2 });
  write(upper(config.senderName || issuer.name), mm(8), ry - mm(2.8), { size: 6.2, maxWidth: senderWidth, minSize: 5 });
  write([streetLine(issuerAddress), upper(issuerAddress.district)].filter(Boolean).join(" - "), mm(8), ry - mm(5.6), { size: 6.2, maxWidth: senderWidth, minSize: 5 });
  write(`${formatCep(issuerAddress.zip)}  ${upper(issuerAddress.city)} / ${upper(issuerAddress.uf)}`, mm(8), ry - mm(8.4), { size: 6.2, maxWidth: senderWidth, minSize: 5 });

  // Linha tracejada
  const sep = mm(72.5);
  page.drawLine({ start: { x: mm(3), y: sep }, end: { x: W - mm(3), y: sep }, thickness: 0.6, color: BLACK, dashArray: [3, 2] });

  // DACE resumida
  page.drawRectangle({ x: mm(3), y: sep - mm(5.2), width: W - mm(6), height: mm(4.2), color: GREY_BAND });
  write("DACE RESUMIDA - DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRÔNICA", W / 2, sep - mm(4), { font: bold, size: 6.6, align: "center" });
  const rows = daceRows(entry);
  let y = sep - mm(8);
  rows.forEach((row) => {
    if (row === null) { y -= mm(1.2); return; }
    write(row, W / 2, y, { size: 5.8, align: "center", maxWidth: W - mm(8), minSize: 4.6 });
    y -= mm(2.75);
  });
  const qs = mm(17); const qy = mm(10.6);
  drawQr(page, qrCodeUrl(entry.accessKey, entry.environment), mm(4), qy, qs);
  LEGAL_LINES.forEach((line, index) => write(line, mm(23), qy + qs - mm(2.6) - index * mm(2.4), { size: 4.3 }));
  write("Chave de Acesso DC-e", W / 2, mm(7.6), { font: bold, size: 5.8, align: "center" });
  write(formatAccessKey(entry.accessKey), W / 2, mm(4.6), { font: mono, size: 6.6, align: "center" });

  if (entry.environment !== "1") {
    page.drawText("HOMOLOGAÇÃO - SEM VALOR FISCAL", { x: mm(14), y: mm(30), size: 15, font: bold, color: rgb(0.9, 0.3, 0.24), opacity: 0.35, rotate: degrees(56) });
  }
}

/** Gera o PDF de etiquetas 10 x 15 (uma por página). */
export async function createLabelsPdf(entries, config, logoPngBytes) {
  const errors = validateChancelaConfig(config);
  if (errors.length) throw new Error(errors.join(" "));
  if (!entries?.length) throw new Error("Nenhuma etiqueta para gerar.");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Etiquetas MDPB ${entries[0].ambito}`);
  pdf.setAuthor("DC-e Fácil - AGF José Bonifácio");
  const fonts = await embedFonts(pdf);
  const logo = await pdf.embedPng(logoPngBytes);
  const report = { cut: 0 };
  entries.forEach((entry) => drawLabel(pdf.addPage(LABEL_SIZE), fonts, logo, entry, config, report));
  const bytes = await pdf.save({ useObjectStreams: true });
  return { bytes, report };
}


// ===================== A4 com 6 etiquetas (máquina de franquear) =====================

function wrapText(font, text, size, maxWidth) {
  const lines = [];
  let line = "";
  text.split(/\s+/).forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(test, size) > maxWidth) { lines.push(line); line = word; } else line = test;
  });
  if (line) lines.push(line);
  return lines;
}

const LEGAL_TEXT = LEGAL_LINES.join(" ");

/** Uma etiqueta: destinatário em cima, DACE resumida embaixo. (x0, y0) = canto inferior esquerdo da área útil. */
function drawA4Label(page, fonts, entry, x0, y0, report) {
  const cw = mm(A4_CELL.width - 2 * A4_CELL.insetX);
  const ch = mm(A4_CELL.height - 2 * A4_CELL.insetY);
  const T = y0 + ch;
  const R = x0 + cw;
  const write = makeWriter(page, fonts, report);
  const { bold, regular, mono } = fonts;
  const dest = entry.recipient || {};
  const destAddress = dest.address || {};

  // Rótulo do destinatário. Serviço e "fechamento autorizado" saem na impressão da máquina de franquear.
  page.drawRectangle({ x: x0, y: T - mm(4.4), width: mm(26), height: mm(4.4), color: BLACK });
  write("DESTINATÁRIO", x0 + mm(2), T - mm(3.2), { font: bold, size: 7.6, color: WHITE });

  // Destinatário
  const box = { top: T - mm(4.4), bottom: T - mm(31) };
  page.drawRectangle({ x: x0, y: box.bottom, width: cw, height: box.top - box.bottom, borderColor: BLACK, borderWidth: 0.9 });
  const inner = cw - mm(5);
  write(upper(dest.name), x0 + mm(2.5), box.top - mm(5.2), { font: bold, size: 10, maxWidth: inner, minSize: 7 });
  write(streetLine(destAddress), x0 + mm(2.5), box.top - mm(9.4), { size: 9, maxWidth: inner, minSize: 6.6 });
  write(upper(destAddress.district), x0 + mm(2.5), box.top - mm(13.4), { size: 9, maxWidth: inner, minSize: 6.6 });
  write(formatCep(destAddress.zip), x0 + mm(2.5), box.top - mm(18.2), { font: bold, size: 10.5 });
  write(`${upper(destAddress.city)} / ${upper(destAddress.uf)}`, x0 + mm(26), box.top - mm(18.2), { size: 9, maxWidth: cw - mm(28), minSize: 6.6 });
  drawCepnet(page, x0 + mm(2.5), box.bottom + mm(1.8), destAddress.zip);

  // Linha tracejada + DACE resumida
  const sep = box.bottom - mm(1.8);
  page.drawLine({ start: { x: x0, y: sep }, end: { x: R, y: sep }, thickness: 0.5, color: BLACK, dashArray: [3, 2] });
  const band = sep - mm(1.3);
  page.drawRectangle({ x: x0, y: band - mm(3.8), width: cw, height: mm(3.8), color: GREY_BAND });
  write("DACE RESUMIDA - DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRÔNICA", x0 + cw / 2, band - mm(2.75), { font: bold, size: 6, align: "center", maxWidth: cw - mm(2), minSize: 5 });

  const qs = mm(20);
  const qTop = band - mm(4.6);
  drawQr(page, qrCodeUrl(entry.accessKey, entry.environment), R - qs, qTop - qs, qs);
  const textWidth = cw - qs - mm(1.5);
  let y = band - mm(6.6);
  daceRows(entry).forEach((row) => {
    if (row === null) { y -= mm(0.8); return; }
    write(row, x0, y, { size: 5.5, maxWidth: textWidth, minSize: 4.3 });
    y -= mm(2.42);
  });

  // Avisos legais em largura total + chave de acesso
  const legalSize = 3.9;
  const legal = wrapText(regular, fonts.safeRegular(LEGAL_TEXT), legalSize, cw);
  let ly = y - mm(0.5);
  legal.forEach((line) => { page.drawText(line, { x: x0, y: ly, size: legalSize, font: regular, color: BLACK }); ly -= mm(1.55); });
  const keyLabel = "CHAVE DE ACESSO DC-e";
  const keyText = formatAccessKey(entry.accessKey);
  let keySize = 6.2;
  while (keySize > 5 && bold.widthOfTextAtSize(keyLabel, keySize - 0.9) + mm(2) + mono.widthOfTextAtSize(keyText, keySize) > cw) keySize -= 0.1;
  const labelWidth = bold.widthOfTextAtSize(keyLabel, keySize - 0.9);
  const keyWidth = mono.widthOfTextAtSize(keyText, keySize);
  const start = x0 + (cw - labelWidth - mm(2) - keyWidth) / 2;
  write(keyLabel, start, y0 + mm(0.6), { font: bold, size: keySize - 0.9 });
  write(keyText, start + labelWidth + mm(2), y0 + mm(0.6), { font: mono, size: keySize });

  if (entry.environment !== "1") {
    page.drawText("HOMOLOGAÇÃO - SEM VALOR FISCAL", { x: x0 + mm(10), y: y0 + mm(8), size: 13, font: bold, color: rgb(0.9, 0.3, 0.24), opacity: 0.35, rotate: degrees(38) });
  }
  return { bottomOfText: ly };
}

/** Posição da etiqueta i (0 a 5) na folha: 2 colunas x 3 linhas, de cima para baixo. */
export function a4Slot(index) {
  const col = index % 2;
  const row = Math.floor(index / 2);
  const x = mm(col * A4_CELL.width + A4_CELL.insetX);
  const y = A4[1] - mm((row + 1) * A4_CELL.height - A4_CELL.insetY);
  return { x, y, col, row };
}

function drawCutGuides(page) {
  const guide = { thickness: 0.3, color: rgb(0.78, 0.8, 0.84), dashArray: [2, 3] };
  page.drawLine({ start: { x: mm(A4_CELL.width), y: mm(4) }, end: { x: mm(A4_CELL.width), y: A4[1] - mm(4) }, ...guide });
  [1, 2].forEach((row) => page.drawLine({ start: { x: mm(4), y: A4[1] - mm(row * A4_CELL.height) }, end: { x: A4[0] - mm(4), y: A4[1] - mm(row * A4_CELL.height) }, ...guide }));
}

/** Gera o PDF A4 com 6 etiquetas por folha (destinatário + DACE resumida), sem chancela. */
export async function createA4LabelsPdf(entries, { cutGuides = true } = {}) {
  if (!entries?.length) throw new Error("Nenhuma etiqueta para gerar.");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Etiquetas A4 MDPB ${entries[0].ambito}`);
  pdf.setAuthor("DC-e Fácil - AGF José Bonifácio");
  const fonts = await embedFonts(pdf);
  const report = { cut: 0, overflow: 0 };
  let page = null;
  entries.forEach((entry, index) => {
    const slot = index % A4_PER_SHEET;
    if (slot === 0) { page = pdf.addPage(A4); if (cutGuides) drawCutGuides(page); }
    const { x, y } = a4Slot(slot);
    const { bottomOfText } = drawA4Label(page, fonts, entry, x, y, report);
    if (bottomOfText < y + mm(2.2)) report.overflow += 1;
  });
  const bytes = await pdf.save({ useObjectStreams: true });
  return { bytes, report, sheets: Math.ceil(entries.length / A4_PER_SHEET) };
}


// ===================== 10 x 15 sem chancela (máquina de franquear) =====================

/** Etiqueta térmica 100 x 150 mm: destinatário em cima, DACE resumida embaixo. Mesmo conteúdo da A4, sem chancela. */
function drawThermalFrankingLabel(page, fonts, entry, report) {
  const W = mm(100);
  const H = mm(150);
  const x0 = mm(3);
  const cw = W - mm(6);
  const R = x0 + cw;
  const T = H - mm(3);
  const write = makeWriter(page, fonts, report);
  const { bold, regular, mono } = fonts;
  const dest = entry.recipient || {};
  const destAddress = dest.address || {};

  // Destinatário + CEPNet
  page.drawRectangle({ x: x0, y: T - mm(5), width: mm(30), height: mm(5), color: BLACK });
  write("DESTINATÁRIO", x0 + mm(2), T - mm(3.6), { font: bold, size: 8.5, color: WHITE });
  const box = { top: T - mm(5), bottom: T - mm(40) };
  page.drawRectangle({ x: x0, y: box.bottom, width: cw, height: box.top - box.bottom, borderColor: BLACK, borderWidth: 1 });
  const inner = cw - mm(6);
  write(upper(dest.name), x0 + mm(3), box.top - mm(6.4), { font: bold, size: 11.5, maxWidth: inner, minSize: 8 });
  write(streetLine(destAddress), x0 + mm(3), box.top - mm(11.8), { size: 10.5, maxWidth: inner, minSize: 7.5 });
  write(upper(destAddress.district), x0 + mm(3), box.top - mm(16.8), { size: 10.5, maxWidth: inner, minSize: 7.5 });
  write(formatCep(destAddress.zip), x0 + mm(3), box.top - mm(23), { font: bold, size: 12.5 });
  write(`${upper(destAddress.city)} / ${upper(destAddress.uf)}`, x0 + mm(30), box.top - mm(23), { size: 10.5, maxWidth: cw - mm(33), minSize: 7.5 });
  drawCepnet(page, x0 + mm(3), box.bottom + mm(2.5), destAddress.zip);

  // Linha tracejada + faixa da DACE resumida
  const sep = box.bottom - mm(3);
  page.drawLine({ start: { x: x0, y: sep }, end: { x: R, y: sep }, thickness: 0.6, color: BLACK, dashArray: [3, 2] });
  const band = sep - mm(2);
  page.drawRectangle({ x: x0, y: band - mm(4.6), width: cw, height: mm(4.6), color: GREY_BAND });
  write("DACE RESUMIDA - DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRÔNICA", x0 + cw / 2, band - mm(3.2), { font: bold, size: 7, align: "center", maxWidth: cw - mm(2), minSize: 5.5 });

  // Campos da DACE em largura total
  let y = band - mm(8.2);
  daceRows(entry).forEach((row) => {
    if (row === null) { y -= mm(1.4); return; }
    write(row, x0 + cw / 2, y, { size: 6.6, align: "center", maxWidth: cw, minSize: 5 });
    y -= mm(3.15);
  });

  // QR Code + avisos legais ao lado
  const qs = mm(25);
  const qTop = y - mm(0.5);
  drawQr(page, qrCodeUrl(entry.accessKey, entry.environment), x0, qTop - qs, qs);
  const legalX = x0 + qs + mm(2.5);
  const legalWidth = R - legalX;
  const legalSize = 5;
  const legal = wrapText(regular, fonts.safeRegular(LEGAL_TEXT), legalSize, legalWidth);
  let ly = qTop - mm(3);
  legal.forEach((line) => { page.drawText(line, { x: legalX, y: ly, size: legalSize, font: regular, color: BLACK }); ly -= mm(2.05); });

  // Chave de acesso
  write("CHAVE DE ACESSO DC-e", W / 2, mm(9.2), { font: bold, size: 7, align: "center" });
  write(formatAccessKey(entry.accessKey), W / 2, mm(4.8), { font: mono, size: 8.4, align: "center", maxWidth: cw, minSize: 6.5 });

  if (entry.environment !== "1") {
    page.drawText("HOMOLOGAÇÃO - SEM VALOR FISCAL", { x: mm(14), y: mm(30), size: 15, font: bold, color: rgb(0.9, 0.3, 0.24), opacity: 0.35, rotate: degrees(56) });
  }
  return { bottomOfText: Math.min(ly, qTop - qs) };
}

/** Gera o PDF de etiquetas 10 x 15 sem chancela (uma por página). */
export async function createThermalFrankingLabelsPdf(entries) {
  if (!entries?.length) throw new Error("Nenhuma etiqueta para gerar.");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Etiquetas 10x15 MDPB ${entries[0].ambito}`);
  pdf.setAuthor("DC-e Fácil - AGF José Bonifácio");
  const fonts = await embedFonts(pdf);
  const report = { cut: 0, overflow: 0 };
  entries.forEach((entry) => {
    const { bottomOfText } = drawThermalFrankingLabel(pdf.addPage(LABEL_SIZE), fonts, entry, report);
    if (bottomOfText < mm(12)) report.overflow += 1;
  });
  const bytes = await pdf.save({ useObjectStreams: true });
  return { bytes, report };
}

// ===================== Lista de postagem (A4) =====================

/** Linhas por folha; a última folha sempre guarda espaço para total e assinaturas. */
export function postingListPlan(total, firstRows, nextRows, closingRows) {
  const plan = [];
  let left = total;
  while (left > 0 || !plan.length) {
    const capacity = plan.length ? nextRows : firstRows;
    if (left <= capacity - closingRows) { plan.push(left); left = 0; break; }
    // Não cabe total + assinaturas: deixa ao menos uma linha para a folha seguinte.
    const take = left <= capacity ? left - 1 : capacity;
    plan.push(take); left -= take;
  }
  return plan;
}

/** Lista de postagem por âmbito, na mesma ordem das etiquetas (CEP crescente). */
export async function createPostingListPdf(entries, config, { generatedAt = new Date() } = {}) {
  const weightOk = Number(config?.weightGrams) > 0 && Number(config?.weightGrams) <= 500;
  if (!weightOk) throw new Error("Peso unitário deve estar entre 1 e 500 g.");
  const franking = FRANKING_FORMATS.includes(config.format);
  if (!entries?.length) throw new Error("Nenhum objeto para listar.");
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);
  const { bold, regular } = fonts;
  const ambito = entries[0].ambito;
  const issuer = entries[0].issuer || {};
  pdf.setTitle(`Lista de postagem MDPB ${ambito}`);
  const date = generatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const weight = Number(config.weightGrams);
  const totalKg = (weight * entries.length / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const L = 36; const R = A4[0] - 36; const rowH = 13.2;
  const cols = [{ x: L + 4, w: 34, label: "SEQ" }, { x: L + 40, w: 190, label: "DESTINATÁRIO" }, { x: L + 234, w: 52, label: "CEP" }, { x: L + 288, w: 100, label: "CIDADE / UF" }, { x: L + 392, w: 131, label: "Nº DC-e  ·  FINAL DA CHAVE" }];
  const firstRows = 49; const nextRows = 55; const closingRows = 7;
  const plan = postingListPlan(entries.length, firstRows, nextRows, closingRows);
  const pageCount = plan.length;
  let cursor = 0;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = pdf.addPage(A4);
    const write = makeWriter(page, fonts, null);
    let y = A4[1] - 40;
    write("Lista de postagem - Mala Direta Postal Básica", L, y, { font: bold, size: 13, color: NAVY });
    write(`${ambito}  ·  folha ${pageIndex + 1} de ${pageCount}`, R, y, { font: bold, size: 10, align: "right", color: NAVY });
    y -= 8;
    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1, color: NAVY });
    y -= 14;
    if (pageIndex === 0) {
      const info = [
        ["Cliente", `${upper(issuer.name)}  ·  CNPJ ${formatCnpj(issuer.cnpj)}`],
        ...(digitsOnly(config.contract) ? [["Contrato", `${digitsOnly(config.contract)}/${config.contractYear}  ·  DR/${upper(config.dr)}${config.postingCard ? `  ·  Cartão de postagem ${digitsOnly(config.postingCard)}` : ""}`]] : []),
        ["Serviço", `Mala Direta Postal Básica ${franking ? "com franqueamento por máquina de franquear" : "com chancela"}  ·  âmbito ${ambito}`],
        ["Quantidade", `${entries.length.toLocaleString("pt-BR")} objetos  ·  ${weight} g cada  ·  peso total ${totalKg} kg`],
        ["Data", date],
      ];
      info.forEach(([key, value], index) => {
        if (index % 2 === 0) page.drawRectangle({ x: L, y: y - 4, width: R - L, height: 13, color: SOFT });
        write(key, L + 4, y, { font: bold, size: 8, color: MUTED });
        write(value, L + 76, y, { size: 8.4, maxWidth: R - L - 80, minSize: 6.5 });
        y -= 13;
      });
      y -= 8;
    }
    page.drawRectangle({ x: L, y: y - 4, width: R - L, height: 14, color: NAVY });
    cols.forEach((col) => write(col.label, col.x, y, { font: bold, size: 7, color: WHITE }));
    y -= rowH;
    const limit = plan[pageIndex];
    for (let count = 0; count < limit && cursor < entries.length; count += 1, cursor += 1) {
      const entry = entries[cursor];
      const address = entry.recipient.address || {};
      if (count % 2 === 1) page.drawRectangle({ x: L, y: y - 4, width: R - L, height: rowH, color: SOFT });
      write(String(cursor + 1).padStart(4, "0"), cols[0].x, y, { size: 7.4 });
      write(upper(entry.recipient.name), cols[1].x, y, { size: 7.4, maxWidth: cols[1].w, minSize: 6 });
      write(formatCep(address.zip), cols[2].x, y, { size: 7.4 });
      write(`${upper(address.city)} / ${upper(address.uf)}`, cols[3].x, y, { size: 7.4, maxWidth: cols[3].w, minSize: 6 });
      write(`${formatDceNumber(entry.number)}  ·  ...${entry.accessKey.slice(-8)}`, cols[4].x, y, { size: 7.4, maxWidth: cols[4].w, minSize: 6 });
      y -= rowH;
    }
    if (limit) page.drawLine({ start: { x: L, y: y + rowH - 4 }, end: { x: R, y: y + rowH - 4 }, thickness: 0.6, color: LINE });
    if (pageIndex === pageCount - 1) {
      y -= 10;
      write(`Total do âmbito ${ambito}: ${entries.length.toLocaleString("pt-BR")} objetos  ·  ${totalKg} kg`, L, y, { font: bold, size: 9 });
      const sy = y - 52;
      [[L, "Cliente (remetente) - nome e assinatura"], [L + (R - L) / 2 + 10, "Correios - recebido por, matrícula e data"]].forEach(([x, label]) => {
        page.drawLine({ start: { x, y: sy }, end: { x: x + (R - L) / 2 - 10, y: sy }, thickness: 0.6, color: BLACK });
        write(label, x, sy - 10, { size: 7.4, color: MUTED });
      });
    }
    write(`Gerado pelo DC-e Fácil em ${date}  ·  ordem por CEP crescente, igual à das etiquetas`, L, 22, { size: 6.8, color: MUTED });
  }
  return pdf.save({ useObjectStreams: true });
}

// ===================== Conferência (CSV) =====================

export function conferenceCsv(entries) {
  const header = ["SEQ_AMBITO", "AMBITO", "NOME", "CEP", "CIDADE", "UF", "NUMERO_DCE", "SERIE", "CHAVE_ACESSO", "PROTOCOLO", "REFERENCIA"];
  const counters = {};
  const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = entries.map((entry) => {
    counters[entry.ambito] = (counters[entry.ambito] || 0) + 1;
    const address = entry.recipient.address || {};
    return [counters[entry.ambito], entry.ambito, upper(entry.recipient.name), formatCep(address.zip), upper(address.city), upper(address.uf), entry.number, entry.series, entry.accessKey, entry.protocol, entry.reference].map(cell).join(";");
  });
  return `﻿${[header.join(";"), ...lines].join("\r\n")}`;
}
