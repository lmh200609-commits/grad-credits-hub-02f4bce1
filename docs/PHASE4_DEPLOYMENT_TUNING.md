# 阶段 4：自建 Supabase 部署调优（千级并发）

目标：在 Docker Compose 自建 Supabase 上承载 200–2000 并发，
覆盖 Postgres、连接池、PostgREST、GoTrue、Realtime、Storage、监控。

本文是**部署侧 Runbook**，无需改代码。按顺序执行，每步都有验收命令。

---

## 0. 服务器规格基线

| 并发 | CPU | 内存 | 磁盘（SSD/NVMe） |
|------|-----|------|------------------|
| 200  | 4   | 8 GB | 100 GB           |
| 1000 | 8   | 16 GB | 200 GB          |
| 2000 | 16  | 32 GB | 500 GB（独立 PG 节点更稳） |

建议：**Postgres 单独一台机器**，其它服务（PostgREST/GoTrue/Realtime/Storage/Kong）放第二台。

---

## 1. PostgreSQL 参数（`postgresql.conf`）

下面是 8 vCPU / 16 GB 内存的推荐基线。其它规格按比例调整。

```ini
# 连接
max_connections = 200            # 走连接池后不需要更高；过高反而拖慢
superuser_reserved_connections = 5

# 内存
shared_buffers = 4GB             # ≈ 25% 物理内存
effective_cache_size = 12GB      # ≈ 75% 物理内存
work_mem = 16MB                  # 单 query 排序/HashJoin
maintenance_work_mem = 512MB
wal_buffers = 16MB

# 并发
max_worker_processes = 8
max_parallel_workers = 8
max_parallel_workers_per_gather = 4

# WAL / checkpoint
wal_compression = on
checkpoint_timeout = 15min
max_wal_size = 4GB
min_wal_size = 1GB
checkpoint_completion_target = 0.9

# 计划器
random_page_cost = 1.1           # SSD/NVMe
effective_io_concurrency = 200

# 日志（监控慢查询）
log_min_duration_statement = 500 # 记录 >500ms 的查询
log_lock_waits = on
log_temp_files = 0

# 扩展
shared_preload_libraries = 'pg_stat_statements,pg_cron,pgaudit'
pg_stat_statements.track = all
```

应用：
```bash
docker compose restart db
psql -c "SHOW shared_buffers;"
psql -c "SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;"
```

---

## 2. 连接池：Supavisor（推荐）或 PgBouncer

自建 Supabase 默认带 Supavisor。**所有应用层（PostgREST、Edge、worker）都走 6543 端口**，
不要直连 5432。

```ini
# Supavisor / PgBouncer
pool_mode = transaction
default_pool_size = 25            # 每个数据库的常驻后端数
max_client_conn = 2000            # 客户端可同时连入的上限
server_idle_timeout = 60
```

验收：
```bash
psql -p 6543 -c "SHOW pool_mode;"
# 压测时观察后端连接：
psql -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY 1;"
# active 应 ≤ default_pool_size，不堆积 idle in transaction
```

> 注意：用 6543 时 **不能用 prepared statements with names**（会跨连接复用失败）。
> Supabase JS 客户端默认 OK；自写 Node/Deno 直连请关闭 prepared cache。

---

## 3. PostgREST 横向扩展

单进程 PostgREST 在 1000 并发会成为瓶颈（CPU 单核）。在 docker-compose 中加副本：

```yaml
rest:
  image: postgrest/postgrest:v12.x
  deploy:
    replicas: 3                  # 200 并发=1, 1000=3, 2000=6
  environment:
    PGRST_DB_POOL: 30
    PGRST_DB_POOL_TIMEOUT: 10
    PGRST_DB_URI: postgres://authenticator:***@supavisor:6543/postgres
    PGRST_DB_MAX_ROWS: 1000      # 防止误用全表查询
    PGRST_DB_PREPARED_STATEMENTS: false   # 走 6543 必须关
```

Kong/Nginx 上游加权重：`upstream rest { server rest1; server rest2; server rest3; }`。

---

## 4. GoTrue（Auth）速率限制

集中提交 / 集中登录场景下 GoTrue 容易触发 429。调高速率（按校规要求权衡）：

```env
GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For
GOTRUE_RATE_LIMIT_EMAIL_SENT=100        # 默认 30/h
GOTRUE_RATE_LIMIT_TOKEN_REFRESH=300     # 默认 150/5min
GOTRUE_RATE_LIMIT_VERIFY=300
GOTRUE_RATE_LIMIT_OTP=300
GOTRUE_DB_MAX_OPEN_CONNECTIONS=20
```

`import-users` 边缘函数的 `auth.admin.createUser` 不走该限速（service-role），
但 Auth 服务本身仍受 DB 连接数限制 → **务必走 6543**。

---

## 5. Realtime 副本与频道控制

前端已按 `college_id` 过滤（阶段 1）。在 Compose 中加副本：

```yaml
realtime:
  deploy: { replicas: 2 }
  environment:
    DB_POOL: 20
    REPLICATION_POLL_INTERVAL: 100
    SECURE_CHANNELS: "true"
    SLOT_NAME: realtime_slot
```

建议：**只对 `applications` / `submission_records` 启用 Realtime**，其它表关闭。
在 SQL 中显式：
```sql
ALTER PUBLICATION supabase_realtime SET TABLE public.applications, public.submission_records;
```

---

## 6. Storage + CDN

证书图片访问压力 = 学生提交 + 教师审核反复看，单点 storage-api 会被打爆。

- 在 storage 前面挂 **Nginx 反向代理 + 本地磁盘缓存**（或 MinIO + CDN）
- 静态资源缓存头：`Cache-Control: public, max-age=86400, immutable`
- 私有附件用 Signed URL（有效期 30 min），通过缓存层服务

示例（Nginx）：
```nginx
proxy_cache_path /var/cache/storage levels=1:2 keys_zone=stor:100m max_size=20g inactive=7d;
location /storage/v1/object/ {
  proxy_cache stor;
  proxy_cache_key "$scheme$host$request_uri";
  proxy_cache_valid 200 1h;
  proxy_pass http://storage:5000;
}
```

---

## 7. AI worker 调度

阶段 3 已建 `ai_eval_queue`。生产建议：

- 高峰期把 cron 频率从 `* * * * *`（每分钟）改为多条并行：
  ```sql
  select cron.schedule('eval-1','* * * * *', $$ ... batch:5 ... $$);
  select cron.schedule('eval-2','* * * * *', $$ ... batch:5 ... $$);
  -- 总并发 = schedules × concurrency
  ```
- 监控队列堆积：
  ```sql
  SELECT status, count(*) FROM public.ai_eval_queue GROUP BY 1;
  -- queued > 100 持续 5 分钟 → 加 schedule
  ```
- 死信巡检：
  ```sql
  SELECT * FROM public.ai_eval_failures ORDER BY failed_at DESC LIMIT 50;
  ```

---

## 8. 监控与告警

最小可行栈：**pg_stat_statements + Grafana + Prometheus**（或 Supabase 自带的 Logflare）。

核心指标：

| 指标 | 阈值 | 告警动作 |
|------|------|----------|
| `pg_stat_activity.active` | > 80% pool_size | 加副本 / 找慢查询 |
| `pg_stat_statements` mean_time top10 | > 200 ms | 加索引 / 改 RPC |
| Realtime 延迟 | > 5 s | 加 realtime 副本 |
| `ai_eval_queue` queued | > 200 持续 5 min | 加 cron schedule |
| `ai_eval_failures` 新增 | > 0 | 邮件告警人工排查 |
| 边缘函数 5xx | > 1% | 看具体函数日志 |
| Postgres CPU | > 80% 持续 1 min | 紧急扩容 |

建议每天凌晨跑：
```sql
VACUUM (ANALYZE) public.applications, public.submission_records, public.profiles;
```

---

## 9. 验收压测

用 [k6](https://k6.io/) 模拟 1000 学生 5 分钟内集中提交：

```js
import http from 'k6/http';
export const options = { vus: 1000, duration: '5m' };
export default function () {
  http.post('https://your.domain/rest/v1/applications',
    JSON.stringify({ description: 't', selected_keywords: ['x'] }),
    { headers: { Authorization: `Bearer ${__ENV.JWT}`, apikey: __ENV.ANON, 'Content-Type': 'application/json' } });
}
```

通过标准：
- p95 < 800 ms
- 5xx < 0.5%
- 队列在 10 min 内回落到 < 50
- Postgres CPU < 80%

---

## 10. 回滚

任何一步出问题：
- 参数：恢复旧 `postgresql.conf`，`docker compose restart db`
- 副本：把 `replicas` 改回 1
- cron：`select cron.unschedule('process-eval-queue');`
- 队列：`UPDATE ai_eval_queue SET status='queued', locked_at=NULL WHERE status='processing';`