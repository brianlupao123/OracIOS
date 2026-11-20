// Produce a minimal read-only account preflight result. Never return a user
// record, email, password hash, payment data, or any other store field.
export function summarizeAdminAccess(users, targetEmail) {
  const list = Array.isArray(users) ? users : [];
  const normalized = String(targetEmail || "").trim().toLowerCase();
  const target = list.find((user) => String(user?.email || "").trim().toLowerCase() === normalized);
  return {
    target_found: Boolean(target),
    target_is_admin: target?.role === "Admin",
    target_active: target?.is_active === true,
    target_has_password: Boolean(target?.password_hash),
    active_admin_count: list.filter((user) => user?.role === "Admin" && user.is_active === true).length
  };
}
