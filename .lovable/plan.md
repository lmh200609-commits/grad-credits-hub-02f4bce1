# 修复"加载 AI 鉴别数据失败 / JWT expired"反复弹窗

## 问题本质

浏览器里的登录会话过期（`refresh_token` 也已失效），但应用没有感知，仍在用旧 JWT 发请求；`AigcStatsPanel` 因为带 10 秒轮询，所以每 10 秒弹一次 toast。这是一个会影响所有带轮询/Realtime 页面的全局问题，需要在公共层修复，而不是只补 AIGC 面板。

## 方案（共三处改动，均为前端）

### 1. 新建公共会话守卫 `src/lib/sessionGuard.ts`

提供两个工具：

- `isJwtExpiredError(err)` — 判断 Supabase 返回的 error 是否属于"JWT 失效/刷新失败"族（匹配 `JWT expired`、`Invalid Refresh Token`、`refresh_token_not_found`、`PGRST301` 等）。
- `handleAuthExpired()` — 全局只触发一次：先尝试 `supabase.auth.refreshSession()`，成功就返回 `true`，让调用方安静地重试一次；失败则
  - `supabase.auth.signOut()`，
  - 弹一次 toast "登录已过期，请重新登录"（用模块级 `alreadyShown` flag 去重，避免轮询场景重复弹），
  - `window.location.replace("/login?reason=expired")`。

### 2. `src/hooks/useAuth.tsx`：监听 token 刷新失败 / 登出

在 `onAuthStateChange` 里：

- 收到 `TOKEN_REFRESHED` 且 `newSession` 为空，或收到 `SIGNED_OUT` 而当前路径不在 `/login`，调用 `handleAuthExpired()`，避免应用继续在登录页之外用空会话发请求。

### 3. `src/components/AigcStatsPanel.tsx`：捕获过期错误，停止 toast 风暴

把 `load()` 里报错分支改成：

```ts
if (error) {
  if (await handleAuthExpired(error)) {
    // 已尝试续签或跳转登录，无需弹"加载失败"
    return;
  }
  toast({ title: "加载 AI 鉴别数据失败", description: error.message, variant: "destructive" });
}
```

`handleAuthExpired(error)` 内部判断：若不是 JWT 失效错误，直接返回 `false`，原 toast 照常走；若是，则按上面"先 refresh、否则跳登录"的逻辑处理，并返回 `true` 让调用方静默。

> 同样的 3 行模式可以后续推广到其它带轮询的列表页（`Reviews.tsx`、`MyApplications.tsx` 等），但本次改动只先把弹窗源 `AigcStatsPanel` 改了，避免一次改动面太大。

## 不改动 / 不涉及

- **不改后端**、不改 edge functions、不改数据库；这是纯客户端会话管理问题。
- 不调整 `useRealtimeTable` 的轮询间隔——它本身行为是对的，错的是没人处理鉴权失败。
- 不动 supabase client 的 `autoRefreshToken` 配置；该配置仍有用，只是在它失败时我们多兜一层。

## 验证

实现后：

1. 在浏览器 DevTools → Application → Local Storage 把 `sb-...-auth-token` 的 `expires_at` 改成已过期的时间戳，刷新 `/admin/dashboard`：应在第一次 toast 之后立即被带去 `/login?reason=expired`，而不是每 10 秒重复弹。
2. 正常使用页面（未过期）行为完全不变，仍能正常加载数据 + Realtime 推送。
