# 学分排名：并列排名 + 班级多选筛选

## 需求

1. **并列排名**：累计学分相同的学生显示相同名次（dense rank），从高到低。若全员都是 0 分，则全部并列第 1。
2. **班级筛选支持批量**：在原有「院系」筛选旁新增「班级」筛选，支持多选若干班级，命中其一即纳入。

涉及两个页面：
- `src/pages/admin/Credits.tsx`（学院管理员 / 超管）
- `src/pages/teacher/Credits.tsx`（教师，数据来自 RPC `get_student_credit_ranking`）

## 1. 并列排名（dense rank）

前端统一计算，避免依赖后端 RPC：

```ts
// 排序后计算 dense rank
let rank = 0, prev = Number.POSITIVE_INFINITY;
const ranked = sorted.map((r) => {
  if (r.total_credit < prev) { rank += 1; prev = r.total_credit; }
  return { ...r, rank };
});
```

- admin 页：在 `setRows` 之前生成 `rank` 字段（Row 类型加 `rank: number`），表格直接渲染 `r.rank`，不再用 `page * PAGE_SIZE + i + 1`。
- teacher 页：忽略 RPC 返回的 `rank`，按相同逻辑在前端重算（保证「全 0 → 全部第 1」与 admin 一致）。

导出 Excel 同样使用计算后的 `r.rank`。

## 2. 班级多选筛选

新增交互：
- 用 `Popover` + 多个 `Checkbox`（shadcn 已有）做下拉多选（不用 Combobox 以减少依赖）。触发器是一个 `Button variant="outline"`，显示「全部班级」/「已选 N 个班级」。
- 班级列表来自 `rows.map(r => r.class_name)` 去重后字母排序。
- 顶部加「清空」按钮，并支持「全选 / 反选」操作。
- URL 同步：`classes=班级A,班级B`（逗号分隔，URL encode）；初次加载从 search params 读入。
- 筛选逻辑：`if (selectedClasses.size > 0 && !selectedClasses.has(r.class_name ?? "")) return false;`。
- 计数行更新："共 X 名 · 已选 N 个班级"。
- 筛选区从 `md:grid-cols-4` 调整为 `md:grid-cols-5` 以容纳新过滤器。

为兼容老 URL，仍保留 `dept` 单选。

## 技术细节

文件改动：

1. `src/pages/admin/Credits.tsx`
   - `Row` 增加 `rank: number`；构建列表时按学分降序排序后用 dense-rank 算法填充 `rank`。
   - 表格渲染 `#{r.rank}`；导出 Excel 用 `r.rank`。
   - 新状态 `classes: Set<string>`，与 URL 参数 `classes` 双向同步（`updateClassFilter` 写 `next.set/delete`）。
   - 渲染 Popover：`Button` 触发 → `PopoverContent` 含搜索框（按班级名过滤可选项）+ 「全选 / 清空」+ Checkbox 列表。
   - `filtered` 中加入班级判断；`useEffect` 重置分页时把 `classes` 也作为依赖。
   - 计算 `classes` 候选列表：`Array.from(new Set(rows.map(r => r.class_name).filter(Boolean))).sort()`，并按当前 `dept` 过滤后展示（如果选了院系，只显示该院系下的班级）。

2. `src/pages/teacher/Credits.tsx`
   - 同样的 dense-rank 逻辑（覆盖 RPC 的 rank）。
   - 同样的班级多选 UI 与 URL 同步。

3. 不改数据库；RPC 现有字段够用。

不改 RLS、不改后端逻辑，仅前端展示和筛选。
