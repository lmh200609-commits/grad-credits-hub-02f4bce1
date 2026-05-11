## 目标
将系统中所有日期/日期时间输入统一改为「点选式」组件，并显示为简体中文（`zh-CN` locale）。

## 涉及位置（共 5 处）
1. `src/components/SingleUserDialog.tsx` — 新建学生/教师账号「出生日期」（文本输入）
2. `src/pages/student/MyProfile.tsx` — 个人信息「出生日期」（文本输入）
3. `src/pages/admin/AuditLogs.tsx` — 审计日志起止日期筛选（原生 `<input type="date">`，浏览器英文界面）
4. `src/pages/admin/SubmissionWindows.tsx` — 提交窗口开始/结束时间（原生 `<input type="datetime-local">`）
5. `src/pages/admin/Keywords.tsx` — 已经是 shadcn Calendar，仅补 `zh-CN` locale

## 方案

### A. 新增两个统一组件（`src/components/ui/`）
- `date-picker.tsx`：基于 shadcn `Popover + Calendar + Button`，props `{ value: string | undefined /* YYYY-MM-DD */, onChange, placeholder?, disabled?, fromYear?, toYear?, allowFuture? }`。
  - 内部用 `date-fns` `format(d, "yyyy-MM-dd")` 序列化输出，按钮显示用 `format(d, "yyyy 年 M 月 d 日", { locale: zhCN })`。
  - `Calendar` 加 `locale={zhCN}`、`pointer-events-auto`、`captionLayout="dropdown-buttons"`、`fromYear`/`toYear` 用于出生日期可快速翻年。
- `date-time-picker.tsx`：日期 Popover + 两个数字 `Select`（小时 0–23、分钟以 5 步进或自由 00–59），输出 `YYYY-MM-DDTHH:mm`，与现有 `datetime-local` 字符串完全兼容。

两组件全部中文 placeholder（"选择日期"/"选择日期时间"）。

### B. 替换调用点
- **SingleUserDialog**：把「出生日期」`<Field>` 替换为 `<DatePicker fromYear={1940} toYear={当前年}>`，学生分支保留「必填 *」。校验保留（仍 `YYYY-MM-DD`）。
- **MyProfile**：「出生日期」`<EField>` 替换为 `<DatePicker fromYear={1940} toYear={当前年}>`。
- **AuditLogs**：两个 `<Input type="date">` 换成 `<DatePicker>`。
- **SubmissionWindows**：两个 `<Input type="datetime-local">` 换成 `<DateTimePicker>`，输出格式不变（仍 `YYYY-MM-DDTHH:mm`），后端 `new Date(value).toISOString()` 逻辑无需改动。
- **Keywords**：给已有 `<Calendar>` 加 `locale={zhCN}`，按钮显示文本改为 `format(d, "yyyy 年 M 月 d 日", { locale: zhCN })`。

### C. 全局 locale
`date-fns` 已是项目依赖。所有 `Calendar` 一律传 `locale={zhCN}`，所有按钮显示走中文格式串。Calendar 内置周名/月名通过 `locale` 自动汉化（一/二/…/日；1 月–12 月）。

## 不动的内容
- 数据库字段、Edge Function、批量导入解析（依旧接收/产出 `YYYY-MM-DD`）。
- 其他业务逻辑、校验文案保持不变。

## 验证
1. 打开「教师管理 / 学生管理 → 新建账号」「学生 → 个人信息」：「出生日期」按钮弹出中文日历，选择后按钮显示「2005 年 9 月 1 日」，提交后数据库存 `2005-09-01`。
2. 「审计日志」起止日期为中文日历选择器，筛选生效。
3. 「提交窗口」新建/编辑：开始/结束为日期+时间组合选择，保存后窗口起止时间正确。
4. 「关键词库」日历改为中文显示。
