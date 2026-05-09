# 问题诊断

| 现象 | 根因 |
|---|---|
| 点「查看报告/导出 PDF」跳到登录页（图二） | `window.open(route, "_blank")` 在 Lovable 预览 iframe 中开新标签时，新标签会跳到**已发布域名**（`grad-credits-hub.lovable.app`），而该域名的 localStorage 里没有 session，于是 `RoleRoute` 把用户踢回 `/login`。预览域名和发布域名是两个独立 origin，session 不互通。 |
| 点「查看报告」出现裸 "not found"（图一） | 同上跳到了发布域名，但发布版本是上一次部署的旧 bundle，其中还没有 `/admin/window-report/:windowId` 路由，于是被 Lovable 的边缘 404（纯文本 `not found`）拦截。 |
| 「生成报告」感觉"看不到结果" | 现在点击后只 toast 一条「报告已生成」+ 试图开新标签（被上面两个问题阻断），用户感知不到任何变化。 |
| 自托管 / 局域网部署能否导出 PDF | **能**。新方案完全不依赖外网：报告数据存在数据库 `submission_window_reports.summary`（jsonb），前端直接渲染，PDF 由浏览器内置 `window.print()` 输出，中文字体使用系统字体（PingFang SC / 微软雅黑），无需任何外部字体或 Storage 服务。只要部署的 Supabase + 前端在同一局域网，PDF 导出 100% 可用。 |

# 方案：同标签页内打开报告 + 兜底体验

## 1. `src/pages/admin/SubmissionWindows.tsx`：改为同页跳转

把所有 `window.open(..., "_blank")` 换成 react-router `navigate(...)`，session 一定带得过去：

- `generateReport(w)`：成功后改为 `navigate(\`/admin/window-report/\${w.id}\`)`。toast 改为「报告已生成，正在打开…」。
- `viewReport(w)`：改为 `navigate(\`/admin/window-report/\${w.id}\`)`。
- 给报告按钮（`FileText` 图标）旁加一个明显的文字标签「查看报告」（小屏只显示图标，桌面显示文字 + 图标），消除"看不到结果"的感觉。
- 「生成报告」按钮在没有 `report_generated_at` 时是主操作，给它加文字标签「生成报告」。

> 用户若仍想新标签查看，可在浏览器里右键按钮→新标签打开；同标签页是默认行为，避开 origin/session 坑。

## 2. `src/pages/admin/WindowReport.tsx`：增强健壮性

- 顶部工具栏「返回」按钮：`navigate("/admin/submission-windows")`（避免 `navigate(-1)` 在直接访问时返回到空白历史）。
- 数据库取不到报告时：不再只 toast，而是渲染一张友好卡片：「该批次尚未生成报告」+ 一个「立即生成」按钮（直接调 `supabase.functions.invoke("generate-window-report", { body: { window_id }})`，成功后刷新本页）。这样从任何入口直达 `/admin/window-report/:id` 都不会出现"没反应"。
- 给打印按钮加一行小字提示「Windows 打印对话框中选择"另存为 PDF"，Mac 选左下角"PDF → 存储为 PDF"」，降低用户门槛。

## 3. 清理历史脏数据（可选但推荐）

之前的批次 `submission_windows.report_path` 里可能残留 `.html` 的 storage 路径字符串。新代码已经不再读取它，但为了语义干净，在 edge function 写入新路径时已经覆盖为 `/admin/window-report/{id}`，无需迁移脚本。

## 4. 局域网/自托管说明（写到文档不改代码）

在 `docs/self-hosted-deployment.md` 末尾追加一节「批次报告 PDF 导出」：
- 报告页是纯前端 React 路由，渲染数据来自自托管的 PostgreSQL `submission_window_reports.summary` 列。
- PDF 通过 `window.print()` + `@media print` 由浏览器原生导出，**不依赖**外网、Lovable Cloud 函数运行时、jsPDF、字体 CDN 或对象存储。
- 中文字体来自客户端操作系统：Win 用微软雅黑/等线；macOS 用 PingFang SC；Linux 推荐安装 `fonts-noto-cjk`。
- 唯一需要联网/可达的服务：Supabase（数据库 + Edge Function），均可完全自托管在同一台/同一局域网。

# 交付效果

- 「生成报告」一键完成"生成 → 打开报告"，全程在当前标签页内完成，session 100% 携带，绝不再跳到登录或裸 404。
- 「查看报告」直接进入排版精美的报告页，浏览器原生打印即得 PDF。
- 自托管 / 局域网部署的 PDF 导出能力得到明确保证并写入部署文档。

# 改动文件清单

- `src/pages/admin/SubmissionWindows.tsx`：替换 `window.open` 为 `navigate`，按钮加文字标签。
- `src/pages/admin/WindowReport.tsx`：兜底"未生成报告"卡片 + 立即生成按钮；返回按钮改为固定路径；打印小贴士。
- `docs/self-hosted-deployment.md`：追加 PDF 导出说明段。
- 不动数据库 schema、edge function、RLS、bucket。
