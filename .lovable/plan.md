

# 隐藏 AI 审核环节 — 学生侧文案与状态脱敏

学生不应感知"AI 预审"的存在。所有面向学生的文案、状态、流程图都统一改为"已提交 / 审核中 / 已通过 / 已拒绝"，把 AI 与教师复核合并成一个"审核中"黑盒。

## 一、文案改动

**1. `src/pages/student/Apply.tsx`**
- 顶部副标题：去掉「AI 将在 1 分钟内完成预审」→ 改为「四步完成认定申请，提交后将进入审核流程」
- 提交成功 toast：由当前的「已提交，AI 正在评估…」改为「提交成功，正在等待审核」
- 提交后不再显示 AI 评估结果对话框 / 进度条；如有"立即查看 AI 结论"等按钮一并移除
- 模板说明、FAQ、提示文案中所有"AI / 智能预审 / 系统核验"等字样，统一替换为「审核」「审核老师」

**2. `src/pages/student/MyApplications.tsx`**
- 表格列若有「AI 置信度 / AI 建议学分 / AI 理由」列 → 学生视图隐藏
- 状态列做映射（见下）

**3. `src/pages/ApplicationDetail.tsx`（学生角色访问时）**
- 隐藏区块：AI 推理 `ai_reasoning`、AI 置信度、匹配规则来源、`application_reviews` 中 `action = ai_evaluation` 的记录
- 仅展示：申请信息、附件、最终状态、教师批注（如有）
- 教师 / 管理员访问该页时保持原样（按 `useAuth().hasRole` 分支渲染）

**4. `src/components/StatusBadge.tsx`**
- 学生侧状态显示映射（新增 `audience?: "student" | "staff"` prop，默认 staff 不变）：
  - `auto_approved` → 「已通过」（绿）
  - `rejected_by_ai` → 「已拒绝」（红）
  - `pending_review` → 「审核中」（黄）
  - `approved` → 「已通过」、`rejected` → 「已拒绝」、`submitted` → 「已提交」
- 学生看到的所有 Badge 走 `audience="student"`

**5. `src/components/ProcessSteps.tsx` 调用处（学生工作台 & Apply 页）**
- 学生侧步骤由「提交 → AI 审核 → 教师复核 → 结果」改为 **「提交材料 → 审核中 → 审核完成」** 三步
- 教师工作台保持原步骤不变

**6. `src/pages/Index.tsx`（学生工作台）**
- StatCard / 最近申请 / ProcessSteps 全部使用脱敏后的状态文案
- 移除任何"AI 已自动通过 X 件"等表述

**7. `src/components/AiAssistant.tsx`**
- 组件名对外不暴露；学生入口处的标题 / 提示从「AI 助手」改为「智能问答」「学分助手」（保留功能，仅去掉"AI"字样以保持一致体感）—— 若用户希望保留"AI 助手"名称仅用于咨询场景，可不改，待确认

## 二、不改动

- 数据库枚举值、`evaluate-application` Edge Function、`application_reviews` 写入逻辑、教师 / 管理员后台展示 — 后台仍能看到 AI 评估明细
- 提交流程依旧调用 AI 预审，只是前端不告知学生

## 三、文件清单

**修改**
- `src/pages/student/Apply.tsx`
- `src/pages/student/MyApplications.tsx`
- `src/pages/ApplicationDetail.tsx`
- `src/pages/Index.tsx`
- `src/components/StatusBadge.tsx`
- `src/components/ProcessSteps.tsx`（如内置默认步骤含 AI 字样）

## 四、验收

- 学生端任何页面、toast、状态、流程图均搜索不到「AI / 智能预审 / 系统核验 / 置信度」字样
- 提交后只看到「提交成功，正在等待审核」，详情页只看到最终状态与教师批注
- 教师 / 管理员后台功能与可见信息完全不变

