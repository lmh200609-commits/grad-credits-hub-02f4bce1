# 修复"新建教师/学生账号"日期选择器乱码与被遮挡

## 问题

1. **乱码重叠**：日历顶部出现"五月 / Year: 2026 / 2026 ▾"等文字与箭头叠在一起。
2. **被遮挡**：日历弹层超出对话框右边缘，部分日期看不见。

## 根因

- `src/components/ui/calendar.tsx` 中 `classNames` 未为 `captionLayout="dropdown-buttons"` 提供下拉布局相关样式（缺 `caption_dropdowns / dropdown / dropdown_month / dropdown_year / vhidden`），导致原生 `<select>`、隐藏的 caption 文本、左右翻页按钮全部重叠。
- `src/components/ui/date-picker.tsx` 的 `<PopoverContent>` 使用 `align="start"` 且无 `collisionPadding / sideOffset`，在 Dialog 右列触发时弹层向右溢出被裁切。

## 改动

### 1. `src/components/ui/calendar.tsx`
为 `dropdown-buttons` caption 补齐样式：
- 新增 `caption_dropdowns: "flex justify-center gap-1"`
- 新增 `vhidden: "hidden"`（隐藏原 caption 文字"五月"以避免与下拉重叠）
- 新增 `dropdown: "bg-background border border-input rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"`
- 新增 `dropdown_month / dropdown_year: "relative"`
- 调整 `caption_label` 在 dropdown 模式下隐藏（通过 `vhidden`，react-day-picker 会自动应用）

### 2. `src/components/ui/date-picker.tsx`
让弹层在 Dialog 内不被遮挡：
- `<PopoverContent>` 增加 `align="end"`（默认值改为 end，仍允许 prop 覆盖）
- 增加 `sideOffset={8}` 与 `collisionPadding={16}`
- 给 `PopoverContent` 加 `z-50 max-h-[--radix-popover-content-available-height] overflow-auto`

## 不改动

- 不修改任何业务页面（`SingleUserDialog.tsx` 等）；本次只动 UI 基础组件。
- 不改后端、不改数据库。

## 验证

打开"新建教师账号"/"新建学生账号"对话框，点击"选择日期"：
- 顶部应显示两个清晰的下拉框（年 / 月）+ 左右翻页箭头，无文字叠加。
- 日历完整显示在 Dialog 内，不被右边缘截断。
