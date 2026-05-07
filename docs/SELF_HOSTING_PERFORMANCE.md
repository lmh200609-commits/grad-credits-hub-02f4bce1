# 自托管 & 高并发性能优化手册（千级并发）

本文档配合 `.lovable/plan.md` 使用。阶段 1（DB 索引 + RLS 优化 + Realtime filter）已通过迁移和代码改造落地，本文重点说明阶段 2/3/4 的执行细节与运维要点。

---

## 阶段 2：前端查询与 Realtime 改造

### 2.1 去掉 `fetchAll` 全表拉取

目前以下页面在前端拉全表 + 内存 join，学生数到 5000+ 时会非常慢，需要改为服务端分页/聚合：

| 页面 | 当前做法 | 推荐 |
|---|---|---|
| `pages/admin/Dashboard.tsx` | 一次拉全部 applications + roles + profiles | 新建 SQL view `v_admin_dashboard_kpi`，单次 RPC 返回 KPI |
| `pages/teacher/Dashboard.tsx` | 同上 | 同上（按 college_id 过滤） |
| `pages/teacher/Students.tsx` | 拉全部 user_roles + profiles 后前端 join | 服务端 `profiles where exists(user_roles role=student) order by full_name` 加分页（已加 trgm 索引支持模糊搜） |
| `pages/admin/UsersManage.tsx` | 同上 | 同上 |

示例 RPC（放在 migration 里）：
```sql
CREATE OR REPLACE FUNCTION public.dashboard_kpi(_college uuid DEFAULT NULL)
RETURNS TABLE(total int, approved int, pending int, rejected int, total_credit numeric)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status IN ('approved','auto_approved'))::int,
    count(*) FILTER (WHERE status IN ('pending_ai','pending_review'))::int,
    count(*) FILTER (WHERE status IN ('rejected','rejected_by_ai'))::int,
    coalesce(sum(coalesce(final_credit, ai_suggested_credit, 0))
      FILTER (WHERE status IN ('approved','auto_approved')), 0)
  FROM public.applications
  WHERE _college IS NULL OR college_id = _college;
$$;
```

### 2.2 Realtime 已加 filter

本轮已为以下页面补齐 `filter: 'college_id=eq.<id>'`：
- `admin/Dashboard`、`admin/ReviewHub`
- `teacher/Dashboard`、`teacher/Students`
- `Reviews`、`SubmissionRecords`

其余学生端订阅本身已带 `student_id=eq.<uid>` filter，不变。

**自托管 Realtime 注意**：`.env` 增加 `MAX_HEADER_LENGTH=8192`、`REPLICATION_POLL_INTERVAL=300`，并启用 cluster：
```yaml
realtime:
  environment:
    REPLICATION_MODE: RLS
    REPLICATION_POLL_INTERVAL: 300
    SUBSCRIPTION_SYNC_INTERVAL: 60000
    REGION: self
    ERL_AFLAGS: "-kernel inet_dist_listen_min 9100 inet_dist_listen_max 9200"
  deploy:
    replicas: 2
```

### 2.3 React Query 缓存读多写少数据

`colleges`、`keywords`、`rules`、`certificate_types`、`rule_library` 都是变化很慢的字典表。建议引入 `@tanstack/react-query` 缓存（项目已经 dedupe 了）：
```ts
useQuery({ queryKey: ['colleges'], queryFn: () => supabase.from('colleges').select('*').then(r => r.data),
           staleTime: 5 * 60_000 })
```

### 2.4 大列表虚拟化
`@tanstack/react-virtual` 用于 5000+ 行表格（student 管理、submission records）。

---

## 阶段 3：AI 评估异步化

### 3.1 队列表 + worker

```sql
CREATE TABLE public.ai_eval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_queue_pickable ON public.ai_eval_queue (next_run_at)
  WHERE status IN ('queued','failed');
```

申请提交时 trigger 入队：
```sql
CREATE OR REPLACE FUNCTION public.enqueue_ai_eval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pending_ai' THEN
    INSERT INTO public.ai_eval_queue(application_id) VALUES (NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enqueue_ai_eval AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_eval();
```

### 3.2 Worker（Edge Function + pg_cron）

新增 `process-eval-queue`，每 10 秒由 pg_cron 触发一次，每次 `SELECT FOR UPDATE SKIP LOCKED LIMIT 5` 拉一批，控制 AI provider 并发：
```sql
SELECT cron.schedule('ai-eval-tick', '*/10 * * * * *',
  $$ SELECT net.http_post('https://<your-host>/functions/v1/process-eval-queue',
        '{}'::jsonb, '{"Authorization":"Bearer <service-role>"}'::jsonb); $$);
```

### 3.3 AI provider 限流
在 `_shared/ai-router.ts` 加 token-bucket（per-provider QPS / RPM），失败统一退避并写回 `ai_eval_queue.next_run_at = now()+interval`。

### 3.4 import-users 调优
- BATCH_SIZE 500 / CONCURRENCY 20
- 增加 429/503 指数退避
- GoTrue 端调高 `GOTRUE_RATE_LIMIT_HEADER`、`API_EXTERNAL_URL` 后端速率限制

---

## 阶段 4：自托管部署调优

### 4.1 Postgres 配置（16GB / 8 core 参考）
```conf
max_connections = 200
shared_buffers = 4GB
effective_cache_size = 12GB
work_mem = 16MB
maintenance_work_mem = 512MB
wal_buffers = 16MB
checkpoint_completion_target = 0.9
random_page_cost = 1.1   # SSD
effective_io_concurrency = 200
max_worker_processes = 8
max_parallel_workers_per_gather = 4
max_parallel_workers = 8
```

开启扩展：
```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- 已开
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 4.2 连接池：Supavisor (推荐) / PgBouncer

Supavisor `transaction` 模式：
```yaml
supavisor:
  environment:
    POOL_MAX_SIZE: 200
    DB_POOL_SIZE: 25
    DEFAULT_POOL_SIZE: 200
    MAX_CLIENT_CONN: 5000
    POOL_MODE: transaction
```

前端 / PostgREST 都通过 Supavisor 连库（端口 6543）。

### 4.3 PostgREST 横向扩
```yaml
rest:
  environment:
    PGRST_DB_POOL: 80
    PGRST_DB_POOL_TIMEOUT: 10
    PGRST_MAX_ROWS: 1000
    PGRST_DB_USE_LEGACY_GUCS: "false"
  deploy:
    replicas: 3
```
前置 Caddy/Nginx 做轮询负载均衡。

### 4.4 GoTrue (Auth)
```yaml
auth:
  environment:
    GOTRUE_RATE_LIMIT_HEADER: X-RateLimit
    GOTRUE_RATE_LIMIT_EMAIL_SENT: 1000
    GOTRUE_RATE_LIMIT_SMS_SENT: 1000
    GOTRUE_RATE_LIMIT_VERIFY: 1000
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: 1000
    GOTRUE_PASSWORD_MIN_LENGTH: 6
```

### 4.5 Storage + CDN
`application-files`（私有桶）每次访问都签名，QPS 高时给 Storage 服务前置 Nginx 缓存：
```nginx
proxy_cache_path /var/cache/sb levels=1:2 keys_zone=sb:50m max_size=20g inactive=1h;
location /storage/v1/object/sign/ {
  proxy_cache sb;
  proxy_cache_key "$request_uri";
  proxy_cache_valid 200 30m;
  proxy_pass http://storage:5000;
}
```

或迁到 MinIO + CloudFront/Cloudflare R2。

### 4.6 监控
- pg_stat_statements + pgHero（慢查询）
- node_exporter + Prometheus + Grafana（CPU / IO / 连接数）
- Supabase Realtime metrics endpoint
- 应用层：增加请求耗时上报到 `audit_logs.duration_ms`（部分 edge function 已经写了，扩展到所有写操作）

---

## 阶段 1 已完成内容清单（参考）

- 索引：`applications` / `user_roles` / `profiles` / `submission_records` / `audit_logs` / `application_reviews` 共计 14 个新索引
- pg_trgm：`profiles.student_no`、`profiles.full_name` GIN trigram 索引（支持高速 ILIKE 模糊搜）
- RLS：全部 `auth.uid()` 改为 `(SELECT auth.uid())`，避免每行重复求值
- 清理：5 张 `*_backup_20260424` 表已删除
- Realtime：6 个页面的 `applications/profiles` 订阅都加上了 `college_id=eq.<id>` filter

预期收益：
- 学院范围列表查询：10-50x 提速（索引 + RLS 优化叠加）
- Realtime 广播流量：减少 (N-1)/N（N 为学院数）
- Postgres CPU 在高峰期：下降 40-60%