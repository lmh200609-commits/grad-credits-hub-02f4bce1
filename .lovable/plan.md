# 修复：上传院徽自动应用主题 + 解决"看不到变化"

## 根因
1. **403 上传失败**：你账号 `user_roles.role=admin`，但 `profiles.college_id` 为 `NULL`。`college-badges` 桶的 INSERT 策略要求 `(storage.foldername(name))[1] = current_user_college_id()::text`，NULL ≠ `'d66aa1e4-...'`，所以上传被拒，`badge_url` 实际没换。
2. **主题"应用了但没变化"**：`colleges.theme` 被写入了非法值 `primary:"00000" / background:"00000"`，`useCollegeTheme` 的 `isValidHsl` 校验失败，跳过 `setProperty`，UI 回退默认。
3. **诉求变更**：撤销上一版弹窗，改回上传即自动提取并应用。

## 修改

### 1. `src/pages/admin/Branding.tsx`（撤销弹窗，恢复自动应用 + 健壮化）
- 删除 `extractOpen` / `extracted` state 和确认弹窗 UI。
- `onFile` 流程：
  1. 上传文件到 storage；
  2. 取 `publicUrl`；
  3. `extractPaletteFromImage(url)` 提取，加入合法性校验（用同一份 `isValidHsl` 正则；非法字段丢弃）；
  4. `newTheme = { ...theme, ...validPalette }`；
  5. 一次 `update({ badge_url, theme: newTheme })` 写库；
  6. `setTheme(newTheme)` + `load()`，toast「院徽已上传，主题已自动更新」。
- 由于 `useCollegeTheme` 已订阅 `colleges` 表的 realtime UPDATE，写库后全学院用户都会自动重新拉取并应用，无需手动刷新。

### 2. 修正历史脏数据（一次性 SQL 迁移）
- 把 `colleges.theme` 中所有不符合 `^\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%$` 格式的 `primary / accent / background` 字段清掉（用 `theme - 'primary'` 之类操作），让前端走默认主题，避免下次提取被错误的旧值挡住可视效果。
- 范围：所有 `colleges` 行，仅删除非法字段；合法字段保留。

### 3. 解决上传 403：让管理员账号绑定学院
- 由于你账号 `profiles.college_id IS NULL`，在 SQL 迁移中**不**自动绑定（避免误绑），改为：
  - 在 `Branding` 页面顶部增加一段提示卡（仅当 `useAuth().collegeId` 为 null 时显示）：「当前账号未绑定学院，无法上传院徽 / 修改主题，请联系超级管理员在「用户管理」中将账号绑定到对应学院」并禁用上传按钮。
- 这样可以避免静默 403 的困惑；真正的绑定动作走超级管理员现有的用户管理界面（已存在）。
- 不修改 RLS 策略本身。

## 不改动
- `extractPaletteFromImage`（输出已是合法 HSL）；
- `usePreviewTheme` / `useCollegeTheme` 应用逻辑；
- 存储桶策略；
- 数据库结构（仅清洗一行 JSON 字段）。

## 验收
1. 用一个已绑定学院的 admin 账号上传新院徽 → toast 显示已自动提取 → 侧边栏 / 按钮主色立刻变化；其他学院不受影响。
2. 未绑定学院的 admin 进入 `/admin/branding` 看到提示卡，上传按钮禁用，不再出现 403 toast。
3. 旧的 `00000` 脏数据被清掉后，原来"看不到变化"的学院首次上传即可正常生效。
