import { env } from "./constants.mjs";

export async function callAppsScript(action, payload, user) {
  const url = env("APPS_SCRIPT_URL");
  const token = env("APPS_SCRIPT_TOKEN");
  if (!url || !token) throw new Error("Integração com Apps Script não configurada");

  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      token,
      action,
      user: { id: user.id, email: user.email || "" },
      payload,
    }),
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Resposta inválida do Apps Script: ${text.slice(0, 300)}`);
  }
  if (!response.ok || result.ok === false) throw new Error(result.error || "Falha no Apps Script");
  return result.data;
}
