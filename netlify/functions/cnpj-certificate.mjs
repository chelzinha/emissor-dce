import { readPkcs12 } from './_shared/certificate.mjs';
import { json, parseJson, publicError } from './_shared/http.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido' }, 405);

  try {
    const body = await parseJson(req, 5_000_000);
    const certificateBase64 = String(body.certificateBase64 || '');
    const passphrase = String(body.passphrase || '');

    if (!certificateBase64) return json({ ok: false, error: 'Certificado não informado' }, 400);
    if (!passphrase) return json({ ok: false, error: 'Senha do certificado não informada' }, 400);

    const certificate = readPkcs12(certificateBase64, passphrase);
    return json({
      ok: true,
      data: {
        commonName: certificate.commonName,
        cnpj: certificate.cnpj,
        validFrom: certificate.validFrom,
        validTo: certificate.validTo,
      },
    });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 422);
  }
}

export const config = { path: '/api/cnpj/certificate', method: ['POST'] };
