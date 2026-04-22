

# 简化工作助手：移除快捷指令 + 修复滚动 + 去除底部空白

## 改动概览

### 1. 移除「快捷指令」板块
- 删除 `QUICK_ACTIONS` 常量、`activeQuick` 状态、`Tabs/TabsList/TabsTrigger/TabsContent` 包裹结构。
- 助手面板内只保留单一聊天界面（消息列表 + 输入框），不再有 tab 切换栏。
- 同步清理 `useStaffAssistantStore.ts`：移除 `tab` 字段及 `setTab` action，`loadPersisted` 只持久化 `messages`，避免脏数据残留。

### 2. 发送消息后自动滚动到最新内容（当前失效的根因）
- 现状：`scrollRef` 挂在 ScrollArea 内层 div 上，但 Radix `ScrollArea` 的真正滚动容器是 `[data-radix-scroll-area-viewport]`，所以 `scrollTop = scrollHeight` 写在错位的 div 上没有效果。
- 修复方案：放弃 `ScrollArea`，改用原生 `div + flex-1 min-h-0 overflow-y-auto`(与「快捷指令」修复一致的模式)，`scrollRef` 直接挂在该滚动容器上。`useEffect` 监听 `messages` 和 `loading` 变化时设置 `scrollTop = scrollHeight`，并加一个 `requestAnimationFrame` 确保 DOM 更新后再滚。

### 3. 去除发送框下方的大片空白
- 当前 footer `<div className="border-t p-3">` 下还有一行 `<p className="mt-1 text-[10px] ...">由国产大模型驱动…</p>` 占位较多，加上面板固定高度 `560px` 减去消息区导致视觉空白。
- 处理：
  - 删除底部 "由国产大模型驱动…" 提示文案。
  - 将 footer 内边距从 `p-3` 收紧为 `px-3 py-2`。
  - 面板高度从固定 `min(560px, …)` 改为内容自适应：`h-[min(520px,calc(100vh-6rem))]`，并确保聊天区 `flex-1 min-h-0`，让消息区自然占满，输入框紧贴底部，无残留空白。

## 文件改动

**修改**
- `src/components/StaffAiAssistant.tsx` — 移除 Tabs/快捷指令，改用原生滚动容器，scrollRef 挂到正确节点，收紧底部布局，删除提示文案。
- `src/hooks/useStaffAssistantStore.ts` — 移除 `tab` 字段与 `setTab` action，持久化只保留 `messages`。

**不动**
- 数据库、edge function、其他页面。

## 验收

- 打开工作助手 → 直接进入聊天界面，没有「智能问答 / 快捷指令」tab 栏。
- 发送任意消息或收到 AI 回复 → 消息列表自动滚到最底部，最新内容可见。
- 输入框紧贴面板底部，下方无多余空白；面板整体更紧凑。
- 刷新页面后历史消息仍保留（localStorage 持久化未受影响）。

