## 目标
把「复核中心」从纯卡片页扩展为可直接审核的工作台：保留状态卡片摘要 + 嵌入审核列表 + 状态筛选 + 行内多选批量通过/驳回 + 行内详情侧弹（Sheet），不离开页面即可处理大批量申请。

## 数据库
现有 schema 已能支持，无需迁移：
- `applications`：可更新 `status` / `final_credit` / `final_reviewer_id` / `final_review_note` / `reviewed_at`（RLS：`apps reviewer update scoped` 允许 admin/teacher 在本学院范围）
- `application_reviews`：插入 `action='teacher_review'|'admin_review'`、`decision`、`credit`、`note`（RLS：`reviews insert by reviewer`）
- 触发器 `log_submission_event` 自动写入 `submission_records`，无需前端额外动作

仅在 `ApplicationDetail.tsx` 中已存在的"通过沉淀案例库"逻辑：批量通过场景为提速，**不**自动沉淀新案例（否则一次操作可能产生大量低质量案例），保留单条详情通过时沉淀。

## 改动清单

### 1. `src/pages/admin/ReviewHub.tsx` — 工作台改造
- 顶部保留摘要：把 6 个状态卡片改为一行紧凑 chips（点击切换筛选，而非跳转 `/reviews`）
- 新增筛选区：
  - 状态筛选：`pending_review`（默认）/ `auto_approved` / `rejected_by_ai` / `pending_ai` / `approved` / `rejected` / `finished` / `all`
  - 复核来源（仅 `pending_review`）：`all` / `ai_uncertain` / `student_appeal`
  - 学生姓名/学号搜索（防抖）
- 新增列表（复用 `Reviews.tsx` 数据查询逻辑，抽取到 `useApplicationsList` 钩子供两边共用）：
  - 列：复选框 / 学生 / 说明 / 建议学分 / 置信度 / 状态 / 提交时间 / 行内操作（查看 / 通过 / 驳回）
  - 复选框支持「全选当页」+ 顶部已选条数统计 + 「批量通过」「批量驳回」按钮
  - 仅当所选行的状态 ∈ {`pending_review`, `auto_approved`, `rejected_by_ai`, `pending_ai`} 时启用按钮，其它状态禁用
  - 分页（PAGE_SIZE=50）+ Realtime 自动刷新

### 2. 新增 `src/components/ApplicationDetailSheet.tsx`
- 用 `Sheet`（右侧抽屉，`sm:max-w-2xl`）包装一个**只读 + 简化操作**的详情视图
- 内容：学生信息、说明、关键词、文件预览（沿用 `application-files` storage signed URL）、AI 判定卡片、最终学分输入、备注输入、通过/驳回按钮
- 操作逻辑直接复用 `ApplicationDetail.tsx` 中 `decide()` 的核心写库流程，抽到 `src/lib/applicationActions.ts`
- 不复制 `ApplicationDetail.tsx` 的全部高级功能（人脸比对、证书生成、关键词推断），那些仍只在 `/applications/:id` 完整页

### 3. 新增 `src/lib/applicationActions.ts`
导出三个函数：
- `decideOne(appId, decision, credit, note, reviewerId, isAdmin)` — 写 `application_reviews` + 更新 `applications`
- `decideBatch(appIds[], decision, defaultCredit, note, reviewerId, isAdmin)` — 顺序串行调用 `decideOne`，收集成功/失败计数；驳回时 `credit=null`；通过时若某行 `final_credit/ai_suggested_credit` 已有值则用其，否则用 `defaultCredit`
- 返回 `{ ok: number, fail: number, errors: string[] }` 用于 toast 汇总

### 4. 抽取列表查询钩子 `src/hooks/useApplicationsList.ts`
- 输入 `{ tab, sourceFilter, search, page, pageSize }`
- 输出 `{ rows, total, profiles, reviewCounts, loading, reload }`
- 同步 `useRealtimeTable("applications", reload)`
- 同时被 `Reviews.tsx` 与 `ReviewHub.tsx` 使用，避免代码漂移

### 5. `src/pages/Reviews.tsx`
- 改为消费 `useApplicationsList`，行为不变；额外把同样的批量勾选 + 批量操作能力下放到这里（与 ReviewHub 体验一致）

### 6. 顶部入口
- 不动路由；侧边栏的「复核中心」继续指向 `/admin/review`，超级管理员侧边栏也同样可见
- `ReviewHub` 顶部保留 `→ 全部审核` 链接跳到 `/reviews`（保留专用页）

## 边界与确认
- 批量通过弹一个 `AlertDialog` 提示「将对 X 条申请按各自的建议学分通过，无建议学分的使用你输入的默认值（默认 1）」
- 批量驳回弹 `AlertDialog`，必须填一行「批量驳回原因」，否则禁止
- 失败行（RLS / 不在同学院 / 状态非可改）在 toast 中给出数量与首条错误，整体不回滚（每条独立事务）
- 仅 `admin` / `super_admin` 在 ReviewHub 内可批量操作（teacher 仍能进入但批量按钮隐藏）；详情侧弹的单条操作 teacher 也可用

## 风险
- Realtime 在批量更新中可能抖动，使用 `useSerializedReload` 避免重复请求
- 一次批量超过 100 条时，加 `progress` toast；不加并发以免触发限流
