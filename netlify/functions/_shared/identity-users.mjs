export async function listAllIdentityUsers(listUsers, { perPage = 100, maxPages = 50 } = {}) {
  const rows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await listUsers({ page, perPage });
    if (!Array.isArray(batch)) throw new Error("Resposta inválida ao consultar usuários.");
    rows.push(...batch);
    if (batch.length < perPage) return rows;
  }
  throw new Error("Limite de paginação de usuários excedido.");
}
