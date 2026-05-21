// 同步检查 supabase 是否在 localStorage 中已有会话 token。
// 用于路由守卫在 auth 异步初始化期间提前放行，避免「加载中…」整屏闪屏。
export function hasCachedSupabaseSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // Supabase v2 默认键形如 sb-<project-ref>-auth-token
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
        const v = localStorage.getItem(k);
        if (v && v.length > 2) return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}