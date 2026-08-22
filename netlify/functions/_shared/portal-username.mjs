export function normalizePortalUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function explicitUsername(user) {
  const metadata = user?.user_metadata || user?.userMetadata || {};
  return normalizePortalUsername(metadata.username || metadata.user_name || metadata.login || "");
}

export function findIdentityUserByUsername(users, input) {
  const username = normalizePortalUsername(input);
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) return null;
  const list = Array.isArray(users) ? users : [];
  const explicit = list.filter((user) => explicitUsername(user) === username);
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) return null;
  const fallback = list.filter((user) => normalizePortalUsername(String(user?.email || "").split("@")[0]) === username);
  return fallback.length === 1 ? fallback[0] : null;
}
