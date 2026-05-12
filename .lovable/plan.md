## 问题

工作助手目前只支持固定时间窗口（近 7 天 / 近 30 天 / 累计），无法回答：

- "昨天/前天提交了几份"
- "近半个月 / 近半年提交了几份"
- "这一学期 / 半学期提交了几份"
- "这一周提交的详细状态"（通过几个、驳回几个、待 AI 几个、待复核几个、AI 疑似几个）
- "还有多少人没有提交"

模型问到这些就只能回"暂不支持该统计"，体验差。

## 修复方案

### 1. 新增"灵活时间窗口"统计工具（后端）

文件：`supabase/functions/staff-ai-assistant/index.ts`

**新增工具 `query_stats_range`**，参数：

- `metric` — 必填，枚举：
  - `submitted_count` — 时间窗口内提交申请总数
  - `submitted_students` — 时间窗口内去重提交学生数
  - `status_breakdown` — 时间窗口内按状态拆分（auto_approved / approved / rejected / rejected_by_ai / pending_review / pending_ai 各多少条）
  - `not_submitted_students` — 时间窗口内**未**提交申请的学生人数（= 范围内学生总数 − 提交过学生数）
  - `aigc_breakdown` — 时间窗口内 AIGC 鉴别拆分（fake / suspect / real / pending）
- `range` — 必填，枚举（覆盖中文常见说法）：
  - `yesterday` / `day_before_yesterday` — 自然日（按本地 Asia/Shanghai 0 点切分）
  - `today`
  - `last_7_days` / `last_15_days` / `last_30_days` / `last_90_days` / `last_180_days` / `last_365_days`
  - `this_week` / `this_month` / `this_year`
  - `this_semester` — 本学期：3-1 ~ 7-15（春）或 9-1 ~ 次年 1-15（秋），按当前日期判断
  - `half_semester` — 学期前/后半段（按当前日期落在前/后判定）
  - `all_time`

实现要点：
- 全部走 Postgres 真实查询（`submitted_at` 为时间锚点；`status_breakdown` 用 `applications.status` 分组；`not_submitted_students` 用 `user_roles.role='student'` 总数 减去窗口内 `distinct student_id`）。
- 学院作用域沿用现有 `CallerCtx`：超管全局，学院管理员/教师按 `college_id` 过滤；`not_submitted_students` 的"学生总数"也按相同作用域取。
- 时区使用 Asia/Shanghai 计算自然日和学期边界，避免 UTC 错位导致"昨天"差一天。

### 2. 系统提示里教模型怎么映射中文到 range

在 `index.ts` 的 SYSTEM 中追加：

> 凡问"昨天/前天/今天/这一周/这一月/这一年/近 X 天/近半月/近半年/这一学期/半个学期"等任何带时间窗口的统计，必须调用 `query_stats_range`，并将中文映射到对应的 `range` 枚举（昨天→yesterday、前天→day_before_yesterday、近半月→last_15_days、近半年→last_180_days、这一学期→this_semester、半个学期→half_semester …）。问"详细状态/审核情况/各种状态多少"必须用 `metric="status_breakdown"`；问"还有多少人没提交/未提交人数"必须用 `metric="not_submitted_students"`。**严禁**用 `query_stats` 的 `_week`/`_total` 指标替代。

保留现有 `query_stats` 不动，向后兼容旧的固定指标（本周通过/驳回、累计提交等）。

### 3. 前端展示（已存在的 `StaffAiAssistant.tsx`）

文件：`src/components/StaffAiAssistant.tsx`

- 在 `METRIC_LABELS` 字典里追加新 key 的中文标签：
  - `submitted_count` → "提交申请数"
  - `submitted_students` → "提交学生数"
  - `status_breakdown` → "状态分布"
  - `not_submitted_students` → "未提交学生数"
  - `aigc_breakdown` → "AI 鉴别分布"
- 卡片渲染逻辑增强：当后端返回的 `stats.value` 是对象（如 status_breakdown 的 `{auto_approved: 3, approved: 5, ...}`）时，改为渲染"标题 + 多行键值"列表，而不是单个大数字。键名同样走中文映射（auto_approved→系统初审通过、approved→人工通过 等）。
- 卡片副标题展示后端返回的 `range_label`（如"昨天"、"近 15 天"、"本学期 (2026-03-01 ~ 2026-07-15)"），让用户清楚口径。

### 4. 验证（必跑）

1. 超管 / 学院管理员 / 教师 三类账号分别提问，结果都要与对应 SQL 一致：
   - "昨天提交了几份" → `query_stats_range(metric=submitted_count, range=yesterday)`
   - "前天提交了几份" → `range=day_before_yesterday`
   - "近半个月提交了几份" → `range=last_15_days`
   - "近半年提交了几份" → `range=last_180_days`
   - "这一学期提交了几份" → `range=this_semester`
   - "半个学期提交了几份" → `range=half_semester`
   - "这一周提交的详细状态" → `metric=status_breakdown, range=this_week`，卡片展示六类计数
   - "还有多少学生没有提交" → `metric=not_submitted_students, range=all_time`
2. 学院管理员/教师查询的数字必须只覆盖本学院（不能等于全平台数）。
3. 卡片不出现英文 key、`status_breakdown` 等原始字符串。

## 范围之外

- 不动 RLS、表结构、其他 Edge Function。
- 不修改 AI 模型 / 鉴权流程。
- 旧的 `query_stats` 固定指标继续保留，避免回归。
