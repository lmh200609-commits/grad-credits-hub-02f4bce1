# 综合素质学分认定系统 自托管部署完整指南

> 适用版本：v2026.05
> 默认域名占位符：**`https://credits.example.edu`**（部署前全局替换为你的真实域名）
> 适用场景：把本系统从 Lovable Cloud（云端 Supabase）迁移到自托管 Supabase，部署到内网 / 校园云服务器。
> 最后更新：2026-05-08

---

## 📋 目录

1. [前置准备](#1-前置准备)
2. [服务器初始化](#2-服务器初始化)
3. [安装 1Panel 管理面板](#3-安装-1panel)
4. [部署自托管 Supabase](#4-部署自托管-supabase)
5. [跑仓库的 init.sql（核心自动化）](#5-跑仓库的-initsql核心自动化)
6. [部署 23 个 Edge Functions](#6-部署-edge-functions)
7. [创建超管账号 + 一键授权](#7-创建超管账号--一键授权)
8. [从 Lovable Cloud 迁移数据（可选）](#8-数据迁移可选)
9. [构建并部署前端](#9-前端部署)
10. [配置 Nginx + HTTPS](#10-nginx--https-配置)
11. [验收清单](#11-验收清单)
12. [常见问题排查](#12-常见问题)
13. [下次再迁移：精简版命令](#13-下次再迁移精简版命令)
14. [高并发调优建议](#14-高并发调优建议)
15. [附录](#15-附录)

---

## 0. 系统拓扑

```text
                 ┌──────────────────────────────────────────┐
                 │              浏览器（学生 / 教师 / 管理员） │
                 └────────────────────┬─────────────────────┘
                                      │ HTTPS
                          ┌───────────▼────────────┐
                          │   Nginx (443/80)       │
                          │   /        → SPA 静态  │
                          │   /supabase/ → Kong    │
                          └───────────┬────────────┘
                                      │
                  ┌───────────────────▼───────────────────┐
                  │        自托管 Supabase 容器集          │
                  │  Kong · Auth · PostgREST · Storage    │
                  │  Realtime · Edge Functions · Studio   │
                  │  PostgreSQL（含 ai_eval_queue 等业务表）│
                  └───────────────────┬───────────────────┘
                                      │ HTTPS（仅 Edge Function 出站）
                  ┌───────────────────▼───────────────────┐
                  │     AI 网关：DashScope / DeepSeek      │
                  └───────────────────────────────────────┘
```

## 仓库已沉淀的 3 个自动化资产

下次再换服务器，按本指南顺序执行即可，**不再需要手动建 trigger / 建 bucket / 写权限 SQL / 手敲 Nginx 配置**。

| 文件（仓库路径） | 作用 |
|---|---|
| `supabase/self-hosted/init.sql` | 幂等：重建 auth trigger + 创建 2 个 bucket + 可选超管授权 |
| `supabase/self-hosted/.env.snippet` | 必须追加到服务器 `.env` 末尾的关键变量 |
| `deploy/nginx/credits.conf` | Nginx 反代配置，drop-in 到 `/etc/nginx/conf.d/` |

下文统一用 `/path/to/repo` 表示这份仓库在服务器上的位置。

> ⚠️ 这 3 个资产**还未在仓库中创建**。如果是首次部署，按本文档第 5、9、10 节给出的 SQL / 配置粘贴即可。

---

## 1. 前置准备

### 1.1 服务器

| 项目 | 推荐值 |
|---|---|
| 配置 | 4 vCPU / 8 GB RAM 起，500 在线学员建议 8c16g |
| 系统 | Ubuntu 22.04 LTS |
| 安全组 | 放行 **22**（SSH）、**80**（HTTP）、**443**（HTTPS）、**1Panel 端口**（安装后给） |
| 域名 | `credits.example.edu`，已实名备案（国内访问必须） |
| DNS | 添加 A 记录：`@` 和 `www` 都指向服务器公网 IP |

> ⚠️ 极易踩坑：很多"连不上"的根因是安全组没放行 443。

### 1.2 需要提前准备的密钥

| 密钥 | 来源 | 用途 |
|---|---|---|
| `DASHSCOPE_API_KEY` | https://dashscope.console.aliyun.com/ | AI 评估、智能问答、人脸比对 |
| `DEEPSEEK_API_KEY` | https://platform.deepseek.com/ | AI 备用模型（可选） |
| `AI_KEY_ENCRYPTION_SECRET` | 自定义 ≥32 位随机串 | `ai_providers` 表里加密第三方 key 的对称密钥 |

生成强随机串：

```bash
openssl rand -base64 48
```

---

## 2. 服务器初始化

```bash
sudo -i

apt update
apt install -y curl wget nano zip unzip tar git telnet

# Node.js 20.x（如果想在服务器 build 前端，本地 build 可省略）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Nginx + certbot
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable nginx
```

> 💡 前端 `npm run build` 完全可以在本地完成，只把 `dist/` 上传到服务器，这样服务器不需要装 Node.js。

---

## 3. 安装 1Panel

```bash
bash -c "$(curl -sSL https://resource.fit2cloud.com/1panel/package/v2/quick_start.sh)"
```

Docker 安装失败兜底（国内网络）：

```bash
bash <(curl -sSL https://linuxmirrors.cn/docker.sh)
```

记录安装完成后给的"外部地址 / 用户名 / 密码"，并在安全组放行 1Panel 端口。

---

## 4. 部署自托管 Supabase

```bash
git clone --depth 1 https://github.com/supabase/supabase
mkdir supabase-project
cp -rf supabase/docker/* supabase-project/
cp supabase/docker/.env.example supabase-project/.env
cd supabase-project
docker compose pull
```

### 4.1 生成密钥

```bash
sh utils/generate-keys.sh
```

**判断是否需要执行 `add-new-auth-keys.sh`**（新版 Supabase 模板才需要）：

```bash
grep -E '^(SUPABASE_PUBLISHABLE_KEY|JWT_KEYS)=' .env
```

- ❌ 没有任何输出，或值已非空：**跳过**
- ✅ 输出是空值：**必须执行**

```bash
sh ./utils/add-new-auth-keys.sh
```

### 4.2 .env 关键变量

在 `/root/supabase-project/.env` 末尾追加：

```env
# 域名 / 回调
SUPABASE_PUBLIC_URL=https://credits.example.edu/supabase
API_EXTERNAL_URL=https://credits.example.edu/supabase
SITE_URL=https://credits.example.edu
ADDITIONAL_REDIRECT_URLS=https://credits.example.edu/**

# 注册策略
ENABLE_EMAIL_AUTOCONFIRM=true       # ⭐ 必须 true：批量导入账号时不发邮件
ENABLE_PHONE_AUTOCONFIRM=false
DISABLE_SIGNUP=false                # 学生可自助注册；如纯导入制可设 true
FUNCTIONS_VERIFY_JWT=false

# 业务密钥（Edge Functions 使用）
DASHSCOPE_API_KEY=__FILL_ME__
DEEPSEEK_API_KEY=__FILL_ME__
AI_KEY_ENCRYPTION_SECRET=__FILL_ME__
```

> 关键说明：
> - `ENABLE_EMAIL_AUTOCONFIRM=true` 必须开。`import-users` / `bulk-reset-password` 等管理函数批量创建账号时不会再卡在"发确认邮件"。
> - `SUPABASE_PUBLIC_URL` 改为 `/supabase` 子路径**不影响 Studio**，由 Nginx 反代到内部 8000。
> - `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` 是 Studio 的 Basic Auth 账号，记下来。

### 4.3 启动

```bash
cd /root/supabase-project
docker compose up -d
docker compose ps    # 全部应 healthy
```

### 4.4 临时验证

```bash
curl -I http://127.0.0.1:8000/auth/v1/health     # 200 / 401 都算正常
```

---

## 5. 跑仓库的 `init.sql`（核心自动化）

这一条 SQL 同时完成：重建 `auth.users` 触发器、创建 2 个 Storage bucket（`application-files` 私有、`college-badges` 公开）。`pg_dump` 不导出 auth schema 上的触发器，所以这一步必跑。

把以下内容存为 `supabase/self-hosted/init.sql`（也可直接 here-doc 跑）：

```sql
-- ============ 1. 重建 auth trigger ============
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ 2. 创建 2 个 bucket（幂等） ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('application-files', 'application-files', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('college-badges', 'college-badges', true)
ON CONFLICT (id) DO NOTHING;

-- ============ 3. 可选：给指定 UUID 授超管 ============
-- 用法： psql -v admin_uid="'<UUID>'" -f init.sql
\if :{?admin_uid}
  INSERT INTO public.user_roles(user_id, role)
  VALUES (:admin_uid::uuid, 'super_admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (:admin_uid::uuid, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
\endif
```

执行：

```bash
docker exec -i supabase-db psql -U postgres \
  < /path/to/repo/supabase/self-hosted/init.sql
```

> 重建的触发器：
> - `on_auth_user_created`（AFTER INSERT）→ `public.handle_new_user()`：自动写 profiles

---

## 6. 部署 Edge Functions

本系统共 **23 个** Edge Functions，按用途分组：

| 分组 | 函数 |
|---|---|
| 账号管理 | `manage-admin`、`bootstrap-admin`、`reset-admin-password`、`create-college-admin`、`reset-password`、`delete-user`、`bulk-delete-users`、`bulk-reset-password` |
| 名册导入 | `import-users`、`ai-parse-roster`、`ai-explain-import`、`import-assistant-chat` |
| AI 评估 | `evaluate-application`、`process-eval-queue`、`ai-eval-stress-test`、`ai-provider-admin` |
| 学生 / 教师助手 | `ask-credit-assistant`、`staff-ai-assistant`、`polish-answer` |
| 工具 | `face-compare`、`generate-window-report`、`audit-log`、`dev-seed`、`admin-purge-and-bootstrap` |

### 6.1 上传函数源码

把仓库 `supabase/functions/` 整个目录上传到服务器：

```bash
rsync -av /path/to/repo/supabase/functions/ \
  root@SERVER:/root/supabase-project/volumes/functions/
```

目录结构应为：

```
/root/supabase-project/volumes/functions/
├── _shared/
├── manage-admin/
├── evaluate-application/
├── process-eval-queue/
├── ...（共 23 个函数目录）
```

### 6.2 重启容器加载

```bash
cd /root/supabase-project
docker compose restart functions auth
docker compose logs --tail=50 functions
```

### 6.3 测试一个函数

```bash
ANON_KEY=$(grep '^ANON_KEY=' .env | cut -d= -f2)
curl -i https://credits.example.edu/supabase/functions/v1/manage-admin \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

应返回 JSON（即使是 401 鉴权失败也表示函数加载成功）。**不能是 404**。

---

## 7. 创建超管账号 + 一键授权

1. 浏览器打开 `https://credits.example.edu/supabase`，输入 Basic Auth。
2. **Authentication → Users → Add user**：
   - Email：`admin@credits.example.edu`
   - Password：自定义（≥ 8 位）
   - 勾选 **Auto Confirm User**
3. 创建后复制该用户 UUID。
4. 服务器执行：

```bash
docker exec -i supabase-db psql -U postgres \
  -v admin_uid="'<刚才复制的 UUID>'" \
  < /path/to/repo/supabase/self-hosted/init.sql
```

会自动给该用户加 `super_admin` + `admin` 两个角色。重复执行也安全。

---

## 8. 数据迁移（可选）

> 全新部署是空库，跳过本节。只有"Lovable Cloud → 自托管"才需要做。

### 8.1 本地准备

```powershell
# Windows
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

依赖：Docker Desktop **保持运行**（supabase CLI 内部用 docker），`psql` 可用。

### 8.2 云端连接串

Lovable 项目对应的 Supabase ref：`eceqokilpppnwtfzgbvq`。

在 Supabase 控制台 → Project Settings → Database → 复制密码 → Connect → **Session pooler**：

```
postgresql://postgres.eceqokilpppnwtfzgbvq:[YOUR-PASSWORD]@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
```

把 `[YOUR-PASSWORD]`（含方括号）替换成真实密码。

### 8.3 导出三件套

```bash
supabase db dump --db-url "<CONN>" -f roles.sql  --role-only
supabase db dump --db-url "<CONN>" -f schema.sql
supabase db dump --db-url "<CONN>" -f data.sql   --use-copy --data-only
```

### 8.4 导入自托管

```bash
mkdir -p /root/supabasebackup
# 把 3 个 sql 上传到 /root/supabasebackup
cd /root/supabasebackup

# ⚠️ 严格按顺序
docker exec -i supabase-db psql -U postgres < roles.sql
docker exec -i supabase-db psql -U postgres < schema.sql
docker exec -i supabase-db psql -U postgres < data.sql

# 必须重跑 init.sql（重建 trigger + bucket）
docker exec -i supabase-db psql -U postgres \
  < /path/to/repo/supabase/self-hosted/init.sql
```

### 8.5 校对 college 归属

```bash
docker exec -i supabase-db psql -U postgres -c "
  SELECT role, count(*) FILTER (WHERE college_id IS NULL) AS missing
  FROM public.user_roles GROUP BY role;
"
```

`teacher` / `student` 的 `missing` 应为 0；为 0 之外都需要在 Studio 里手动补 `college_id`，否则 RLS 会拦掉这些用户的所有数据访问。

---

## 9. 前端部署

### 9.1 修改 `.env.production`

```env
VITE_SUPABASE_URL=https://credits.example.edu/supabase
VITE_SUPABASE_PUBLISHABLE_KEY=<服务器 .env 里的 ANON_KEY>
VITE_SUPABASE_PROJECT_ID=default
```

获取自托管 ANON_KEY：

```bash
cat /root/supabase-project/.env | grep '^ANON_KEY='
```

### 9.2 本地构建

```bash
npm install
npm run build   # 生成 dist/
```

### 9.3 上传到服务器

把 `dist/` **内部内容**上传到 `/var/www/credits/`：

```
/var/www/credits/
├── index.html
├── assets/
└── ...
```

> ⚠️ 常见错误：把 `assets/` 拆出来单独放会 404。**保持 dist 内部结构原样上传**。

### 9.4 设置权限

```bash
chown -R www-data:www-data /var/www/credits
chmod -R 755 /var/www/credits
```

---

## 10. Nginx + HTTPS 配置

### 10.1 drop-in 配置

`/etc/nginx/conf.d/credits.conf`：

```nginx
upstream supabase_kong {
    server 127.0.0.1:8000;
    keepalive 64;
}

server {
    listen 80;
    server_name credits.example.edu;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name credits.example.edu;

    # SSL 由 certbot 自动填充，或手动指向 /etc/nginx/ssl/
    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root /var/www/credits;
    index index.html;
    client_max_body_size 100M;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # SPA fallback
    location / { try_files $uri $uri/ /index.html; }

    # 静态资源强缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Supabase 反代（含 WebSocket，ai_eval_queue 实时刷新需要）
    location /supabase/ {
        proxy_pass http://supabase_kong/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400;
    }
}
```

应用：

```bash
nginx -t && systemctl reload nginx
```

### 10.2 申请 HTTPS 证书

```bash
certbot --nginx -d credits.example.edu
```

certbot 会自动续期。1Panel 用户也可在面板内"网站 → 证书"申请。

### 10.3 验证

```bash
curl -I https://credits.example.edu/                          # 应 200
curl  https://credits.example.edu/supabase/auth/v1/health     # JSON 响应
curl -I https://credits.example.edu/supabase/functions/v1/manage-admin
```

浏览器打开 `https://credits.example.edu/`，强刷（Ctrl+Shift+R）尝试登录。

---

## 11. 验收清单

- [ ] `docker compose ps` 所有 Supabase 容器 Up（healthy）
- [ ] `ss -tlnp | grep ':443'` 看到 nginx
- [ ] `curl -I https://credits.example.edu/` 返回 200
- [ ] 安全组开放 80 / 443
- [ ] 第 7 步创建的超管账号能登录 → 跳到 `/admin/dashboard`
- [ ] 在管理端"AI 模型"页能配置 DashScope key 并测试连通
- [ ] 学生提交一份学分申请 → 状态变为 `pending_ai` → 数秒后变为 `pending_review` 或 `auto_approved`（验证 ai_eval_queue + process-eval-queue）
- [ ] 教师在自己学院能看到该申请并复核
- [ ] 上传一张学院徽章 → 公开访问可见（验证 college-badges bucket）
- [ ] Studio (`https://credits.example.edu/supabase`) 能看到所有业务表和 2 个 bucket

---

## 12. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 注册成功但 `profiles` 没数据 | `on_auth_user_created` trigger 没建 | 重跑第 5 步 |
| 学院徽章 / 申请附件 404 | 没建 2 个 bucket | 重跑第 5 步 |
| 提交申请报"当前不在开放提交时间内" | `submission_windows` 没开启或已过期 | 管理端 → 提交窗口 → 新建/激活窗口 |
| 申请永远卡在 `pending_ai` | `process-eval-queue` 没被定时触发 | 在 1Panel 加 cron：`*/1 * * * * curl -X POST .../functions/v1/process-eval-queue -H "Authorization: Bearer $SERVICE_ROLE_KEY"` |
| 评估返回 `AI provider not configured` | `DASHSCOPE_API_KEY` 没设 | 改 `.env`，`docker compose restart functions` |
| `ai_providers` 解密报错 | `AI_KEY_ENCRYPTION_SECRET` 改过 | 在管理端"AI 模型"页重新填一次 key |
| 调 `manage-admin` 返回非 2xx 提示无管理员权限 | `user_roles` 没 `super_admin`/`admin` 行 | 第 7 步重跑 init.sql |
| 教师能登录但看不到任何申请 | `user_roles.college_id` 为 NULL | Studio 直接补；或走"超管 → 创建学院管理员"重置 |
| 登录 `Failed to fetch` | Nginx 没监听 443 / 安全组没放行 / `/supabase/` 没配 | `ss -tlnp \| grep 443` |
| 刷新子路由 404 | Nginx 缺 `try_files $uri /index.html` | 用第 10.1 配置 |
| Realtime/WebSocket 报错 | `/supabase/` 缺 `Upgrade` / `Connection upgrade` | 同上 |
| Studio 看不到表 | schema.sql 导入有 ERROR 中断 | `docker compose restart`，重新导入 |
| `face-compare` 报 503 | DashScope 未开通 face-compare 模型 | 阿里云控制台开通；或暂时跳过身份核验 |

---

## 13. 下次再迁移：精简版命令

```bash
# ---------- Supabase ----------
cd /root/supabase-project
docker compose up -d
sh ./utils/add-new-auth-keys.sh    # 视需要
cat /path/to/repo/supabase/self-hosted/.env.snippet >> .env
nano .env                           # 填 3 个 AI 密钥 + 域名

# 如有云端 dump：
docker exec -i supabase-db psql -U postgres < schema.sql
docker exec -i supabase-db psql -U postgres < data.sql

# 核心一步：trigger + bucket
docker exec -i supabase-db psql -U postgres \
  < /path/to/repo/supabase/self-hosted/init.sql

# ---------- Edge Functions ----------
rsync -av /path/to/repo/supabase/functions/ \
  /root/supabase-project/volumes/functions/
docker compose restart functions auth

# ---------- 超管授权（Studio 创建账号后）----------
docker exec -i supabase-db psql -U postgres \
  -v admin_uid="'<UUID>'" \
  < /path/to/repo/supabase/self-hosted/init.sql

# ---------- 前端 + Nginx + HTTPS ----------
cp -r dist/* /var/www/credits/
chown -R www-data:www-data /var/www/credits && chmod -R 755 /var/www/credits
cp /path/to/repo/deploy/nginx/credits.conf /etc/nginx/conf.d/credits.conf
nginx -t && systemctl reload nginx
certbot --nginx -d credits.example.edu
```

---

## 14. 高并发调优建议

本系统的高并发主要发生在两个场景：

1. **提交窗口截止前夜**：大量学生集中上传申请 → 写 `applications` + 上传到 `application-files` bucket
2. **AI 评估队列堆积**：`ai_eval_queue` 短时间挤入数百条 → `process-eval-queue` 反复调用 DashScope

默认配置 100 人以下没问题；以下参数建议用于 500~3000 在线学员场景。

### 14.1 PostgreSQL（`/root/supabase-project/volumes/db/postgresql.conf`）

按 **4c8g 服务器**为基准：

```conf
max_connections = 200
shared_buffers = 1GB                  # 物理内存 25%
effective_cache_size = 3GB            # 物理内存 75%
work_mem = 16MB
maintenance_work_mem = 256MB
wal_buffers = 16MB
checkpoint_completion_target = 0.9
random_page_cost = 1.1                # SSD
log_min_duration_statement = 500      # 慢查询日志（ms）
```

修改后：`docker compose restart db`。

### 14.2 PostgREST 连接池（`.env` 末尾追加）

```env
PGRST_DB_POOL=30
PGRST_DB_POOL_TIMEOUT=10
PGRST_MAX_ROWS=1000
```

`docker compose up -d rest` 让其热加载。

### 14.3 AI 评估队列处理节奏

`ai_eval_queue` 自带 `claim_ai_eval_jobs(_limit)` SKIP LOCKED 锁机制，可水平触发多个 worker 并发消费。

建议 cron（1Panel → 计划任务）：

```cron
# 每分钟 1 次，每次最多消费 5 条
* * * * * curl -sS -X POST \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  https://credits.example.edu/supabase/functions/v1/process-eval-queue \
  -d '{"limit":5}'
```

高峰时改为 `*/15 * * * * *`（每 15 秒）+ `limit=10`，并多挂 2 个并发 cron。

失败任务的指数退避已经内置（`mark_ai_eval_failed`：30s × 2^attempts）。`ai_eval_failures` 表里超过 `max_attempts` 的死信由超管在管理端"AI 评估失败"页查看。

### 14.4 Kong 限流（保护 evaluate-application）

编辑 `/root/supabase-project/volumes/api/kong.yml`，给 `functions-v1` 添加：

```yaml
plugins:
  - name: rate-limiting
    route: functions-v1-route
    config:
      minute: 600
      policy: local
```

`docker compose restart kong`。

### 14.5 Nginx 调优

```nginx
# /etc/nginx/nginx.conf 顶部
worker_connections 4096;

# server 块
client_max_body_size 200M;
proxy_read_timeout 300s;
proxy_connect_timeout 30s;
gzip on;
```

`nginx -t && systemctl reload nginx`。

### 14.6 提交窗口集中开闭时段的容量评估

| 在线学员 | DB | DashScope QPS | 建议配置 |
|---|---|---|---|
| ≤ 200 | 4c8g | 1 | 默认即可 |
| 200~800 | 4c8g + PG 调优 | 3~5 | cron 每 30s × 2 worker |
| 800~3000 | 8c16g + 独立 PG 实例 | 5~10 | 申请 DashScope 商业版配额 + Kong 限流 |
| > 3000 | 16c32g + 读写分离 | > 10 | 联系 DashScope 提配额；考虑 evaluate-application 异步回调改造 |

### 14.7 监控与排障

```bash
# 当前数据库连接
docker compose exec db psql -U postgres -c \
  "SELECT count(*),state FROM pg_stat_activity GROUP BY state;"

# AI 队列堆积情况
docker compose exec db psql -U postgres -c \
  "SELECT status, count(*) FROM public.ai_eval_queue GROUP BY status;"

# 死信
docker compose exec db psql -U postgres -c \
  "SELECT count(*) FROM public.ai_eval_failures WHERE failed_at > now() - interval '1 day';"

# 慢查询
docker compose logs db --tail 200 | grep duration

# 容器资源
docker stats --no-stream

# 推荐安装 pg_stat_statements
docker compose exec db psql -U postgres -c \
  "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

---

## 15. 附录

### A. 完整 .env 必填清单

| 变量 | 来源 | 说明 |
|---|---|---|
| `POSTGRES_PASSWORD` | generate-keys.sh | DB 密码 |
| `JWT_SECRET` | generate-keys.sh | JWT 签名 |
| `ANON_KEY` / `SERVICE_ROLE_KEY` | generate-keys.sh | API Key |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | 自定义 | Studio 登录 |
| `SUPABASE_PUBLIC_URL` / `API_EXTERNAL_URL` / `SITE_URL` | 自定义 | 域名 |
| `ENABLE_EMAIL_AUTOCONFIRM=true` | 固定 | **必须 true** |
| `DASHSCOPE_API_KEY` | 阿里云 | AI 评估主用 |
| `DEEPSEEK_API_KEY` | DeepSeek | 备用模型，可空 |
| `AI_KEY_ENCRYPTION_SECRET` | `openssl rand -base64 48` | `ai_providers` 加密 |

### B. 业务表速查

| 表 | 用途 | 关键 RLS |
|---|---|---|
| `colleges` | 学院信息 | 全员可读，超管管全部，学院管理员只能改自己 |
| `profiles` | 用户档案（含 college_id） | 学院级隔离 |
| `user_roles` | 角色（super_admin/admin/teacher/student） | 学院级隔离 |
| `applications` | 学分申请主表 | 学生自己 + 同学院教师/管理员 + 超管 |
| `application_reviews` | 复核流水（不可改不可删） | 同上 |
| `submission_records` | 提交事件日志 | 客户端只读 |
| `submission_windows` | 提交开放窗口 | 学院级 |
| `submission_window_reports` | 窗口结束自动报表 | 学院级 |
| `rules` / `rule_library` | 学分规则库 | 全员可读，admin 管 |
| `keywords` | 关键词库（normalize trigger） | 同上 |
| `cases` | 评审案例库 | 同上 |
| `certificate_types` | 证书类型（自动从 rules 同步） | 同上 |
| `ai_providers` | 第三方 AI 配置（key 加密） | admin |
| `ai_function_bindings` | 函数 → 模型映射 | admin |
| `ai_eval_queue` | AI 评估任务队列 | super_admin |
| `ai_eval_failures` | 死信 | super_admin 只读 |
| `audit_logs` | 操作审计 | super_admin 只读 |

### C. Storage Bucket

| Bucket | 公开 | 用途 |
|---|---|---|
| `application-files` | ❌ 私有 | 学生上传的申请附件（图片/PDF） |
| `college-badges` | ✅ 公开 | 学院徽章 |

### D. 升级 / 维护

- 升级 Supabase 镜像：`docker compose pull && docker compose up -d`
- 升级前端：本地 `npm run build` → 覆盖 `/var/www/credits/`，无需重启 Nginx
- 数据备份：`docker exec supabase-db pg_dump -U postgres > backup_$(date +%F).sql`，建议每日 cron + 异地存储
- 紧急回滚：保留最近 3 个 dist 版本目录（`/var/www/credits-v1/...`），用 nginx symlink 切换

完。
