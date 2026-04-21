

# 工作助手保持常驻 + 聊天记录持久化

## 问题

1. 管理员点击 AI 助手返回的「跳转 xxx」按钮或候选学生卡片后，路由切换导致 `StaffAiAssistant` 组件被卸载（或 state 重置），面板关闭。
2. 重新打开助手时 `messages` 回到初始 `[WELCOME]`，历史对话丢失。

## 根因

- `StaffAiAssistant` 渲染在 `AppLayout` 内，路由切换时虽然 Layout 不卸载，但组件内 `open`、`messages`、`tab`、`input` 都是局部 `useState`，任何导致组件重挂载的情况都会清空。
- 没有持久化层；即使组件不卸载，刷新页面也会丢。

## 修复方案

将助手的 UI 状态与会话提升为**全局 + 持久化**：

### 1. 新增 `src/hooks/useStaffAssistantStore.ts`

用 Zustand（项目已用过类似轻量模式）或一个简单的自定义 store + `localStorage` 持久化。优先用**纯自定义实现**避免新增依赖：
- 模块级 `let state` + `Set<listener>` + `useSyncExternalStore`
- 字段：`open`、`tab`、`messages`、`input`
- 写入时同步到 `localStorage`（key: `staff-assistant-v1`），仅持久化 `messages` 和 `tab`，不持久化 `open`（避免每次进系统就弹出）
- 提供 `setOpen / setTab / setMessages / setInput / clearMessages` 方法

### 2. 改造 `src/components/StaffAiAssistant.tsx`

- 删除所有 `useState` 关于 `open / tab / messages / input`，改用 store hook
- 在 header 增加「清空对话」按钮（垃圾桶图标），调用 `clearMessages()` 重置为 `[WELCOME]`
- 顶部 X 按钮仅设置 `open=false`，不清空消息

### 3. 确保跳转后助手不被卸载

- `StaffAiAssistant` 已挂在 `AppLayout` 顶层（教师/管理员路由共用），路由切换 Layout 不卸载 → 组件实例保留
- 配合 store 化后，即便某个角色路由切换导致 Layout 重渲染，状态也从 store 读取，`open` 维持 `true`
- 验证：点击「跳转 /admin/credits」按钮后，`navigate()` 触发路由变化，`StaffAiAssistant` 仍保持 `open=true`、消息列表完整

### 4. 容错

- `localStorage` 解析失败时回退到 `[WELCOME]`
- 限制持久化消息条数 ≤ 50，避免无限增长
- SSR / 首次加载时 `typeof window === "undefined"` 守卫

## 文件改动

**新增**
- `src/hooks/useStaffAssistantStore.ts` — 全局 store + localStorage 持久化

**修改**
- `src/components/StaffAiAssistant.tsx` — 改用 store、添加「清空对话」按钮

**不动**
- `AppLayout.tsx`、Edge Function、其他页面

## 验收

- 管理员与助手对话 → 点击「跳转 /admin/review」→ 路由切到复核中心，**助手面板仍保持打开**，对话记录完整
- 手动点击 X 关闭后再打开 → 历史对话仍在
- 刷新整个页面 → 对话记录从 localStorage 恢复
- 点击 header「清空对话」→ 回到欢迎语
- 任何场景下助手不会自动关闭，只能由用户点击 X

