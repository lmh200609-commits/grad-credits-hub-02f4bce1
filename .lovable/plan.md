## 目标

在教师 / 管理员 / 超管的数据看板新增"AI 生成材料统计"面板，含 KPI、柱状图、饼状图、筛选，并支持**导出 PDF 报告 + 导出明细 CSV**。

## 现状

- 教师看板：`src/pages/teacher/Dashboard.tsx`
- 管理员 / 超管看板：`src/pages/admin/Dashboard.tsx`（超管用同一页，由 `isSuperAdmin` 决定是否传 `_college`）
- `applications` 表已有：`aigc_status`(`pending|real|suspect|fake|skipped|error`)、`aigc_score`、`aigc_checked_at`、`submitted_at`、`college_id`、`student_id`、`description`、`file_path`
- RLS 已分级：教师/管理员限本学院，超管全量
- 项目已用过 `html2canvas + jsPDF` 导出证书（`src/lib/certificate.ts`），可复用同一栈

## 新增组件

### `src/components/AigcStatsPanel.tsx`

布局（一张 `Card`，跨满栏，紧贴现有"近 14 天提交趋势"下方）：

```text
┌── AI 生成材料鉴别  [导出 PDF] [导出 CSV] ─────────┐
│  时间: 7/14/30/90/全部   状态多选   学院(仅超管) │
│                                                    │
│  KPI:  已检测 N · 高风险 X(占比%) · 嫌疑 Y(占比%) │
│        检出率 Z% · 平均概率 P%                     │
│                                                    │
│  ┌─ 柱状图(stacked) ─┐  ┌─ 饼状图 ──────────────┐│
│  │ 每日 fake/suspect/real │  │ 状态占比         ││
│  │ X=日期 Y=数量          │  │ real/suspect/... ││
│  └─────────────────────┘  └──────────────────────┘│
└────────────────────────────────────────────────────┘
```

### 筛选

1. 时间范围：7 / 14 / 30 / 90 天 / 全部（默认 14 天，按 `submitted_at`）
2. 状态多选：高风险 / 嫌疑 / 通过 / 待检测 / 跳过 / 失败（默认全选）
3. 学院：仅超管显示，下拉「全部 / 某学院」

### 数据获取

`supabase.from("applications").select("id, aigc_status, aigc_score, submitted_at, college_id, student_id, description").gte("submitted_at", since).limit(2000)`

- RLS 自动控权；超管时才 `.eq("college_id", X)`
- 聚合在前端 JS 完成

### 实时刷新

复用 `useRealtimeTable("applications", reload, { filter: collegeFilter })`。

### 配色

`hsl(var(--destructive))`(fake)、`hsl(var(--warning))`(suspect)、`hsl(var(--success))`(real)、`hsl(var(--muted-foreground))`(其它)。不引入新 hex。

## 导出功能（重点）

### 1. 导出 CSV（明细）

- 字段：申请ID、提交时间、AI状态(中文)、AI概率%、申请描述前40字、学院ID
- 走当前筛选后的行集合
- 浏览器端用 `Blob + URL.createObjectURL` 触发下载
- 文件名：`AIGC统计_{college名或全校}_{since}_{now}.csv`
- 加 UTF-8 BOM (`\uFEFF`) 兼容 Excel 中文

### 2. 导出 PDF（汇总报告）

- 复用 `src/lib/certificate.ts` 里的 `exportElementToPdf()` 模式：`html2canvas` 截一个隐藏的 A4 报告 DOM，再 `jsPDF` 输出
- 报告内容（按打印友好的纵版 A4 排版）：
  - 顶部：学院徽章（`college.badge_url`）+ 标题「AI 生成材料鉴别报告」+ 副标题「{学院名 / 全校} · {时间范围} · 生成于 {now}」
  - KPI 网格（与面板一致）
  - 柱状图截图（直接截屏面板里的 recharts SVG/Canvas，用 `html2canvas` 抓取 panel 内对应 div）
  - 饼状图截图
  - 明细 Top 20 高风险申请表（按 `aigc_score desc` 取前 20 行）
  - 页脚：第 X / Y 页，自动分页（jsPDF `addPage`，按图像高度切片）
- 文件名：`AIGC统计报告_{college或全校}_{since}_{now}.pdf`
- 实现要点：
  - 在面板组件内额外渲染一个 `<div ref={reportRef} className="absolute -left-[9999px] w-[794px]">`（A4 宽度 794px @ 96dpi），里面是 PDF 专用的"打印态"布局（白底、深色文字、固定字号）
  - 不直接截屏屏幕上的图表（响应式宽度可能不稳定），而是在打印态 DOM 里**单独再渲染一份** recharts，固定宽高（图表区 700×260），保证多分辨率下结果稳定
  - 字体：使用 `system-ui`，避免 html2canvas 字体加载竞态
  - `html2canvas(reportRef.current, { scale: 2, backgroundColor: "#fff" })` 然后切片到 A4 多页

### 3. 状态指示

- 导出按钮在工作时显示 spinner + 文案"生成中…"，期间禁用
- 失败 toast 提示

## 改动文件清单

- 新建：`src/components/AigcStatsPanel.tsx`
- 修改：`src/pages/admin/Dashboard.tsx`（在主图表 grid 之后插入 `<AigcStatsPanel />`）
- 修改：`src/pages/teacher/Dashboard.tsx`（同上）
- 复用：`html2canvas`、`jspdf`（项目已安装）、`src/lib/certificate.ts` 中的 A4 切片工具
- 不动 RLS、不动 RPC、不动 schema

## 不做

- 不在学生侧出现
- 不做服务端 PDF（保持纯前端，无需新 edge function）
- 不做定时邮件 / 历史报告归档（按需后续加）

## 验证

- 教师 / 普通管理员：仅本学院；学院筛选不显示
- 超管：默认全校，可切学院
- 切时间 / 状态：图表 + KPI + 导出内容同步
- 导出 CSV：在 Excel 中文不乱码
- 导出 PDF：A4 纵版、徽章 + 标题、KPI、两图清晰、Top 20 表格不溢出、自动分页页码正确
- 浅色 / 深色模式（PDF 始终为白底深色）
- 889px 视口下面板布局不溢出
