import { createDacePdf } from "./_shared/dace.mjs";
import { parseJson, publicError, requireUser } from "./_shared/http.mjs";

export default async function handler(req) {
  if (req.method !== "POST") return Response.json({ ok: false, error: "Método não permitido" }, { status: 405 });
  const user = await requireUser();
  if (!user) return Response.json({ ok: false, error: "Sessão expirada" }, { status: 401 });
  try {
    const body = await parseJson(req);
    const bytes = await createDacePdf(body.entries);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=daces.pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: publicError(error) }, { status: 400 });
  }
}

export const config = { path: "/api/dce/dace", method: ["POST"] };
