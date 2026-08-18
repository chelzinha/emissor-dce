import { callAppsScript } from "./_shared/apps-script.mjs";
import { json, parseJson, publicError, requireUser } from "./_shared/http.mjs";

export default async function handler(req) {
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);
  const user = await requireUser();
  if (!user) return json({ ok: false, error: "Sessão expirada" }, 401);
  try {
    const body = await parseJson(req);
    if (!/^[a-z][a-z0-9_.-]{1,60}$/i.test(body.action || "")) throw new Error("Ação inválida");
    const data = await callAppsScript(body.action, body.payload || {}, user);
    return json({ ok: true, data });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 400);
  }
}

export const config = { path: "/api/data", method: ["POST"] };
