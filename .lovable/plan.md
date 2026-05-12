## 目标

把 `/admin/dashboard` 顶部统计卡片中合并显示的「规则 / 师生 — 141 / 0+294」拆成两张独立卡片，让数字更清晰、不再臃肿。

## 现状

`src/pages/admin/Dashboard.tsx` L106 在 6 列网格里有一张合并卡片：

```tsx
<StatCard label="规则 / 师生" value={`${ruleCount} / ${teacherCount}+${studentCount}`} accent="text-cyan-600" />
```

一张卡里塞了 3 个数字 + 1 个分隔符 + 1 个加号，识别成本高。

## 改动

仅修改 `src/pages/admin/Dashboard.tsx`，将该卡拆为两张并排卡片：

1. **规则数**
   - label：`规则数`
   - value：`{ruleCount}`
   - accent：`text-cyan-600`

2. **教师 / 学生**
   - label：`教师 / 学生`
   - value：`{teacherCount} / {studentCount}`（用「/」替代原本含义不清的「0+294」加号写法）
   - accent：`text-cyan-600`

同时把外层网格从 `lg:grid-cols-6` 调整为 `lg:grid-cols-7`，保持单行布局，避免拆分后换行错位。

## 学院管理员端 / 教师端核对

- 当前 `/admin/dashboard` 即"学院管理员端"Dashboard（登录账号 13647488835 为国际经济与贸易学院管理员）。
- `src/pages/super/`（超管）只有 `Admins.tsx`、`Colleges.tsx`，无统计面板，无需改动。
- `src/pages/teacher/` 经全局搜索（`rg "师生|ruleCount"`）无任何相同面板，无需改动。

## 不改动

- `StatCard` 组件本身、其他统计卡、数据来源（`ruleCount / teacherCount / studentCount` 仍来自原 query）、业务逻辑、其他页面。
