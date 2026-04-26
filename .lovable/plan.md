## 目标

在原有 AI 初审基础上，新增三项能力：

1. **身份核验**：材料中出现的「学号 / 姓名 / 院系 / 班级 / 身份证号」必须与学生账号 `profiles` 一致；任一不符 → 强制驳回。
2. **逻辑性核验**：检测常识性错误（如 CET-4 满分仅 710，材料显示 720；GPA 超上限；时间倒置；证书编号格式异常等）→ 强制驳回。允许 AI 用通识知识 + **联网查询**做辅助判断，但必须以材料证据为主。
3. **空白字段判定**：材料中出现「学校：—— / 学校：______ / 学校：（空）」「院系：—— / 院系：（空）」等占位符且未填写 → 直接判定材料无效驳回。**默认学校 = 长春财经学院**：若材料未写学校，但其他身份字段都对得上，则视为长春财经学院；若材料明确写了别的学校，则与默认值不符 → 驳回。

## 技术改动

### 1) 数据库迁移（`applications` 新增 8 列）

```sql
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ai_check_identity_match  boolean,   -- 身份信息一致性
  ADD COLUMN IF NOT EXISTS ai_check_logic           boolean,   -- 逻辑合理性
  ADD COLUMN IF NOT EXISTS ai_check_completeness    boolean,   -- 材料字段完整性（无空白占位）
  ADD COLUMN IF NOT EXISTS ai_identity_mismatch     text,      -- 身份不符的中文说明
  ADD COLUMN IF NOT EXISTS ai_logic_issue           text,      -- 逻辑错误的中文说明
  ADD COLUMN IF NOT EXISTS ai_blank_fields          text,      -- 检测到的空白字段（如「学校、院系」）
  ADD COLUMN IF NOT EXISTS ai_detected_student_no   text,
  ADD COLUMN IF NOT EXISTS ai_detected_school       text;      -- 图片中识别到的学校
```

### 2) `supabase/functions/evaluate-application/index.ts`

**a. 拉取学生完整档案**：`profiles.select` 扩展为 `full_name, student_no, department, class_name, id_card`，同时硬编码 `DEFAULT_SCHOOL = "长春财经学院"`，一并写入 prompt 的 `student_profile` 段（身份证仅传末 4 位脱敏）。

**b. 系统提示词新增三段 + 联网授权：**

- **C. 身份核验** → `identity_match_ok` + `identity_mismatch_detail`
  - 材料未出现身份字段 → `true`，detail = "材料未包含身份信息"
  - 出现学号/姓名/院系/班级/身份证 → 与 `student_profile` 逐项严格比对，任一不符 → `false`，detail 写明具体差异。
  - **学校特别规则**：默认学校为长春财经学院；材料若未写学校 → 视为一致；材料明确写了其他学校（且非"长春财经学院"等价表述）→ `false`。

- **D. 逻辑性核验** → `logic_ok` + `logic_issue_detail`
  - 检测常识错误：四级/六级满分 710；GPA 上限 4.0/5.0；分数 / 名次 / 颁发日期是否合理。
  - **允许联网查询**：当遇到无法仅靠通识判断的赛事 / 证书 / 期刊真伪时，可调用 `web_search` 工具核实（见下方 c 项），但 reasoning 中必须注明「材料证据为主，联网信息辅助」。
  - 命中 → `false`，detail 用中文写明（如「材料显示 CET-4 = 720 分，CET-4 满分仅 710 分，分数不合理」）。

- **E. 完整性核验** → `completeness_ok` + `blank_fields_detail`
  - 检测「学校：____ / 学校：—— / 学校：（） / 院系：__」等任何字段名后留白 / 占位符（中英文括号、下划线、横线、星号、空白）。
  - 命中任一空白关键字段（学校 / 院系 / 班级 / 姓名 / 学号 / 项目名 / 颁发单位） → `false`，detail = "材料中『学校、院系』字段为空白未填写"。

**c. 工具 schema 扩展**：在 `submit_evaluation` 之外新增一个 `web_search` function tool，让模型可在需要时主动调用：

```typescript
tools: [
  { type: "function", function: { name: "web_search",
      parameters: { type: "object",
        properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "submit_evaluation", ...原 schema 加新字段... } },
],
tool_choice: "auto",   // 由 auto 替代强制
```

**调用循环**：保留原 single-shot 改为最多 2 轮。若模型返回 `web_search` → 后端用 `https://api.tavily.com` 或简单的 DuckDuckGo HTML 抓取（已可用，无需新 secret，使用 `fetch` + `r.jina.ai` 代理获取摘要文本，限 800 字），把结果作为 `tool` 角色消息追加，再调一次模型；第二次必须直接调用 `submit_evaluation`。设硬上限 2 次 web_search，避免成本失控。

**新字段加入 submit_evaluation 的 properties + required：**

```typescript
identity_match_ok, identity_mismatch_detail,
logic_ok, logic_issue_detail,
completeness_ok, blank_fields_detail,
detected_student_no, detected_school
```

**d. 服务端硬规则扩展（接现有 `failedChecks` 路径）：**

```typescript
if (result.identity_match_ok === false) failedChecks.push("身份核验");
if (result.logic_ok === false)          failedChecks.push("逻辑性核验");
if (result.completeness_ok === false)   failedChecks.push("材料完整性");
```

→ 复用既有「任一失败 → 强制 reject + 90% 置信」逻辑，并把三个 detail 字段拼到 `overrideNotes` 与 reasoning。

**学校兜底**：服务端再做一次正则保险——若 `detected_school` 非空且既不包含「长春财经」也不在已知等价别名（"CCUFE"），覆盖 `identity_match_ok = false`，detail 追加「材料学校『…』不属于长春财经学院」。

**e. 落库**：把 8 个新列写入 `applications` 更新语句。

**f. reasoning 模板**：固定结构追加「身份核验：…；逻辑性：…；完整性：…」三段。

### 3) `src/components/AiVerdictCard.tsx`

- 「核验项」区块新增三行：身份信息一致性、逻辑合理性、材料完整性，复用 `<CheckRow ok={...} />`。
- 任一为 `false` 时，下方显示对应的红色细体说明（`ai_identity_mismatch` / `ai_logic_issue` / `ai_blank_fields`）。
- 「图片实际识别」追加「学号」「学校」两行。
- TS 接口同步新增 8 字段。

### 4) 类型同步

迁移成功后 `src/integrations/supabase/types.ts` 自动重生成，无需手改。

## 不在范围

- 不改学生端 UI（学生只看 `reasoning_short`，会自动出现「身份信息不符 / 字段空白未填写 / 分数超出常识范围」之类一句话）。
- 不改 `Reviews.tsx` / `ReviewHub.tsx` 列表（仍按 review_source 区分 AI/学生申诉）。
- 联网检索仅作为辅助，硬规则与材料证据始终优先。
