# 学分认定系统 自托管部署文档 — 编写计划

参照上传的 LMS 部署指南风格，针对本系统（综合素质学分认定 / Graduate Credits Hub）输出一份**完整、可复制粘贴执行**的部署文档。

---

## 1. 交付物

| 文件 | 路径 | 用途 |
|---|---|---|
| 中文 Markdown 文档 | `docs/self-hosted-deployment.md` | 进 Git，团队协作维护 |
| Word 文档 | `/mnt/documents/学分认定系统-自托管部署指南.docx` | 给运维 / 学校 IT 直接下载 |

两份内容**完全一致**，由同一份 Markdown 源用 docx-js 生成 Word。

---

## 2. 文档章节结构（针对本系统重写）

域名暂用占位符 `credits.example.edu`（生成时全局可替换）。

```text
0. 关于本文档（适用版本 / 系统拓扑图）
1. 前置准备
   ├─ 服务器规格（4c8g 起，pg + 容器吃内存）
   ├─ 安全组：22 / 80 / 443 / 1Panel 端口
   ├─ 域名 + 备案 + DNS A 记录
   └─ 需要提前准备的密钥清单：
        DASHSCOPE_API_KEY、DEEPSEEK_API_KEY、AI_KEY_ENCRYPTION_SECRET
2. 服务器初始化（apt / docker / nginx / certbot / node20）
3. 安装 1Panel
4. 部署自托管 Supabase
   ├─ 4.1 generate-keys / add-new-auth-keys 判定
   ├─ 4.2 .env 关键变量（SITE_URL、AUTOCONFIRM、3 个 AI 密钥）
   ├─ 4.3 docker compose up -d
   └─ 4.4 临时验证
5. 跑仓库 init.sql（重建 trigger + 创建 2 个 bucket）
   ├─ 触发器：on_auth_user_created → handle_new_user（写 profiles）
   └─ Bucket：application-files（私有）、college-badges（公开）
6. 部署 Edge Functions（按本系统真实清单列出 23 个）
   manage-admin / bootstrap-admin / reset-admin-password /
   create-college-admin / delete-user / bulk-delete-users /
   bulk-reset-password / import-users / ai-parse-roster /
   ai-explain-import / import-assistant-chat /
   evaluate-application / process-eval-queue /
   ai-eval-stress-test / ask-credit-assistant / staff-ai-assistant /
   polish-answer / face-compare / generate-window-report /
   audit-log / dev-seed / admin-purge-and-bootstrap /
   ai-provider-admin
7. 创建超管 + 一键授权（写入 user_roles.super_admin）
8. 从 Lovable Cloud 云端 Supabase 迁移数据（可选）
   ├─ 8.1 本地装 supabase CLI
   ├─ 8.2 拿连接串（含 ref = eceqokilpppnwtfzgbvq）
   ├─ 8.3 dump roles/schema/data
   ├─ 8.4 导入顺序：roles → schema → data → init.sql 重跑
   └─ 8.5 校对 user_roles.college_id 是否齐全
9. 前端部署
   ├─ .env.production 三个变量
   ├─ npm run build → /var/www/credits/
   └─ 权限设置
10. Nginx + HTTPS
    ├─ drop-in 配置
    ├─ /supabase/ 反代 + WebSocket（ai_eval_queue 实时刷新需要）
    └─ certbot 自动签
11. 验收清单（10 项勾选）
12. 常见问题 FAQ（结合本系统的高频报错：
    submission_window 不开放、profiles 缺失、application-files 403、
    process-eval-queue 不消费、AI key 未配置、face-compare 等）
13. 下次再迁移：精简版命令
14. 高并发调优（针对学分认定特有场景）
    ├─ 14.1 PostgreSQL 参数（4c8g 基线）
    ├─ 14.2 PostgREST 连接池
    ├─ 14.3 ai_eval_queue 处理节奏
    │      （process-eval-queue 定时调用、claim_ai_eval_jobs 锁机制）
    ├─ 14.4 Kong 限流（保护 evaluate-application）
    ├─ 14.5 Nginx 调优 + gzip
    └─ 14.6 提交窗口集中开闭时段的容量评估
15. 附录
    ├─ A. 完整 .env 模板（按本系统所有 secret 列出）
    ├─ B. 数据库表清单 + 用途速查（19 张业务表）
    ├─ C. Storage Bucket 与 RLS 速查
    └─ D. 联系 / 升级路径
```

## 3. 与原 LMS 文档的关键差异

| 原文档 | 本系统 |
|---|---|
| 阿里云 VOD 4 个变量 | **删除**，改为 3 个 AI 网关密钥 |
| 3 个 bucket（avatars/courses/contents） | **2 个**（application-files / college-badges） |
| 假邮箱 `{phone}@phone.lms.local` | 本系统使用真实邮箱注册，**保留** AUTOCONFIRM |
| 8 个 Edge Functions | **23 个**，分组列出（账号管理 / 导入 / AI 评估 / 报表 / 工具） |
| LMS 高并发：考试交卷 | 本系统高并发：**提交窗口截止前夜 + AI 评估队列堆积** |

## 4. 待用户确认的内容

我会把以下两处用 `__FILL_ME__` 占位符标出，方便用户一次替换：

- 域名：`credits.example.edu`
- 服务器目录：`/var/www/credits/`、`/root/supabase-project/`

## 5. 实现步骤（点 Implement 后我会执行）

1. 写 `docs/self-hosted-deployment.md`（约 600 行，结构同上）
2. 在 `/tmp/` 写一个 docx-js 脚本，把 Markdown 转 .docx：
   - US Letter / 1 寸边距 / Arial / 中文用 Microsoft YaHei fallback
   - H1/H2/H3 样式按规范注册
   - 表格用 DXA + columnWidths 双宽度
   - 代码块单独段落 + 等宽字体 + 浅灰底
3. `npm i -g docx`，运行脚本生成 .docx 到 `/mnt/documents/`
4. 用 LibreOffice 把 .docx 转 PDF 截首页 + 抽样 3 页做 QA，确认无溢出 / 无空页
5. 输出 `<lov-artifact>` 链接给用户下载

预计耗时 5–8 分钟，全部自动化。

