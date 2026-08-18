import https from "node:https";
import { XMLParser } from "fast-xml-parser";
import { escapeXml } from "./xml.mjs";

export function buildSoapEnvelope(payloadXml, namespace) {
  const xml = String(payloadXml).replace(/^<\?xml[^>]*>\s*/i, "");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">`,
    "<soap12:Body>",
    `<dceDadosMsg xmlns="${escapeXml(namespace)}">`,
    xml,
    "</dceDadosMsg>",
    "</soap12:Body>",
    "</soap12:Envelope>",
  ].join("");
}

export const buildAuthorizationEnvelope = buildSoapEnvelope;

export function postSoap({ url, action, body, certificate, timeoutMs = 50_000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      pfx: certificate.pfx,
      passphrase: certificate.passphrase,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      timeout: timeoutMs,
      headers: {
        "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`,
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "Emissor-DCe/0.1.0",
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`Web Service retornou HTTP ${response.statusCode}: ${responseBody.slice(0, 500)}`));
          return;
        }
        resolve({ statusCode: response.statusCode || 200, headers: response.headers, body: responseBody });
      });
    });
    request.on("timeout", () => request.destroy(new Error("Tempo limite excedido ao consultar o autorizador")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function findObjectByKey(value, wanted) {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (key === wanted) return child;
    const nested = findObjectByKey(child, wanted);
    if (nested != null) return nested;
  }
  return null;
}

function findScalar(value, wanted) {
  if (!value || typeof value !== "object") return "";
  for (const [key, child] of Object.entries(value)) {
    if (key === wanted && (typeof child === "string" || typeof child === "number")) return String(child);
    const nested = findScalar(child, wanted);
    if (nested) return nested;
  }
  return "";
}

export function parseAuthorizationResponse(soapXml) {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
  let parsed = parser.parse(soapXml);
  const resultText = findScalar(parsed, "dceAutorizacaoResult");
  if (resultText && resultText.trim().startsWith("<")) parsed = parser.parse(resultText);
  const ret = findObjectByKey(parsed, "retDCe") || parsed;
  const protocol = findObjectByKey(ret, "protDCe");
  return {
    cStat: findScalar(ret, "cStat"),
    reason: findScalar(ret, "xMotivo"),
    accessKey: findScalar(protocol || ret, "chDCe"),
    protocolNumber: findScalar(protocol || ret, "nProt"),
    receivedAt: findScalar(protocol || ret, "dhRecbto"),
    protocol,
    rawSoap: soapXml,
  };
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function extractProtocolXml(soapXml) {
  const decoded = decodeXmlEntities(soapXml);
  return decoded.match(/<(?:[A-Za-z0-9_-]+:)?protDCe\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?protDCe>/)?.[0] || "";
}


export function parseServiceResponse(soapXml) {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
  let parsed = parser.parse(soapXml);
  for (const resultName of ["dceStatusServicoResult", "dceConsultaResult", "dceRecepcaoEventoResult"]) {
    const resultText = findScalar(parsed, resultName);
    if (resultText && resultText.trim().startsWith("<")) parsed = parser.parse(resultText);
  }
  return {
    cStat: findScalar(parsed, "cStat"),
    reason: findScalar(parsed, "xMotivo"),
    accessKey: findScalar(parsed, "chDCe"),
    protocolNumber: findScalar(parsed, "nProt"),
    receivedAt: findScalar(parsed, "dhRecbto"),
    rawSoap: soapXml,
  };
}
