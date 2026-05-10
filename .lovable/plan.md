## 目标

在 `学院界面风格` 页面新增一个「进入全局预览」按钮。点击后将当前选择（但尚未提交）的主色 / 辅色 / 背景色 / 圆角等样式临时应用到**整个系统**（侧边栏、顶部栏、所有具体页面），让管理员可以自由跳转任意路由查看真实效果；并提供醒目的「退出预览」按钮一键还原为已保存的主题。

## 用户体验

1. 在 `学院界面风格` 页底部新增 **「进入全局预览」** 按钮（与"还原 / 确认并提交"并列）。
2. 点击后：
   - 当前未保存的主题立即生效到 `document.documentElement`（覆盖侧边栏、按钮、卡片、链接等所有使用 `--primary / --accent / --background / --radius` 的组件）。
   - 自动跳转到 `/admin/dashboard`，方便从首页开始巡览。
   - 顶部出现一个**固定预览横幅**（不遮挡内容）：
     - 左侧文字：`预览模式 · 当前未保存的样式仅对你可见`
     - 右侧两个按钮：`退出预览`（恢复已保存主题，留在当前页）、`返回风格设置`（恢复并跳回 `/admin/branding`）
3. 预览期间用户可正常点击侧边栏、进入任意页面，所有界面都使用预览样式渲染。
4. 退出预览后，CSS 变量恢复为数据库已保存的主题；其他用户全程不受影响（仅本浏览器生效）。
5. 刷新页面会自动退出预览（避免管理员忘记关闭后误以为已生效）。

## 技术实现（开发参考）

### 新增：`src/hooks/usePreviewTheme.tsx`
- 用 React Context + 一个轻量 store（`useState` 即可）保存：`active: boolean`、`theme: Theme`。
- 暴露 `enterPreview(theme)` / `exitPreview()` / `usePreviewTheme()`。
- `enterPreview` 时将 `theme.primary / accent / background / radius` 写入 `document.documentElement.style`（同时覆盖 `--ring`、`--sidebar-primary`、`--sidebar-ring`、`--card`，与 `useCollegeTheme` 保持一致）。
- `exitPreview` 时移除这些行内变量，让 `useCollegeTheme` 已设置的真实主题重新生效。
- Provider 在 `src/App.tsx` 顶层包裹整个路由树。

### 改动：`src/hooks/useCollegeTheme.ts`
- 读取 `usePreviewTheme()`，当 `active === true` 时**跳过** DB → CSS 变量的写入和 realtime 重置，避免实时订阅在预览过程中把预览样式刷掉。

### 新增：`src/components/PreviewModeBanner.tsx`
- 固定在视口顶部（`fixed top-0 inset-x-0 z-50`），仅当 `usePreviewTheme().active` 时渲染。
- 包含说明文案 + `退出预览` + `返回风格设置`（通过 `useNavigate('/admin/branding')`）。
- 渲染该横幅时给 `<body>` 加 `padding-top` 偏移（或在横幅内部用占位 div），避免遮挡 AppLayout 顶栏。
- 在 `src/App.tsx` 中挂载一次，确保**所有路由**（侧边栏布局、登录后的任意页）都能看到。

### 改动：`src/pages/admin/Branding.tsx`
- 在"配色与样式"卡片的按钮区新增 `进入全局预览` 按钮（`variant="outline"`）。
- 点击时调用 `enterPreview(theme)`，然后 `navigate('/admin/dashboard')`。
- 现有的"实时预览"卡片可以保留作为页内小预览，或在本次一并移除（建议保留，作为不离开页面的快速预览）。

### 边界处理
- `enterPreview` 前校验主色与背景色对比度（沿用现有 `lightnessOf` 警告），过浅时 toast 提示但仍允许预览。
- `exitPreview` 必须显式触发一次 `useCollegeTheme` 的重新应用：在 hook 里通过 `useEffect` 监听 `previewActive` 由 true→false 时重新写入 DB 主题。
- 预览状态只存在于内存中，不写 `localStorage`，刷新即失效（符合"刷新自动退出"要求）。

## 不在本次范围
- 不修改任何已保存数据；预览不会写库。
- 不影响其他用户视觉；预览样式仅作用于当前浏览器 DOM。
- 不改造 `aigc-detect` / 触发器等后端逻辑。
