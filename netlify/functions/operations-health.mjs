import { callOperationsAppsScript } from './_shared/operations-apps-script.mjs';
import { json, publicError } from './_shared/http.mjs';

export default async function handler(req) {
  if (req.method !== 'GET') return json({ ok: false, error: 'Método não permitido' }, 405);
  try {
    const data = await callOperationsAppsScript('system.health', {}, { id: 'release-healthcheck', email: 'healthcheck@agf.local' });
    return json({ ok: true, name: data?.name || '', version: data?.version || '' });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 500);
  }
}

export const config = { path: '/api/operations-health', method: ['GET'] };
