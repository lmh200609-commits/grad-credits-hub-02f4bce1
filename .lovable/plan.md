# 学生端清理 + 登录按钮修复

## 1. 学生端删除"实时一致性"入口

`src/components/AppLayout.tsx` 中 `studentItems`（第 67-73 行）包含一项：
```
{ title: "实时一致性", url: "/diagnostics/realtime", icon: Activity }
```
这是面向运维 / 管理员的诊断页，不应暴露给学生。

**改动**：从 `studentItems` 移除该条目。教师端、学院管理员、超级管理员保留（他们需要排查实时同步问题）。

## 2. 登录按钮"有时消失"的根因

登录页截图显示「登录」按钮变成了纯白色块，文字不可见。原因：

- `src/pages/Login.tsx` 第 82 行的 `<Button>` 使用默认 `variant="default"`，样式是 `bg-primary text-primary-foreground`。
- `src/hooks/useCollegeTheme.ts` 在用户登录某学院后，会把 `--primary` 写到 `document.documentElement.style` 上（来自学院主题，可能是接近白色的浅色，或来自校徽提取色）。
- 学生 / 老师**登出**后跳到 `/login`：Login 页面**不渲染** `AppLayout`，因此 `useCollegeTheme` 卸载，但它的清理只在 `collegeId` 变 null 时执行——而登出后整个组件直接卸载，`useEffect` 的 cleanup 只移除 realtime channel，**不会** `removeProperty("--primary")`。残留的浅色 `--primary` 让按钮和背景同色 → "登录"按钮消失。
- 此外 `--background` 一旦被学院主题覆盖，从未被清除。

**修复方案（双保险）**：

A. 在 `useCollegeTheme.ts` 的 `useEffect` cleanup 中，无条件 `removeProperty` 所有它可能写入的变量（`--primary`、`--ring`、`--sidebar-primary`、`--sidebar-ring`、`--accent`、`--background`、`--radius`），这样组件卸载时一定会还原。同时把 `collegeId` 为 null 的分支也加上 `--background`、`--accent` 的清理。

B. 把 `Login.tsx` 中的「登录」按钮改成 `variant="solid"`，使用稳定的 `--action` / `--action-foreground` token（上次已加），即便主题变量异常也始终是深底白字。

两步组合后，登录按钮在任何 session 状态下都保持可见。

## 技术细节

文件改动：

1. `src/components/AppLayout.tsx`
   - 从 `studentItems` 删除 `实时一致性` 项。

2. `src/hooks/useCollegeTheme.ts`
   - 抽出 `resetThemeVars(root)`，移除 `--primary`、`--ring`、`--sidebar-primary`、`--sidebar-ring`、`--accent`、`--background`、`--radius`。
   - `collegeId` 为 null 分支调用 `resetThemeVars`。
   - useEffect 的 cleanup 中追加 `resetThemeVars(document.documentElement)`，确保切换路由 / 登出时彻底清空。

3. `src/pages/Login.tsx`
   - `<Button type="submit" variant="solid" className="w-full" ...>`。

不动业务逻辑、RLS、数据表。
