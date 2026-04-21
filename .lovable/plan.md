

# 教师/管理员 AI 工作助手 + 后台 UI 重构（使用国产大模型）

在原计划基础上，将 AI 提供方从 Lovable AI Gateway 切换为**国产大模型**（DeepSeek 或 通义千问），与现有 `ask-credit-assistant` 保持一致的技术栈。

## 一、模型选型

**默认使用 DeepSeek**（`deepseek-chat`），与现有 `ask-credit-assistant/index.ts` 一致：
- 已有 `DEEPSEEK_API_KEY` secret，无需新增配置
- 国内访问稳定、低成本、支持 function calling
- 备选 `qwen-plus`（通义千问），通过 `provider` 参数切换，复用 `DASHSCOPE_API_KEY`

端点：
- DeepSeek：`https://api.deepseek.com/chat/completions`
- 千问：`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`

两者均兼容 OpenAI Chat Completions 格式 + tool calling，前端无需差异化处理。

## 二、StaffAiAssistant 全局助手（新增）

`src/components/StaffAiAssistant.tsx`：
- 右下角紫色渐变悬浮按钮（区别学生端蓝色），仅 `admin` / `teacher` 可见
- 420×620 面板，Tab：「智能问答」/「快捷指令」
- 快捷指令 6 项：待我审核 / 不合格学生 / 数据看板 / 查学生档案 / 导出排名 / 本周新提交
- 自然语言指令示例：
  - "调出张三的学分档案" → 跳 `/teacher/students/{id}`
  - "查看不合格学生" → 跳 `/admin/credits?passFilter=fail`
  - "打开复核中心" → 跳 `/admin/review`
  - "本月被拒申请数" → 直接给数字 + 跳转按钮

## 三、Edge Function — `staff-ai-assistant`（新增）

`supabase/functions/staff-ai-assistant/index.ts`：
- 入参：`{ messages, role, provider? }`，`provider` 默认 `deepseek`，可选 `qwen`
- 调用 DeepSeek/千问 chat completions API + **function calling**
- 暴露工具：
  - `navigate_to(path, query?)`
  - `find_student(query)` — 后端 ilike 查 profiles
  - `query_stats(metric, filters?)` — 聚合 applications/credits
  - `list_failing_students(threshold?)`
- 系统提示词约束：仅服务教师/管理员业务、只能调用预定义工具、多匹配让用户选择
- 兼容学生侧 `ask-credit-assistant` 的错误处理（429 / 401 / 402）
- 返回：`{ answer, action?: { type, payload }, candidates? }`

## 四、前端响应处理

- `action.type === "navigate"` → `useNavigate().navigate(payload.path)`
- `action.type === "candidates"` → 在气泡内渲染候选学生卡片，点击跳转
- `action.type === "stats"` → 渲染数字 + 跳转按钮
- 复用 `supabase.functions.invoke("staff-ai-assistant", ...)`

## 五、AppLayout 集成

```tsx
{hasRole("student") && <AiAssistant />}
{(hasRole("admin") || hasRole("teacher")) && <StaffAiAssistant />}
```

## 六、教师端 UI 重构（对齐学生端风格）

- `src/pages/Index.tsx` 教师工作台：`PageHeader` + `StatCard×4`（待我审核 / 今日已审 / 本周通过率 / 我管理学生）+「AI 快速操作」chip 横条 + 待审核 Top5 + 学生关注榜
- `src/pages/teacher/Students.tsx`：`PageHeader` + 紧凑筛选卡 + 学分进度条列 + 状态 Badge
- `src/pages/teacher/StudentDetail.tsx`：`PageHeader` + 学生信息卡 + StatCard×4 + Card 包裹申请列表

## 七、管理员端 UI 重构

- `src/pages/admin/Dashboard.tsx`：`PageHeader`（带「打开复核中心」主按钮）+ 统一 `StatCard×6` + 图表 Card 阴影 + 4 列快捷入口
- `src/pages/admin/ReviewHub.tsx`：`PageHeader` + 渐变状态卡 + AI 提示条
- `src/pages/admin/Credits.tsx`：`PageHeader` + StatCard×4 + 不达标行 `bg-danger/5` + URL 参数 `?passFilter=fail|pass|all`
- `UsersManage / Cases / Rules / AuditLogs / ImportUsers`：统一 `PageHeader` + `shadow-card`
- `src/pages/Reviews.tsx`：`PageHeader` + 胶囊 Tabs + 行 hover + Badge

## 八、URL 参数协议（供 AI 直接跳转）

- `/admin/credits?passFilter=fail|pass|all&dept=xxx`
- `/reviews?status=pending_review`
- `/teacher/students/{id}`
- `/admin/users/students?search=张三`

## 九、Secret 需求

- ✅ `DEEPSEEK_API_KEY`（已存在，主用）
- ⚪ `DASHSCOPE_API_KEY`（已存在，备用千问）
- 无需新增任何 secret

## 十、文件清单

**新增**
- `src/components/StaffAiAssistant.tsx`
- `supabase/functions/staff-ai-assistant/index.ts`
- `supabase/config.toml` 注册新函数（`verify_jwt = true`）

**修改**
- `src/components/AppLayout.tsx`（按角色挂载助手）
- `src/pages/Index.tsx`（教师工作台增强 + AI chip 横条）
- `src/pages/teacher/Students.tsx`、`teacher/StudentDetail.tsx`
- `src/pages/admin/Dashboard.tsx`、`ReviewHub.tsx`、`Credits.tsx`、`UsersManage.tsx`、`Cases.tsx`、`Rules.tsx`、`AuditLogs.tsx`、`ImportUsers.tsx`
- `src/pages/Reviews.tsx`
- 新增页面 URL 参数解析逻辑

**不动**
- 数据库 schema、RLS、`AiAssistant.tsx`（学生侧仍用 DeepSeek）、其他 Edge Function

## 十一、验收

- 教师/管理员每页右下角看到紫色 AI 按钮
- "查看不合格学生" → 自动跳 `/admin/credits?passFilter=fail` 并筛选
- "调出张三档案" → 唯一匹配直跳，多匹配出选择卡
- "打开复核中心" → 跳 `/admin/review`
- 所有教师/管理员页面具备统一 PageHeader、StatCard、shadow-card、语义色 Badge

