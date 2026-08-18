import { env, environmentConfig } from "./_shared/constants.mjs";
import { assertCertificateMatchesIssuer, readPkcs12 } from "./_shared/certificate.mjs";
import { json, parseJson, publicError, requireUser } from "./_shared/http.mjs";
import { signDceXml } from "./_shared/signature.mjs";
import {
  buildAuthorizationEnvelope,
  buildSoapEnvelope,
  extractProtocolXml,
  parseAuthorizationResponse,
  parseServiceResponse,
  postSoap,
} from "./_shared/soap.mjs";
import { normalizeDceDocument } from "./_shared/validation.mjs";
import { buildProcessedDceXml, buildUnsignedDce } from "./_shared/xml.mjs";
import { buildConsultationXml } from "./_shared/services.mjs";

function authorized(response) {
  return response.cStat === "100" && Boolean(response.protocolNumber);
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);
  const user = await requireUser();
  if (!user) return json({ ok: false, error: "Sessão expirada" }, 401);

  try {
    const body = await parseJson(req);
    const documents = Array.isArray(body.documents) ? body.documents : [];
    const maxPerRequest = Math.max(1, Math.min(20, Number(env("DCE_MAX_PER_REQUEST", "5"))));
    if (documents.length < 1 || documents.length > maxPerRequest) {
      throw new Error(`Envie entre 1 e ${maxPerRequest} DC-e por chamada`);
    }
    const certificate = readPkcs12(body.certificateBase64, body.passphrase);
    const results = [];

    for (const source of documents) {
      const validation = normalizeDceDocument(source);
      if (!validation.valid) {
        results.push({
          reference: source.reference || source.trackingCode || "",
          status: "INVALID",
          errors: validation.errors,
        });
        continue;
      }
      const document = validation.document;
      if (document.identification.environment === "1" && body.confirmProduction !== true) {
        results.push({
          reference: document.reference || document.trackingCode,
          status: "INVALID",
          errors: ["Emissão em produção não confirmada pelo usuário"],
        });
        continue;
      }

      let built;
      try {
        assertCertificateMatchesIssuer(certificate, document.issuer.cnpj);
        built = buildUnsignedDce(document, { numericCode: source.identification?.numericCode });
        const signedXml = signDceXml(built.xml, certificate);
        if (Buffer.byteLength(signedXml, "utf8") > 500_000) {
          throw new Error("XML da DC-e excede o limite oficial de 500 KB");
        }
        const config = environmentConfig(document.identification.environment);
        const envelope = buildAuthorizationEnvelope(signedXml, config.authorizationNamespace);
        const soap = await postSoap({
          url: config.authorizationUrl,
          action: config.authorizationSoapAction,
          body: envelope,
          certificate,
        });
        let response = parseAuthorizationResponse(soap.body);
        let protocolXml = extractProtocolXml(soap.body);
        if (response.cStat === "452") {
          const consultation = await postSoap({
            url: config.consultationUrl,
            action: config.consultationSoapAction,
            body: buildSoapEnvelope(buildConsultationXml(document.identification.environment, built.accessKey), config.consultationNamespace),
            certificate,
          });
          const consulted = parseServiceResponse(consultation.body);
          if (consulted.cStat === "100") {
            response = { ...consulted, reason: `Autorizada anteriormente. ${consulted.reason}` };
            protocolXml = extractProtocolXml(consultation.body);
          }
        }
        const isAuthorized = authorized(response);
        results.push({
          reference: document.reference || document.trackingCode,
          trackingCode: document.trackingCode,
          status: isAuthorized ? "AUTHORIZED" : "REJECTED",
          accessKey: response.accessKey || built.accessKey,
          cStat: response.cStat,
          reason: response.reason,
          protocolNumber: response.protocolNumber,
          receivedAt: response.receivedAt,
          total: built.total,
          signedXml,
          processedXml: isAuthorized ? buildProcessedDceXml(signedXml, protocolXml) : "",
          qrCode: built.qrCode,
        });
      } catch (error) {
        results.push({
          reference: document.reference || document.trackingCode,
          trackingCode: document.trackingCode,
          status: "ERROR",
          accessKey: built?.accessKey || "",
          error: publicError(error),
        });
      }
    }

    return json({ ok: true, data: { results } });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 400);
  }
}

export const config = { path: "/api/dce/authorize", method: ["POST"] };
