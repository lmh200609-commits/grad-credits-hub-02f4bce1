## 改动一：关键词库默认收起

文件：`src/pages/student/Apply.tsx`

把"自定义关键词"卡片中第 621–643 行的「关键词库（往届人工通过沉淀）」整块用 `Collapsible` 包裹：

- 触发器一行：`BookOpen` 图标 + 文案「关键词库（共 N 个，点击展开作为参考）」+ 右侧 `ChevronRight` / `ChevronDown` 图标，整行可点击。
- 默认 `open=false`，不点击则保持收起，节省版面。
- 展开后展示 chips 列表（保留现有 `slice(0, 20)` 的 + 添加交互），点击 chip 仍是一键加入自定义关键词；并把上限从 20 提升到 40 + 一句"仅供参考"提示。
- 使用项目内已有的 `@/components/ui/collapsible`（Radix），无需新增依赖。

不影响 step 完成度逻辑、不影响提交校验。

## 改动二：AI 助手对"挑战杯"等词检索失败

根因（已用 SQL 验证）：
- "挑战杯"在 `cases` 表（案例库）多条记录里出现，但 `rules` 表里没有任何规则名称/keywords 包含"挑战杯"。
- 现有 `ask-credit-assistant` 仅对 `rules` 做打分，case 只在命中 rule 后通过 `rule_id` 回带，导致输入"挑战杯"完全检索不到任何上下文，触发"未找到相关认定规则"兜底。
- 另外，中文 tokenizer 把句子切成单字，案例库里的"挑战杯"不会按整词参与打分。

文件：`supabase/functions/ask-credit-assistant/index.ts`

调整检索流程（仅服务端，不动前端调用方式）：

1. **新增 cases 直接打分检索**：
   - 加载 `cases.title, summary, awarded_credit, notes, rule_id`（限制 500 条）。
   - 复用 `scoreRule` 思路新增 `scoreCase(query, c)`：把 `title + summary + notes` 拼成字段串做 token 计数；额外做"整词包含"加分——遍历用户原始 query 中的 2~6 字中文连续片段（用正则 `/[\u4e00-\u9fa5]{2,6}/g` 抽取，如"挑战杯"），若片段在 case 文本中出现则 `score += 5`。同样的整词包含加分也加到 `scoreRule`，让"挑战杯/三创赛/英语四级"这类整词命中 keywords/description 时大幅加权。
   - 取案例 top 5。

2. **合并上下文**：
   - 当 rules 命中为空但 cases 命中非空时，**不再返回兜底"未找到相关认定规则"**，改为基于案例库构造回答上下文，并在 system 提示里说明"以下为相关历史案例，可据此解释，但需明确告知学生这是案例参考、最终学分以教师复核为准"。
   - 当 rules 与 cases 都命中：把两者一并写入 RAG 上下文（保留现有 `===== 检索到的规则 =====` + `===== 相关案例 =====` 结构，案例段落用新打分结果，去掉只能跟 `rule_id` 关联的限制）。
   - 兜底（rules+cases 都为 0 命中）仍返回原"未找到"提示。

3. **学生端数据源对齐**（次要）：在 SYSTEM_PROMPT 里增加一句"案例库（cases）与规则库（rules）同为合法依据，案例库优先用于解释相似情形"，使回答口径与申请页"仅来自案例库"的设定一致。

不改动调用方式、返回结构，前端 `AiAssistant.tsx` 无需修改。

## 验证

- 申请页：进入 `/apply`，"自定义关键词"卡片中"关键词库"那一行默认折叠，点击后展开 chips，再次点击收起。
- 助手：在悬浮窗输入"挑战杯"应能给出基于案例的「结论 / 依据 / 补充」三段答复，引用类似"挑战杯…国家级一等奖…10 学分"的案例。

## 涉及文件

- `src/pages/student/Apply.tsx`
- `supabase/functions/ask-credit-assistant/index.ts`
