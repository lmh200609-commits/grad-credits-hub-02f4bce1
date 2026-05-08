
# 学分认定系统 · 自托管部署完整指南（计划）

参照你上传的 `deployment-guide-2.md` 结构，结合本项目实际情况（23 个 Edge Function、2 个 Storage bucket、pg_cron 队列、AI 多 Provider、Sightengine、人脸对比、超管/学院管理员/教师/学生四级角色）撰写一份完整的中文部署文档。

## 输出物

一个 Word 文档：`/mnt/documents/学分认定系统-自托管部署指南-v2.docx`

不修改项目源码，仅生成文档。

## 文档目录（13 章 + 附录）

```
1.  前置准备（域名、ECS、阿里云安全组）
2.  服务器初始化（apt 包、Node 20、Nginx、certbot）
3.  安装 1Panel
4.  部署自托管 Supabase
    4.1 拉取 supabase/docker
    4.2 generate-keys.sh / add-new-auth-keys.sh 判断
    4.3 .env 关键变量（SITE_URL、ENABLE_EMAIL_AUTOCONFIRM、DASHBOARD_*）
    4.4 docker compose up -d 启动 + 健康检查
5.  数据库初始化（跑本仓库 supabase/migrations 全部迁移）
    - 用 supabase CLI db push 或 docker exec 顺序执行 *.sql
    - 必装扩展：pgcrypto、pg_trgm、vector、pg_cron、pg_net
    - 创建 2 个 Storage bucket：application-files（私有）、college-badges（公开）
    - bucket RLS 策略
6.  部署 23 个 Edge Functions
    - 列出全部函数清单与作用（评估、队列、AI 助手、导入、人脸、报告、超管授权…）
    - 上传到 volumes/functions/，restart functions
    - 列出每个函数依赖的 secret
7.  配置 Edge Function Secrets（写入 supabase-project/.env）
    - SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY（自托管自动注入）
    - SUPABASE_PUBLISHABLE_KEY、SUPABASE_JWKS
    - AI_KEY_ENCRYPTION_SECRET（自定义 ≥16 位）
    - DEEPSEEK_API_KEY、DASHSCOPE_API_KEY、LOVABLE_API_KEY（AI 路由后备）
    - SIGHTENGINE_API_USER / SIGHTENGINE_API_SECRET（AI 图片检测）
    - 获取方式（DeepSeek/通义/Sightengine 各自后台地址）
8.  pg_cron 定时任务（AI 评估队列每分钟跑）
    - 跑一段 SQL 在 Studio SQL Editor，包含本项目 URL + ANON_KEY
    - 验证 cron.job 表
9.  创建超管账号 + 一键授权
    - Studio Auth → Add user，勾 Auto Confirm
    - 用 bootstrap-admin Edge Function 或直接 SQL 写入 user_roles(super_admin)
    - 创建第 1 个学院 + 学院管理员
10. （可选）从 Lovable Cloud 迁移现有数据
    - supabase db dump --role-only / schema / data
    - 顺序导入 + 重跑迁移
11. 前端构建与部署
    - .env.production：VITE_SUPABASE_URL=https://your-domain/supabase
    - npm run build → 上传 dist/ 到 /var/www/credits/
12. Nginx + HTTPS
    - SPA fallback、/supabase/ 反代、WebSocket、client_max_body_size 50M（学生上传证明材料）
    - certbot 自动签发
13. 验收清单
    - 所有容器 healthy
    - 学生注册→完善资料→提交申请（带图片）→AI 评估→教师审核→生成证书
    - 超管能切换学院、模型绑定页能看到 Provider

附录 A 常见问题（注册失败、AI 评估卡 queued、Sightengine 401、人脸对比超时、cron 未跑）
附录 B 高并发调优（Postgres、PostgREST、Kong 限流、Nginx）
附录 C 一键再部署精简命令
```

## 关键差异（相比上传参考文档）

- **业务域不同**：学分认定，不是 LMS；表名/bucket 名/Edge Function 名全部按本项目
- **23 个 Edge Function**：完整列出而非 8 个
- **AI Provider 多源**：要讲 ai_providers 表 + AI_KEY_ENCRYPTION_SECRET 加密机制
- **pg_cron 队列**：必须配，且要包含本项目 URL 和 service-role key（用 vault 或 settings）
- **没有阿里云 VOD**：去掉 VOD 相关配置
- **审核窗口**：要提到 submission_windows 控制学生何时能提交
- **角色四级**：super_admin / admin（学院）/ teacher / student
- **不依赖仓库未沉淀的 init.sql/snippet/lms.conf**：本项目暂未沉淀这些资产，文档内联给出 SQL 与 Nginx 模板

## 不在范围

- 不创建 `supabase/self-hosted/` 目录或 Nginx 配置文件（如需我也可以一起沉淀，请告知）
- 不修改任何源码
- 不运行实际部署
