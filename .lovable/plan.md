# 简化日期选择器顶部为「‹ 月份文字 ›」

## 目标

去掉日历顶部臃肿的"月 / 年"双下拉，改为 react-day-picker 默认的 buttons 布局：左右箭头翻月 + 中间显示"2026年6月"。

## 改动

### 1. `src/components/ui/date-picker.tsx`
移除 dropdown 模式：
```diff
- captionLayout="dropdown-buttons"
- fromYear={_fromYear}
- toYear={_toYear}
```
`fromYear / toYear` 在 buttons 模式下不再需要（仅 dropdown 模式起范围限制作用）。`disableFuture` 仍保留，确保出生日期不能选未来。

### 2. `src/components/ui/calendar.tsx`
回滚上一次为 dropdown 模式添加的样式（已不再使用）：
```diff
- caption_dropdowns: "flex justify-center gap-1",
- vhidden: "hidden",
- dropdown: "bg-background border border-input rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
- dropdown_month: "relative [&>.rdp-caption_label]:hidden",
- dropdown_year: "relative [&>.rdp-caption_label]:hidden",
```
保留原始 `caption_label / nav_button` 样式。

## 取舍说明

用户选择"仅左右箭头 + 月份文字"。该方案最简洁；缺点是选择出生年份等跨年场景需多次点击翻月。如果之后觉得翻年太慢，可再加一对"« »"年度翻页按钮 —— 本次不做。

## 不改动

- `DatePicker` 的 props 接口、调用方（`SingleUserDialog.tsx` 等）保持不变。
- 不动业务逻辑、后端、数据库。

## 验证

打开"新建学生 / 教师账号 → 选择日期"：日历顶部仅有 `‹  2026年6月  ›`，无重复文字、无下拉框，整体清爽。
