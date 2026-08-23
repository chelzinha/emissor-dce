import { admin, verifyRequestOrigin } from '@netlify/identity';
import { callAppsScript } from './_shared/apps-script.mjs';
import { json, parseJson, publicError, requireUser } from './_shared/http.mjs';
import { explicitUsername, findIdentityUserByUsername } from './_shared/portal-username.mjs';
import { findIdentityUserByEmail, normalizePortalProvisionInput } from './_shared/portal-user-provision.mjs';

async function listAllIdentityUsers() {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const batch = await admin.listUsers({ page, perPage: 100 });
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido' }, 405);
  const actor = await requireUser();
  if (!actor) return json({ ok: false, error: 'Sessão expirada' }, 401);

  try {
    verifyRequestOrigin(req);
    const input = normalizePortalProvisionInput(await parseJson(req, 50_000));
    const campaign = await callAppsScript('campaign.get', { campaignId: input.campaignId }, actor);
    if (String(campaign?.role || '') !== 'AGENCY_ADMIN') return json({ ok: false, error: 'Seu perfil não permite criar acessos.' }, 403);

    const users = await listAllIdentityUsers();
    const byUsername = findIdentityUserByUsername(users, input.username);
    const byEmail = findIdentityUserByEmail(users, input.email);
    if (byUsername && byEmail && String(byUsername.id) !== String(byEmail.id)) {
      throw new Error('Usuário e e-mail pertencem a contas diferentes.');
    }

    let target = byEmail || byUsername;
    let created = false;
    if (target) {
      if (String(target.email || '').toLowerCase() !== input.email) throw new Error('O usuário informado já pertence a outro e-mail.');
      const currentUsername = explicitUsername(target);
      if (currentUsername && currentUsername !== input.username) throw new Error('Este e-mail já possui outro nome de usuário.');
      const metadata = target.user_metadata || target.userMetadata || {};
      target = await admin.updateUser(String(target.id), {
        user_metadata: { ...metadata, username: input.username, ...(input.fullName ? { full_name: input.fullName } : {}) },
      });
    } else {
      target = await admin.createUser({
        email: input.email,
        password: input.password,
        data: {
          user_metadata: { username: input.username, ...(input.fullName ? { full_name: input.fullName } : {}) },
          app_metadata: { roles: ['campaign-user'] },
        },
      });
      created = true;
    }

    try {
      await callAppsScript('campaign.user.add', {
        campaignId: input.campaignId,
        userId: String(target.id),
        role: 'CAMPAIGN_USER',
      }, actor);
    } catch (error) {
      if (created) {
        try { await admin.deleteUser(String(target.id)); } catch {}
      }
      throw error;
    }

    return json({ ok: true, data: { id: String(target.id), username: input.username, email: input.email, created } });
  } catch (error) {
    return json({ ok: false, error: publicError(error) }, 400);
  }
}

export const config = { path: '/api/portal/users', method: ['POST'] };
