import { admin, login, verifyRequestOrigin } from "@netlify/identity";
import { json } from "./_shared/http.mjs";
import { findIdentityUserByUsername, normalizePortalUsername } from "./_shared/portal-username.mjs";

function invalidCredentials() {
  return json({ ok: false, error: "Usuario ou senha invalidos." }, 401);
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ ok: false, error: "Metodo nao permitido" }, 405);

  try {
    verifyRequestOrigin(req);
    const body = await req.json();
    const username = normalizePortalUsername(body?.username);
    const password = String(body?.password || "");
    if (!/^[a-z0-9._-]{3,64}$/.test(username) || password.length < 1 || password.length > 1024) {
      return invalidCredentials();
    }

    const users = await admin.listUsers();
    const user = findIdentityUserByUsername(users, username);
    if (!user?.email) return invalidCredentials();

    await login(user.email, password);
    return json({ ok: true, data: { authenticated: true } });
  } catch {
    return invalidCredentials();
  }
}

export const config = { path: "/api/portal/login", method: ["POST"] };
