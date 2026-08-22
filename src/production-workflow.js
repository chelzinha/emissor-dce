import { buildUnifiedLabelModel, DOCUMENT_MODES, isMatrixVerified, normalizeServiceFamily } from "./label-production.js";
import { validateUnifiedLabelForTest } from "./unified-label-layout.js";

export const LABEL_TEST_EVENT = "LABEL_TEST_APPROVED";

export function normalizeProductionObject(row) {
  const matrixStatus = String(row?.matrixStatus || row?.matrix?.status || "MISSING").toUpperCase();
  return {
    ...row,
    trackingCode: String(row?.trackingCode || "").replace(/\s/g, "").toUpperCase(),
    service: normalizeServiceFamily(row?.service),
    matrix: { ...(row?.matrix || {}), status: matrixStatus },
  };
}

export function selectTestRows(rows) {
  const normalized = (rows || []).map(normalizeProductionObject);
  const tests = [];
  for (const service of ["SEDEX", "PAC"]) {
    const row = normalized.find((item) => item.service === service);
    if (row) tests.push(row);
  }
  if (!tests.length && normalized[0]) tests.push(normalized[0]);
  return tests;
}

export function attachVerifiedCrop(row, crops) {
  const normalized = normalizeProductionObject(row);
  const dataUrl = crops?.get?.(normalized.trackingCode) || "";
  return {
    ...normalized,
    matrix: {
      ...normalized.matrix,
      dataUrl,
      image: dataUrl,
    },
  };
}

export function buildProductionModels(rows, crops, options = {}) {
  const documentMode = options.documentMode;
  const sender = options.sender || {};
  const format = options.format || "10x15";
  if (![DOCUMENT_MODES.SIMPLIFIED, DOCUMENT_MODES.DCE].includes(documentMode)) {
    throw new Error("Modalidade documental invalida.");
  }
  return (rows || []).map((row) => {
    const withCrop = attachVerifiedCrop(row, crops);
    if (!isMatrixVerified(withCrop.matrix.status)) throw new Error(`Data Matrix nao verificado: ${withCrop.trackingCode}`);
    if (!withCrop.matrix.dataUrl) throw new Error(`Imagem do Data Matrix ausente: ${withCrop.trackingCode}`);
    return buildUnifiedLabelModel(withCrop, {
      format,
      documentMode,
      sender,
      defaultContent: options.defaultContent,
    });
  });
}

export function validateTestModels(models, options = {}) {
  const problems = [];
  (models || []).forEach((model) => {
    const result = validateUnifiedLabelForTest(model, {
      allowSimplified: options.allowSimplified === true,
    });
    result.problems.forEach((problem) => problems.push({ trackingCode: model.trackingCode, problem }));
  });
  return { ready: models?.length > 0 && problems.length === 0, problems };
}

export function buildTestApprovalEvent({ campaignId, productionBatchId, model, note = "" }) {
  if (!campaignId || !productionBatchId || !model?.trackingCode) throw new Error("Dados da aprovacao da etiqueta teste incompletos.");
  const service = normalizeServiceFamily(model.service?.family || model.service);
  return {
    campaignId,
    type: LABEL_TEST_EVENT,
    sourceType: "PRODUCTION_BATCH",
    sourceId: productionBatchId,
    service,
    quantity: 1,
    idempotencyKey: `label-test-approved:${productionBatchId}:${service}:${model.trackingCode}`,
    metadata: {
      trackingCode: model.trackingCode,
      format: model.format,
      documentMode: model.declaration?.mode || "",
      scanValidated: true,
      note: String(note || "").slice(0, 500),
    },
  };
}

export function approvalStateFromOperations(operations, productionBatchId, testModels) {
  const expected = (testModels || []).map((model) => ({
    service: normalizeServiceFamily(model.service?.family || model.service),
    trackingCode: String(model.trackingCode || "").toUpperCase(),
  }));
  const events = (operations || []).filter((event) => event.type === LABEL_TEST_EVENT && event.sourceId === productionBatchId);
  const approvals = expected.map((item) => {
    const event = events.find((candidate) => {
      const metadataSro = String(candidate.metadata?.trackingCode || "").toUpperCase();
      return candidate.service === item.service && metadataSro === item.trackingCode && candidate.metadata?.scanValidated === true;
    });
    return { ...item, approved: Boolean(event), event: event || null };
  });
  return {
    approvals,
    ready: approvals.length > 0 && approvals.every((item) => item.approved),
  };
}

export function batchGenerationGate({ rows, crops, documentMode, sender, testModels, operations, productionBatchId, allowSimplified = false }) {
  const problems = [];
  const normalizedRows = (rows || []).map(normalizeProductionObject);
  if (!normalizedRows.length) problems.push("LOTE_SEM_OBJETOS");
  const matrixBlocked = normalizedRows.filter((row) => !isMatrixVerified(row.matrix.status));
  if (matrixBlocked.length) problems.push("MATRIX_NAO_VERIFICADO_100_PERCENT");
  const cropMissing = normalizedRows.filter((row) => !crops?.get?.(row.trackingCode));
  if (cropMissing.length) problems.push("RECORTE_MATRIX_AUSENTE");
  if (!sender?.name) problems.push("REMETENTE_AUSENTE");
  if (documentMode === DOCUMENT_MODES.SIMPLIFIED && !allowSimplified) problems.push("CONFIRMACAO_DECLARACAO_SIMPLIFICADA_PENDENTE");
  let dcePending = [];
  let qrPending = [];
  if (documentMode === DOCUMENT_MODES.DCE) {
    dcePending = normalizedRows.filter((row) => !/^\d{44}$/.test(String(row.accessKey || "")) || !String(row.protocol || ""));
    if (dcePending.length) problems.push("DCE_NAO_AUTORIZADA_100_PERCENT");
    qrPending = normalizedRows.filter((row) => !/^https:\/\//i.test(String(row.qrCode || "")) || !String(row.qrCode || "").includes(String(row.accessKey || "")));
    if (qrPending.length) problems.push("DCE_QRCODE_NAO_VALIDADO_100_PERCENT");
  }
  const approval = approvalStateFromOperations(operations, productionBatchId, testModels);
  if (!approval.ready) problems.push("ETIQUETA_TESTE_NAO_APROVADA");
  return {
    ready: problems.length === 0,
    problems: [...new Set(problems)],
    counts: {
      total: normalizedRows.length,
      matrixBlocked: matrixBlocked.length,
      cropMissing: cropMissing.length,
      testsExpected: testModels?.length || 0,
      testsApproved: approval.approvals.filter((item) => item.approved).length,
      dcePending: dcePending.length,
      qrPending: qrPending.length,
    },
    approval,
  };
}
