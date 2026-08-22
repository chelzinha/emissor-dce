import test from 'node:test';
import assert from 'node:assert/strict';
import { findIdentityUserByEmail, normalizePortalProvisionInput } from '../netlify/functions/_shared/portal-user-provision.mjs';

test('normaliza provisionamento de acesso do cliente', () => {
  const value = normalizePortalProvisionInput({
    campaignId: ' camp-1 ',
    username: ' Cliente.Teste ',
    email: ' CLIENTE@EXEMPLO.COM ',
    fullName: 'Cliente Teste',
    password: 'senha-segura-123',
  });
  assert.equal(value.campaignId, 'camp-1');
  assert.equal(value.username, 'cliente.teste');
  assert.equal(value.email, 'cliente@exemplo.com');
});

test('rejeita usuário, e-mail e senha inválidos', () => {
  assert.throws(() => normalizePortalProvisionInput({ campaignId: '1', username: 'a', email: 'x', password: '1' }));
});

test('localiza usuário Identity por e-mail sem diferenciar maiúsculas', () => {
  const user = findIdentityUserByEmail([{ id: 'u1', email: 'Pessoa@Exemplo.com' }], 'pessoa@exemplo.com');
  assert.equal(user.id, 'u1');
});
