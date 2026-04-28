# AI 模型设置功能

## 目标

把目前硬编码使用 DeepSeek / 通义千问 (DASHSCOPE) 的所有 AI 调用，改为通过管理员在前台配置。每个功能模块（学生端 AI 初审、管理员批量导入、教师/管理员 AI 工作助手、文案润色等）都可以**单独**绑定不同厂商、模型、API Key、Base URL，并支持"测试连接"。页面只在管理员端出现。

## 用户可见效果

### 1. 新增页面：`/admin/ai-models`
- 入口：管理员侧边栏新增"AI 模型设置"菜单项（学生端、教师端、教师菜单完全看不到）。
- 页面顶部：**提供商配置（凭据）** 卡片列表
  - 卡片字段：名称、厂商预设（DeepSeek 深度求索 / 阿里通义千问 / 智谱 GLM / Moonshot Kimi / 月之暗面 / 百度文心 / 自定义 OpenAI 兼容）、Base URL、API Key（写入时加密保存，读取时只显示"已配置"+ 末 4 位）、备注。
  - 选择厂商预设会自动填充 Base URL。
  - 操作：新增 / 编辑 / 删除 / **测试连接**（调用一次最便宜的 chat 接口，返回延迟和 ok / 错误码）。
- 页面下半：**功能与模型绑定** 表格，一行一个功能：

| 功能 | 默认厂商 | 模型名 | 操作 |
|---|---|---|---|
| 学生端-AI 初审 (`evaluate-application`) | 通义千问 | `qwen3-vl-32b-thinking` | 切换 |
| 管理员-批量导入解析 (`ai-parse-roster`) | 通义千问 | `qwen-plus` | 切换 |
| 管理员-导入失败解释 (`ai-explain-import`) | 通义千问 | `qwen-turbo` | 切换 |
| 管理员-导入助手对话 (`import-assistant-chat`) | 通义千问 | `qwen-turbo` | 切换 |
| 管理员/教师-AI 工作助手 (`staff-ai-assistant`) | DeepSeek | `deepseek-chat` | 切换 |
| 学生端-学分助手 (`ask-credit-assistant`) | DeepSeek | `deepseek-chat` | 切换 |
| 文案润色 (`polish-answer`) | DeepSeek | `deepseek-chat` | 切换 |

每行可下拉选"提供商"+ 输入"模型名"，保存。每行右侧显示当前生效的厂商、模型、Base URL（脱敏）。

### 2. 学生端 / 教师端 完全无变化（也无入口）。

## 技术实现

### 数据库（一次迁移）

新增两张表（均启用 RLS，仅 `admin` 可读写；普通用户和匿名一律拒绝）：

```sql
-- 凭据表
create table public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,                       -- 用户起的名字，如"我的 DeepSeek"
  vendor text not null,                     -- deepseek | qwen | zhipu | kimi | wenxin | custom
  base_url text not null,                   -- 例 https://api.deepseek.com/v1
  api_key_encrypted text not null,          -- pgsodium / pgcrypto 加密；不返回明文
  api_key_last4 text not null,              -- 仅末 4 位，前端展示
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 功能 → 模型映射
create table public.ai_function_bindings (
  id uuid primary key default gen_random_uuid(),
  function_key text unique not null,        -- evaluate-application 等
  provider_id uuid references public.ai_providers(id) on delete restrict,
  model text not null,                      -- 调用时使用的 model 名
  updated_at timestamptz not null default now(),
  updated_by uuid
);
```

- API Key 用 `pgcrypto` 的 `pgp_sym_encrypt` 加密，密钥放 secret `AI_KEY_ENCRYPTION_SECRET`（由我们用 `add_secret` 让用户生成）。
- 读取明文只在 edge function 内部用 service role 完成，前端永远拿不到。
- RLS：`select / insert / update / delete using (public.has_role(auth.uid(), 'admin'))`，且 `api_key_encrypted` 列前端永不直接 select（前端只 select 不含密钥的视图 `ai_providers_safe`）。

### 共享辅助模块（新增）

`supabase/functions/_shared/ai-router.ts`：
```ts
export async function getAiConfig(functionKey: string): Promise<{
  baseUrl: string; apiKey: string; model: string; vendor: string;
}>;
export async function callChat(functionKey, messages, opts): Promise<Response>;
```
- 内部用 service role 查 `ai_function_bindings` join `ai_providers`，调用 `pgp_sym_decrypt` 解出 API Key。
- 所有厂商统一走 OpenAI 兼容 `${base_url}/chat/completions`。
- 命中失败时回退到原来的环境变量（保证升级期间不挂）。

### 改造 edge functions（保留原有业务逻辑，只换 AI 调用层）
- `evaluate-application`、`ai-parse-roster`、`ai-explain-import`、`import-assistant-chat`、`staff-ai-assistant`、`ask-credit-assistant`、`polish-answer`：把 `Deno.env.get("DASHSCOPE_API_KEY"|"DEEPSEEK_API_KEY")` + 硬编码 endpoint 替换成 `getAiConfig(<function_key>)`。
- 失败时返回 `{ error, retryable: true }`，沿用现有重试 UI。

### 新增 edge function

`ai-provider-admin`（仅管理员可调用，verify_jwt = true，函数内二次校验 has_role admin）：
- `POST /list_providers` → 不返回密钥
- `POST /upsert_provider` → 接收明文 key，函数内加密落库
- `POST /delete_provider`
- `POST /test_provider` → `{ provider_id }` 或 `{ vendor, base_url, api_key, model }`，内部发一条最小请求，返回 `{ ok, latency_ms, status, sample }`
- `POST /list_bindings` / `POST /upsert_binding`

### 前端

- 新增 `src/pages/admin/AiModels.tsx`：上半"提供商管理"，下半"功能绑定"表格。
- 在 `src/App.tsx` 增加路由 `/admin/ai-models`，包 `<RoleRoute role="admin">`。
- 在管理员侧边栏（`AppLayout.tsx`）添加菜单项；学生/教师菜单完全不引用。
- 厂商预设清单：
  - DeepSeek `https://api.deepseek.com/v1`，模型示例 `deepseek-chat` / `deepseek-reasoner`
  - 通义千问 `https://dashscope.aliyuncs.com/compatible-mode/v1`，示例 `qwen-plus` / `qwen-turbo` / `qwen3-vl-32b-thinking`
  - 智谱 GLM `https://open.bigmodel.cn/api/paas/v4`，示例 `glm-4-plus`
  - Moonshot Kimi `https://api.moonshot.cn/v1`，示例 `moonshot-v1-8k`
  - 百度文心（OpenAI 兼容代理）`https://qianfan.baidubce.com/v2`
  - 自定义：用户填 base_url / model
- "测试连接"按钮：发一条 "ping" 用户消息，max_tokens=5，超时 8s；展示绿色 ✓ / 红色 ✗ + 错误信息 + 延迟 ms。

## 兼容性 / 迁移

- 首次部署时自动 `INSERT` 一条默认 binding：把所有 7 个 function_key 指到现有的 DASHSCOPE / DEEPSEEK 凭据（用一条迁移读 secret 写库），保证零中断。
- 现有 `DASHSCOPE_API_KEY` / `DEEPSEEK_API_KEY` secret 保留作为兜底。

## 安全要点

- API Key 全程加密，前端永远拿不到明文。
- `ai_providers` / `ai_function_bindings` RLS 仅 admin 可读写。
- 测试连接的明文 key 只允许从管理员会话经 edge function 内部使用；测试结果不回显完整密钥。
- 不在客户端硬编码任何 key；不暴露 service_role。

## 需要你授权的事项（实施时会请求）
1. 数据库迁移（新增 2 张表 + RLS + 加密扩展）。
2. 新增 secret `AI_KEY_ENCRYPTION_SECRET`（用于加密存储用户填入的 API Key）。
3. 新建 / 部署上述 edge function 与改造现有 7 个 edge function。

确认后我即开始实施。
