## 问题

用户在 `/admin/submission-windows`（侧边栏需要向下滚才能看到底部的"实时一致性"）。点击"实时一致性"后，新页面加载，但**侧边栏自身的滚动位置被重置到顶端**，导致刚刚选中的菜单项滚出可视区——视觉上就是"界面突然跳到最上端"。

## 根因

项目里**每个页面**都各自包裹一层 `<AppLayout>`（已确认 30+ 个页面都是这种用法）。路由切换 = 旧 AppLayout 卸载 + 新 AppLayout 重新挂载 = 侧边栏内的滚动容器被重建，`scrollTop` 回到 0。

之前我们去掉了 `scrollIntoView`（解决了"主内容区被推走"的跳），但侧边栏自身在重挂时丢失滚动位置这一问题仍在。

## 方案对比

- **方案 A（推荐，最小改动）**：在侧边栏的滚动容器上做"会话级滚动位置保持"。
  - 在 `AppSidebar` 里给 `<SidebarContent>` 接一个 `ref`，挂载时从 `sessionStorage`（key 例如 `sidebar-scroll-top`）读取并 `scrollTop = saved`。
  - 监听该容器的 `scroll` 事件（节流），把当前 `scrollTop` 写回 `sessionStorage`。
  - 这样跨页导航时侧边栏滚动位置保持不变，刚刚点击的菜单项仍然在视区内，不再"跳到最上端"。
  - 改动只集中在 `src/components/AppLayout.tsx` 内的 `AppSidebar`，零侵入、不影响其他页面。

- **方案 B（更彻底，但改动大）**：把 `AppLayout` 提升为 React Router 的 layout route（在 `src/App.tsx` 用 `<Route element={<AppLayoutOutlet/>}>` 包裹所有受保护路由），让所有页面共用同一个 AppLayout 实例，从此侧边栏不再随页面卸载。需要逐页删掉 `<AppLayout>` 包裹，并在 `Index.tsx` 等地方调整 `Outlet` 用法，涉及 30+ 文件，回归风险高。

→ **采用方案 A。**

## 改动点（仅一文件）

`src/components/AppLayout.tsx` 的 `AppSidebar`：

```tsx
const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { hasRole, isSuperAdmin } = useAuth();
  const location = useLocation();
  const items = /* 原逻辑 */;
  const scrollRef = useRef<HTMLDivElement>(null);

  // 在挂载时恢复上次滚动位置
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = Number(sessionStorage.getItem("sidebar-scroll-top") || "0");
    if (saved > 0) el.scrollTop = saved;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        sessionStorage.setItem("sidebar-scroll-top", String(el.scrollTop));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <Sidebar collapsible="icon">
      <SidebarContent ref={scrollRef}>
        {/* 原内容不变 */}
      </SidebarContent>
    </Sidebar>
  );
};
```

如 `SidebarContent` 不能直接接 `ref`（看 shadcn 实现是 `forwardRef`，可以），就把 `ref` 放在它里面的第一层 `<div>` 上即可。

## 验收

- 在 `/admin/submission-windows` 把侧边栏滚到底部，点击"实时一致性"：跳转到目标页面后，侧边栏依然停在原位，"实时一致性"仍可见且为高亮态。
- 折叠/展开侧边栏、跨各角色导航均正常。
- 主内容区滚动位置仍然按浏览器默认行为（每页从顶端开始），不受影响。