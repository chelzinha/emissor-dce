import { DOCUMENT_MODES, LABEL_FORMATS, isMatrixVerified } from "./label-production.js";

export const LABEL_LAYOUT_VERSION = "2026.08.20-local.1";

export const TEXT_GRID = Object.freeze({
  top: Object.freeze({ pp: 5.0, payment: 10.0, service: 15.0, routing: 22.0 }),
  tracking: Object.freeze({ text: 6.0, barcode: 7.5 }),
  receiver: Object.freeze({ line1: 4.0, line2: 8.0 }),
  recipient: Object.freeze({ document: 3.4, name: 9.8, street: 14.0, district: 17.8, zip: 21.9, barcode: 5.4 }),
  sender: Object.freeze({ label: 3.0, name: 6.3, address: 9.0, city: 11.5 }),
  declaration: Object.freeze({ title: 3.0, meta1: 3.2, meta2: 6.2, meta3: 8.9 }),
});

export const DEFAULT_SIMPLIFIED_STATEMENT = "Declaracao simplificada vinculada ao objeto postal. Nao representa DC-e autorizada.";

function rect(x, y, width, height) {
  return Object.freeze({ xMm: x, yMm: y, widthMm: width, heightMm: height, bottomMm: y + height });
}

function nonEmpty(value) {
  return String(value || "").trim();
}

export function buildZoneMap(formatName = "10x15") {
  const format = LABEL_FORMATS[formatName];
  if (!format) throw new Error("Formato de etiqueta invalido");
  const x = format.marginMm;
  const width = format.widthMm - format.marginMm * 2;
  let y = format.marginMm;
  const zoneMap = {};
  const ordered = [
    ["top", format.zones.top],
    ["tracking", format.zones.tracking],
    ["receiver", format.zones.receiver],
    ["recipient", format.zones.recipient],
    ["sender", format.zones.sender],
    ["separator", format.zones.separator],
    ["declarationTitle", format.zones.declarationTitle],
    ["declarationMeta", format.zones.declarationId],
    ["declarationParties", format.zones.declarationParties],
    ["declarationItems", format.zones.declarationItems],
    ["declarationLegal", format.zones.declarationLegal],
  ];
  for (const [name, height] of ordered) {
    zoneMap[name] = rect(x, y, width, height);
    y += height;
  }
  return Object.freeze({
    formatName,
    widthMm: format.widthMm,
    heightMm: format.heightMm,
    marginMm: format.marginMm,
    contentWidthMm: width,
    bottomMm: y,
    zones: Object.freeze(zoneMap),
  });
}

export function buildUnifiedLabelLayout(model, options = {}) {
  if (!model || !model.formatSpec) throw new Error("Modelo de etiqueta ausente");
  const formatName = model.format || options.format || "10x15";
  const zoneMap = buildZoneMap(formatName);
  const format = model.formatSpec;
  const contentX = format.marginMm;
  const contentWidth = format.widthMm - format.marginMm * 2;
  const top = zoneMap.zones.top;
  const symbolX = format.widthMm - format.marginMm - format.routingSymbol.widthMm;
  const matrixX = symbolX - 2 - format.dataMatrix.widthMm;
  const textX = contentX + format.postageMark.widthMm + 2;
  const textWidth = Math.max(0, matrixX - textX - 2);
  const zipBarcodeX = contentX + (format.zipBarcode.xMm ?? contentWidth - format.zipBarcode.widthMm - 2);
  const recipientTextWidth = Math.max(0, zipBarcodeX - contentX - 4);

  const simplified = model.declaration?.mode === DOCUMENT_MODES.SIMPLIFIED;
  const dce = model.declaration?.mode === DOCUMENT_MODES.DCE;
  if (!simplified && !dce) throw new Error("Modalidade documental invalida");

  return Object.freeze({
    version: LABEL_LAYOUT_VERSION,
    formatName,
    page: Object.freeze({ widthMm: format.widthMm, heightMm: format.heightMm, marginMm: format.marginMm }),
    zoneMap,
    postal: Object.freeze({
      postageMark: rect(contentX, top.yMm, format.postageMark.widthMm, format.postageMark.heightMm),
      headerText: rect(textX, top.yMm, textWidth, top.heightMm),
      dataMatrix: rect(matrixX, top.yMm, format.dataMatrix.widthMm, format.dataMatrix.heightMm),
      routingSymbol: rect(symbolX, top.yMm + 1, format.routingSymbol.widthMm, format.routingSymbol.heightMm),
      trackingBarcode: rect(contentX + (contentWidth - format.trackingBarcode.widthMm) / 2, zoneMap.zones.tracking.yMm + TEXT_GRID.tracking.barcode, format.trackingBarcode.widthMm, format.trackingBarcode.heightMm),
      zipBarcode: rect(zipBarcodeX, zoneMap.zones.recipient.yMm + TEXT_GRID.recipient.barcode, format.zipBarcode.widthMm, format.zipBarcode.heightMm),
      recipientText: rect(contentX + 2, zoneMap.zones.recipient.yMm + 4.8, recipientTextWidth, zoneMap.zones.recipient.heightMm - 5.5),
      senderStripe: rect(contentX + contentWidth - 8, zoneMap.zones.sender.yMm, 8, zoneMap.zones.sender.heightMm),
    }),
    declaration: Object.freeze({
      kind: simplified ? "SIMPLIFIED" : "DCE",
      title: nonEmpty(model.declaration.title),
      statement: simplified ? nonEmpty(options.simplifiedStatement || DEFAULT_SIMPLIFIED_STATEMENT) : "",
      titleBox: zoneMap.zones.declarationTitle,
      metaBox: zoneMap.zones.declarationMeta,
      partiesBox: zoneMap.zones.declarationParties,
      itemsBox: zoneMap.zones.declarationItems,
      legalBox: zoneMap.zones.declarationLegal,
      showDceAuthorization: dce,
      showQrCode: dce && Boolean(model.declaration.qrEligible),
    }),
    requirements: Object.freeze({
      originalDataMatrix: true,
      matrixStatus: model.dataMatrixStatus,
      matrixVerified: isMatrixVerified(model.dataMatrixStatus),
      testLabelBeforeBatch: true,
    }),
  });
}

export function validateUnifiedLabelForTest(model, options = {}) {
  const problems = [];
  if (!model) return { ready: false, problems: ["MODELO_AUSENTE"] };
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(nonEmpty(model.trackingCode).replace(/\s/g, "").toUpperCase())) problems.push("SRO_INVALIDO");
  if (!isMatrixVerified(model.dataMatrixStatus)) problems.push("MATRIX_NAO_VALIDADO");
  if (!nonEmpty(model.dataMatrixImage)) problems.push("IMAGEM_MATRIX_AUSENTE");
  if (!nonEmpty(model.recipient?.name)) problems.push("DESTINATARIO_AUSENTE");
  if (!nonEmpty(model.recipient?.street)) problems.push("ENDERECO_AUSENTE");
  if (!nonEmpty(model.recipient?.zip)) problems.push("CEP_AUSENTE");
  if (!nonEmpty(model.sender?.name)) problems.push("REMETENTE_AUSENTE");
  if (!nonEmpty(model.content)) problems.push("CONTEUDO_AUSENTE");
  if (model.declaration?.mode === DOCUMENT_MODES.DCE && !model.declaration.authorized) problems.push("DCE_NAO_AUTORIZADA");
  if (model.declaration?.mode === DOCUMENT_MODES.DCE && model.declaration.authorized && !model.declaration.qrEligible) problems.push("DCE_QRCODE_NAO_VALIDADO");
  if (model.declaration?.mode === DOCUMENT_MODES.DCE && !(model.items?.length > 0)) problems.push("DCE_ITENS_AUSENTES");
  if (model.declaration?.mode === DOCUMENT_MODES.SIMPLIFIED && options.allowSimplified !== true) problems.push("CONFIRMACAO_DECLARACAO_SIMPLIFICADA_PENDENTE");
  return { ready: problems.length === 0, problems };
}

export function validateZoneGeometry(formatName = "10x15") {
  const layout = buildZoneMap(formatName);
  const maxBottom = layout.heightMm - layout.marginMm;
  const problems = [];
  if (layout.bottomMm > maxBottom + 0.001) problems.push("ZONAS_EXCEDEM_PAGINA");
  const entries = Object.entries(layout.zones);
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1][1];
    const current = entries[index][1];
    if (Math.abs(previous.bottomMm - current.yMm) > 0.001) problems.push(`GAP_${entries[index - 1][0]}_${entries[index][0]}`);
  }
  return { valid: problems.length === 0, problems, bottomMm: layout.bottomMm, maxBottomMm: maxBottom };
}
