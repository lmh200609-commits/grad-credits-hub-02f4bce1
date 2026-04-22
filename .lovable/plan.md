

# 系统功能与数据库同步全面回归测试方案

我将以**只读探查 + 真实接口压测**的方式，对当前系统的所有核心模块和数据库同步状态做一次完整体检，最后输出一份可下载的测试报告（Markdown + CSV），不会修改任何业务数据。

## 测试范围（覆盖现有全部模块）

1. **数据库结构与一致性**
   - 8 张业务表（profiles / user_roles / applications / application_reviews / rules / keywords / cases / audit_logs）行数、最近写入时间、孤儿数据
   - RLS 策略覆盖度（每张表 SELECT/INSERT/UPDATE/DELETE 是否齐全）
   - Supabase linter 安全告警

2. **认证与角色**
   - 三类账号登录（admin / teacher / student 测试账号）
   - `has_role` 函数对越权调用的拦截
   - 角色路由（RoleRoute）实际跳转

3. **学生端**
   - Apply 提交（关键词匹配 + 自定义关键词归一化）
   - MyApplications 列表 / 详情可见性
   - 申请人工复核流程触发

4. **教师端**
   - Students 列表与 StudentDetail 数据加载
   - 复核操作写入 `application_reviews` 并回写 `applications.status`

5. **管理员端**
   - Dashboard 统计、ReviewHub、Cases、Credits
   - Rules / Keywords CRUD（含日期范围筛选、归一化去重）
   - UsersManage、ImportUsers、AuditLogs
   - **AI 初审压测**（10 用例）—— 直接调用 `ai-eval-stress-test` 取实际通过率
   - AiAssistant / StaffAiAssistant 边缘函数可用性

6. **Edge Functions 健康检查**
   - 11 个函数逐一探活：bootstrap-admin / import-users / evaluate-application / reset-password / dev-seed / ai-parse-roster / ask-credit-assistant / ai-explain-import / staff-ai-assistant / ai-eval-stress-test / audit-log
   - 调用次数、平均耗时、最近 24h 错误率（来自 analytics_query）

7. **Realtime / 同步**
   - `useRealtimeTable` 在 applications / keywords 上的订阅是否成功（通过 edge logs 验证 channel）
   - keywords.usage_count 在审批通过后是否正确递增

8. **存储**
   - `application-files` bucket 中文件与 `applications.file_path` 的引用一致性（孤儿文件 / 失效引用）

## 测试方法

```text
┌──────────────────────────────────────────────┐
│  只读 SQL 抽样           → supabase--read_query        │
│  Edge Function 探活      → supabase--curl_edge_functions│
│  日志 / 错误率          → supabase--analytics_query    │
│  RLS / 安全             → supabase--linter             │
│  AI 压测 10 用例        → 调 ai-eval-stress-test       │
│  结果汇总               → /mnt/documents/system-qa-报告 │
└──────────────────────────────────────────────┘
```

不会执行任何 INSERT/UPDATE/DELETE。AI 压测是只读的（不写库）。

## 交付物

放在 `/mnt/documents/`：

- `system-qa-report.md` —— 人类可读总报告（每模块 ✅ / ⚠️ / ❌ + 证据 + 修复建议）
- `system-qa-summary.csv` —— 模块 / 检查项 / 状态 / 数据 一行一项，便于归档
- `ai-stress-test-result.csv` —— 10 个用例的 expected vs actual 明细

## 技术细节（实现层）

- 切回默认模式后，按上面顺序串行执行只读工具，每个模块结果暂存内存
- AI 压测调用使用现有 admin 测试账号的 JWT（curl_edge_functions 自动注入）
- 报告由 Python 脚本本地拼装（`/tmp/build_report.py`），不依赖外部依赖
- 所有 SQL 加 `LIMIT` 防止超出 1000 行默认上限影响判断
- 报告中所有时间戳统一用 `formatDepositDate` 同款 `YYYY-MM-DD HH:mm:ss` 格式，避免浏览器差异

## 不在范围内

- 不做前端 UI 截图回归（需要 browser 工具，成本高，未要求）
- 不做性能压测 / 并发压测
- 不修改任何代码或数据；如发现 bug 仅在报告中列出建议

