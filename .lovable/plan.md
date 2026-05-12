# 统一所有日期选择器为「2026年7月」中文数字格式

## 现状

| 位置 | 当前显示 | 问题 |
|---|---|---|
| Calendar 顶部标题 | `五月 2026` | ❌ 月在前年在后；月份用中文 |
| DatePicker 触发器 | `2026 年 5 月 12 日` | ⚠ 含多余空格 |
| DateTimePicker 触发器 | `2026 年 5 月 12 日` | ⚠ 含多余空格 |
| Keywords 范围按钮 | `formatDepositDate → 2026-05-12` | 由 `formatDepositDate` 控制，是数字格式但用 `-` 分隔，与中文阅读习惯不一致 |

> 教师端 (`src/pages/teacher/*`) 无任何日期选择器；学院管理员端与超管端共用 `DatePicker / DateTimePicker / Calendar` 三个基础组件，集中修改即全覆盖。

## 改动

### 1. `src/components/ui/calendar.tsx`（核心）
为 `<DayPicker>` 传入自定义 `formatters`，强制 caption 输出 `YYYY年M月`：
```tsx
formatters={{
  formatCaption: (date) => `${date.getFullYear()}年${date.getMonth() + 1}月`,
}}
```
这会同时影响：
- `DatePicker` 弹出的日历
- `DateTimePicker` 弹出的日历
- `Keywords.tsx` 的双月份范围日历

### 2. `src/components/ui/date-picker.tsx`
触发按钮已选日期文字改为紧凑格式：
```diff
- format(parsed, "yyyy 年 M 月 d 日", { locale: zhCN })
+ format(parsed, "yyyy年M月d日", { locale: zhCN })
```

### 3. `src/components/ui/date-time-picker.tsx`
同上：
```diff
- format(date, "yyyy 年 M 月 d 日", { locale: zhCN })
+ format(date, "yyyy年M月d日", { locale: zhCN })
```

### 4. `src/lib/utils.ts` — `formatDepositDate`
为符合中文读写习惯，保持数字格式但改用「年月日」分隔：
```diff
- return `${y}-${m}-${day}`;
+ return `${y}年${Number(m)}月${Number(day)}日`;
```
`Number(...)` 去掉前导 0（如 5 月而非 05 月），与日历标题一致。

> 影响范围：审计日志、关键词沉淀日期范围按钮、关键词列表的"创建时间"列。所有这些场景现在都会显示如 `2026年5月12日`。

## 不改动

- 数据库存储格式（仍为 ISO 时间戳）。
- `DateTimePicker` 内部 `value` 仍是 `YYYY-MM-DDTHH:mm`（input/datetime-local 兼容）。
- 业务逻辑、提交、后端、Edge Functions。

## 验证（覆盖所有端 / 所有日期场景）

1. 超管 / 学院管理员：
   - 提交时间窗口 → 新建批次 → 开始/结束日期触发器与日历标题
   - 审计日志 → 开始/结束日期
   - 关键词库 → 沉淀日期范围按钮 + 创建时间列
   - 学生 / 教师管理 → 新建账号 → 出生日期
2. 学生：我的资料 → 出生日期。
3. 所有日历顶部应显示 `‹ 2026年5月 ›`，所有触发器与列表日期为 `2026年5月12日`。
