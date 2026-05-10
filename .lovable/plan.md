## 目标

在「学生提交 → 学分评估」之间插入一个**专用节点**：调用**阿里云内容安全 · AI 生成图片鉴别（旗舰版）**，对学生上传的证书图片做 AIGC 鉴伪，结果写入申请并影响后续流程。

```text
学生提交
  ↓
[新] AIGC 鉴别 (aigc-detect)        ← 调阿里云旗舰版
  ↓
人脸比对 (face-compare)
  ↓
AI 学分评估 (evaluate-application)
  ↓
教师 / 管理员复核
```

---

## 一、阿里云接口对接要点

- **服务**：内容安全 2022 (`Green20220302`) → `ImageModerationPlus`
- **场景值（Service）**：`aigcCheck_pro`（旗舰版）
- **区域 endpoint**：`green-cip.cn-shanghai.aliyuncs.com`（默认上海，可后台改）
- **鉴权**：阿里云 V3 签名（AccessKey ID + Secret）
- **入参**：图片可访问 URL（用 Supabase Storage 的 signed URL，5 分钟有效期）
- **关键返回**：`Result[].Label`（normal / aigc 等）+ `Result[].Confidence`（0–100）；旗舰版还会返回**可疑生成模型来源**（Midjourney / SD / 豆包 Seedream / 通义万相 / Flux 等）和置信度明细

我们把 `Confidence` 归一到 0–1 的 `aigc_score` 写库，模型来源放进 `aigc_detail`。

---

## 二、需要的密钥（要你确认后通过 add_secret 添加）

| 名称 | 用途 |
|---|---|
| `ALIYUN_AK_ID` | 阿里云 AccessKey ID |
| `ALIYUN_AK_SECRET` | 阿里云 AccessKey Secret |

可选（不填走默认值）：
- `ALIYUN_GREEN_REGION`：默认 `cn-shanghai`
- `ALIYUN_AIGC_SERVICE`：默认 `aigcCheck_pro`

> 现有 `SIGHTENGINE_*` 密钥保留，方便后续做"双引擎复核"（旗舰版 + Sightenge）时直接启用。

---

## 三、数据库改动（一次迁移）

### `applications` 新增 5 列

| 列名 | 类型 | 说明 |
|---|---|---|
| `aigc_status` | text，默认 `pending` | `pending / real / suspect / fake / skipped / error` |
| `aigc_score` | numeric(4,3) | AI 生成概率 0–1（越高越像 AI 生成） |
| `aigc_detail` | jsonb | `{provider:"aliyun", service:"aigcCheck_pro", labels:[...], suspected_models:[{name:"Midjourney",score:0.82}], request_id, raw}` |
| `aigc_checked_at` | timestamptz | |
| `aigc_provider` | text | 实际后端（审计 + 后续多引擎切换） |

### 触发器

- 扩展 `applications_block_student_protected_writes`：把上述 5 列加入禁止学生改写白名单
- 新增 `aigc_detect_queue` 表（结构对齐 `ai_eval_queue`）+ RPC `claim_aigc_jobs / mark_aigc_done / mark_aigc_failed`（仿现有 `claim_ai_eval_jobs`）
- 新增 `enqueue_aigc_detect` 触发器：`INSERT applications` 后入 `aigc_detect_queue`
- 改造 `enqueue_ai_eval`：仅当 `aigc_status ∈ (real, suspect, skipped)` 才进 `ai_eval_queue`；若 `fake` 直接 `status='rejected_by_ai'` 跳过学分评估，节省 token

### 阈值配置

学院粒度，写入 `colleges.theme` jsonb 的 `aigc` 字段：
```json
{ "aigc": { "suspect": 0.40, "fake": 0.80, "enabled": true } }
```
默认 `suspect=0.40 / fake=0.80`，超管和学院 admin 可在「AI 模型设置」页调整。

---

## 四、新增 / 修改的边缘函数

### 1. 新增 `supabase/functions/aigc-detect/index.ts`

- **强鉴权**：Bearer JWT 必须存在，且为申请者本人 / 教师 / 管理员 / 服务角色（修复历史 face-compare 同款洞）
- 流程：取 `application_id` → 读 `file_path` → 生成 5 分钟 signed URL → 调阿里云旗舰版 → 解析 → 写 `aigc_*` 字段 → 按学院阈值更新 `applications.status`：
  - `real`：状态保持 `pending_ai`，正常进队
  - `suspect`：状态保持 `pending_ai`；同时给 `evaluate-application` 注入风险信号；最终若学分评估给 `auto_approved` 强制降级为 `pending_review`
  - `fake`：直接 `rejected_by_ai`，不再进学分评估
  - 非图片文件：`skipped`，不阻断
- 阿里云 V3 签名实现独立放在 `_shared/aliyun-sign.ts`，便于复用
- 三次重试 + 指数退避；失败置 `aigc_status='error'` 并入失败队列，**不阻断主流程**（避免阿里云抖动卡死系统）

### 2. 新增 `supabase/functions/process-aigc-queue/index.ts`

完全仿照 `process-eval-queue/index.ts`：service-role、批量领任务、并发执行。

### 3. 修改 `supabase/functions/evaluate-application/index.ts`

- 启动时若 `aigc_status='pending'` → 同步先调 `aigc-detect`（避免乱序）
- prompt 注入风险信号：`本材料 AIGC 鉴别概率 X%（阿里云旗舰版），疑似来源：[Midjourney 0.82, SD 0.31]`
- 若 `aigc_status='suspect'`，强制最终结果不得高于 `pending_review`

### 4. `supabase/config.toml`

注册 `aigc-detect`、`process-aigc-queue`，`verify_jwt = false`（鉴权代码内做，与现有约定一致）。

---

## 五、前端改动

### 学生端

- `Apply.tsx` 上传区追加红字提示：「系统将自动检测 AI 合成/生图，伪造材料将被驳回并记入诚信记录」
- `ProcessSteps.tsx`：扩展节点显示为「材料初审 → 智能审核 → 教师复核」，把 AIGC + 人脸合并叫"材料初审"，**不暴露"AIGC"字样**避免反向调试
- `MyApplications.tsx` / `ApplicationDetail.tsx`：`fake` 件文案脱敏为"材料未通过初审，请提交真实证书原件照片"

### 教师 / 管理员端

- 新增 `src/components/AigcDetectAlert.tsx`（仿 `FaceMatchAlert`）：
  - 红/黄/绿三档徽章 + AI 生成概率百分比
  - 展开显示：阿里云返回的疑似来源模型 TOP-3、置信度、请求 ID、检测时间
  - 「重新检测」按钮（重跑 `aigc-detect`，阈值改了之后可复核）
- 在 `ApplicationDetail.tsx` 把它放在 `FaceMatchAlert` **上方**（这是更前置的风险信号）
- `ReviewHub.tsx` 顶部新增筛选 chip：「疑似 AI 生图」「AIGC 已拒」；高风险件加红色边框

### 管理员后台

- `src/pages/admin/AiModels.tsx` 加一个独立卡片「AIGC 鉴别（阿里云旗舰版）」：
  - 显示当前 AK ID 末 4 位（从 `aigc_provider` 派生）
  - 编辑两档阈值（suspect / fake），写到 `colleges.theme.aigc`
  - 「测试一张图」按钮：选 storage 任意图片直接打一次接口，回显原始 JSON

---

## 六、安全与成本

- 强鉴权 + service role 白名单
- 图片在送入接口前 server 端缩放到 ≤1024px 并转 jpeg 80%（控制阿里云出网流量与计费）
- 单申请最多重试 3 次，指数退避（30s · 2^n），与现有 ai_eval 保持一致
- `aigc_provider` + 阿里云 RequestId 全部入库，方便对账与申诉
- 不做永久缓存（同一 `file_path` 改了就重新检测）

---

## 七、回滚 / 容灾

- `colleges.theme.aigc.enabled=false` 一键关闭整个节点（队列直接 skip）
- AK 失效或 5xx → `aigc_status='error'`，不影响后续学分评估
- 后期若想换/加 Sightenge 二次复核，只需在 `aigc-detect` 内并联第二个 provider，DB schema 不变

---

## 八、实施顺序

1. 你确认后 → `add_secret(ALIYUN_AK_ID, ALIYUN_AK_SECRET)`
2. 数据库迁移：5 列 + 队列表 + 触发器 + RPC + 改造 `enqueue_ai_eval` + 学院阈值默认值
3. 新增边缘函数 `aigc-detect` + `process-aigc-queue` + `_shared/aliyun-sign.ts`
4. 改造 `evaluate-application`：读取 + prompt 注入 + 降级保护
5. 前端：`AigcDetectAlert` + `ProcessSteps` 文案 + `Apply` 提示 + `ReviewHub` 筛选 + 管理员阈值面板
6. 用真实图片（一张真证书 + 一张豆包/MJ 生成图）跑端到端验证

---

## 需要你确认的 1 件事

**密钥**：阿里云 AccessKey 用**主账号 AK** 还是**子账号 AK**？强烈建议用 RAM 子账号、只授权"内容安全只读+图片审核"权限，最小化风险。确认后我直接发起 `add_secret` 让你填入 `ALIYUN_AK_ID` 和 `ALIYUN_AK_SECRET`。
