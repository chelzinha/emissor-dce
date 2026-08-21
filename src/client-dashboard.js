export const CLIENT_EVENT_LABELS = Object.freeze({
  ADDRESS_LIST_RECEIVED: "Cadastros recebidos",
  ADDRESS_CLEANING_COMPLETED: "Endereços preparados",
  PORTAL_CSV_EXPORTED: "Arquivo enviado ao Portal Postal",
  PORTAL_RETURN_IMPORTED: "Etiquetas retornadas do Portal",
  LABEL_GENERATED: "Etiquetas geradas",
  LABEL_TEST_APPROVED: "Etiqueta de teste aprovada",
  LABEL_PRINTED: "Etiquetas impressas",
  LABEL_HANDOFF: "Etiquetas entregues à operação",
  DCE_PREPARED: "DC-e preparada",
  DCE_AUTHORIZED: "DC-e autorizada",
  POSTING_COMPLETED: "Postagem concluída",
  TRACKING_DELIVERED: "Objetos entregues",
  OFFLINE_SYNC_COMPLETED: "Contingência sincronizada",
});

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function emptyClientMetrics() {
  return {
    addressReceived: 0,
    addressCleaned: 0,
    portalExported: 0,
    portalReturned: 0,
    labelsPac: 0,
    labelsSedex: 0,
    labelsPrinted: 0,
    labelsHandedOff: 0,
    dcePrepared: 0,
    dceAuthorized: 0,
    posted: 0,
    delivered: 0,
  };
}

export function applyClientEvent(metrics, event) {
  const out = metrics || emptyClientMetrics();
  const type = String(event?.type || event?.TYPE || "").toUpperCase();
  const service = String(event?.service || event?.SERVICE || "").toUpperCase();
  const quantity = num(event?.quantity ?? event?.QUANTITY);
  if (type === "ADDRESS_LIST_RECEIVED") out.addressReceived += quantity;
  if (type === "ADDRESS_CLEANING_COMPLETED") out.addressCleaned += quantity;
  if (type === "PORTAL_CSV_EXPORTED") out.portalExported += quantity;
  if (type === "PORTAL_RETURN_IMPORTED") out.portalReturned += quantity;
  if (type === "LABEL_GENERATED" && service === "PAC") out.labelsPac += quantity;
  if (type === "LABEL_GENERATED" && service === "SEDEX") out.labelsSedex += quantity;
  if (type === "LABEL_PRINTED") out.labelsPrinted += quantity;
  if (type === "LABEL_HANDOFF") out.labelsHandedOff += quantity;
  if (type === "DCE_PREPARED") out.dcePrepared += quantity;
  if (type === "DCE_AUTHORIZED") out.dceAuthorized += quantity;
  if (type === "POSTING_COMPLETED") out.posted += quantity;
  if (type === "TRACKING_DELIVERED") out.delivered += quantity;
  return out;
}

export function summarizeClientEvents(events = []) {
  const metrics = emptyClientMetrics();
  for (const event of events) applyClientEvent(metrics, event);
  return {
    ...metrics,
    labelsGenerated: metrics.labelsPac + metrics.labelsSedex,
    withoutDeliveryRecord: Math.max(0, metrics.posted - metrics.delivered),
  };
}

export function normalizeClientTimeline(events = [], limit = 12) {
  return [...events]
    .sort((a, b) => String(b.occurredAt || b.OCCURRED_AT || "").localeCompare(String(a.occurredAt || a.OCCURRED_AT || "")))
    .slice(0, Math.max(1, Number(limit || 12)))
    .map((event) => {
      const type = String(event.type || event.TYPE || "").toUpperCase();
      return {
        type,
        label: CLIENT_EVENT_LABELS[type] || type || "Atualização da operação",
        service: String(event.service || event.SERVICE || "").toUpperCase(),
        quantity: num(event.quantity ?? event.QUANTITY),
        occurredAt: String(event.occurredAt || event.OCCURRED_AT || event.createdAt || event.CREATED_AT || ""),
      };
    });
}

export function buildClientDashboard(events = [], productions = []) {
  const metrics = summarizeClientEvents(events);
  const productionStatus = { total: productions.length, active: 0, completed: 0, blocked: 0 };
  for (const row of productions) {
    const status = String(row.status || row.STATUS || "").toUpperCase();
    if (["FINISHED", "POSTED", "DELIVERED", "DCE_AUTHORIZED"].includes(status)) productionStatus.completed += 1;
    else if (["BLOCKED", "REVIEW", "ERROR", "REJECTED"].includes(status)) productionStatus.blocked += 1;
    else productionStatus.active += 1;
  }
  return { metrics, productionStatus, timeline: normalizeClientTimeline(events) };
}
