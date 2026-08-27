import { callOperationsAppsScript } from "./_shared/operations-apps-script.mjs";
import { env } from "./_shared/constants.mjs";
import { json, parseJson, publicError } from "./_shared/http.mjs";

const MIGRATION_USER = Object.freeze({
  id: "b1b4bfe1-766b-41ab-80d8-fd5082f10b7b",
  email: "chelzinha@gmail.com",
});

const ALLOWED_ACTIONS = new Set([
  "system.health",
  "campaign.get",
  "campaign.upsert",
  "addressList.start",
  "addressList.append",
  "addressList.finish",
  "addressLists.list",
  "portalReturn.start",
  "portalReturn.append",
  "portalReturn.finish",
  "portalReturns.list",
  "postalObjects.list",
  "production.prepare",
  "production.list",
  "production.matrix.confirm",
  "production.labelTest.data",
  "production.labelTest.approve",
  "production.print.confirm",
  "production.handoff.confirm",
  "production.posting.confirm",
  "production.posting.list",
  "volumes.list",
  "tracking.updates.append",
  "tracking.summary",
  "tracking.events.list",
  "operation.record",
  "operations.list",
  "dashboard.daily",
]);

function normalizeRequest(body) {
  if (body.action === "append") {
    return {
      action: "portalReturn.append",
      payload: {
        campaignId: String(body.campaignId || ""),
        portalReturnId: String(body.portalReturnId || ""),
        rows: Array.isArray(body.rows) ? body.rows : [],
      },
    };
  }
  return {
    action: String(body.action || ""),
    payload: body.payload && typeof body.payload === "object" ? body.payload : {},
  };
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const expected = env("HISTORICAL_IMPORT_TOKEN");
  const provided = req.headers.get("x-historical-import-token") || "";
  if (!expected || provided !== expected) return json({ ok: false, error: "Acesso não autorizado" }, 401);

  try {
    const body = await parseJson(req);
    const request = normalizeRequest(body);
    if (!ALLOWED_ACTIONS.has(request.action)) throw new Error("Ação de migração inválida");

    const data = await callOperationsAppsScript(request.action, request.payload, MIGRATION_USER);
    return json({ ok: true, data });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 400);
  }
}

export const config = { path: "/api/historical-import", method: ["POST"] };
