import { SignedXml } from "xml-crypto";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";

export function signDceXml(unsignedXml, certificate) {
  return signElement(unsignedXml, certificate, "infDCe", "DCe");
}

export function signEventXml(unsignedXml, certificate) {
  return signElement(unsignedXml, certificate, "infEvento", "eventoDCe");
}

function signElement(unsignedXml, certificate, signedElement, rootElement) {
  const signer = new SignedXml({
    privateKey: certificate.privateKeyPem,
    publicCert: certificate.certificatePem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
    getKeyInfoContent: () => (
      `<X509Data><X509Certificate>${certificate.certificateBase64}</X509Certificate></X509Data>`
    ),
  });
  signer.addReference({
    xpath: `//*[local-name(.)='${signedElement}']`,
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
  });
  signer.computeSignature(unsignedXml, {
    location: { reference: `//*[local-name(.)='${rootElement}']`, action: "append" },
    prefix: "",
  });
  return signer.getSignedXml();
}
