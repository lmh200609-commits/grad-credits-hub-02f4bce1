## 问题原因

`solid` 变体当前用 `bg-foreground text-background`。但 `useCollegeTheme` 会把 `--background` 覆盖成学院主题（自动从院徽提取的）背景色。当该背景色本身偏深时，按钮就变成"深底 + 深字"，看起来一片黑、文字图标全部不可见——这正是截图中"上传院徽 / 确认并提交修改 / 新建批次 / 新建第一个批次"的现象。

## 修复方案（仅前端样式层）

1. 在 `src/index.css` 的 `:root` 与 `.dark` 中新增**不受学院主题覆盖**的动作色令：
   - `--action: 222 47% 11%`（接近深蓝黑）
   - `--action-foreground: 0 0% 100%`（纯白）
   - `.dark` 下反转：`--action: 0 0% 100%`，`--action-foreground: 222 47% 11%`
   并在 `tailwind.config.ts` 的 `colors` 中暴露 `action: { DEFAULT, foreground }`。

2. 修改 `src/components/ui/button.tsx` 的 `solid` 变体：
   - 由 `bg-foreground text-background` 改为 `bg-action text-action-foreground hover:bg-action/90`。
   - 这样无论学院把 `--background / --foreground` 改成什么颜色，主操作按钮始终保持"深底白字（亮色模式）/ 浅底深字（暗色模式）"的高对比，永远清晰可见。

3. 确认 `useCollegeTheme.ts` **不要**去覆盖 `--action` / `--action-foreground`（保持现状即可，它本来就只覆盖 primary/accent/background/radius）。

4. 复查并保留：
   - `src/pages/admin/Branding.tsx`：上传院徽、确认并提交修改、弹窗"确认提交"按钮均用 `variant="solid"`（已是）。弹窗里 `AlertDialogAction` 也改用 `bg-action text-action-foreground hover:bg-action/90`，避免硬编码 `bg-foreground text-background`。
   - `src/pages/admin/SubmissionWindows.tsx`：页头"新建批次"、空态"新建第一个批次"、保存按钮均用 `variant="solid"`（已是，自动获得新配色）。

5. 系统其他端（超管/教师/学生）已经统一使用 `Button` 的 `solid` 变体或 `default` 变体，本次只改令牌与变体定义，自动同步生效，不动业务逻辑。

## 验收点

- 任意学院主题（包括极浅或极深背景）下，上传院徽 / 确认并提交修改 / 新建批次 / 新建第一个批次 / 保存 等按钮都能清晰看到文字与图标。
- 暗色模式下按钮自动反色，依然清晰。
- 其他下载类、轮廓类按钮样式不变。
