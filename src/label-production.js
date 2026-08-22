export const LABEL_FORMATS = Object.freeze({
  "10x15": Object.freeze({
    widthMm: 100,
    heightMm: 150,
    marginMm: 4,
    trackingBarcode: Object.freeze({ widthMm: 80, heightMm: 11.5 }),
    zipBarcode: Object.freeze({ widthMm: 19.7, heightMm: 13, xMm: 62 }),
    postageMark: Object.freeze({ widthMm: 31, heightMm: 18 }),
    dataMatrix: Object.freeze({ widthMm: 25, heightMm: 25 }),
    routingSymbol: Object.freeze({ widthMm: 15, heightMm: 17 }),
    zones: Object.freeze({
      top: 23,
      tracking: 20,
      receiver: 8.5,
      recipient: 23,
      sender: 12,
      separator: 2.5,
      declarationTitle: 4.2,
      declarationId: 9.5,
      declarationParties: 13,
      declarationItems: 6,
      declarationLegal: 19.5,
    }),
  }),
  "10x20": Object.freeze({
    widthMm: 100,
    heightMm: 200,
    marginMm: 4,
    trackingBarcode: Object.freeze({ widthMm: 80, heightMm: 15 }),
    zipBarcode: Object.freeze({ widthMm: 40, heightMm: 15, xMm: 48 }),
    postageMark: Object.freeze({ widthMm: 31, heightMm: 20 }),
    dataMatrix: Object.freeze({ widthMm: 25, heightMm: 25 }),
    routingSymbol: Object.freeze({ widthMm: 18, heightMm: 20 }),
    zones: Object.freeze({
      top: 27,
      tracking: 25,
      receiver: 11,
      recipient: 30,
      sender: 16,
      separator: 3,
      declarationTitle: 5,
      declarationId: 13,
      declarationParties: 18,
      declarationItems: 8,
      declarationLegal: 19,
    }),
  }),
});

export const DOCUMENT_MODES = Object.freeze({
  SIMPLIFIED: "SIMPLIFIED_DECLARATION",
  DCE: "DCE_AUTHORIZED",
});

export const SERVICE_PRESENTATION = Object.freeze({
  PAC: Object.freeze({ routingClass: "STANDARD", stripeFallback: "IMP" }),
  SEDEX: Object.freeze({ routingClass: "EXPRESSA", stripeFallback: "SIM" }),
});

export const PRODUCTION_STAGES = Object.freeze([
  "PORTAL_RETURN_RECEIVED",
  "MATRIX_AUDITED",
  "DOCUMENT_MODE_SELECTED",
  "DOCUMENT_READY",
  "TEST_LABEL_APPROVED",
  "BATCH_PRINTED",
  "VOLUMES_PREPARED",
  "HANDOFF_COMPLETED",
]);

export function normalizeServiceFamily(service) {
  const value = String(service || "").trim().toUpperCase();
  if (value.startsWith("SEDEX")) return "SEDEX";
  if (value.startsWith("PAC") || value.startsWith("MINI")) return "PAC";
  return value;
}

export function servicePresentation(service, observedStripe = "") {
  const family = normalizeServiceFamily(service);
  const fallback = SERVICE_PRESENTATION[family] || { routingClass: "", stripeFallback: "" };
  return {
    family,
    routingClass: fallback.routingClass,
    stripe: String(observedStripe || "").trim().toUpperCase() || fallback.stripeFallback,
  };
}

export function formatTrackingCode(value) {
  const code = String(value || "").replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code)) return code;
  return `${code.slice(0, 2)} ${code.slice(2, 5)} ${code.slice(5, 8)} ${code.slice(8, 11)} ${code.slice(11)}`;
}

export function formatZip(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : String(value || "").trim();
}

export function formatDocument(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return String(value || "").trim().toUpperCase();
}

export function declarationDescriptor(documentMode, document = {}) {
  if (documentMode === DOCUMENT_MODES.SIMPLIFIED) {
    return {
      mode: documentMode,
      title: "DECLARACAO SIMPLIFICADA DE CONTEUDO",
      authorized: false,
      accessKey: "",
      protocol: "",
      qrEligible: false,
    };
  }
  if (documentMode === DOCUMENT_MODES.DCE) {
    const accessKey = String(document.accessKey || "").replace(/\D/g, "");
    const protocol = String(document.protocol || "").replace(/\D/g, "");
    return {
      mode: documentMode,
      title: "DACE - DECLARACAO AUXILIAR DE CONTEUDO ELETRONICA",
      authorized: accessKey.length === 44 && Boolean(protocol),
      accessKey,
      protocol,
      qrEligible: accessKey.length === 44,
    };
  }
  throw new Error("Modalidade documental invalida");
}

export function productionReadiness({ row, documentMode, matrixRequired = true, testLabelApproved = false }) {
  const problems = [];
  const trackingCode = String(row?.trackingCode || "").replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode)) problems.push("SRO_INVALIDO");
  const family = normalizeServiceFamily(row?.service);
  if (!["PAC", "SEDEX"].includes(family)) problems.push("SERVICO_INVALIDO");
  const matrixStatus = String(row?.matrix?.status || "MISSING");
  if (matrixRequired && ["MISSING", "DIVERGENT"].includes(matrixStatus)) problems.push("MATRIX_NAO_VALIDADO");
  if (!documentMode) problems.push("MODALIDADE_DOCUMENTAL_NAO_SELECIONADA");
  else if (documentMode === DOCUMENT_MODES.DCE) {
    const descriptor = declarationDescriptor(documentMode, row || {});
    if (!descriptor.authorized) problems.push("DCE_NAO_AUTORIZADA");
  }
  if (!testLabelApproved) problems.push("ETIQUETA_TESTE_NAO_APROVADA");
  return { ready: problems.length === 0, problems };
}

export function productionSummary(rows, documentMode) {
  const summary = {
    total: rows.length,
    pac: 0,
    sedex: 0,
    matrixVerified: 0,
    matrixPending: 0,
    documentsReady: 0,
    documentMode,
  };
  rows.forEach((row) => {
    const family = normalizeServiceFamily(row.service);
    if (family === "PAC") summary.pac += 1;
    if (family === "SEDEX") summary.sedex += 1;
    if (["AUTO_VERIFIED", "VERIFIED"].includes(String(row.matrix?.status || ""))) summary.matrixVerified += 1;
    else summary.matrixPending += 1;
    if (documentMode === DOCUMENT_MODES.SIMPLIFIED) summary.documentsReady += 1;
    if (documentMode === DOCUMENT_MODES.DCE && declarationDescriptor(documentMode, row).authorized) summary.documentsReady += 1;
  });
  return summary;
}

export function buildUnifiedLabelModel(row, options = {}) {
  const format = LABEL_FORMATS[options.format || "10x15"];
  if (!format) throw new Error("Formato de etiqueta invalido");
  const documentMode = options.documentMode;
  const declaration = declarationDescriptor(documentMode, row);
  const presentation = servicePresentation(row.service, row.matrix?.stripe || row.stripe);
  return {
    format: options.format || "10x15",
    dimensions: { widthMm: format.widthMm, heightMm: format.heightMm },
    service: presentation,
    trackingCode: String(row.trackingCode || "").toUpperCase(),
    trackingCodeFormatted: formatTrackingCode(row.trackingCode),
    dataMatrixImage: row.matrix?.image || row.matrix?.dataUrl || "",
    dataMatrixStatus: row.matrix?.status || "MISSING",
    recipient: {
      name: String(row.recipient?.name || "").trim(),
      document: formatDocument(row.recipient?.document),
      street: String(row.recipient?.address?.street || "").trim(),
      number: String(row.recipient?.address?.number || "").trim() || "S/N",
      complement: String(row.recipient?.address?.complement || "").trim(),
      district: String(row.recipient?.address?.district || "").trim(),
      city: String(row.recipient?.address?.city || "").trim(),
      uf: String(row.recipient?.address?.uf || "").trim().toUpperCase(),
      zip: formatZip(row.recipient?.address?.zip),
    },
    sender: {
      name: String(options.sender?.name || "").trim(),
      document: formatDocument(options.sender?.document),
      addressLine: String(options.sender?.addressLine || "").trim(),
      cityLine: String(options.sender?.cityLine || "").trim(),
    },
    content: String(row.content || options.defaultContent || "").trim(),
    declaration,
    postalReference: String(row.reference || "").trim(),
    formatSpec: format,
  };
}
