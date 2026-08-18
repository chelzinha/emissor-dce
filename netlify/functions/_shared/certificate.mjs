import forge from "node-forge";

function findBag(p12, bagType) {
  const bags = p12.getBags({ bagType });
  return bags[bagType]?.[0] || null;
}

function extractBrazilianCnpj(certificate, commonName) {
  const candidates = [commonName];
  for (const extension of certificate.extensions || []) {
    if (extension.name === "subjectAltName") {
      for (const altName of extension.altNames || []) candidates.push(altName.value || "");
    }
    candidates.push(extension.value || "");
  }
  for (const candidate of candidates) {
    const text = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
    const printable = Array.from(String(text), (char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code <= 126 ? char : " ";
    }).join("");
    const found = printable.match(/(?:^|\D)(\d{14})(?:\D|$)/)?.[1];
    if (found) return found;
  }
  return "";
}

export function readPkcs12(certificateBase64, passphrase) {
  if (!certificateBase64) throw new Error("Certificado A1 não informado");
  const raw = Buffer.from(String(certificateBase64).replace(/^data:.*?;base64,/, ""), "base64");
  if (raw.length < 100) throw new Error("Arquivo de certificado inválido");

  let p12;
  try {
    const bytes = forge.util.createBuffer(raw.toString("binary"));
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bytes), false, String(passphrase ?? ""));
  } catch (error) {
    throw new Error("Não foi possível abrir o certificado. Verifique o arquivo e a senha.", { cause: error });
  }

  const keyBag = findBag(p12, forge.pki.oids.pkcs8ShroudedKeyBag)
    || findBag(p12, forge.pki.oids.keyBag);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const certBag = certBags.find((bag) => {
    const publicKey = bag.cert?.publicKey;
    return publicKey?.n && keyBag?.key?.n && publicKey.n.compareTo(keyBag.key.n) === 0;
  }) || certBags[0];
  if (!keyBag?.key || !certBag?.cert) throw new Error("O arquivo não contém chave privada e certificado válidos");

  const certificate = certBag.cert;
  const now = new Date();
  if (now < certificate.validity.notBefore || now > certificate.validity.notAfter) {
    throw new Error("O certificado digital está fora do período de validade");
  }
  const commonName = certificate.subject.getField("CN")?.value || "";
  const cnpj = extractBrazilianCnpj(certificate, commonName);
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();

  return {
    pfx: raw,
    passphrase: String(passphrase ?? ""),
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certificatePem: forge.pki.certificateToPem(certificate),
    certificateBase64: forge.util.encode64(certDer).replace(/\r?\n/g, ""),
    commonName,
    cnpj,
    validFrom: certificate.validity.notBefore.toISOString(),
    validTo: certificate.validity.notAfter.toISOString(),
  };
}

export function assertCertificateMatchesIssuer(certificate, issuerCnpj) {
  if (!certificate.cnpj) throw new Error("Não foi possível identificar o CNPJ no certificado digital");
  if (certificate.cnpj.slice(0, 8) !== String(issuerCnpj).slice(0, 8)) {
    throw new Error("O CNPJ-base do certificado não corresponde ao CNPJ do emitente");
  }
}
