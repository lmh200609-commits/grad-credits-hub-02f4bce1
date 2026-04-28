# 修复教师端 / 管理员端 / 学生端的实时同步

## 问题诊断

通过排查代码与数据库迁移，找到两个根本原因：

### 原因 1：只有 `applications` 一张表加入了 Realtime 发布
迁移文件 `20260420170018_*.sql` 只做了：
```sql
ALTER TABLE public.applications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;
```

但 `ApplicationDetail.tsx` 还订阅了 `application_reviews` 表，由于这张表 **没加入 publication**，订阅会一直失败 → 落回 30 秒轮询，所以详情页的"复核记录"必须刷新才能看到。

`submission_records` 表（提交记录页用）同理也没加入发布。

### 原因 2：多个关键页面根本没有接入实时订阅
通过 `rg` 扫描，目前只有 4 个页面用了 `useRealtimeTable`：
- `MyApplications.tsx` ✅
- `Reviews.tsx` ✅
- `SubmissionRecords.tsx` ✅
- `ApplicationDetail.tsx` ✅

但这些页面**没有**订阅，全靠 `useEffect` 一次性加载：
- `src/pages/Index.tsx`（学生工作台首页）
- `src/pages/admin/Dashboard.tsx`（管理员数据看板）
- `src/pages/admin/ReviewHub.tsx`（**复核中心** —— 管理员审完后这里数字不更新）
- `src/pages/teacher/Dashboard.tsx`（教师数据看板）
- `src/pages/teacher/Students.tsx`（教师学生列表，含已获学分）

所以教师审完一条申请后：
- 学生工作台首页数字不变 → 必须刷新
- 管理员看板的"待审/已审"数字不变 → 必须刷新
- 另一个老师的复核中心队列不变 → 必须刷新

### 附加问题：订阅断线后只有 30 秒兜底轮询
`useRealtimeTable.ts` 在 `CHANNEL_ERROR / TIMED_OUT / CLOSED` 时退化为 30s 轮询，对"实时同步"来说体感太慢，且没有自动重连。

---

## 修复方案

### 1. 数据库迁移：把所有需要实时的表加入发布
新建一份迁移：

```sql
ALTER TABLE public.application_reviews REPLICA IDENTITY FULL;
ALTER TABLE public.submission_records  REPLICA IDENTITY FULL;
ALTER TABLE public.profiles            REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.application_reviews;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.submission_records;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### 2. 增强 `useRealtimeTable` Hook
- 订阅断线后做 **指数退避自动重连**（2s → 4s → 8s，封顶 30s），而不是只靠 30s 轮询。
- 兜底轮询频率从 30s 调到 **10s**，保证在 Realtime 完全不可用时也能在十秒内同步。
- 暴露 `onStatusChange` 回调（可选），便于以后做"连接状态"指示灯。

### 3. 给以下页面接入实时订阅
全部用现成的 `useRealtimeTable("applications", reload, ...)`，按角色加 filter：

| 页面 | 订阅表 | filter |
|---|---|---|
| `pages/Index.tsx`（学生首页） | `applications` | `student_id=eq.${user.id}` |
| `pages/admin/Dashboard.tsx` | `applications` | 全表 |
| `pages/admin/ReviewHub.tsx` | `applications` | 全表 |
| `pages/teacher/Dashboard.tsx` | `applications` | 全表 |
| `pages/teacher/Students.tsx` | `applications` | 全表（用于刷新"已获学分"列） |

为避免连续 INSERT/UPDATE 触发太多请求，给重新加载函数加 **300ms debounce**（用 `useRef + setTimeout` 实现，不引入新依赖）。

### 4. （可选小优化）顶部加一个连接状态指示
在 `AppLayout.tsx` header 右侧加一个小绿点/灰点，表示当前 Realtime 是否连通。仅作可视化反馈，不阻塞功能。

---

## 验证步骤
1. 教师 A 在"待审核"批准一条申请 → 学生 B 的"我的申请"和"工作台首页"应在 ~1 秒内自动出现状态变化，不刷新。
2. 同时打开两个管理员窗口，A 在复核中心审一条 → B 的复核中心列表与计数自动减 1。
3. 学生提交新申请 → 教师"待审核"页面不刷新就能看到新行。
4. 断网 5 秒再恢复 → 重连后自动收到错过的变更（依赖步骤 2 的指数退避重连）。

## 涉及文件
**新增**
- `supabase/migrations/<timestamp>_add_realtime_publications.sql`

**修改**
- `src/hooks/useRealtimeTable.ts`（重连 + 更短轮询 + debounce 工具）
- `src/pages/Index.tsx`
- `src/pages/admin/Dashboard.tsx`
- `src/pages/admin/ReviewHub.tsx`
- `src/pages/teacher/Dashboard.tsx`
- `src/pages/teacher/Students.tsx`
- 可选：`src/components/AppLayout.tsx`（连接指示点）
