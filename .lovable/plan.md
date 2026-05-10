# 修复"系统核验中"卡死等四个问题

排查结论：四个问题在数据库、Edge Function 和前端三层各有独立成因，需要分别处理。

---

## 问题 1 — 申请一直卡在"系统核验中"

**根因**：数据库触发器 `enqueue_ai_eval` 只在 `applications.status` 改变时触发；AIGC 检测完成后只更新 `aigc_status`（real/suspect/skipped/error），`status` 仍是 `pending_ai`，因此 `ai_eval_queue` 永远不会被入队，`process-eval-queue` worker 自然不会评估，状态永远停在"系统核验中"。

数据库已确认：当前申请 `aigc_status=real` 且 AIGC 队列已 `done`，但 `ai_eval_queue` 中没有这条记录。

**修复**：新建迁移，增加一个 UPDATE OF aigc_status 的触发器，当 aigc_status 从 pending 变为终态（real/suspect/skipped/error）且 status 仍是 pending_ai 时，向 ai_eval_queue 入队（与 enqueue_ai_eval 相同逻辑，UPSERT 防重复）。同时把 enqueue_ai_eval() 内部条件保留作 INSERT 时兜底。

并补一条一次性回填语句，把所有"status=pending_ai 且 aigc_status∈(real,suspect,skipped,error) 且 ai_eval_queue 中无记录"的旧申请重新入队，治好已经卡住的存量数据。

## 问题 2 — 学生未提交证件照时不应跑人脸比对

**现状**：`face-compare/index.ts` 在 `profile.photo_url` 缺失时已写入 `face_match_status='unknown'` 并返回，逻辑本身是正确的；但前端 `FaceMatchAlert` 仍显示"暂未比对 / 重新比对"按钮，且如果有定时/触发任务调用就会无谓写表。

**修复**：
- `aigc-detect` 评估完成后不再隐式触发人脸比对（当前流程中 evaluate-application/aigc-detect 都未自动触发，确认无队列调度），保持手动触发。
- `face-compare` 在 `profile.photo_url` 为空时直接 return 不写库，避免给学生无证件照的申请打上"unknown"噪音。
- 前端 `ApplicationDetail.tsx` 把 `<FaceMatchAlert />` 的 `visible` 改为 `isReviewer && !!studentHasPhoto`（通过已加载的 student profile 判断），学生未上传证件照时整块不渲染。

## 问题 3 — 超级管理员看不到 AI 生图鉴别 / 人脸核验面板

**根因**：`src/pages/ApplicationDetail.tsx:150`
```ts
const isReviewer = !!app && (hasRole("admin") || hasRole("teacher"));
```
漏掉了 `super_admin` 角色。所有依赖 `isReviewer` 的 UI（AigcDetectAlert、FaceMatchAlert、复审按钮、AI 推理详情等）对超管都隐藏。

**修复**：把判定改为 `hasRole("admin") || hasRole("teacher") || hasRole("super_admin")`。同时审查同文件其它 isReviewer 用法，确保超管获得与管理员一致的视图与操作权限。

## 问题 4 — 系统提示已 AI 鉴别，但阿里云控制台看不到记录

**排查**：数据库里这条申请的 `aigc_provider=aliyun:aigcDetector_ultra`、`aigc_detail.request_id=D56F2730-8444-56C7-A33D-248AC0901D67`，说明请求确实成功打到了阿里云（否则不会有 RequestId）。

阿里云内容安全控制台分两类页面：
- **图片审核（ImageModeration / 同步检测）调用记录**：在「内容安全 → 图片审核 → 调用记录」里看，且必须切到 **cn-shanghai** 区域；当前函数固定 `ALIYUN_GREEN_REGION=cn-shanghai`，若用户在控制台切到杭州/北京就什么都看不到。
- **AIGC 检测**走的是同一接口 `ImageModeration` 的 `aigcDetector_ultra` 服务码，记录会出现在"图片审核"列表里，**不在**"AIGC 检测专项"页签（那是另一条产品线，含独立计费）。

**修复**：
- 在 `aigc-detect/index.ts` 写入 `aigc_detail` 时额外保存 `region` 与控制台直达链接，并打印到函数日志，方便用户对照。
- 在 `AigcDetectAlert` 展开区显示 region 和"在阿里云控制台查询此 RequestId"的链接（指向 `https://yundun.console.aliyun.com/?p=cts#/imageaudit/dashboard?regionId=cn-shanghai`），消除"看不到记录"的误会。
- 文档不改服务码（`aigcDetector_ultra` 是当前生效且能返回 RequestId 的旗舰版）。

---

## 技术细节

**新迁移 SQL（要点）**
```sql
CREATE OR REPLACE FUNCTION public.enqueue_ai_eval_after_aigc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status = 'pending_ai'
     AND NEW.aigc_status IN ('real','suspect','skipped','error')
     AND (OLD.aigc_status IS DISTINCT FROM NEW.aigc_status) THEN
    INSERT INTO public.ai_eval_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
    VALUES (NEW.id, 'queued', now(), 0, NULL, NULL)
    ON CONFLICT (application_id) DO UPDATE
      SET status='queued', next_run_at=now(), attempts=0, last_error=NULL, locked_at=NULL, updated_at=now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_enqueue_ai_eval_after_aigc
  AFTER UPDATE OF aigc_status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_eval_after_aigc();

-- 回填存量
INSERT INTO public.ai_eval_queue (application_id, status, next_run_at)
SELECT a.id, 'queued', now()
  FROM public.applications a
 WHERE a.status='pending_ai'
   AND a.aigc_status IN ('real','suspect','skipped','error')
   AND NOT EXISTS (SELECT 1 FROM public.ai_eval_queue q WHERE q.application_id = a.id)
ON CONFLICT (application_id) DO UPDATE
  SET status='queued', next_run_at=now(), attempts=0, last_error=NULL, locked_at=NULL, updated_at=now();
```

**前端修改**
- `src/pages/ApplicationDetail.tsx:150` 加入 `super_admin`
- 同文件 `<FaceMatchAlert visible={...} />` 增加学生证件照存在性判断
- `src/components/AigcDetectAlert.tsx` 展开区追加 region + 控制台链接

**Edge Function**
- `supabase/functions/face-compare/index.ts`：`profile.photo_url` 为空时直接 return，不再写 unknown
- `supabase/functions/aigc-detect/index.ts`：detail 增加 `region` 字段

完成后预期：当前卡住的申请会在 worker 下一轮（约几十秒内）自动进入"待人工复核 / 自动通过"；超管能看到与管理员相同的 AI/人脸面板；学生没传证件照的申请不再显示人脸卡片；用户在阿里云 cn-shanghai 区的图片审核控制台能按 RequestId 查到调用记录。
