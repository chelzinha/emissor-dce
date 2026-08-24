import { getUser } from "@netlify/identity";
import { env } from "./constants.mjs";

export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

export async function parseJson(req, maxBytes = 6_000_000) {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("Requisição maior que o limite permitido");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new Error("Requisição maior que o limite permitido");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error("Corpo JSON inválido");
  }
}

export async function requireUser() {
  const user = await getUser();
  if (user) return user;
  // O bypass so existe fora de producao. Antes bastava a variavel de ambiente,
  // o que deixava um admin sem senha a um deploy de distancia.
  const isProduction = env("CONTEXT", "") === "production"
    || env("NODE_ENV", "") === "production";
  if (!isProduction && env("DCE_ALLOW_DEV_AUTH", "false") === "true") {
    return { id: "local-development", email: "dev@localhost", app_metadata: { roles: ["admin"] } };
  }
  return null;
}

export function publicError(error, fallback = "Não foi possível concluir a operação") {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/[\r\n]+/g, " ").slice(0, 800);
}
