## 问题

点击侧边栏进入页面后，难以识别"当前在哪个页面"，原因有两点：

1. **侧边栏激活态不够显眼**：`SidebarMenuButton` 是 shadcn 默认按钮容器，它自带的 hover/背景样式会把内部 `NavLink` 的 `isActive` 样式（淡淡的 `bg-primary/10` + 3px 左侧条）覆盖或弱化，视觉上几乎看不出区别。
2. **顶部没有当前页面标题**：header 只显示"学分认证系统"这一固定文字，没有当前路由的名称作参考。

## 修改方案（保持现有配色与基础样式不变）

### 1. 强化侧边栏激活项（`src/components/AppLayout.tsx`）
在不更换配色（仍用 `primary`）的前提下，让激活项更明显：
- 用 `SidebarMenuButton` 自身的 `isActive` 属性来驱动激活样式，而不是仅靠内部 `NavLink` 的 className（避免被父级按钮样式覆盖）。
- 激活态样式微调：
  - 背景从 `bg-primary/10` 改为略深的 `bg-primary/15`
  - 文字保持 `text-primary font-medium`
  - 保留左侧 3px `bg-primary` 竖条作为强指示
  - 图标在激活时也变为 `text-primary`
- 非激活项保持现状（`text-sidebar-foreground` + `hover:bg-muted`）。
- 折叠态（icon-only）下，左侧竖条同样可见，便于在迷你模式识别当前项。

实现要点：用 `useLocation()` 计算 `isActive`，传给 `SidebarMenuButton` 的 `isActive` prop，同时给 `NavLink` 加 `data-active` 配合样式。

### 2. 顶部 header 显示当前页面名（`src/components/AppLayout.tsx`）
- 根据当前路径，在三套菜单（admin / teacher / student）+ 少量额外路由（如 `/apply`、`/my-applications`、`/reviews`、`/admin/*` 详情页）中查找匹配项的 `title`。
- 在 header 中"学分认证系统"右侧加一个分隔符 `·` 和当前页面名（`text-muted-foreground`，不抢主标题视觉）。
- 移动端窄屏自动隐藏（`hidden sm:inline`），避免拥挤。

### 3.（可选小增强）页面内 `PageHeader` 兜底
现有 `PageHeader` 组件已存在。检查目前几个主要路由页面是否都使用了它；若有遗漏的页面没有标题，会在后续单独补全（本次不在范围内，仅做记录）。

## 不做的事

- 不改侧边栏整体配色、宽度、折叠机制
- 不改 `sidebar.tsx` shadcn 组件源码
- 不引入面包屑组件库
- 不调整路由结构

## 涉及文件

- `src/components/AppLayout.tsx`（唯一修改文件）

## 验收

- 进入任一菜单项后：侧边栏对应项有明显的浅色背景 + 左侧竖条 + 主色文字/图标
- 顶部 header 显示当前页面名称（桌面端）
- 折叠侧边栏到 icon 模式时，仍能通过左侧竖条+图标主色识别当前项
- 现有配色（primary/sidebar 颜色变量）未变更