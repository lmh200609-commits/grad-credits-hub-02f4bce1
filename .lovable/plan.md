## 修改目标

1. AI 助手回复全程纯简体中文，杜绝英文字段名/状态值/表名残留。
2. 数据看板「AI 生成材料鉴别」面板支持点击：行 → 跳转到对应申请详情；图表段 → 自动筛选并展示对应清单。
3. 同步到系统其它 AI 端点（学生端学分助手、批量导入助手）和复用同一组规则。

---

## A. 助手中文化（edge functions）

### A.1 `supabase/functions/staff-ai-assistant/index.ts`
- 新增 `CHINESE_ONLY_RULE`，挂入 `sysMsg`：
  - 回复一律简体中文；禁止出现英文字段名（`aigc_status / aigc_score_pct / student_no / application_id` 等）、英文枚举值（`fake / suspect / real / pending / skipped / error`）、英文表名。
  - 工具返回里的英文键值必须翻译：状态映射 `fake=高风险 / suspect=嫌疑 / real=通过 / pending=待检测 / skipped=跳过 / error=失败`；字段映射 `aigc_score_pct=AI 生成概率 / submitted_at=提交时间 / student_name=姓名 / student_no=学号 / application_id=申请编号`。
  - 显示申请编号一律取末 8 位；时间精确到分钟。
- 在 `execTool` 出口对 `list_aigc_flagged` 的返回做一次轻量后处理：把每条 item 加上中文化的 `状态文案`、`概率文案`、`提交时间文案`、`编号末8位`，原英文键也保留以便兼容，但中文键放前面，模型自然优先采用。

### A.2 `supabase/functions/ask-credit-assistant/index.ts`
- 同样追加一行：仅简体中文、禁止英文字段/枚举/表名。系统提示已是中文，这里只补强约束防漏。

### A.3 `supabase/functions/import-assistant-chat/index.ts`
- 已有"纯文本简体中文"规则，无需改动；如发现仍有英文残留再补强。

部署：仅重新部署改动的两个函数。

---

## B. 面板可点击跳转（前端）

文件：`src/components/AigcStatsPanel.tsx`

### B.1 新增"高风险 / 嫌疑申请"清单表格（在饼/柱图下方）
- 数据源：`filtered.filter(r => ["fake","suspect"].includes(r.aigc_status))`，按 `aigc_score` 倒序，最多 20 行。
- 表头：序号 / 提交时间 / 状态 / AI 生成概率 / 学生 / 申请描述（截断 30 字）/ 操作。
- 整行 `onClick` → `navigate('/applications/' + r.id)`；操作列也放一个「查看」按钮（同跳转，便于无障碍）。
- 学生姓名/学号需要补查 `profiles`（按 `student_id` 批量查，与 `ReviewHub` 同款做法），新增 `Map<student_id, {full_name, student_no}>` state；面板原 `load` 加一段 profiles 拉取。

### B.2 图表点击交互
- BarChart：`onClick` 取 `activeLabel`（日期），把状态筛选保持，再把面板下方表格滚动到顶；同时在表格上方显示「已聚焦：MM-DD」徽标 + 「清除」按钮。
- PieChart：`Pie onClick` → 把 `statuses` 设为该段对应的单一状态（如点"高风险"=`["fake"]`），表格随即变成只显示该状态。
- 若用户点的段没有可跳转的明细（如「通过」段），仅做筛选，不跳详情页。

### B.3 KPI 卡片可点击
- "高风险" / "嫌疑" 卡片加 `cursor-pointer` + `onClick` → 把 `statuses` 设为对应单状态。
- "待检测" 提示行已有「仅看待检测」，保持。

### B.4 路由确认
`/applications/:id` 路由已存在（`ApplicationDetail.tsx`，`ProtectedRoute` 包裹），所有教师/管理员均可访问；无需新建路由。

---

## C. 同步到系统其它位置

- `src/pages/admin/Dashboard.tsx`、`src/pages/teacher/Dashboard.tsx` 已经引用 `<AigcStatsPanel />`，B 节改动自动生效。
- `src/pages/student/MyApplications.tsx` 顶部 AIGC 汇总条已有"跳转到对应申请详情"按钮，无需重复改造。
- 学生端 `StudentAigcWarning` 是纯展示组件，与本次改动无关。

---

## 不做的事

- 不改 RLS / 表结构 / 队列服务。
- 不改助手对话历史的存储格式。
- 不在 PDF 报告里加跳转（PDF 是离线产物）。

## 影响文件
- `supabase/functions/staff-ai-assistant/index.ts`
- `supabase/functions/ask-credit-assistant/index.ts`
- `src/components/AigcStatsPanel.tsx`