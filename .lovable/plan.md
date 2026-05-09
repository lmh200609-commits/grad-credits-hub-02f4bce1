## 问题诊断

下载报告打开后显示的是 HTML 源码 + 中文乱码，原因有二：

1. **Supabase Storage 的签名 URL 不会按 `Content-Type: text/html; charset=utf-8` 渲染**——它强制以 `application/octet-stream` 或 `text/plain` 形式返回（带 `Content-Disposition`），导致浏览器把 HTML 当纯文本展示。
2. 即便部分浏览器把它当 HTML 解析，由于响应头没有 `charset=utf-8`，中文 UTF-8 字节会被默认按 GBK 解码 → 出现"鍐 介 樿"这种乱码。

存储桶里放 HTML 文件这条路天然有这两个坑，最稳妥的做法是**不再把 HTML 当文件存**，改为前端路由内联渲染。

## 方案：前端路由直接渲染报告

### 1. Edge Function 调整（`supabase/functions/generate-window-report/index.ts`）
- 继续生成完整的 `summary` JSON（含 KPI、状态分布、班级聚合、不合格名单、未提交名单、申请明细、14 天趋势等所有字段，与现有 HTML 同等详细）。
- **不再** 拼接 HTML、不再 upload 到 storage、不再返回 `download_url`。
- 把 `summary` 完整写入 `submission_window_reports.summary`（jsonb），同时把 `submission_windows.report_path` 设为前端路由形式：`/admin/window-report/{window_id}`，并写入 `report_generated_at`。
- 返回 `{ ok: true, report_route: "/admin/window-report/{id}", summary }`。

### 2. 新前端路由 `/admin/window-report/:windowId`
新建 `src/pages/admin/WindowReport.tsx`：
- 通过 `submission_window_reports` 拉取 `summary` JSON（管理员/超管 RLS 已具备）。
- 用项目现有 design tokens（`bg-background`、`text-foreground`、`border`、`primary` 等）渲染成与原 HTML 一样详细的报告：
  - 顶部封面（批次名、学院、时间窗口、生成时间）。
  - KPI 卡片网格（总学生 / 已提交 / 提交率 / 申请数 / 通过 / 驳回 / 平均学分 / 合格人数 / 合格率 等 9–12 项）。
  - 状态分布水平条形图（CSS div 实现）。
  - ≥2 / ≥4 / ≥6 学分三档合格率对比。
  - 14 天提交趋势柱状图。
  - 院系 / 专业 / 班级三级聚合表（合格率 < 60% 红色高亮）。
  - **按班级分块的"不合格学生"清单**（每班一个 card，标题 `班级 (专业) — 不合格 X/Y 人 — 合格率 Z%`，按"距合格差值"降序，列出姓名/学号/已得学分/差距）。
  - 未提交学生清单（按班级分组）。
  - 全量申请明细表（带状态彩色 badge）。
- 顶部 sticky 工具栏：「打印 / 导出 PDF」按钮 → `window.print()`；「返回」按钮。
- 使用 `@media print` 规则隐藏工具栏、收紧间距，浏览器原生打印即可输出高质量 PDF（中文字体由用户系统提供，无需额外加载）。

### 3. 触发链路调整（`src/pages/admin/SubmissionWindows.tsx`）
- `generateReport`：成功后用 `navigate(data.report_route)`（或 `window.open` 同源新标签）打开新路由，去掉对 `download_url` 的处理。
- `downloadReport`（已生成的批次"下载报告"按钮）：改为打开 `/admin/window-report/{window.id}`，不再走 storage signed URL。
- 按钮文案从"下载报告"改为"查看报告"，更贴近实际行为；用户可在报告页内自行打印为 PDF。

### 4. 路由注册
在 `src/App.tsx`（或现有路由文件）的管理员路由组里新增 `<Route path="/admin/window-report/:windowId" element={<WindowReport />} />`。

### 5. 清理
- 删除 edge function 内 HTML 模板字符串与 storage upload 逻辑。
- 不动数据库 schema、RLS、触发器、bucket 配置。
- `report_path` 列继续复用，但语义改为"前端路由"，旧的 `.html` 路径数据不影响（前端按 windowId 重新跳转）。

### 技术细节速查
- 中文渲染：完全依赖浏览器 + 系统字体（PingFang SC / Microsoft YaHei），不再有任何 storage MIME / charset 风险。
- PDF 输出：`window.print()` + `@page { size: A4; margin: 14mm }`，比 jsPDF 体积小、无内存上限、字体完美。
- 数据一致性：报告数据全部来自 `summary` JSON 快照，与原 HTML 报告字段完全一致，确保"和数据看板一样详细"。

## 交付效果

点"生成报告" → 直接在新标签打开排版精美的中文报告页，KPI / 图表 / 班级合格率 / 不合格学生分班级清单一应俱全；点右上角"导出 PDF"由浏览器原生导出。彻底告别乱码与源码裸奔。
