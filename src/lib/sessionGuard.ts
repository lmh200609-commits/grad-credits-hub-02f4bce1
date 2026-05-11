import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const JWT_PATTERNS = [
  "jwt expired",
  "invalid jwt",
  "invalid refresh token",
  "refresh_token_not_found",
  "refresh token not found",
  "token has expired",
  "pgrst301",
];

export function isJwtExpiredError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as any;
  const msg = String(anyErr?.message ?? anyErr?.error_description ?? anyErr ?? "").toLowerCase();
  const code = String(anyErr?.code ?? "").toLowerCase();
  return JWT_PATTERNS.some((p) => msg.includes(p)) || code === "pgrst301";
}

let toastShown = false;
let redirecting = false;
let refreshInFlight: Promise<boolean> | null = null;

/**
 * If `err` is a JWT/refresh-token failure, try to silently refresh the session.
 * On refresh success → returns true (caller should retry or stay quiet).
 * On refresh failure → signs out, shows ONE toast, redirects to /login, returns true.
 * If `err` is not auth-related → returns false (caller should handle normally).
 *
 * Calling without `err` forces the expired-flow (used by auth state listeners).
 */
export async function handleAuthExpired(err?: unknown): Promise<boolean> {
  if (err !== undefined && !isJwtExpiredError(err)) return false;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data?.session) return true;
      } catch {
        /* fall through */
      }
      return false;
    })();
  }

  const refreshed = await refreshInFlight.finally(() => {
    setTimeout(() => { refreshInFlight = null; }, 1000);
  });

  if (refreshed) return true;

  if (redirecting) return true;
  redirecting = true;

  try { await supabase.auth.signOut(); } catch { /* ignore */ }

  if (!toastShown) {
    toastShown = true;
    toast({
      title: "登录已过期",
      description: "请重新登录后继续操作。",
      variant: "destructive",
    });
  }

  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.replace("/login?reason=expired");
  }
  return true;
}
