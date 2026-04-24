# 计划

## 问题分析

### 问题 1：李明的二次人工复核没有生效
查询数据库发现：李明的申请目前 `status='rejected'`（已被管理员驳回一次），且 `application_reviews` 中只有 1 条 `admin_review` 记录——也就是说，**学生点击"申请二次人工复核"按钮根本没有把状态改成 `pending_review`**，所以教师/管理员端自然看不到。

根本原因在 `applications` 表的 RLS 策略 `apps student update own pending`：

```
status = ANY (ARRAY['pending_ai', 'pending_review', 'rejected_by_ai'])
```

这条策略**没有包含 `approved` 和 `rejected`**，因此学生在教师已复核后调用 `update({ status: 'pending_review' })` 会被 RLS 静默拦截，前端虽 toast "已转人工复核" 但数据库未更新。

### 问题 2：教师/管理员端缺少"提交记录"快捷浏览页
现有 `/reviews` 是按状态分 tab 的复核列表；用户希望另有一个**纯浏览**的提交记录页：列表显示姓名/状态/关键词，点击行从底部滑出抽屉直接看详情，不离开列表。

---

## 实施方案

### 1. 修复二次复核 RLS（数据库迁移）

更新 `apps student update own pending` 策略，把 `approved` 和 `rejected` 也纳入允许范围，但通过 `WITH CHECK` 限制学生只能把状态改回 `pending_review`（不能擅自改成 approved/rejected），且不能修改 `final_credit / final_review_note / final_reviewer_id` 等结论字段（保持原值）。

```sql
DROP POLICY "apps student update own pending" ON public.applications;

CREATE POLICY "apps student update own"
ON public.applications FOR UPDATE TO authenticated
USING (student_id = auth.uid())
WITH CHECK (
  student_id = auth.uid()
  AND status IN ('pending_ai','pending_review','rejected_by_ai')
);
```
说明：`USING` 不再限制状态以便学生可以从 `rejected/approved` 发起二次复核；`WITH CHECK` 强制目标状态必须是上述三种之一，学生无法把申请直接改成 approved。

### 2. ApplicationDetail 二次复核交互修复
- `requestManualReview` 后端如果实际未变更（受 RLS 限制时），增加判断：从返回的 data 长度或 `select()` 验证状态实际变更，失败则提示"无权限申请，请联系管理员"。
- 教师/管理员视角下，若 `isReReview`，在审核操作卡片顶部突出显示"⚠ 学生第 N 次申诉，请重点核查"。

### 3. 新增"提交记录"页（核心功能）

**路由**：`/submissions`，教师 + 管理员可见。

**侧边栏**：在 `adminItems` 和 `teacherItems` 中新增菜单项「提交记录」，图标用 `History`。

**页面**：`src/pages/SubmissionRecords.tsx`
- 顶部：搜索框（姓名/学号）+ 状态多选筛选（全部/待复核/已通过/已拒绝/系统未通过）+ 时间范围。
- 列表表格：列 = 学生姓名 · 学号 / 状态徽章 / 关键词（合并 `selected_keywords` + `custom_keywords`，最多显示前 4 个 + "+N"）/ 提交时间 / 二次复核标记。
- 行点击：打开 **Sheet（侧滑抽屉，side="bottom"）**，高度约 85vh，内容直接复用一个轻量版申请详情（说明、关键词、附件预览、AI 结论、复核记录）。
- 抽屉底部固定按钮：「打开完整页面」跳转 `/applications/:id`、「关闭」。
- 支持键盘 ↑/↓ 在列表行间切换，自动更新抽屉内容（快捷浏览）。
- 列表分页 50 条/页，使用 `TablePagination`，与 `Reviews.tsx` 一致。

**复用**：抽屉内详情封装为独立组件 `src/components/ApplicationDetailPanel.tsx`，只读模式（不显示复核操作表单），同时供未来其他场景复用。

### 技术细节

| 文件 | 改动 |
|---|---|
| `supabase/migrations/<new>.sql` | 重建 `applications` 学生 UPDATE 策略 |
| `src/App.tsx` | 新增 `/submissions` 路由，`RoleRoute role={["teacher","admin"]}` |
| `src/components/AppLayout.tsx` | adminItems / teacherItems 加「提交记录」菜单 + `extraTitles` |
| `src/pages/SubmissionRecords.tsx` | 新建列表 + 抽屉页 |
| `src/components/ApplicationDetailPanel.tsx` | 新建只读详情面板（抽取自 ApplicationDetail 的展示部分） |
| `src/pages/ApplicationDetail.tsx` | `requestManualReview` 增加结果校验；二次复核警示徽章已存在，确认无回归 |

### 不做的事
- 不动 `Reviews.tsx` 已有的"待复核/已完成"业务流，仅做并行的浏览入口。
- 不修改 `application_reviews` 表结构。
- 不抽取 ApplicationDetail 的复核表单逻辑（避免引入回归）。

---

## 验收

1. 登录李明账号，进入已被驳回的申请详情，点击「申请二次人工复核」→ 状态变为 `pending_review`，教师/管理员 `/reviews` 待复核 tab 出现该条并带「⚠ 第 2 次复核」徽章。
2. 教师/管理员侧边栏出现「提交记录」，点击进入看到全量列表；点击任意行从底部滑出详情抽屉，可上下键切换；点击「打开完整页面」跳转到现有详情页。
