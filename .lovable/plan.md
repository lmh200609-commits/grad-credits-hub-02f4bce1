## 背景（已核查）

**1. "待检测"是什么**
`AigcStatsPanel` 中的"待检测" = `applications.aigc_status = 'pending'`，即尚未跑过 AI 生成图像鉴别的申请。

数据库现状：fake = 3, real = 1, **pending = 2**。这 2 条 pending 都已是 `status = rejected_by_ai`、`aigc_checked_at = null` —— AI 文本审材料阶段就被驳回，AIGC 图像检测从未真正跑过，属于"卡住的遗留单"，不是"排队中"。

**2. AI 助手回答不了"本周疑似 AI 生成图片"**
`staff-ai-assistant` 的 `query_stats` 工具枚举里没有任何 AIGC 相关 metric，也没有专用工具 → 助手没有合法工具可调，回退到"权限不足"兜底话术。不是 RLS 问题，是工具能力缺失。

---

## 修复方案

### A. "待检测"复检入口（前端）
文件：`src/components/AigcStatsPanel.tsx`

- KPI 卡片下方新增提示行：当筛选窗口内 pending > 0 时，显示「N 条待检测」+「查看清单」按钮，跳转 `/admin/applications?aigc=pending`。
- 若 `Applications.tsx` 不支持 `?aigc=pending` query 过滤，顺手加上读取该参数并初始化筛选。

### B. 给 AI 助手补 AIGC 统计能力（边缘函数）
文件：`supabase/functions/staff-ai-assistant/index.ts`

1. `query_stats` 的 `metric` 枚举追加：
   - `aigc_fake_week` —— 本周 `aigc_status='fake'` 计数
   - `aigc_suspect_week` —— 本周 `aigc_status='suspect'` 计数
   - `aigc_pending_total` —— 当前 pending 总数
   - `aigc_overview` —— `{fake, suspect, real, pending, skipped, error, week_fake, week_suspect, avg_score}`
2. `execTool` 内实现对应分支，全部走 `applications` 表 `count: "exact", head: true` + `gte("submitted_at", weekAgo)`。RLS 自动按 college 限定，无需改策略。
3. 新增工具 `list_aigc_flagged`：入参 `{ range: "week"|"month", status: "fake"|"suspect"|"both" }`，返回 application_id + 学生姓名/学号 + aigc_score + submitted_at，按 score desc，最多 20 条。
4. 系统提示词新增一条：涉及"AI 生成 / AIGC / 疑似 AI 图片"的提问，必须先调 `query_stats(aigc_*)` 或 `list_aigc_flagged`。

### C. 不动的部分
- 不改 RLS、表结构、学生端、AIGC 检测服务本身。
- 不批量回填那 2 条遗留 pending，由管理员通过新加的「查看清单」自行处理。

---

## 影响文件
- `src/components/AigcStatsPanel.tsx`
- `src/pages/admin/Applications.tsx`（如需支持 `?aigc=pending`，先读后改）
- `supabase/functions/staff-ai-assistant/index.ts`