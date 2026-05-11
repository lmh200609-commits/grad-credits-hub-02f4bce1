# 修复：上传院徽不再静默覆盖主题

## 问题根因
`src/pages/admin/Branding.tsx` 的 `onFile` 中，上传院徽后立即把 `extractPaletteFromImage` 提取出的 `primary / background / accent` 合并进 `theme` 并写库，导致管理员之前手工保存的主题被无条件覆盖。

## 修改方案

只改 `src/pages/admin/Branding.tsx`，拆成两步：

1. **上传只做上传**
   - `onFile` 内只执行：上传文件 → 拿到 `publicUrl` → `update({ badge_url: url })`（不再写 `theme`）。
   - 成功后 toast 改为「院徽已上传」。

2. **提取 + 弹窗确认**
   - 上传成功后调用 `extractPaletteFromImage(url)`，把结果存入新 state `extracted: Theme | null`。
   - 新增一个 `AlertDialog`（复用项目已用的 shadcn `AlertDialog`）：
     - 标题：「检测到院徽主色，是否应用为 UI 主题？」
     - 内容：左右两列对比预览 —— 左「保留原主题」显示当前 `theme` 的 primary/background/accent 色块；右「应用新提取」显示 `extracted` 的色块。
     - 两个按钮：
       - 「保留原主题」：关闭弹窗，丢弃 `extracted`。
       - 「应用新主题」：`setTheme({ ...theme, ...extracted })`，并立即 `update({ theme })` 持久化，toast「主题已更新」。
   - 提取失败（catch）时不弹窗，仅提示「未能识别院徽主色，已保留原主题」。

3. **保留手动入口**
   - 现有「从院徽提取」按钮（如有）保持不变；用户随时可手动重新提取。
   - 不修改 `extractPaletteFromImage`、`usePreviewTheme`、数据库结构、RLS。

## 影响范围
- 仅前端单文件 `src/pages/admin/Branding.tsx`。
- 行为变化：换院徽默认不再改主题；需在弹窗中显式选择「应用新主题」才会更新。
