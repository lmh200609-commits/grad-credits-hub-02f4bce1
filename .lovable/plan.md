## 问题诊断

**院徽延迟**：每个页面文件都是 `<AppLayout>{...}</AppLayout>` 自包裹，路由切换时 `AppLayout` 整体卸载/重挂载，`useCollegeTheme` 重新走一次 supabase 网络请求才能拿到 `badge_url`。在请求返回前 `college` 是 `null`，所以院徽 `<img>` 短暂消失。

**侧边栏区分弱**：上一轮虽然已经写入 `--sidebar-background`，但侧栏顶部没有任何学院标识色块，菜单项也用普通 `--sidebar-accent`，从远处看仍是"白底+灰高亮"，跟其他学院几乎一样。

## 实施方案

### 1. 全局缓存 College，消除院徽闪烁

**新增 `src/contexts/CollegeContext.tsx`**：
- 提供 `<CollegeProvider>` 包住整个应用（在 `App.tsx` 的 `AuthProvider` 内层），提供 `useCollege()` Hook。
- Provider 内部完成原 `useCollegeTheme` 的全部逻辑：拉取 college、写 CSS 变量、订阅 realtime。
- 初始化时**同步**从 `sessionStorage` 读取上次缓存的 `college`（key: `college-cache:${collegeId}`），立刻提供给消费者；后台再异步刷新。
- 每次 fetch 成功后写回 sessionStorage。
- 将所有 CSS 变量也写到 `localStorage`（key: `college-css-vars:${collegeId}`），并在 `index.html` 顶部加一段内联 `<script>`：登录后下次刷新时同步注入到 `:root`，避免冷启动闪烁。

**改造 `useCollegeTheme.ts`**：内部仅 `return useContext(CollegeContext)`，不再发请求；保持现有调用方签名不变。

效果：路由切换时 `AppLayout` 即便重挂载，`useCollege()` 立即从 Provider 拿到已有数据，院徽不再消失。

### 2. 侧边栏明显学院化

在 `AppLayout.tsx` 的 `AppSidebar` 顶部加一个**品牌头部**（替代/补充现有的"导航"label）：

- 紧贴侧栏顶部一条 56px 的"学院 banner"：背景 `linear-gradient(135deg, hsl(var(--brand-strong)) 0%, hsl(var(--primary)) 100%)`，左侧院徽（圆形白底，h-10 w-10），右侧两行小字：学院 short_name（白色加粗）+ "学分认证系统"（白色 70% 透明）。
- collapsed（图标态）时只显示居中的圆形院徽。
- banner 下方加一条 1px `--primary/30` 分隔线。
- 把 `SidebarGroupLabel "导航"` 颜色改为 `text-[hsl(var(--brand-strong))]` 并加大字号到 xs→sm。
- 当前激活项 `SidebarMenuButton` 用 `data-[active=true]:bg-[hsl(var(--brand-strong)/0.12)] data-[active=true]:text-[hsl(var(--brand-strong))] data-[active=true]:border-l-2 data-[active=true]:border-[hsl(var(--brand-strong))]`，用左侧 2px 主色色条强化"我在哪个学院的哪个页面"。
- 侧栏底部加一行小字 `code · name`（淡色），便于跨学院切账号时确认。

由于 `--sidebar-background / --brand-strong / --primary` 都会随院徽变化，整条侧栏从顶部 banner 到激活态色条，会跟着学院变。两个学院并排时一眼可分。

### 3. 顶部 header 院徽兜底

`<img src={college.badge_url}>` 加 `key={college.badge_url}` 避免新旧 url 之间的图像缓存撕裂；同时保留 `bg-background` 圆底，img 加载未完成期间也是一个圆形占位，不会"消失再出现"。

### 4. 兼容旧学院

旧主题没存 `sidebarBg / headerTint / brandStrong` 的，沿用上一轮已实现的"从 primary 派生"逻辑。无需迁移数据。

## 改动文件

- 新增：`src/contexts/CollegeContext.tsx`
- 修改：`src/App.tsx`（包入 Provider）
- 修改：`src/hooks/useCollegeTheme.ts`（瘦身为消费 Context）
- 修改：`src/components/AppLayout.tsx`（侧栏品牌 banner + 激活态强化 + img key）
- 修改：`index.html`（启动时从 localStorage 注入 CSS 变量，消除冷启动闪烁）

## 验证

- 在 admin 账户下连续点击多个左侧菜单项，header 院徽全程稳定显示，无闪烁。
- 用两个学院账户分别登录，侧栏顶部 banner、激活项色条颜色明显不同。
- 折叠侧栏（icon 模式）时仍能看到院徽圆标。
- 退出登录或切换学院时 banner/CSS 变量正确重置。