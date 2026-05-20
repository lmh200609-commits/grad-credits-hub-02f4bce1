# 全站错误信息中文化方案

## 问题
当前各处调用 `supabase.functions.invoke(...)` 后，如果云函数返回 4xx/5xx，Supabase SDK 抛出的 `error.message` 就是英文的 `"Edge Function returned a non-2xx status code"`，真正的报错原因藏在 `error.context`（一个 Response 对象）里没人去读。结果用户看到的就是图里那条听不懂的英文。除此之外，还有 PostgREST 错误码（`23505` 唯一约束、`42501` 权限、`PGRST116` 没找到等）、网络超时、`storage` 上传失败等同类问题，弹出的也是英文或技术术语。

同时部分提示用的是默认（白色）样式，按要求所有"失败/错误"都应改为红色（`variant: "destructive"` 或 `toast.error`）。

## 解决思路

### 1) 新建统一翻译工具 `src/lib/errors.ts`
导出两个核心函数：

- `explainError(err, fallback?)`：把任意错误对象（SDK error、Response、Error、字符串…）转成 `{ title, description }` 中文。
  - 自动 `await err.context?.json()` / `.text()` 把云函数真实返回的 `{ error: "..." }` 抽出来。
  - 命中常见模式映射成人话，例如：
    - `non-2xx status code` → 标题"操作失败"，描述用云函数返回的中文 error 字段；若拿不到则回退到"服务暂时不可用，请稍后再试"。
    - `Failed to fetch` / `NetworkError` / `TypeError: fetch` → "网络连接失败，请检查网络后重试"。
    - `AbortError` / `timeout` → "请求超时，请稍后再试"。
    - PostgREST `code: 23505` → "该记录已存在（重复数据）"。
    - PostgREST `code: 23503` → "存在关联数据，无法删除"。
    - PostgREST `code: 42501` / `permission denied` → "没有权限执行该操作"。
    - PostgREST `code: PGRST116` → "未找到对应数据"。
    - `JWT expired` / `invalid token` → "登录已过期，请重新登录"（沿用现有 sessionGuard）。
    - `row-level security` → "权限不足，无法访问该数据"。
    - 文件上传 `Payload too large` / `413` → "文件过大，请压缩后重试"。
    - 其它未知错误：标题"操作失败"，描述显示原始 message 但去掉 stack/英文 prefix。
- `toastError(err, fallbackTitle?)`：内部调用 `explainError` 并以红色弹框弹出（自动判别用的是 `sonner` 还是 `useToast` —— 项目里两种都在用，为兼容做两个变体）：
  - `toastError(...)`（基于 `hooks/use-toast`，`variant: "destructive"`）
  - `toastErrorSonner(...)`（基于 `sonner` 的 `toast.error`）

- `invokeFunction<T>(name, options)`：封装 `supabase.functions.invoke`，调用失败时自动抛出已翻译好的 `Error`（message 即中文），调用方只要 `try/catch` 即可。可选用。

### 2) 替换所有现有错误处理
逐个改造下列文件，把 `error.message` 直接弹给用户的地方换成 `toastError(error)` / `toastErrorSonner(error)`：

- 图里出现的位置（人脸比对入口）：`src/components/FaceMatchAlert.tsx`
- AIGC 相关：`src/components/AigcDetectAlert.tsx`、`src/pages/admin/AigcAdmin.tsx`
- 用户管理：`src/pages/admin/UsersManage.tsx`、`src/components/SingleUserDialog.tsx`、`src/components/BulkUserDialog.tsx`、`src/pages/super/Admins.tsx`、`src/pages/teacher/Students.tsx`
- AI 相关：`src/components/AiAssistant.tsx`、`src/components/StaffAiAssistant.tsx`、`src/pages/admin/AiModels.tsx`
- 申请/审核：`src/pages/student/Apply.tsx`、`src/pages/ApplicationDetail.tsx`、`src/pages/admin/SubmissionWindows.tsx`、`src/pages/admin/WindowReport.tsx`、`src/pages/admin/ImportUsers.tsx`、`src/pages/admin/PurgeAndBootstrap.tsx`
- 课程库三页（最近改的）：`src/pages/admin/Rules.tsx`、`src/pages/admin/Cases.tsx`、`src/pages/admin/Keywords.tsx`
- 数据库直查的地方（`.from(...).select/.insert/.update/.delete()` 报错）也走同一函数翻译

确保所有"失败"提示都是红色（`destructive` / `toast.error`），白色信息提示只保留在"成功/中性提示"。

### 3) 顺带：让云函数返回更人话的 error
现状：`supabase/functions/*/index.ts` 大多已经 `return new Response(JSON.stringify({ error: "..." }), { status: 400 })`，但部分函数返回的是英文（如 `"missing fields"`、`"forbidden"`）。在这次范围内只做"前端翻译兜底"，**不修改云函数文案**（避免影响后端契约）；如果云函数已返回中文，前端会直接展示。

### 4) 自检
- 找一个一定会失败的入口（如未登录调 `face-compare`、对没有人脸的图重试）触发一次，确认弹出的是红色中文气泡而不是 "Edge Function returned a non-2xx status code"。
- 全局 `rg "error.message"` 复核没有漏网。

## 范围之外
- 不改云函数业务逻辑、不改库表结构、不改 RLS。
- 不做 i18n 多语言框架，统一硬编码中文（项目本身就是中文）。

## 大致代码示意
```ts
// src/lib/errors.ts
export async function explainError(err: unknown): Promise<{title:string; description:string}> {
  // 1. Supabase Functions SDK 错误：读取 err.context（Response）拿真实 JSON
  // 2. PostgrestError：按 err.code 映射
  // 3. 网络/超时/权限/JWT 兜底
  // 4. 默认回退
}

export function toastError(err: unknown, fallback = "操作失败") {
  explainError(err).then(({title, description}) =>
    toast({ title: fallback ?? title, description, variant: "destructive" })
  );
}
```

实现后，图里那条提示会变成类似：
> **人脸比对失败**
> 服务暂时不可用或图片中未检测到清晰人脸，请稍后再试。
（红色弹框）
