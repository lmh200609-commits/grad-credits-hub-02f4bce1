/**
 * Resolve the workbench greeting name.
 *
 * Priority: profile.full_name (trimmed) > account (email prefix) > "" .
 * If the profile lookup fails (profile is null/undefined), falls back to account.
 */
export function resolveDisplayName(
  profile: { full_name?: string | null } | null | undefined,
  account: string,
): string {
  const name = profile?.full_name?.trim();
  return name && name.length > 0 ? name : account;
}