## 问题
`useStaffAssistantStore` 用固定的 localStorage key `staff-assistant-v1` 存放工作助手聊天记录。同一台电脑上若超管、学院管理员、教师先后登录，会读到同一份历史 —— 即"互通"。需要按账号隔离。

（注：学生端 `AiAssistant.tsx` 不持久化历史，关闭弹窗即丢，不受影响。）

## 方案

按"当前登录用户 id"给 storage key 加后缀，并在登录态变化时切换：

1. **改造 `src/hooks/useStaffAssistantStore.ts`**
   - storage key 由常量改为 `staff-assistant-v1:<userId>`；未登录用 `staff-assistant-v1:anon`。
   - 暴露一个 `setStaffAssistantUser(userId: string | null)` 方法：
     - 切换内部 `currentKey`；
     - 从新 key 读取该账号的历史，重置 `state.messages`（找不到就回到 `WELCOME`）；
     - 关闭弹窗、清空输入；
     - 通知订阅者刷新。
   - `persist()` 写入当前 `currentKey`。

2. **在 `src/hooks/useAuth.tsx` 接入切换**
   - `onAuthStateChange` 与初始 `getSession()` 中拿到 user 后，调用 `setStaffAssistantUser(user?.id ?? null)`。
   - 登出时调 `setStaffAssistantUser(null)`，避免下一个账号看到上一份。

3. **一次性清理旧 key（可选）**
   - 首次加载时若发现旧的 `staff-assistant-v1`（无后缀）残留，直接 `localStorage.removeItem`，防止泄漏到任何账号。

## 不改动的内容
- 不改 UI、不改助手对话逻辑、不动 edge function。
- 学生端 `AiAssistant` 仍按现状（会话内内存，关闭即清）。
- 不引入服务端持久化（如果后续要跨设备同步再单独讨论）。

## 验证
- A 账号登录 → 与助手对话几条 → 退出。
- B 账号登录 → 工作助手应只显示欢迎语，看不到 A 的内容。
- 重新切回 A → 历史应恢复。
- 检查 localStorage 中只存在带 user id 后缀的 key，旧的无后缀 key 已被清掉。
