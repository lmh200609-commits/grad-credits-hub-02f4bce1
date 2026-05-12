## 目标

学院管理员端、教师端的所有筛选 UI 中，去掉"按院系筛选"控件——因为这两端的用户已固定属于一个学院，再按"院系"过滤没有业务意义。

## 需要修改的 5 个文件

均仅删除"院系"下拉筛选控件，**保留**：表格中的"院系"列、搜索框对 department 字段的关键词匹配、CSV 导出中的"院系"列、以及与院系无关的其他筛选（专业 / 班级 / 是否合格等）。

1. `src/pages/admin/UsersManage.tsx`
   - 删除：`dept` state、`facets.departments`、查询里的 `.eq("department", dept)`、`<Select placeholder="院系">` 控件、依赖数组中的 `dept`。
   - 搜索 placeholder 改为不再提及"院系"也可，但保留搜索字段中的 `department.ilike` 不影响功能 → 仅去掉控件，搜索条件保留。

2. `src/pages/admin/Credits.tsx`
   - 删除：`dept` state、`departments` memo、`pool` 中按 dept 过滤、URL `?dept=` 参数读写、`<Select placeholder="院系">` 控件、依赖数组中的 `dept`。
   - "合格率/排名"统计的 `pool` 改为始终使用 `rows`。

3. `src/pages/teacher/Students.tsx`
   - 删除：`dept` state、`departments` memo、过滤条件、`<Select placeholder="院系">`、依赖数组 `dept`。

4. `src/pages/teacher/Credits.tsx`
   - 同 admin/Credits 的处理。

5. `src/components/BulkUserDialog.tsx`
   - 删除：`dept` state、`departments` memo、过滤条件、`<Select placeholder="院系">`、依赖数组 `dept`。

## 不改动

- 表格 `院系` 列、个人详情中的"院系"字段、导出 CSV 中的"院系"列、Dashboard 的"院系分布"图表（这是统计可视化，不是筛选）。
- WindowReport 中以院系为维度的报表分组（同上，是聚合维度而非筛选项）。
- 关键词搜索中对 department 的模糊匹配（不是独立筛选控件）。
- 超管端不动（超管跨学院，"院系"筛选对超管才真正有意义）。

## 验证

逐页打开 `/admin/users-manage`、`/admin/credits`、`/teacher/students`、`/teacher/credits` 以及"批量选择用户"弹窗，确认院系下拉已消失，其他筛选与表格列正常工作。
