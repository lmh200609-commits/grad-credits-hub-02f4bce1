

# 计划：三张新表 + 三端 AI 助手接入

## 一、数据库改动

### 1. `certificate_types`（证书类型字典，自动汇总，只读）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| name | text unique | 证书/成果类型，如「英语六级」「SCI论文」「计算机高级」 |
| category | text | 来自 rules.category（如 论文/竞赛/英语/职业证书）|
| level | text | 级别，如 国家级/省级/六级/高级 |
| typical_credit | numeric | 该类型在 rules 中的典型学分 |
| source_rule_ids | uuid[] | 关联的 rules.id |
| source_case_ids | uuid[] | 关联的 cases.id |
| keywords | text[] | 命中关键词 |
| occurrence_count | int | 在 cases 中出现次数 |
| last_synced_at | timestamptz | |

- RLS：所有 authenticated 可 SELECT，仅 admin 可 INSERT/UPDATE/DELETE。
- 通过函数 `refresh_certificate_types()`（SECURITY DEFINER）扫描 `rules + cases + keywords`，按 (category, level, name) 去重写入。一次性首次填充，后续每天/手动刷新。

### 2. `profiles` 字段扩展（不另建学生信息表）
为 `profiles` 增加：`id_card text`、`gender text`、`enrollment_year int`、`political_status text`、`birth_date date`、`address text`、`emergency_contact text`、`emergency_phone text`。
- 密码继续由 `auth.users` 管理，**绝不进库**。
- RLS 沿用现有策略（学生看自己、教师/管理员可看全部）。
- 新增字段 `id_card` 设置为 admin/teacher/本人可读，避免横向越权。

### 3. `submission_records`（材料提交流水表）
每次「提交 / AI 初审 / 教师复核 / 补交 / 撤回」各一条事件记录。
| 字段 | 说明 |
|---|---|
| id, application_id, student_id, student_no（冗余便于检索）|
| event_type | enum: submitted / ai_reviewed / manual_reviewed / resubmitted / withdrawn |
| actor_id, actor_role, actor_name |
| ai_decision, ai_confidence, ai_suggested_credit, ai_matched_rule_id, ai_reasoning |
| review_decision, review_credit, review_note, matched_rule_id |
| file_path, description_snapshot, keywords_snapshot |
| created_at |

- RLS：学生只能 SELECT 自己；teacher/admin 可 SELECT 全部；只允许 service_role 写入。
- 由 edge function（evaluate-application、复核 API）写入；同时建 `applications` 的 AFTER INSERT/UPDATE 触发器自动补流水，保证历史完整。

### 4. `submission_summary`（材料汇总视图）
`CREATE VIEW`，每份 application 一行，关联 profiles + 最新一条 AI 流水 + 最新一条复核流水：
`student_no, full_name, department, application_id, status, submitted_at, ai_decision, ai_confidence, ai_suggested_credit, ai_reasoning, final_credit, reviewer_name, review_note, reviewed_at, file_path`。AI 助手优先查这张视图。

## 二、AI 助手接入

### A. 教师/管理员助手 `staff-ai-assistant` 新增 4 个工具
1. `student_full_profile(query)` — 通过学号/姓名定位学生，返回 profiles 全字段 + 累计学分 + 申请数。
2. `student_submission_history(student_no, limit?)` — 从 `submission_summary` 拉该生全部申请，含 AI 初审结论与教师复核结论。
3. `submission_timeline(application_id)` — 从 `submission_records` 拉单份申请的完整时间线。
4. `certificate_type_lookup(keyword)` — 在 `certificate_types` 检索匹配的证书类型 + 典型学分 + 关联规则。

System Prompt 追加约束："凡涉及学生个人信息、提交记录、复核记录、证书类型，必须先调用对应工具，禁止凭记忆回答；找不到就回答'数据库中暂无该信息'。"

### B. 学生助手 `ask-credit-assistant` 扩展
- 默认：继续 RAG 公共规则知识（rules + rule_library + cases + keywords + certificate_types）。
- 新增工具/分支：识别"我的"类问题（"我累计多少学分"/"我之前那份…如何"），通过 JWT 中 `auth.uid()` 调用 `submission_summary` 仅过滤 `student_id = 当前用户`。
- System Prompt 强约束：禁止访问其他学生数据；非学分相关问题继续拒绝。

### C. 安全
- 学生端 edge function 改为 `verify_jwt = true` 或在代码里强制校验 JWT 并使用 `auth.uid()`；查询 `submission_summary` 始终带 `student_id = auth.uid()` 过滤。
- 教师端继续 service_role，但由前端确保只在 teacher/admin 角色处展示。

## 三、技术细节

```text
rules ─┐
cases ─┼──(refresh fn)──> certificate_types ──┐
keywords ─┘                                     │
                                                ▼
applications ──(trigger)──> submission_records ──> submission_summary (view)
profiles (扩展实名字段)                          ▲
                                                │
                       ┌────────────────────────┴────────────────────┐
              staff-ai-assistant                              ask-credit-assistant
        (4 个新工具，全表可读)                          (公共知识 + 自己的数据)
```

迁移文件：1 个 schema migration（建表/视图/触发器/函数/RLS）+ 1 个 data 写入（首次 `refresh_certificate_types()`）。
代码改动：`supabase/functions/staff-ai-assistant/index.ts`、`supabase/functions/ask-credit-assistant/index.ts`、`supabase/functions/evaluate-application/index.ts`（写入流水）、`src/integrations/supabase/types.ts` 自动重生成。

## 四、用户需要确认

执行前请批准 1 个数据库迁移；之后我会更新 3 个 edge function。所有 AI 回答严格基于上述表/视图，找不到数据即明确告知"数据库中暂无该信息"，绝不虚构。

