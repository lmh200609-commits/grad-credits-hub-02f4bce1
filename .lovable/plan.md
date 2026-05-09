## 问题诊断

通过截图与代码核对，三个问题的根因均与"主题色被设成接近白色"以及"激活态依赖主色显色"有关：

1. **提交时间窗口看不到"新建批次"按钮**：按钮其实存在（页头右上 + 卡头右上 + 空状态中央，共 3 处），但 `Button` 默认 `bg-primary text-primary-foreground`。当前学院的 `theme.primary` 被存成接近白色（截图中"主色/背景色"色块都是白），白底 + 白字 → 按钮"消失"。
2. **学院界面风格缺少"确认提交"按钮 + 改完后教师/学生端不变**：页面已有"保存主题"按钮（同样因白底白字看不见），且保存后只有当前会话刷新才能看到效果——`useCollegeTheme` 仅在挂载时读一次，没有订阅 `colleges` 行的实时更新，所以同学院的教师/学生端不会同步。
3. **侧栏看不出当前页**：激活样式用 `bg-primary/15` + `text-primary` + 左侧 `before:bg-primary` 竖条，主色发白时三者全部不可见。

## 改动方案（仅前端展示层 + 已有保存逻辑兜底）

### 一、`src/pages/admin/Branding.tsx`

- 在保存按钮前加一段提示卡片："以下修改仅作用于本学院（{当前学院名}），保存后本学院的全部管理员、教师、学生端将自动同步。"
- 把"保存主题"按钮替换为更醒目的"确认并提交修改"主按钮 + 旁边"还原"次按钮：
  - 主按钮使用 `variant="default"` 但包一层强制文字色 `className="!text-white"`，避免主色发白时不可见。
  - 点击后弹出 `AlertDialog` 二次确认："确认将新的界面风格应用到本学院的所有用户？"，确认后再调用现有 `save()`。
- "保存"成功后保留现有 toast，并把"刷新页面后生效"改为"已同步到本学院全部用户"。
- 主色亮度护栏：保存前若 `primary` 亮度 > 88% 或 `background` 亮度同主色亮度差 < 5%，弹 toast 警告"主色过浅，按钮可能不可见，是否继续"。

### 二、`src/hooks/useCollegeTheme.ts`（实时同步）

- 在加载学院后，新增 Supabase Realtime 订阅：`postgres_changes` on `public.colleges` filter `id=eq.{collegeId}`，收到 `UPDATE` 后重新读取并把 `--primary / --accent / --background / --radius` 写回 `:root`。
- 卸载时移除 channel。
- 这样学院管理员保存后，所有同学院教师/学生端实时跟随，无需刷新。

### 三、`src/components/AppLayout.tsx`（侧栏激活态强可见）

- 激活项样式改为不依赖主色的强对比方案：
  - 容器：`bg-accent text-accent-foreground font-medium`
  - 左侧竖条：`before:bg-foreground`（而非 `before:bg-primary`）
  - 图标：`text-foreground`
- 同时保留 hover 态。这样无论学院主色多浅，当前页都能清晰高亮。

### 四、`src/pages/admin/SubmissionWindows.tsx`（按钮强制可读）

- 三处 `<Button onClick={openCreate}>新建批次</Button>` 加 `className="!text-white"`，保证主色发白时仍能看到字。
- "新建第一个批次"按钮同上处理。
- 不动业务逻辑、表结构、调用顺序。

## 范围与不动项

- 不修改任何数据库结构、RLS、Edge Function。
- 不动其它页面文案与逻辑。
- 现有保存流程（`colleges.update({theme,system_title}).eq('id', collegeId)`）天然只影响该学院；本次新增 Realtime 订阅让"同步到教师/学生端"自动完成。

## 验收

- 学院管理员打开"提交时间窗口" → 右上、卡头、空状态三处都能清楚看到"新建批次"按钮。
- 学院管理员在"学院界面风格"修改主色 → 弹确认 → 确认 → 同学院的教师/学生在另一标签页内 1–2 秒内界面自动变色，无需刷新。
- 任何主题下，侧栏当前页都有清晰的高亮 + 左侧竖条。
