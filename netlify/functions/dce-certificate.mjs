import { readPkcs12 } from "./_shared/certificate.mjs";
import { json, parseJson, publicError, requireUser } from "./_shared/http.mjs";

export default async function handler(req) {
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);
  const user = await requireUser();
  if (!user) return json({ ok: false, error: "Sessão expirada" }, 401);
  try {
    const body = await parseJson(req);
    const certificate = readPkcs12(body.certificateBase64, body.passphrase);
    return json({
      ok: true,
      data: {
        commonName: certificate.commonName,
        cnpj: certificate.cnpj,
        validFrom: certificate.validFrom,
        validTo: certificate.validTo,
      },
    });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 422);
  }
}

export const config = { path: "/api/dce/certificate", method: ["POST"] };
