## 问题
当前出生日期用通用 `DatePicker`（shadcn Calendar 默认头部），只有「← →」逐月翻动，选 80/90/00 后年份要点几十下，完全不适合"出生日期"这种跨度大的场景。

## 方案：新建一个紧凑的"年/月/日"三段下拉选择器

不动通用 `DatePicker`（提交时间窗口等仍需要日历视图）。新增专用组件给"出生日期"用，三段 `Select` 横排，一屏内最多 3 次点击完成选择。

### 1. 新建 `src/components/ui/ymd-picker.tsx`
- Props 与 `DatePicker` 兼容：`value: string | null` (YYYY-MM-DD)、`onChange(v: string)`、`disabled`、`placeholder`、`fromYear?`、`toYear?`、`disableFuture?`、`allowClear?`、`className?`。
- UI：三个紧挨着的 shadcn `Select`，宽度自适应，整体一行：
  - 年：`fromYear`（默认 1940）→ `toYear`（默认今年），降序排列，方便往近年找。
  - 月：1–12。
  - 日：根据已选年/月动态生成 28–31，并自动钳制（如 2 月 30 日 → 2 月 28/29）。
- 任意一段未选完整时不触发 `onChange`；三段齐全时输出 `YYYY-MM-DD`，并对 `disableFuture` 做校验（未来日期 → 不写入并轻提示）。
- 当 `allowClear` 且已有值时，行尾显示一个小「清除」按钮。
- 仍兼容现有的字符串校验（`/^\d{4}-\d{2}-\d{2}$/`）。

### 2. 接入两处出生日期
- `src/pages/student/MyProfile.tsx`：把 `DatePicker` 换成 `YmdPicker`（保留 `disableFuture`、默认 `fromYear=1940`）。
- `src/components/SingleUserDialog.tsx`：必填和可选两个出生日期都换成 `YmdPicker`。

### 3. 不动的内容
- 通用 `DatePicker` 保持不变，提交时间窗口等仍用日历。
- 数据库字段、字符串格式、校验逻辑、导入模板均保持 `YYYY-MM-DD`，零迁移。

## 验证
- 学生端「我的档案」出生日期：年/月/日三个下拉，可在 3 次点击内完成；2 月选 30 日时自动变 28/29；未来日期不能选；清除可恢复为空。
- 新建教师账号（当前页面 /admin/users/teachers）→ 出生日期同样三段式，必填校验依旧生效。
- 已存在的旧值（`1998-05-12`）打开后三段正确回显。
