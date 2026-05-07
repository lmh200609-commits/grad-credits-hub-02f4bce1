# 性能与并发优化方案（千级并发 / 自托管）

## 一、体检结论（关键发现）

### 数据库层（高影响）
1. **索引缺口**（千级并发下会成主瓶颈）：
   - `applications` 没有 `(college_id, status, submitted_at DESC)` 复合索引 → 学院管理员翻页/筛选会走顺扫
   - `applications` 没有 `(student_id, submitted_at DESC)` → 学生「我的申请」列表慢
   - `applications.status='pending_review'` 是审核台高频查询，缺 partial index
   - `submission_records` 没有 `(college_id via app, created_at DESC)` 时间索引
   - `audit_logs` 已有 created_at DESC 索引 ✓
   - `profiles(college_id, role via user_roles)` 联表多，缺 `user_roles(college_id, role)` 复合索引
2. **冗余备份表**：`*_backup_20260424` 4 张表占空间 + 影响 `pg_stat` 噪声，可归档/删除
3. **RLS 函数性能**：`has_role` / `current_user_college_id` / `is_super_admin` 是 STABLE SECURITY DEFINER，但每行都会调用。可以用 `(SELECT auth.uid())` 包裹改写策略，让 PG 缓存结果（Supabase 官方优化范式）

### 前端查询层（中高影响）
1. **`fetchAll` 批量拉全表**在 `Dashboard / UsersManage / Students / Reviews` 都在用 —— 学生 5000+ 时一次拉回 5MB+ JSON，浏览器卡顿、Postgres CPU 飙升
2. **N+1 / 多次串行查询**：`UsersManage`、`Dashboard` 同时拉 user_roles + profiles + applications 后在前端 join，应改为：
   - 后端 `view` 或 RPC 一次性聚合
   - 或服务端分页 + `select(..., count: 'exact')`
3. **Realtime 全表订阅**：多个页面订阅整个 `applications` 表，千并发下 Realtime 服务器会广播海量事件给每个客户端 → 必须加 `filter=college_id=eq.xxx`

### Edge Function 层
1. **`evaluate-application`**：每次申请提交都同步调用 AI（DeepSeek/Qwen），千级并发会瞬间打满 AI provider 配额并拖垮 Edge Runtime
2. **`import-users`** 已经做了 BATCH_SIZE=200 + CONCURRENCY=10，但 Auth admin API 在自托管 GoTrue 下默认 rate limit 较低，需调高
3. **`reset-password` / `bulk-reset-password`** 等无队列、无背压

### 部署层（自建 Docker Compose）
1. **PgBouncer / Supavisor 必须开启**（事务模式），否则千并发会直接耗尽 Postgres `max_connections`
2. **PostgREST** 默认 `db-pool=10`，需提升到 50-100
3. **Realtime** 默认单进程，需根据连接数横向扩
4. **Storage**（`application-files` 私有桶）大量证明材料，需要 CDN/缓存

---

## 二、分阶段实施方案

### 阶段 1：数据库索引与 RLS 优化（**本次先做**，影响最大、风险最低）

**新增索引**（迁移文件）：
```text
applications:
  - (college_id, status, submitted_at DESC)
  - (student_id, submitted_at DESC)
  - partial: (submitted_at DESC) WHERE status IN ('pending_review','pending_ai')
  - partial: (college_id, submitted_at DESC) WHERE status='pending_review'

user_roles:
  - (college_id, role)
  - (role) partial WHERE role='student'

profiles:
  - (college_id, full_name)         -- 学生列表搜索/排序
  - GIN trigram on student_no       -- 学号模糊搜索（pg_trgm）
  - GIN trigram on full_name

submission_records:
  - (student_id, created_at DESC)
  - (created_at DESC)

audit_logs:
  - (action, created_at DESC)
```

**RLS 策略改写**：把所有 `auth.uid()` 包成 `(SELECT auth.uid())`，让 Postgres planner 把它当常量缓存（10x 提升典型）

**清理**：归档 4 张 `*_backup_20260424` 备份表（导出后 DROP）

### 阶段 2：前端查询与 Realtime 改造

1. **去掉 `fetchAll` 全表拉取**：
   - `UsersManage` / `Students` / `ReviewHub` → 服务端分页 + count:exact + 搜索关键字下推
   - `Dashboard` 统计 → 改为 PG 聚合 view 或 RPC 一次返回 KPI
2. **Realtime 加 filter**：所有 `useRealtimeTable("applications", ...)` 必须传 `filter: 'college_id=eq.<xxx>'`，学生页传 `student_id=eq.<uid>`
3. **React Query 引入**：用 `@tanstack/react-query` 缓存 colleges/keywords/rules 等"读多写少"数据（已在 dedupe 列表里），避免每次切页都重拉
4. **虚拟化大列表**：`react-virtual` 用于 5000+ 行的学生表

### 阶段 3：AI 评估异步化与背压

1. **新增 `ai_eval_queue` 表**：申请提交时只入队，不直接调 AI
2. **后台 worker**：单个 Edge Function `process-eval-queue` 用 cron 每 10s 拉一批（5-10 条），并发可控地调 AI provider
3. **超时 / 重试 / 死信**：失败入 `ai_eval_failures` 供管理员重试
4. **AI provider 限流**：在 `_shared/ai-router.ts` 增加 token bucket（per-provider QPS 限制）
5. **import-users**：把 BATCH_SIZE 提到 500，但增加 retry-with-backoff 处理 Auth API 429

### 阶段 4：自托管部署调优（提供 docker-compose 片段 + 文档）

1. **PgBouncer/Supavisor**：事务池、pool_size=200
2. **PostgREST**：`db-pool=80`，多副本（2-4 实例）+ HAProxy/Caddy
3. **GoTrue**：`GOTRUE_RATE_LIMIT_*` 调高
4. **Realtime**：开启 cluster 模式，分片订阅
5. **Storage + CDN**：建议前置 Caddy/Nginx 做 `application-files` 的签名 URL 缓存，或接入 MinIO + CDN
6. **PG 配置**：`shared_buffers=4GB / effective_cache_size=12GB / max_connections=200 / work_mem=16MB`（按 16GB 内存机型）
7. **监控**：pgHero / pg_stat_statements / Grafana + node_exporter

---

## 三、本次执行范围（建议先做阶段 1 + 关键 Realtime filter）

**小步快跑**，避免一次性改太多。本轮：
1. 创建索引迁移（阶段 1 全部）
2. RLS 策略 `auth.uid()` 包裹改写
3. 删除 4 张 backup 表
4. 给所有 `useRealtimeTable("applications" / "submission_records" / "profiles", ...)` 补齐 college_id / student_id filter（无需大改逻辑）
5. 输出 `docs/SELF_HOSTING_PERFORMANCE.md` —— 阶段 2/3/4 的执行手册

阶段 2-4 涉及较多业务代码改造，确认后再分别开 PR。

---

## 技术细节

- 索引使用 `CREATE INDEX CONCURRENTLY` 避免锁表（生产环境）
- `pg_trgm` 扩展需 `CREATE EXTENSION IF NOT EXISTS pg_trgm`
- RLS 包裹示例：`USING ((SELECT auth.uid()) = student_id)` 替代 `USING (auth.uid() = student_id)`
- Realtime filter 仅支持 `=` `in` 等基础操作符，复杂场景仍需后端轮询兜底（已有 `useRealtimeTable` 的 polling fallback）
- AI 队列推荐用 `pg_cron` + `SELECT FOR UPDATE SKIP LOCKED` 实现轻量级队列，无需引入 Redis