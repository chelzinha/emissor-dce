import { json, parseJson, publicError, requireUser } from "./_shared/http.mjs";
import { normalizeDceDocument } from "./_shared/validation.mjs";
import { buildUnsignedDce } from "./_shared/xml.mjs";

export default async function handler(req) {
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);
  const user = await requireUser();
  if (!user) return json({ ok: false, error: "Sessão expirada" }, 401);
  try {
    const body = await parseJson(req);
    const result = normalizeDceDocument(body.document);
    if (!result.valid) return json({ ok: false, errors: result.errors }, 422);
    const built = buildUnsignedDce(result.document, { numericCode: body.numericCode });
    return json({
      ok: true,
      data: {
        accessKey: built.accessKey,
        total: built.total,
        normalized: result.document,
        unsignedXml: body.includeXml ? built.xml : undefined,
      },
    });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 400);
  }
}

export const config = { path: "/api/dce/validate", method: ["POST"] };
