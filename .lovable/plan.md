## 目标

参考你上传的 `deployment-guide-3.md`（LMS 自托管部署指南）风格、章节顺序与精简度，结合本项目（综合素质学分认定系统）的真实组成，**单独生成一份新的部署文档**，输出为可下载的 Markdown 文件：

- 路径：`/mnt/documents/credits-deployment-guide.md`
- 不修改仓库内已有的 `docs/self-hosted-deployment.md`
- 域名占位符沿用 `credits.example.edu`（用户确认）

## 文档大纲（与上传文档对齐，按本系统替换内容）

```text
0.  系统拓扑（前端 SPA + Nginx + 自托管 Supabase + AI 网关）
1.  前置准备
    - 服务器（4c8g 起 / Ubuntu 22.04 / 安全组 22·80·443·1Panel）
    - 域名 + DNS（credits.example.edu）
    - 需提前准备的密钥：DASHSCOPE_API_KEY、DEEPSEEK_API_KEY、AI_KEY_ENCRYPTION_SECRET
2.  服务器初始化（apt、Node 20、nginx、certbot）
3.  安装 1Panel
4.  部署自托管 Supabase
    4.1 拉镜像 + generate-keys.sh
    4.2 判断是否需 add-new-auth-keys.sh（grep 法）
    4.3 .env 关键变量（域名 / AUTOCONFIRM / 3 个 AI 密钥）
    4.4 启动并 docker compose ps
5.  跑仓库的 init.sql（核心自动化）
    - 重建 on_auth_user_created → handle_new_user
    - 创建 2 个 bucket：application-files（私有）、college-badges（公开）
    - 可选 admin_uid 一键授 super_admin + admin
6.  部署 23 个 Edge Functions（按用途分组列表）
    - 账号管理 8 个 / 名册导入 4 个 / AI 评估 4 个 / 助手 3 个 / 工具 4 个
    - rsync 上传 → restart functions auth → curl 自检
7.  创建超管账号 + 一键授权（Studio 添加用户 + psql -v admin_uid 跑 init.sql）
8.  从 Lovable Cloud 迁移数据（可选）
    - supabase CLI dump roles/schema/data
    - 严格顺序导入 + 重跑 init.sql
    - 校对 user_roles.college_id（避免 RLS 拦截）
9.  前端部署（.env.production、本地 build、上传 /var/www/credits、权限）
10. Nginx + HTTPS（drop-in credits.conf + certbot）
11. 验收清单（10 项，含 ai_eval_queue 全链路、bucket、徽章公开访问）
12. 常见问题排查（≈12 行表格，针对本系统：pending_ai 卡住、AI provider not configured、college_id NULL、face-compare 503 等）
13. 下次再迁移：精简版命令（一段 bash 全流程）
14. 高并发调优建议（提交截止前夜 + AI 队列堆积两个真实场景）
    - PostgreSQL 参数（4c8g 基线）
    - PostgREST 连接池
    - process-eval-queue 多 worker 触发节奏
    - Nginx upstream keepalive
    - 监控命令
    - 容量预估表（日常 / 截止前夜 / 学期末高峰）
15. 附录：目录速查 / 关键端口 / 范围之外
```

## 关键差异（相对上传文档）

| 维度 | 上传文档（LMS） | 本文档（学分系统） |
|---|---|---|
| Bucket 数量 | 3（avatars / courses / contents） | 2（application-files 私有、college-badges 公开） |
| 业务密钥 | 阿里云 VOD 4 件套 | DashScope / DeepSeek / AI_KEY_ENCRYPTION_SECRET |
| Edge Functions | 8 个 | **23 个**，按 5 组分类 |
| auth trigger | autoconfirm + handle_new_user 两个 | 仅 handle_new_user 一个（本系统不用假邮箱注册） |
| 高并发场景 | 考试集中交卷 | 提交窗口截止 + AI 评估队列 |
| 验收特色项 | 视频上传播放 | AI 评估全链路（pending_ai → auto_approved/pending_review）+ 徽章公开访问 |
| 常见问题特色 | VOD / Realtime | ai_eval_queue / college_id RLS / DashScope 模型未开通 |

## 风格约定

- 中文正文、命令块用 ```bash / ```env / ```nginx / ```sql
- 全部沿用上传文档的"⚠️ / 💡 / ⭐"标记习惯
- 每节末尾该有的"必须 true / 严格按顺序 / 重复执行也安全"提示保留
- 不超出"Tailwind + Motion 设计预览"范围之外的话题；只写部署，不重写业务说明

## 不做

- 不修改 `docs/self-hosted-deployment.md`
- 不创建 `supabase/self-hosted/init.sql`、`deploy/nginx/credits.conf` 等仓库文件（文档内嵌 SQL/配置即可，与上传文档处理方式一致）
- 不改任何前端代码

## 交付

在 `/mnt/documents/credits-deployment-guide.md` 生成完整 Markdown，并以 `<presentation-artifact>` 标签返回，便于直接下载。
