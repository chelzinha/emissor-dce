export function normalizePortalUsername(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

function metadataFor(user) {
  return user?.user_metadata || user?.userMetadata || {};
}

function explicitAliases(user) {
  const metadata = metadataFor(user);
  return [metadata.username, metadata.user_name, metadata.login, user?.username]
    .map(normalizePortalUsername)
    .filter(Boolean);
}

function emailLocalAlias(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  const at = email.indexOf("@");
  return at > 0 ? normalizePortalUsername(email.slice(0, at)) : "";
}

export function identityUserAliases(user) {
  return [...new Set([...explicitAliases(user), emailLocalAlias(user)].filter(Boolean))];
}

export function findIdentityUserByUsername(users, username) {
  const wanted = normalizePortalUsername(username);
  if (!/^[a-z0-9._-]{3,64}$/.test(wanted)) return null;
  const list = Array.isArray(users) ? users : [];

  const explicit = list.filter((user) => explicitAliases(user).includes(wanted));
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) return null;

  const fallback = list.filter((user) => emailLocalAlias(user) === wanted);
  return fallback.length === 1 ? fallback[0] : null;
}
