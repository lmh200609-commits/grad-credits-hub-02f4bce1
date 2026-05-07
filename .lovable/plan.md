# 性能与并发优化方案（千级并发 / 自托管）

> 阶段 1 已在上一轮落地。本计划列出**全部 4 个阶段**的内容，便于你看到整体路线图，并选择下一步要不要做阶段 2 / 3 / 4。

---

## 一、体检结论（关键瓶颈）

### 数据库层
- 缺关键复合索引：`applications(college_id, status, submitted_at)`、`(student_id, submitted_at)`、`pending_review` partial index、`user_roles(college_id, role)` 等
- `profiles` 学号/姓名模糊搜索走顺扫（无 trigram）
- 5 张 `*_backup_20260424` 冗余表占用资源
- RLS 策略中 `auth.uid()` 每行调用一次（应包成 `(SELECT auth.uid())` 让 planner 缓存）

### 前端查询层
- `fetchAll` 在 Dashboard / UsersManage / Students / Reviews 中拉全表，5000+ 学生时 5MB+ JSON
- 多次串行查询后前端 join，应改为 RPC/视图聚合
- Realtime 全表订阅，千并发广播会指数放大

### Edge Function 层
- `evaluate-application` 同步调 AI，瞬间打满 provider 配额
- `import-users` 已分批，但缺 429 退避
- 无队列、无背压

### 自托管部署
- 必须开 PgBouncer/Supavisor，否则千并发耗尽 `max_connections`
- PostgREST 默认 `db-pool=10`，需提升到 50-100 + 多副本
- Realtime 单进程需横向扩
- Storage 大量证明材料需 CDN 缓存

---

## 二、阶段 1（**已完成**）

- [x] 14 个新索引（applications / user_roles / profiles / submission_records / audit_logs / application_reviews）
- [x] pg_trgm 扩展 + 学号/姓名 GIN trigram 索引
- [x] 全部 RLS 策略 `auth.uid()` → `(SELECT auth.uid())`
- [x] 删除 5 张过期 backup 表
- [x] 6 个页面的 Realtime 订阅加 `college_id=eq.<id>` filter
- [x] 输出 `docs/SELF_HOSTING_PERFORMANCE.md`

预期收益：列表查询 10-50x、Realtime 流量按学院数线性下降、Postgres CPU 高峰 -40~60%

---

## 三、阶段 2：前端查询与 Realtime 改造（**建议接下来做**）

1. **去掉 fetchAll 全表拉取**
   - 新建 SQL 函数 `dashboard_kpi(_college uuid)` 一次返回 KPI（total / approved / pending / rejected / 总学分）
   - `admin/Dashboard`、`teacher/Dashboard` 改用 RPC，前端不再聚合
   - `admin/UsersManage`、`teacher/Students` 改服务端分页 + count:exact + trgm 模糊搜
2. **引入 React Query**：缓存 `colleges` / `keywords` / `rules` / `certificate_types` / `rule_library`，staleTime=5min
3. **大列表虚拟化**：`@tanstack/react-virtual` 用于 5000+ 行的学生表/记录表
4. **CSV 导出改服务端流式**：避免浏览器一次拉 5000 行内存炸

工作量：2-3 个 PR，主要改 5 个页面 + 1 个新 RPC

---

## 四、阶段 3：AI 评估异步化与背压

1. **新增队列表 `ai_eval_queue`**（status / attempts / next_run_at / last_error）
2. **trigger 入队**：申请 INSERT 时只入队不调 AI；申请状态从 `pending_ai` 起步
3. **新 Edge Function `process-eval-queue`**：pg_cron 每 10s 触发，`SELECT FOR UPDATE SKIP LOCKED LIMIT 5`，并发 5
4. **AI provider 限流**：`_shared/ai-router.ts` 加 token-bucket（per-provider QPS/RPM）
5. **重试 + 死信**：失败 3 次进入 `ai_eval_failures`，管理员手动重试
6. **import-users 优化**：BATCH=500、并发=20、429 指数退避

工作量：1 个 PR，迁移 + 1 个新函数 + 1 处提交逻辑改造。**会改语义**：学生提交后看到的是"排队中"，几秒后才出现 AI 结果。

---

## 五、阶段 4：自托管部署调优（运维手册 + 模板）

| 组件 | 关键参数 |
|---|---|
| Postgres | `max_connections=200, shared_buffers=4GB, effective_cache_size=12GB, work_mem=16MB`，开启 `pg_stat_statements`、`pg_cron` |
| Supavisor / PgBouncer | transaction 模式，POOL_MAX=200、MAX_CLIENT=5000 |
| PostgREST | `PGRST_DB_POOL=80`，replicas=3，前置 Caddy 负载均衡 |
| GoTrue | `RATE_LIMIT_*=1000`（避免批量导入触发 429） |
| Realtime | replicas=2，`REPLICATION_POLL_INTERVAL=300` |
| Storage | Nginx 缓存签名 URL 30 分钟，或迁 MinIO + CDN |
| 监控 | pgHero + Prometheus + Grafana + node_exporter |

已写入 `docs/SELF_HOSTING_PERFORMANCE.md`，含 docker-compose 片段。

工作量：纯运维，不涉及代码。

---

## 六、推荐执行顺序

1. **现在就做：阶段 2** —— 收益最大、风险可控，能扛住千级用户日常并发
2. **集中提交期前做：阶段 3** —— 没它的话 AI provider 会被 1 分钟打挂
3. **上线前做：阶段 4** —— 部署清单，按手册操作即可

如果你只想再做一项，我推荐**阶段 2.1（Dashboard RPC + 服务端分页）**，单 PR、立竿见影。

---

## 技术细节备忘

- 新索引用 `CREATE INDEX CONCURRENTLY` 避免锁表（生产环境，迁移工具默认是 CONCURRENTLY 之外的方式，需注意）
- `pg_cron` 在自托管 Supabase 默认启用，云端需开
- AI 队列用 `SELECT FOR UPDATE SKIP LOCKED` 避免引入 Redis
- Realtime filter 仅支持 `=` `in`，复杂场景由 useRealtimeTable 的 polling fallback 兜底（已实现）