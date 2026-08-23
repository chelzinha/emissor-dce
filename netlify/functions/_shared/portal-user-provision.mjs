import { normalizePortalUsername } from './portal-username.mjs';

export function normalizePortalProvisionInput(body) {
  const source = body || {};
  const campaignId = String(source.campaignId || '').trim();
  const username = normalizePortalUsername(source.username);
  const email = String(source.email || '').trim().toLowerCase();
  const fullName = String(source.fullName || '').trim().slice(0, 120);
  const password = String(source.password || '');

  if (!campaignId) throw new Error('Operação não informada.');
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error('Usuário deve ter de 3 a 64 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido para recuperação do acesso.');
  if (password.length < 8 || password.length > 128) throw new Error('A senha inicial deve ter entre 8 e 128 caracteres.');

  return { campaignId, username, email, fullName, password };
}

export function findIdentityUserByEmail(users, email) {
  const target = String(email || '').trim().toLowerCase();
  const list = Array.isArray(users) ? users : [];
  return list.find((user) => String(user?.email || '').trim().toLowerCase() === target) || null;
}
