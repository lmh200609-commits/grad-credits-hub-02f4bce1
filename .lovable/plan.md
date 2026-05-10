## 修复目标

1. 删除 `学院界面风格` 页面中的"实时预览"卡片。
2. **侧边栏在「保存后」和「全局预览」中都跟随配色变化**（当前两处都只覆盖了 `--primary / --accent / --background`，没动 `--sidebar-background / --sidebar-accent`，所以侧边栏底色不会变）。
3. 全局预览横幅新增「管理员 / 教师 / 学生」视角切换，能看到三种角色的侧边栏与页面 UI 布局。

## 实现方案

### A. Branding 页面
- 删除 `src/pages/admin/Branding.tsx` 中的"实时预览" Card（页内的小预览整块移除）。

### B. 侧边栏跟随主题（保存后 + 预览中）

需要新写入的 CSS 变量映射（两处保持一致）：
- `theme.primary` → `--primary`、`--ring`、`--sidebar-primary`、`--sidebar-ring`（已有）
- `theme.accent` → `--accent`、**`--sidebar-accent`**（新增）
- `theme.background` → `--background`、`--card`、**`--sidebar-background`**（新增）
- `theme.radius` → `--radius`（已有）

修改文件：
- `src/hooks/useCollegeTheme.ts`：在 `applyTheme` 与 `resetThemeVars` 中追加 `--sidebar-background / --sidebar-accent / --card`。
- `src/hooks/usePreviewTheme.tsx`：在 `VARS` 列表与 `applyVars` 中追加 `--sidebar-background / --sidebar-accent`（`--card` 已有）。

这样：保存配色后，所有用户的侧边栏底色 / 当前项高亮即时跟随；预览模式下侧边栏也立刻变色。

### C. 预览中的"角色视角切换"

**Context 扩展**（`src/hooks/usePreviewTheme.tsx`）
- 新增 `roleView: "admin" | "teacher" | "student" | null` 与 `setRoleView`。
- `enterPreview` 默认设为 `"admin"`；`exitPreview` 重置为 `null`。

**预览横幅**（`src/components/PreviewModeBanner.tsx`）
- 在按钮区前加一组分段切换：`管理员视角 / 教师视角 / 学生视角`。
- 点击时 `setRoleView(target)` 并 `navigate` 到对应首页：admin→`/admin/dashboard`，teacher→`/teacher/dashboard`，student→`/`。

**AppLayout 角色覆盖**（`src/components/AppLayout.tsx`）
- 当 `previewActive && roleView` 时：
  - 用 `roleView` 决定侧边栏 items（admin / teacher / student 三套）
  - 顶栏 `roleLabel` 标注为「预览：xxx 视角」
  - student 视角挂 `<AiAssistant />`，否则挂 `<StaffAiAssistant />`
- 真实 `roles / hasRole` 不变，退出预览即恢复。

**路由守卫放行**（`src/components/RoleRoute.tsx`）
- 引入 `usePreviewTheme()`：当 `previewActive && roleView` 命中本路由要求的角色时直接放行，让管理员能进入 `/apply`、`/teacher/dashboard` 等页面看到 UI。
- `ProtectedRoute` 不改。

**说明**：切到学生 / 教师视角时，页面里依赖角色专属数据的部分可能为空（管理员账号没有学生申请等），这是预期 —— 预览的目的是查看 **UI 布局与配色**，不是模拟真实数据。退出预览或刷新即恢复严格的角色守卫。

## 范围之外
- 不修改后端逻辑、数据库、`useAuth`。
- 不持久化预览状态（刷新即退出）。
