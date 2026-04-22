

# 修复六项问题

## 1. AI 助手数据调用不准（说"2 个"实际只有白雪 1 个）

**根因**：`staff-ai-assistant` Edge Function 的 `query_stats` 工具仅支持 `pending_review / approved_week / rejected_week / total_students / total_apps_month` 五个 metric，不存在「提交人数」「合格人数」「不合格人数」等指标。模型遇到这些问题时**编造数字**。

**修复**：扩充 `query_stats` 的 metric 枚举：
- `submitted_total` — 提交申请的去重学生数（`distinct student_id`，非申请数）
- `submitted_count` — 申请总数
- `passed_students` — 累计学分 ≥ 4 的学生数（合格）
- `failing_students` — 累计学分 < 4 的学生数（不合格）
- `auto_approved_total` — 系统初审通过申请数
- `manual_approved_total` — 人工复核通过申请数
- `rejected_total` — 驳回总数（含 rejected_by_ai + rejected）
- `pending_ai` — 系统核验中数量

每个分支用真实 SQL 查询（COUNT / 聚合），并在系统提示词里**强制要求**：「凡涉及任何数量、人数、统计的提问，必须先调用 query_stats 工具，禁止凭对话上下文猜数字」。同时把可用 metric 列表写进 system prompt，模型遇到不在列表里的统计需求时回复"暂不支持该统计"而不是编。

## 2. 管理员看不到学生提交材料的详细资料和图片

**根因**：`ApplicationDetail.tsx` 第 68-73 行用 `supabase.storage.from("application-files").createSignedUrl(file_path, 3600)` 拿签名 URL。当前 `application-files` 桶是私有桶，**没有 SELECT 策略允许 admin/teacher 读取学生上传的文件** → `createSignedUrl` 返回 null → 附件按钮不显示。同时学生填的 `custom_keywords`（自定义关键词）没渲染出来，也算"详情不全"。

**修复**：
- 新建 storage RLS 策略：`admin` 和 `teacher` 角色可对 `application-files` 桶执行 SELECT（学生只能读自己的，已存在策略不动）
- `ApplicationDetail.tsx`：在「基本信息」卡片中补充渲染 `custom_keywords`（学生自定义关键词）和文件名预览；图片类附件（jpg/png/jpeg/webp）直接 `<img>` 内嵌预览，PDF 仍走「查看附件」按钮

## 3. 教师端看不到 AI 初审的结果

**根因**：`ApplicationDetail.tsx` 第 211 行「系统核验结果」卡片的渲染条件是 `app.ai_reasoning && isReviewer`。当 AI 初审跑完但未生成 `ai_reasoning`（部分边缘情况只写了 `ai_suggested_credit / ai_confidence / ai_matched_rule_id`），整张卡都不显示，教师就看不到任何 AI 结果。

**修复**：把渲染条件放宽为 `isReviewer && (app.ai_reasoning || app.ai_suggested_credit != null || app.ai_matched_rule_id || app.ai_confidence != null || app.status === "rejected_by_ai" || app.status === "auto_approved")`，理由文本若空显示"系统未给出详细理由"。

## 4. 工作助手「快捷指令」太靠下

**根因**：`StaffAiAssistant.tsx` 第 215 行 `TabsContent value="quick"` 用 `flex-1 overflow-auto`，当面板高度有富余时 flex-1 占满空间但内容是 `mt-2 p-3 pt-0`，加上面板用 `min(560px, 100vh-6rem)` 在 611px 视口下被压到 ~530px，TabsContent 内部的 grid 没有 `items-start`/`content-start`，被居中拉伸。

**修复**：
- TabsContent 用 `block`（去掉 flex），加 `data-[state=active]:block`
- grid 容器追加 `content-start` 让卡片**贴顶排列**
- 标题 "点击下方卡片即可一键执行" 行 margin 从 `mb-2` 改为 `mb-3`，整块从 tab 栏正下方开始

## 5. 三端侧边栏太宽

**根因**：`src/components/ui/sidebar.tsx` 第 17 行 `SIDEBAR_WIDTH = "16rem"` (256px)，在 883px 视口下占了近 30%。

**修复**：改为 `SIDEBAR_WIDTH = "12rem"` (192px)，移动端 `SIDEBAR_WIDTH_MOBILE` 保持 `18rem`（移动端用 Sheet 抽屉，宽点更易点）。导航文案最长「批量导入账号」5 个汉字，12rem 完全够。

## 6. 数据库变更（仅一项）

新建 migration：为 `storage.objects` 表 `application-files` bucket 添加 admin/teacher SELECT 策略。

```sql
CREATE POLICY "Staff can read application files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'application-files'
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))
);
```

## 文件改动

**修改**
- `supabase/functions/staff-ai-assistant/index.ts` — 扩充 metric、强化 prompt 防幻觉
- `src/pages/ApplicationDetail.tsx` — 放宽 AI 卡片显示条件、补充自定义关键词、图片内嵌预览
- `src/components/StaffAiAssistant.tsx` — 快捷指令 TabsContent 贴顶布局
- `src/components/ui/sidebar.tsx` — `SIDEBAR_WIDTH` 16rem → 12rem

**新增**
- `supabase/migrations/<新>.sql` — storage admin/teacher SELECT 策略

**不动**
- 其他页面、edge function 鉴权、表结构

## 验收

- 管理员/教师打开任一学生的申请详情 → 能看到学生说明、自定义关键词、AI 系统核验结果（即使无理由文本也显示卡片）、附件图片直接内嵌预览
- 助手问「有多少学生提交了材料」→ 回答"提交申请的学生共 1 人"（白雪），其他统计同样准确
- 助手问「不合格学生有多少」「初审通过多少」「复核通过多少」「本周驳回多少」→ 全部走 query_stats，数字真实
- 助手面板打开 → 「快捷指令」6 个卡片紧贴在 tab 栏下方
- 三端侧边栏宽度肉眼变窄约 25%，主内容区更宽

