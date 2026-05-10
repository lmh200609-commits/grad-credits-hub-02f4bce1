## 你看到的问题

### 1. "Sightengine AI 生成概率 0.1%，低于阈值"是哪来的

系统目前同时调了两家 AI 生图鉴别：

- **阿里云"AIGC 鉴别旗舰版"** —— 你在「AIGC 图像鉴别」后台配的那一家。结果写入 `applications.aigc_status / aigc_score / aigc_detail`，前台红/黄/绿色提示卡用的就是它。
- **Sightengine（境外服务）** —— 在 `evaluate-application` 边缘函数里"再跑一次"作为交叉验证，只在 AI 评估的 reasoning 旁边加一行说明文字。

也就是说：
- "Sightengine AI 生成概率 0.1%，低于阈值" = **第二家（Sightengine）**告诉 AI："这张图它判定有 0.1% 概率是 AI 生成的，远低于 50% 拒绝线，可以放心。"
- 你以为只用阿里云，所以看到 Sightengine 这个名字会一头雾水。

按你的要求，要 **只保留阿里云**，并且把这段话换成人话能看懂的中文。

### 2. 数据看板与「全部审核」数据为什么会"紊乱"

排查后发现：状态枚举 `pending_ai`（系统核验中）和 `pending_review`（待教师复核）虽然数据库已经分清，但前端**叫法不统一**：

| 位置 | pending_ai 显示 | pending_review 显示 |
|---|---|---|
| StatusBadge（详情页徽标） | 系统核验中 | **待教师复核** |
| 数据看板（已修） | 系统核验中 | **待教师复核** |
| `/reviews` 全部审核 Tab | 系统核验中 | **待复核** ← 不一致 |
| `/admin/reviews` ReviewHub | 系统核验中 | **待复核** ← 不一致 |

同一条申请在不同页面叫法不同，用户自然觉得"数据对不上"。需要在全系统统一为：
- `pending_ai` → **系统核验中**
- `pending_review` → **待教师复核**

---

## 改造方案

### A. 鉴别引擎：彻底下线 Sightengine，统一用阿里云

**`supabase/functions/evaluate-application/index.ts`**

1. 删除 `sightengineDetectAi()` 函数、`SIGHTENGINE_REJECT_THRESHOLD` 常量、并行调用 Sightengine 的整段代码（约 220-260 行、530-560 行、740-755 行）。
2. 附件备注 `attachmentNote` 改为：
   - 无附件：`无附件`
   - 非图片：`非图片附件（XX），未做视觉核验`
   - 图片：直接用阿里云结果——`已附图片；阿里云鉴别 AI 生成概率 X.X%`（数据来自 `app.aigc_score`，已经在阿里云队列处理完才会进入本评估，所以一定有值或为 skipped/error）。
3. `overrideNotes` 中给 AI 的提示也改为阿里云口径：
   - 阿里云判定为 `fake`/`suspect` → 已经在 `process-aigc-queue` 阶段直接拒绝，不会进到这里。
   - `real`：写入"阿里云 AIGC 鉴别：AI 生成概率 X.X%，低于疑似阈值（YY%），未发现明显 AI 生成痕迹。"（X = aigc_score，Y = 学院配置的 suspect 阈值）。
   - `skipped` / `error`：写入"阿里云未对该附件做 AI 生成鉴别（原因：未配置/非图片/调用失败）。"
4. 学生侧 `AiVerdictCard` 的"系统说明"段如果还引用了 sightengine 字样，一并替换。

> 注：Sightengine 的 secret（`SIGHTENGINE_API_USER` / `SIGHTENGINE_API_SECRET`）保留在密钥管理，不主动删除，避免破坏其他可能的引用——但函数里不再读取。

### B. 全系统状态标签统一

把所有页面上的"待复核"统一改成"待教师复核"，"系统核验中"保持不变：

- `src/pages/Reviews.tsx`：
  - 第 151 行 `pending_review: "待复核"` → `"待教师复核"`
  - 第 175 行 `<TabsTrigger value="pending_review">待复核</TabsTrigger>` → `待教师复核`
  - 第 77 行注释里的"待复核"同步改。
- `src/pages/admin/ReviewHub.tsx`：
  - 第 48 行 `{ key: "pending_review", label: "待复核" ... }` → `"待教师复核"`。
- 全局再用 `rg "待复核"` 兜底搜一次，确认没有漏网。

### C. 数据看板与各列表的口径一致性核对

确认下列入口的状态计数都来自统一的 `dashboard_stats` RPC（已拆分 `pending_ai` / `pending_review`）：

- `src/pages/admin/Dashboard.tsx`（已用 `kpi.pending_ai` / `kpi.pending_review`）
- `src/pages/teacher/Dashboard.tsx`（同上）
- `src/pages/admin/ReviewHub.tsx`：分类 Tab 数量是用 RPC 还是即时 `count(*)` ？需要核对，如不一致也切到 RPC 同源数据，避免"看板 2 条 vs 列表 N 条"再次出现。
- 列表过滤器（Reviews.tsx 的 status query 参数）和看板卡片的跳转链接要对齐（`?status=pending_ai` / `?status=pending_review`）。

### D. 验证清单（改完必跑）

1. 提交一条新申请 → 阿里云鉴别完成后，AI 评估 reasoning 中只出现"阿里云 AIGC 鉴别…"，**完全看不到 Sightengine 字样**。
2. 打开数据看板，记下"系统核验中 = a，待教师复核 = b"。
3. 进入「全部审核」分别点 `系统核验中` Tab、`待教师复核` Tab，行数必须分别等于 a 和 b。
4. 在 ReviewHub 左侧分类点击，标题/角标显示"待教师复核"而不是"待复核"。
5. 任意申请详情页的 StatusBadge 与列表里的标签文字一致。

---

## 不在本次改动范围

- 不改阿里云鉴别本身的逻辑、阈值、队列重试策略。
- 不改数据库 schema（`dashboard_stats` 已经拆分好了，无需新迁移）。
- 不动 Sightengine 密钥本身（仅在代码中不再调用）。

确认后我进入 build 模式按 A→B→C→D 顺序实施并自检。
