import { callOperationsAppsScript } from "./_shared/operations-apps-script.mjs";
import { env } from "./_shared/constants.mjs";
import { json, parseJson, publicError } from "./_shared/http.mjs";

const MIGRATION_USER = Object.freeze({
  id: "b1b4bfe1-766b-41ab-80d8-fd5082f10b7b",
  email: "chelzinha@gmail.com",
});

export default async function handler(req) {
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const expected = env("HISTORICAL_IMPORT_TOKEN");
  const provided = req.headers.get("x-historical-import-token") || "";
  if (!expected || provided !== expected) return json({ ok: false, error: "Acesso não autorizado" }, 401);

  try {
    const body = await parseJson(req);
    if (body.action !== "append") throw new Error("Ação de migração inválida");

    const campaignId = String(body.campaignId || "");
    const portalReturnId = String(body.portalReturnId || "");
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!campaignId || !portalReturnId) throw new Error("Operação e retorno são obrigatórios");
    if (!rows.length || rows.length > 200) throw new Error("O bloco deve conter de 1 a 200 objetos");

    const data = await callOperationsAppsScript(
      "portalReturn.append",
      { campaignId, portalReturnId, rows },
      MIGRATION_USER,
    );
    return json({ ok: true, data });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 400);
  }
}

export const config = { path: "/api/historical-import", method: ["POST"] };
