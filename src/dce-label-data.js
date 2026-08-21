const TRACKING_RE = /^[A-Z]{2}\d{9}BR$/;

export function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeTracking(value) {
  return String(value ?? "").replace(/\s/g, "").toUpperCase();
}

export function normalizeDceLabelRow(source = {}) {
  const trackingCode = normalizeTracking(source.trackingCode || source.TRACKING_CODE);
  const service = String(source.service || source.SERVICE || "").trim().toUpperCase();
  const status = String(source.status || source.STATUS || "").trim().toUpperCase();
  const matrixStatus = String(source.matrixStatus || source.MATRIX_STATUS || source.matrix?.status || "MISSING").trim().toUpperCase();
  const accessKey = digits(source.accessKey || source.ACCESS_KEY);
  const protocol = String(source.protocol || source.PROTOCOL || "").trim();
  const qrCode = String(source.qrCode || source.QR_CODE || "").trim();
  const recipient = source.recipient || {};
  const issuer = source.issuer || {};
  const items = Array.isArray(source.items) ? source.items.map((item) => ({
    description: String(item.description || "").trim(),
    ncm: digits(item.ncm || ""),
    quantity: Number(item.quantity || 0),
    unitValue: Number(item.unitValue || 0),
    totalValue: Number(item.totalValue != null ? item.totalValue : Number(item.quantity || 0) * Number(item.unitValue || 0)),
  })) : [];
  const identification = source.identification || {};
  return {
    ...source,
    trackingCode,
    service,
    status,
    matrixStatus,
    matrix: { ...(source.matrix || {}), status: matrixStatus },
    accessKey,
    protocol,
    qrCode,
    recipient,
    issuer,
    items,
    identification: {
      ...identification,
      series: Number(identification.series || source.series || 0),
      number: Number(identification.number || source.number || 0),
      environment: String(identification.environment || source.environment || "2") === "1" ? "1" : "2",
      emissionDateTime: String(identification.emissionDateTime || source.emissionDateTime || ""),
    },
    authorizedAt: String(source.authorizedAt || source.AUTHORIZED_AT || ""),
    content: String(source.content || items[0]?.description || "").trim(),
    reference: String(source.reference || source.REFERENCE || "").trim(),
  };
}

export function dceLabelRowProblems(row) {
  const value = normalizeDceLabelRow(row);
  const problems = [];
  if (!TRACKING_RE.test(value.trackingCode)) problems.push("SRO_INVALIDO");
  if (!["PAC", "SEDEX"].includes(value.service)) problems.push("SERVICO_INVALIDO");
  if (!["AUTO_VERIFIED", "VERIFIED"].includes(value.matrixStatus)) problems.push("MATRIX_NAO_VERIFICADO");
  if (value.status !== "AUTHORIZED") problems.push("DCE_NAO_AUTORIZADA");
  if (!/^\d{44}$/.test(value.accessKey)) problems.push("CHAVE_DCE_INVALIDA");
  if (!value.protocol) problems.push("PROTOCOLO_DCE_AUSENTE");
  if (!/^https:\/\//i.test(value.qrCode)) problems.push("QRCODE_DCE_AUSENTE");
  if (value.qrCode && value.accessKey && !value.qrCode.includes(value.accessKey)) problems.push("QRCODE_DCE_DIVERGENTE");
  if (!value.issuer?.name || !digits(value.issuer?.cnpj)) problems.push("EMITENTE_DCE_AUSENTE");
  if (!value.recipient?.name) problems.push("DESTINATARIO_DCE_AUSENTE");
  if (!value.items.length) problems.push("ITENS_DCE_AUSENTES");
  if (value.items.some((item) => !item.description || !(item.quantity > 0) || !(item.unitValue >= 0.01))) problems.push("ITENS_DCE_INVALIDOS");
  if (!(value.identification.number > 0)) problems.push("NUMERO_DCE_AUSENTE");
  return [...new Set(problems)];
}

export function dceLabelContextReadiness(context = {}) {
  const rows = Array.isArray(context.rows) ? context.rows.map(normalizeDceLabelRow) : [];
  const perRow = rows.map((row) => ({ trackingCode: row.trackingCode, problems: dceLabelRowProblems(row) }));
  const packageStatus = String(context.package?.status || context.package?.STATUS || "").toUpperCase();
  const batchStatus = String(context.batch?.status || context.batch?.STATUS || "").toUpperCase();
  const global = [];
  if (!rows.length) global.push("LOTE_DCE_VAZIO");
  if (packageStatus !== "AUTHORIZED") global.push("PACOTE_DCE_NAO_AUTORIZADO");
  if (!["READY_FOR_LABEL_TEST", "DCE_AUTHORIZED"].includes(batchStatus)) global.push("LOTE_NAO_LIBERADO_PARA_ETIQUETA");
  const total = Number(context.package?.total || context.batch?.total || rows.length || 0);
  if (total && rows.length !== total) global.push("QUANTIDADE_DCE_DIVERGENTE");
  const rowProblems = perRow.flatMap((item) => item.problems.map((problem) => `${item.trackingCode}:${problem}`));
  return {
    ready: global.length === 0 && rowProblems.length === 0,
    global,
    perRow,
    rows,
    counts: {
      total: rows.length,
      authorized: rows.filter((row) => row.status === "AUTHORIZED").length,
      qrReady: rows.filter((row) => /^https:\/\//i.test(row.qrCode) && row.qrCode.includes(row.accessKey)).length,
      matrixVerified: rows.filter((row) => ["AUTO_VERIFIED", "VERIFIED"].includes(row.matrixStatus)).length,
    },
  };
}

export function senderFromDceIssuer(issuer = {}) {
  const address = issuer.address || {};
  const firstLine = [address.street, address.number, address.complement].filter(Boolean).join(", ");
  const cityLine = [
    [address.city, address.uf].filter(Boolean).join(" / "),
    digits(address.zip).replace(/^(\d{5})(\d{3})$/, "$1-$2"),
  ].filter(Boolean).join(" · ");
  return {
    name: String(issuer.name || "").trim(),
    document: digits(issuer.cnpj || issuer.document || ""),
    addressLine: firstLine,
    cityLine,
  };
}

export function totalDceValue(items = []) {
  return Number((items || []).reduce((sum, item) => sum + Number(item.totalValue != null ? item.totalValue : Number(item.quantity || 0) * Number(item.unitValue || 0)), 0).toFixed(2));
}
