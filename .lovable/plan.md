## 一、问题定位

用户反馈：
- 超级管理员侧边栏点击 **AI 模型设置 / 审计日志 / 提交时间窗口 / 实时一致性** 会"跳"
- 学院管理员侧边栏点击 **学院界面风格 / 提交时间窗口 / 实时一致性** 也会"跳"

经审计，"跳"并非权限/路由跳回首页（路由守卫与角色映射均正确，super_admin 能进 admin 路由、college admin 能进 admin 路由）。两类共同特征是：**这些菜单项都是侧边栏靠下的几项**（在 17 项 / 15 项菜单中位列第 13-17）。在用户当前 574px 高的视口下它们多半超出可视区域。

### 根因 1（主因）：`SidebarNavItem` 在激活时调用 `scrollIntoView`，导致整页滚动

`src/components/AppLayout.tsx:127-131`：

```ts
useEffect(() => {
  if (active && ref.current) {
    ref.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}, [active]);
```

当点击底部菜单项后，新页面挂载、对应导航项变为 active → `scrollIntoView` 触发。由于侧边栏内部容器在该项位置之外，浏览器会沿滚动祖先链向上找到第一个可滚动元素（包括 `<main>` 的 `overflow-auto` 或文档根），把整个布局向上拉一段——视觉上就是用户描述的"跳"。

排在中部的菜单项（如规则库、关键词库、学生管理）因初始就在视区内，`scrollIntoView` 是 no-op，所以不跳。这完全解释了为什么**只有底部几项**会跳，且超管/学院管理员各自的"跳页清单"恰好对应各自侧边栏的最后 3-4 项。

### 根因 2（次因）：`useCollegeTheme` 在每次 `AppLayout` 卸载时重置 CSS 变量

`src/hooks/useCollegeTheme.ts:78-82` 在 effect 清理中调用 `resetThemeVars`，删掉 `--primary / --background / --accent / --radius` 等。每个页面都各自包了一层 `<AppLayout>`，路由切换 = AppLayout 卸载+重挂 = 主题被擦除然后异步从数据库重取再贴回，造成主背景/主色短暂闪一下默认色。这个闪烁在每次导航都存在，但底部菜单项的"页面滚动跳"叠加上"颜色闪"会更明显。

### 根因 3（边角）：`Branding.tsx` 在 `collegeId` 未就绪时直接渲染"未绑定学院"

`src/pages/admin/Branding.tsx:148-150`：未先判 `loading`，刷新或首次进入时若 useAuth 还没拉完角色，会先闪一下"未绑定学院"再切回正常表单——也是一种"跳"。

---

## 二、修复方案

### 修复 1：去掉 `SidebarNavItem` 中导致整页滚动的 `scrollIntoView`（核心修复）

在 `src/components/AppLayout.tsx`：

- **方案 A（推荐，最小改动）**：直接删掉这个 `useEffect`。侧边栏整体高度受 `min-h-screen` 控制，菜单数 ≤ 17 行，正常视口都能放下；当 sidebar 自身确有滚动时，浏览器会自动随键盘焦点处理，不需要 JS 主动 scroll。
- **方案 B（保留滚动但不影响主页面）**：把调用改成"仅在挂载时执行一次"，并在调用前先检查目标祖先 `[data-sidebar="content"]` 是否真的可滚动；非可滚动则跳过。代码示例：

```ts
const didScrollRef = useRef(false);
useEffect(() => {
  if (didScrollRef.current || !active || !ref.current) return;
  didScrollRef.current = true;
  const sb = ref.current.closest('[data-sidebar="content"]') as HTMLElement | null;
  if (sb && sb.scrollHeight > sb.clientHeight) {
    const top = ref.current.offsetTop - sb.offsetTop;
    sb.scrollTo({ top: Math.max(0, top - 8), behavior: "auto" });
  }
}, [active]);
```

我们采用方案 A 即可彻底消除"跳"。

### 修复 2：让 `useCollegeTheme` 不再于卸载时擦除主题

在 `src/hooks/useCollegeTheme.ts`：

- 移除 effect 清理函数中的 `resetThemeVars(document.documentElement)`（保留 `cancelled = true` 与 `removeChannel`）。
- 仅当 `collegeId` 由"有"变成"无"（如登出）时清空——可在 `useEffect` 起始处的 `if (!collegeId)` 分支保留 `resetThemeVars`。
- 这样跨页导航不再闪默认背景色。

### 修复 3：`Branding.tsx` 等待 auth 加载完成再判断 `collegeId`

在 `src/pages/admin/Branding.tsx`：

```tsx
const { collegeId, loading: authLoading } = useAuth();
if (authLoading) {
  return <AppLayout><div className="p-6 text-muted-foreground">加载中…</div></AppLayout>;
}
if (!collegeId) {
  return <AppLayout><div className="p-6 text-muted-foreground">未绑定学院，无法配置主题。</div></AppLayout>;
}
```

避免首次进入闪一下"未绑定学院"。

### 不需要改的地方（已验证正确）

- `RoleRoute` / `ProtectedRoute`：role 加载完成后才放行，不会误重定向。
- super_admin 已在 `RoleRoute` 中绕过角色检查；admin 路由对 super_admin 始终放行。
- 各页面（AiModels / AuditLogs / SubmissionWindows / RealtimeDiagnostics）内没有任何强制 `Navigate` 跳转。

---

## 三、验收标准

1. 在 574px 高的视口下点击侧边栏底部任意菜单项（AI 模型设置 / 审计日志 / 提交时间窗口 / 实时一致性 / 学院界面风格），主内容区不再"跳"，URL 切换且页面平滑出现。
2. 学院管理员跨页导航，主背景色/主色不再闪烁默认色。
3. 学院管理员首次进入 `/admin/branding` 时直接显示表单，不再闪"未绑定学院"。
4. 其余权限与功能行为保持不变。