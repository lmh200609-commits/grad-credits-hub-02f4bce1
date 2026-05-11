## 目标

学生提交的材料图片被 AIGC 鉴别为 fake/suspect 时，在学生侧界面给出醒目但克制的提示——单一字体、语气适度，不上升到纪律处分。

## 设计预览

![预览](src/assets/aigc_warning_preview_v2.png)

风格要点：
- **单一字体**：沿用项目现有 sans 字体，不引入衬线/新字族；只通过 字号/字重/颜色 构建层级
- 主色统一走 `--destructive` 语义 token（红），背景 `bg-destructive/10`、左侧 4px 实色竖条 `border-l-4 border-destructive`
- 左侧 `ShieldAlert` 红色图标；标题 `text-base font-semibold text-destructive`；正文 `text-sm text-foreground/80`
- suspect 走 `--warning`（琥珀色）同款式，标题改为「材料图片存在 AI 生成嫌疑」
- 暗色模式：`dark:bg-destructive/15`，对比度自适应

## 文案（已调整为温和版）

- **fake** 标题：材料图片疑似 AI 生成
  正文：本次提交的图片经系统鉴别为 AI 生成图像，已自动驳回。请使用真实拍摄的材料重新提交，如有疑问可联系所在学院核实。
- **suspect** 标题：材料图片存在 AI 生成嫌疑
  正文：本次提交的图片存在 AI 生成迹象，已转人工复核。请确保提交材料真实有效，必要时准备好原件以备核查。
- 角标行：`AI 生成概率 96.4%` · `检测时间 2026-05-11` · 右侧链接「查看详情 ›」

不出现"学术不端 / 纪律处分 / 学生手册"等措辞。

## 出现位置（仅学生视角）

1. **申请详情页 `/applications/:id`**
   在 `PageHeader` 下方、现有 `AigcDetectAlert`（仅老师可见）之外，插入 `<StudentAigcWarning />`，仅当当前用户是该申请学生本人且 `aigc_status ∈ {fake, suspect}` 时显示。
2. **我的申请列表 `/my-applications`**
   - select 增加 `aigc_status, aigc_score`
   - 命中行：左侧 2px 红/琥珀竖线 + 状态列后追加小号红色徽章「疑似 AI 生成」
   - 列表顶部若有任一命中行，显示一条精简横幅"检测到 N 条申请的图片疑似 AI 生成，请尽快处理"
3. **新申请提交后 `/apply`**
   提交后的轮询/realtime 中若结果回判为 fake，弹出一次性 `AlertDialog`（同样克制语气，按钮"我知道了"）。

## 技术细节

- 新组件 `src/components/StudentAigcWarning.tsx`
  - props：`status`、`score`、`checkedAt`、`onViewDetail?`、`compact?`
  - 全部使用语义 token，不写任何 hex；图标用 `lucide-react` 的 `ShieldAlert`
  - 字体沿用全局，不修改 `tailwind.config.ts`
- 改动文件：
  - `src/components/StudentAigcWarning.tsx`（新建）
  - `src/pages/ApplicationDetail.tsx`（插入）
  - `src/pages/student/MyApplications.tsx`（select + 行高亮 + 顶部横幅）
  - `src/pages/student/Apply.tsx`（提交后弹窗）

## 不改动

- 后端鉴别逻辑、阈值、自动驳回规则
- 老师/管理员视角的 `AigcDetectAlert`
- 全局字体与主题 token

## 验证

- 手动把一条申请的 `aigc_status` 临时改为 `fake` / `suspect` 各看一次
- 浅色 / 深色模式
- 889px 视口下文字不溢出
