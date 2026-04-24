## 学生端申请流程调整

### 目标
1. 学生端"直接搜索"和"关键词导航"的内容**只来自案例库**（cases），不再使用 rules 表/keywords 表作为来源。
2. 图片证明材料改为**必填**。
3. 取消"必须匹配到学分规则"的提交校验，只要满足"选择/自定义至少一个关键词" + "上传了图片" 即可提交并进入 AI 初审。
4. 后端 AI 初审：**佐证材料只来自案例库**，不再以 rules 作为命中目标。

### 前端改动 — `src/pages/student/Apply.tsx`

**数据来源（仅案例库）**
- 移除 `rules` 表加载逻辑；移除 `keywords` 表加载逻辑（关键词库展示）。
- 改为初始化时从 `cases` 表加载（取最新若干百条，含 title/summary/awarded_credit），统一映射为现有 `Rule` 结构（`source: "case"`），用于：
  - 关键词导航的四级维度选项（来自 `parseCaseKeywords(summary)` 解析的 project/achievement/level/identity）
  - 直接搜索结果（替代原 ruleMatches + caseMatches，统一为 cases）
  - 热门关键词（按 cases 中 achievement 频次）
  - 自定义关键词建议库（用 cases 中出现的关键词聚合后展示，而非 keywords 表）

**关键词导航**
- `nextOptions` 维度选项与 `filteredRules` 全部基于 cases 派生数据。
- "已选规则卡"展示的"预计学分"改为"参考学分"，注明"来自相似案例平均，仅供参考"。

**图片证明材料 → 必填**
- 步骤 4 标题描述：`PDF / 图片，必须上传，单个文件 ≤ 10 MB`。
- 文件类型限制为图片（`accept="image/*"`），描述同步：`仅支持 JPG / PNG / WEBP 等图片格式，最大 10 MB`（按用户原话"图片证明材料"理解为限图片；如保留 PDF，会在技术细节里说明）。
- `checklist` 中"已上传证明材料"去掉 `optional`，改为必填项；准备清单中显示"必填"标识。
- `submit()` 增加校验：`if (!file) return toast({ title: "请上传图片证明材料", variant: "destructive" })`。

**取消"必须匹配学分规则"的限制**
- 修改 `src/lib/schemas.ts` 的 `applySchema`：
  - 移除/不再使用 `rule_id`（保留为可选 nullable，但不强制 uuid）。
  - 保留"至少 1 个关键词"约束。
- `submit()` 中删除/忽略 `rule_id` 校验路径（`selectedRule?.id` 不再传入 schema 校验）。
- 顶部 `STEPS` 文案微调：
  - 步骤 1：`选择关键词` / `从案例库搜索或导航`
  - 步骤 3：改为 `上传材料`（必填）
  - 步骤 4 文案对应保持"提交审核"。
- "申请说明"卡片标题描述改为：`可选。可补充活动详情；提交不强制要求填写`。

**已选"规则"语义**
- 保留 `selectedRule` 仅作为关键词来源（自动把 case 派生的 4 维写入 picked），不再作为提交必备。

### 后端改动 — `supabase/functions/evaluate-application/index.ts`

**佐证仅来自案例库**
- 移除从 `rules` 表加载并匹配 candidate 的逻辑。
- `candidate` / `detectedRule` / `effectiveRule` / `matched_rule_id` / `suggestedCredit` 全部改为基于 cases：
  - 用学生关键词在 cases 中按 title/summary ilike 匹配，作为 `candidate_case`，建议学分 = 该 case 的 `awarded_credit`。
  - AI 返回的 detected_* 同样在 cases 中再次匹配，得到 `detected_case`。
  - `matched_rule_id` 写入 `null`（applications.ai_matched_rule_id 字段保留为 null，因为不再指向 rules）。
  - `ai_suggested_credit` 取自匹配到的 case `awarded_credit`，无匹配则为 null。
- `relatedCases` 逻辑保留并加强（仍然作为 reference_cases 传入 prompt）。
- 系统提示词中"认定范围参考"保留，但删除/弱化"匹配规则"措辞，强调"以历史通过案例为参考"。
- 自动通过 / 拒绝 / 转人工的判定阈值不变。

**说明**：因 `applications.ai_matched_rule_id` 是非外键的 uuid 列，写 null 不影响 schema；无需数据库迁移。

### 准备清单（侧栏）更新
- 项 1：`已选择/添加关键词`（合并原"规则" + "关键词"，因为不再要求规则）。
- 项 2：`已上传图片证明材料`（必填，去掉"推荐"）。
- 项 3：`申请说明`（可选）。
- 完成度计算同步调整。

### 不变项
- 教师端 / 管理员端 UI 与逻辑不变。
- 数据库 schema 不变；rules / keywords 表仍由管理员维护，仅学生端不再展示作为搜索源。
- AI 详情页面对教师展示的 `ai_matched_rule_id` 字段，匹配为空时 UI 已能容错（之前 case 来源也是 null，无需额外改动；如发现详情页强依赖会一并兜底）。

### 文件清单
- `src/pages/student/Apply.tsx` — 数据源切换为 cases、文件必填、提交校验调整、文案。
- `src/lib/schemas.ts` — `applySchema` 移除 rule_id 强校验。
- `supabase/functions/evaluate-application/index.ts` — 佐证与建议学分仅基于 cases。
