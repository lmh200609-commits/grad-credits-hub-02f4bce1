# 修复表单聚焦边框被裁切 & 日期选择器重复"五月/2026"

## 问题与根因

### 1. 输入框聚焦时边框被裁切
`src/components/SingleUserDialog.tsx` 第 178 行：
```
<div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">
```
该容器为滚动容器（`overflow-y-auto`）但无内边距。`Input` 聚焦环 `focus-visible:ring-2 ring-offset-2` 共 4px，会被容器左/右/下边缘裁掉，造成截图中"床号"边框缺一块。

### 2. 日期选择器重复显示"五月/2026"
react-day-picker dropdown 模式下，每个 `rdp-dropdown_month / rdp-dropdown_year` 内部同时含有 `<select>` 与一个用于视觉显示的 `caption_label`。上一次修改把 `dropdown` 类设为可见 select 样式，但未隐藏其下方的 `caption_label`，于是出现两套"五月 ▾ / 2026 ▾"。

## 改动

### A. `src/components/SingleUserDialog.tsx`（仅改一行）
将第 178 行容器加内边距，给焦点环留空间：
```diff
- <div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">
+ <div className="grid max-h-[60vh] gap-3 overflow-y-auto px-1 py-1 sm:grid-cols-2">
```

### B. `src/components/ui/calendar.tsx`
隐藏 dropdown 内部重复的 caption_label，仅保留可见的 `<select>`：
```diff
- dropdown_month: "relative",
- dropdown_year: "relative",
+ dropdown_month: "relative [&>.rdp-caption_label]:hidden",
+ dropdown_year: "relative [&>.rdp-caption_label]:hidden",
```
（不影响普通 buttons 模式 —— 那种模式下 caption_label 是 caption 的直接子级，不在 dropdown_* 内部。）

## 不改动

- 不动业务逻辑、表单字段、提交流程。
- 不动后端、数据库。

## 验证

1. 打开"新建学生账号"/"新建教师账号"，依次点击各输入框（含最右列、最底部的"床号"）：聚焦环完整可见，不再被裁切。
2. 点击"出生日期 → 选择日期"：顶部仅有一行"月份 ▾ 年份 ▾"下拉 + 左右翻页箭头，不再重复出现"五月/2026"。
