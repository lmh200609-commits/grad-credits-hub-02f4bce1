## 目标
让系统在没有 HTTPS 的局域网 HTTP 环境下也能正常使用，替换所有依赖"安全上下文（Secure Context）"的浏览器 API。

## 背景
现代浏览器要求以下 API 必须运行在 HTTPS 或 `localhost` 下，HTTP + IP 访问时会变成 `undefined` 或抛错：

| API | 项目中位置 | 影响 |
|---|---|---|
| `crypto.subtle.digest` | `src/lib/fileHash.ts` | 学员上传材料时报 `Cannot read properties of undefined (reading 'digest')` |
| `crypto.randomUUID()` | `src/pages/student/Apply.tsx:414` | 上传文件生成路径失败（部分浏览器） |
| `navigator.clipboard.writeText` | `src/components/BulkUserDialog.tsx:154`、`src/pages/admin/PurgeAndBootstrap.tsx:61` | 复制账号/密码失败 |

边缘函数（`supabase/functions/aigc-detect`）里的 `crypto.subtle` 在 Deno 服务器端运行，**不受影响**，不需要改。

## 改动方案

### 1. `src/lib/fileHash.ts` — SHA-256 兜底
- 检测 `globalThis.crypto?.subtle?.digest`；可用则继续走原生（性能最好）。
- 不可用则使用纯 JS 实现：引入 `js-sha256` 依赖，按 `ArrayBuffer` 计算并返回 hex。
- 对外签名不变，调用点（`Apply.tsx`）无需改。

### 2. `crypto.randomUUID` 兜底
- 新增 `src/lib/uuid.ts`，导出 `randomUUID()`：
  - 优先 `globalThis.crypto?.randomUUID?.()`；
  - 否则用 `crypto.getRandomValues`（HTTP 下仍可用）按 RFC4122 v4 拼接；
  - 再退化为 `Math.random` 版本（极端兜底）。
- 把 `src/pages/student/Apply.tsx` 里的 `crypto.randomUUID()` 改为 `randomUUID()`。

### 3. 剪贴板兜底
- 新增 `src/lib/clipboard.ts`，导出 `copyText(text): Promise<boolean>`：
  - 有 `navigator.clipboard` 且页面是安全上下文 → 用原生；
  - 否则创建临时 `<textarea>` + `document.execCommand('copy')`。
- 修改 `BulkUserDialog.tsx`、`PurgeAndBootstrap.tsx` 调用此函数。

### 4. 文档补充
- 在 `docs/self-hosted-deployment.md` 末尾追加「HTTP（非 HTTPS）部署注意事项」小节，说明：
  - 已经做了 SHA-256 / UUID / 剪贴板兜底，HTTP + 内网 IP 可正常使用；
  - 但浏览器仍会在以下场景受限（不在本次修改范围，仅告知用户）：摄像头/麦克风（`getUserMedia`，本项目未用到）、Service Worker、推送通知；
  - 建议仅在受信任的局域网内使用。

## 依赖
- 新增依赖：`js-sha256`（≈10KB，零依赖，广泛使用）。

## 不改动
- Supabase Edge Functions（服务端 Deno，原生 `crypto.subtle` 始终可用）。
- 自托管 Supabase / Nginx / 网络层配置（用户已明确不配 HTTPS）。
- 现有 UI / 业务逻辑 / RLS。

## 验证
- 构建通过；
- 在 HTTP 内网 IP 下：学员上传材料不再报 `digest` undefined；管理员复制账号密码可用；上传路径生成不报错。
