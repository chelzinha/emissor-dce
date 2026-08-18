import { environmentConfig } from "./_shared/constants.mjs";
import { assertCertificateMatchesIssuer, readPkcs12 } from "./_shared/certificate.mjs";
import { json, parseJson, publicError, requireUser } from "./_shared/http.mjs";
import { buildCancellationXml } from "./_shared/services.mjs";
import { signEventXml } from "./_shared/signature.mjs";
import { buildSoapEnvelope, parseServiceResponse, postSoap } from "./_shared/soap.mjs";

export default async function handler(req) {
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);
  const user = await requireUser();
  if (!user) return json({ ok: false, error: "Sessão expirada" }, 401);
  try {
    const body = await parseJson(req);
    if (String(body.environment) === "1" && body.confirmProduction !== true) {
      throw new Error("Cancelamento em produção não confirmado pelo usuário");
    }
    const config = environmentConfig(body.environment);
    const certificate = readPkcs12(body.certificateBase64, body.passphrase);
    assertCertificateMatchesIssuer(certificate, body.issuerCnpj);
    const unsigned = buildCancellationXml({
      ...body,
      environment: config.tpAmb,
      organizationCode: config.eventOrganizationCode,
    });
    const signedXml = signEventXml(unsigned, certificate);
    const soap = await postSoap({
      url: config.eventUrl,
      action: config.eventSoapAction,
      body: buildSoapEnvelope(signedXml, config.eventNamespace),
      certificate,
    });
    const response = parseServiceResponse(soap.body);
    return json({
      ok: true,
      data: {
        ...response,
        status: ["135", "136"].includes(response.cStat) ? "CANCELLED" : "REJECTED",
        eventXml: signedXml,
      },
    });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 400);
  }
}

export const config = { path: "/api/dce/cancel", method: ["POST"] };
