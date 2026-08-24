import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { downloadBlob } from './api.js';

const MM = 72 / 25.4;
const mm = (value) => value * MM;
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(.93, .93, .93);
const MID = rgb(.38, .38, .38);

function fmt(value) { return new Intl.NumberFormat('pt-BR').format(Number(value || 0)); }
function brDate(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}
function short(value) { return String(value || '').slice(0, 8); }
function safe(value) { return String(value ?? ''); }
function text(page, font, value, x, y, size = 9, options = {}) {
  const content = safe(value);
  let current = size;
  const maxWidth = options.maxWidth ? mm(options.maxWidth) : 0;
  while (maxWidth && current > 5 && font.widthOfTextAtSize(content, current) > maxWidth) current -= .3;
  page.drawText(content, { x: mm(x), y: mm(y), size: current, font, color: options.color || BLACK });
}
function rightText(page, font, value, rightMm, y, size = 9) {
  const content = safe(value);
  const width = font.widthOfTextAtSize(content, size);
  page.drawText(content, { x: mm(rightMm) - width, y: mm(y), size, font, color: BLACK });
}
function line(page, x1, y1, x2, y2, thickness = .5) {
  page.drawLine({ start: { x: mm(x1), y: mm(y1) }, end: { x: mm(x2), y: mm(y2) }, thickness, color: MID });
}

export async function generateInternalDeliveryVolumeLabels(plan, operation) {
  if (!plan?.date || !plan?.volumes?.length) throw new Error('Vincule os lotes e a data da entrega antes de gerar as etiquetas de volume.');
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const total = Number(plan.totalVolumes || plan.volumes.length);

  plan.volumes.forEach((volume) => {
    const page = pdf.addPage([mm(100), mm(150)]);
    page.drawRectangle({ x: mm(4), y: mm(129), width: mm(92), height: mm(14), color: BLACK });
    const header = 'CONTROLE INTERNO DE VOLUME';
    const hw = bold.widthOfTextAtSize(header, 11);
    page.drawText(header, { x: (mm(100) - hw) / 2, y: mm(134), font: bold, size: 11, color: rgb(1, 1, 1) });
    text(page, bold, safe(operation?.name || 'AGF OPERAÇÕES POSTAIS').toUpperCase(), 9, 119, 10, { maxWidth: 82 });
    text(page, regular, `Entrega à operação: ${brDate(plan.date)}`, 9, 113, 8, { maxWidth: 82 });
    const volumeTitle = `VOLUME ${volume.sequence}/${total}`;
    const titleWidth = bold.widthOfTextAtSize(volumeTitle, 24);
    page.drawText(volumeTitle, { x: (mm(100) - titleWidth) / 2, y: mm(96), font: bold, size: 24, color: BLACK });
    page.drawRectangle({ x: mm(12), y: mm(80), width: mm(76), height: mm(13), color: GRAY, borderColor: GRAY, borderWidth: .5 });
    const service = safe(volume.service || '').toUpperCase();
    const sw = bold.widthOfTextAtSize(service, 18);
    page.drawText(service, { x: (mm(100) - sw) / 2, y: mm(84), font: bold, size: 18, color: BLACK });
    text(page, regular, 'ETIQUETAS NESTE VOLUME', 10, 70, 8);
    rightText(page, bold, fmt(volume.quantity), 90, 68.5, 20);
    line(page, 10, 61, 90, 61, .6);
    text(page, bold, 'PRIMEIRO SRO', 10, 52, 7.5);
    rightText(page, regular, volume.firstTracking || '—', 90, 51.5, 12);
    text(page, bold, 'ÚLTIMO SRO', 10, 40, 7.5);
    rightText(page, regular, volume.lastTracking || '—', 90, 39.5, 12);
    text(page, bold, 'LOTE DE PRODUÇÃO', 10, 31, 7.5);
    rightText(page, regular, short(volume.batchId), 90, 30.5, 10);
    text(page, bold, 'DATA DA ENTREGA', 10, 25, 7.5);
    rightText(page, regular, brDate(plan.date), 90, 24.5, 10);
    page.drawRectangle({ x: mm(4), y: mm(4), width: mm(92), height: mm(13), color: GRAY });
    text(page, bold, 'USO INTERNO - NÃO SUBSTITUI O PROTOCOLO DE POSTAGEM', 8, 11.5, 7.2, { maxWidth: 84 });
    text(page, regular, 'Numeração definida pela entrega à operação selecionada.', 8, 7, 6.5, { maxWidth: 84 });
  });

  pdf.setTitle(`Etiquetas de volumes - entrega ${brDate(plan.date)}`);
  const bytes = await pdf.save();
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `etiquetas_volumes_entrega_${plan.date}.pdf`);
}

function manifestHeader(page, fonts, plan, operation, pageNumber) {
  text(page, fonts.bold, 'CONTROLE INTERNO DE ENTREGA DE VOLUMES', 12, 281, 16, { maxWidth: 186 });
  text(page, fonts.regular, 'Documento interno - não é protocolo postal', 12, 274, 8);
  line(page, 12, 267, 198, 267, .8);
  text(page, fonts.bold, 'OPERAÇÃO', 12, 258, 8);
  text(page, fonts.regular, operation?.name || '—', 42, 258, 9, { maxWidth: 90 });
  text(page, fonts.bold, 'DATA', 144, 258, 8);
  rightText(page, fonts.regular, brDate(plan.date), 198, 258, 9);
  text(page, fonts.bold, 'TOTAL', 12, 249, 8);
  text(page, fonts.regular, `${fmt(plan.totalObjects)} etiquetas / ${fmt(plan.totalVolumes)} volumes`, 42, 249, 9, { maxWidth: 90 });
  text(page, fonts.bold, 'ENTREGA', 144, 249, 8);
  rightText(page, fonts.regular, short(plan.id), 198, 249, 9);
  text(page, fonts.regular, `Página ${pageNumber}`, 177, 281, 7);
}

function manifestTableHeader(page, fonts, y) {
  page.drawRectangle({ x: mm(12), y: mm(y - 6), width: mm(186), height: mm(8), color: BLACK });
  const cols = [[14, 'VOLUME'], [39, 'SERVIÇO'], [70, 'ETIQUETAS'], [105, 'PRIMEIRO SRO'], [155, 'ÚLTIMO SRO']];
  cols.forEach(([x, label]) => text(page, fonts.bold, label, x, y - 3.4, 7, { color: rgb(1,1,1) }));
}

export async function generateInternalDeliveryManifest(plan, operation) {
  if (!plan?.date || !plan?.volumes?.length) throw new Error('Vincule os lotes e a data da entrega antes de gerar o controle.');
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const rowsPerPage = 28;
  let pageNumber = 0;
  for (let offset = 0; offset < plan.volumes.length; offset += rowsPerPage) {
    pageNumber += 1;
    const page = pdf.addPage([mm(210), mm(297)]);
    manifestHeader(page, fonts, plan, operation, pageNumber);
    manifestTableHeader(page, fonts, 234);
    let y = 221;
    plan.volumes.slice(offset, offset + rowsPerPage).forEach((volume, index) => {
      if (index % 2 === 0) page.drawRectangle({ x: mm(12), y: mm(y - 3.5), width: mm(186), height: mm(7.5), color: GRAY });
      text(page, fonts.regular, `${volume.sequence}/${plan.totalVolumes}`, 14, y, 8);
      text(page, fonts.regular, volume.service || '—', 39, y, 8);
      text(page, fonts.regular, fmt(volume.quantity), 70, y, 8);
      text(page, fonts.regular, volume.firstTracking || '—', 105, y, 8);
      text(page, fonts.regular, volume.lastTracking || '—', 155, y, 8);
      y -= 8;
    });
    if (offset + rowsPerPage >= plan.volumes.length) {
      const base = Math.max(40, y - 10);
      text(page, fonts.bold, 'CONFIRMAÇÃO DE ENTREGA FÍSICA', 12, base, 9);
      text(page, fonts.regular, 'Recebido por:', 12, base - 12, 8); line(page, 36, base - 12, 115, base - 12, .4);
      text(page, fonts.regular, 'Hora:', 151, base - 12, 8); line(page, 164, base - 12, 198, base - 12, .4);
      text(page, fonts.regular, 'Responsável pela entrega:', 12, base - 24, 8); line(page, 55, base - 24, 125, base - 24, .4);
      text(page, fonts.regular, 'Data:', 151, base - 24, 8); line(page, 164, base - 24, 198, base - 24, .4);
      text(page, fonts.bold, 'REGRA OPERACIONAL', 12, base - 40, 7.5);
      text(page, fonts.regular, 'A geração do PDF não confirma impressão nem postagem.', 15, base - 48, 7.2);
      text(page, fonts.regular, 'A numeração dos volumes pertence exclusivamente a esta entrega à operação.', 15, base - 55, 7.2);
      text(page, fonts.regular, 'Este controle não substitui o Protocolo de Postagem à Vista.', 15, base - 62, 7.2);
    }
  }
  pdf.setTitle(`Controle interno de entrega - ${brDate(plan.date)}`);
  const bytes = await pdf.save();
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `controle_entrega_interna_${plan.date}.pdf`);
}
