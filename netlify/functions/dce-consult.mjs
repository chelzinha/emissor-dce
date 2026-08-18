import { environmentConfig } from "./_shared/constants.mjs";
import { readPkcs12 } from "./_shared/certificate.mjs";
import { json, parseJson, publicError, requireUser } from "./_shared/http.mjs";
import { buildConsultationXml } from "./_shared/services.mjs";
import { buildSoapEnvelope, parseServiceResponse, postSoap } from "./_shared/soap.mjs";

export default async function handler(req) {
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);
  const user = await requireUser();
  if (!user) return json({ ok: false, error: "Sessão expirada" }, 401);
  try {
    const body = await parseJson(req);
    const config = environmentConfig(body.environment);
    const certificate = readPkcs12(body.certificateBase64, body.passphrase);
    const xml = buildConsultationXml(config.tpAmb, body.accessKey);
    const soap = await postSoap({
      url: config.consultationUrl,
      action: config.consultationSoapAction,
      body: buildSoapEnvelope(xml, config.consultationNamespace),
      certificate,
    });
    return json({ ok: true, data: parseServiceResponse(soap.body) });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 400);
  }
}

export const config = { path: "/api/dce/consult", method: ["POST"] };
