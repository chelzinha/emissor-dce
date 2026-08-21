const MM_TO_PT = 72 / 25.4;
const mm = (value) => Number(value || 0) * MM_TO_PT;

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function crop(value, max = 100) { const text = clean(value); return text.length > max ? `${text.slice(0, max - 1)}...` : text; }
function formatNumber(value) { return new Intl.NumberFormat("pt-BR").format(Number(value || 0)); }

async function barcodeDataUrl(text) {
  if (!globalThis.document) return "";
  const module = await import("bwip-js");
  const bwipjs = module.default || module;
  const canvas = document.createElement("canvas");
  bwipjs.toCanvas(canvas, {
    bcid: "code128",
    text: String(text || ""),
    scale: 3,
    height: 12,
    includetext: false,
    padding: 0,
    backgroundcolor: "FFFFFF",
  });
  return canvas.toDataURL("image/png");
}

function dataUrlBytes(dataUrl) {
  const [, payload = ""] = String(dataUrl || "").split(",", 2);
  const binary = globalThis.atob ? atob(payload) : Buffer.from(payload, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function drawText(page, font, text, xMm, yMm, size, options = {}) {
  const value = crop(text, options.maxChars || 140);
  if (!value) return;
  page.drawText(value, { x: mm(xMm), y: mm(yMm), size, font, ...options.pdf });
}

function drawCentered(page, font, text, centerXmm, yMm, size) {
  const value = clean(text);
  if (!value) return;
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: mm(centerXmm) - width / 2, y: mm(yMm), size, font });
}

function statusText(status) {
  const value = clean(status).toUpperCase();
  if (["HANDED_OFF", "DELIVERED", "RECEIVED"].includes(value)) return "ENTREGUE A OPERACAO";
  return "PREPARADO";
}

export async function generateVolumeLabelsPdf(models, options = {}) {
  if (!models?.length) throw new Error("Nenhum volume para gerar etiqueta.");
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const model of models) {
    const page = pdfDoc.addPage([mm(100), mm(150)]);
    const service = clean(model.service).toUpperCase();
    const serviceIsSedex = service === "SEDEX";
    page.drawRectangle({ x: 0, y: mm(132), width: mm(100), height: mm(18), color: serviceIsSedex ? rgb(0.93, 0.95, 0.99) : rgb(0.96, 0.97, 0.93) });
    drawText(page, bold, "AGF OPERACOES POSTAIS", 6, 141, 7.2);
    drawText(page, regular, crop(model.operationName || "Operacao postal em lote", 50), 6, 135.8, 6.2);
    drawText(page, bold, service, 75, 139.3, 13, { maxChars: 15 });

    drawCentered(page, bold, `VOLUME ${model.number}/${model.totalVolumes}`, 50, 119.5, 20);
    drawCentered(page, bold, `${formatNumber(model.quantity)} ETIQUETAS`, 50, 110.7, 12);
    drawCentered(page, regular, statusText(model.status), 50, 104.8, 6.5);

    page.drawRectangle({ x: mm(6), y: mm(73), width: mm(88), height: mm(25), borderWidth: 0.8 });
    drawText(page, bold, "REFERENCIA DO VOLUME", 9, 92, 6.2);
    drawCentered(page, bold, model.reference, 50, 82.5, 13);

    const barcode = await barcodeDataUrl(model.reference);
    if (barcode) {
      const image = await pdfDoc.embedPng(dataUrlBytes(barcode));
      page.drawImage(image, { x: mm(12), y: mm(61), width: mm(76), height: mm(10) });
    }

    page.drawLine({ start: { x: mm(6), y: mm(55) }, end: { x: mm(94), y: mm(55) }, thickness: 0.6 });
    drawText(page, bold, "CONTEUDO DESTE VOLUME", 6, 50.5, 7);
    drawText(page, regular, `Primeiro SRO: ${model.firstTrackingCode || "-"}`, 6, 44.5, 6.4);
    drawText(page, regular, `Ultimo SRO: ${model.lastTrackingCode || "-"}`, 6, 39.5, 6.4);
    drawText(page, regular, `Total conferido: ${formatNumber(model.trackingCodes?.length || model.quantity)}`, 6, 34.5, 6.4);
    drawText(page, regular, `Lote: ${crop(model.productionBatchId, 50)}`, 6, 29.5, 5.8);
    if (model.documentMode) drawText(page, regular, `Documento: ${model.documentMode}`, 6, 24.8, 5.5);

    page.drawRectangle({ x: mm(6), y: mm(7), width: mm(88), height: mm(12), borderWidth: 0.7 });
    drawCentered(page, bold, "NAO MISTURAR PAC E SEDEX NO MESMO VOLUME", 50, 14.1, 6.1);
    drawCentered(page, regular, "A conferencia analitica segue as listas postais do lote.", 50, 9.7, 4.8);
  }
  return new Blob([await pdfDoc.save()], { type: "application/pdf" });
}
