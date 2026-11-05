// Diagnóstico temporário: confere, a partir da Netlify, se o TLS com o autorizador
// de produção passa a validar com a raiz ICP-Brasil. Não usa certificado do cliente.
import https from "node:https";
import tls from "node:tls";
import { SEFAZ_TRUSTED_CAS } from "./_shared/icp-brasil-roots.mjs";

function probe(host, ca) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: host, path: "/dce/DCeStatusServico", method: "GET", ca, rejectUnauthorized: true, timeout: 15000, minVersion: "TLSv1.2" }, (res) => {
      res.resume(); resolve({ tlsOk: true, http: res.statusCode });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({ tlsOk: !/certificate|self-signed|issuer/i.test(error.message), error: error.code || error.message, message: error.message }));
    req.end();
  });
}

export default async function handler() {
  const result = {};
  for (const host of ["dce.fazenda.pr.gov.br", "homologacao.dce.fazenda.pr.gov.br"]) {
    result[host] = { comRaizIcp: await probe(host, SEFAZ_TRUSTED_CAS), soRaizesPadrao: await probe(host, tls.rootCertificates) };
  }
  return Response.json(result);
}

export const config = { path: "/api/diag-tls" };
