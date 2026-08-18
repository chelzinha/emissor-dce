import { json, publicError, requireUser } from "./_shared/http.mjs";

export default async function handler(req) {
  if (req.method !== "GET") return json({ ok: false, error: "Método não permitido" }, 405);
  const user = await requireUser();
  if (!user) return json({ ok: false, error: "Sessão expirada" }, 401);
  try {
    const url = new URL(req.url);
    const ufs = [...new Set(String(url.searchParams.get("ufs") || "")
      .toUpperCase().split(",").map((value) => value.trim()).filter((value) => /^[A-Z]{2}$/.test(value)))];
    if (!ufs.length || ufs.length > 27) throw new Error("Informe de 1 a 27 UFs");
    const responses = await Promise.all(ufs.map(async (uf) => {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`);
      if (!response.ok) throw new Error(`IBGE indisponível para ${uf}`);
      const data = await response.json();
      return data.map((city) => ({ id: String(city.id), name: city.nome, uf }));
    }));
    return Response.json({ ok: true, data: responses.flat() }, {
      headers: { "Cache-Control": "public, max-age=3600", "Netlify-CDN-Cache-Control": "public, durable, s-maxage=86400" },
    });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 400);
  }
}

export const config = { path: "/api/municipalities", method: ["GET"] };
