## 目标
1. 优化「新增/编辑案例」对话框布局，减少纵向高度
2. 新增通用「可搜索下拉」组件，先用于"关联规则"，并同步到系统中其他长列表下拉

---

## 一、案例对话框布局优化（`src/pages/admin/Cases.tsx`）

当前问题：竖向堆叠 6 个字段 + 大段 Textarea，整体超出小屏视口需要滚动，按钮被挤到底部。

调整方案：
- `DialogContent` 加宽：`sm:max-w-2xl`，并 `max-h-[85vh] overflow-y-auto`
- 使用 2 列栅格 `grid grid-cols-2 gap-3`：
  - 第 1 行：标题（占 2 列）
  - 第 2 行：关联规则 / 给定学分（各 1 列）
  - 第 3 行：摘要（占 2 列，`rows={3}`）
  - 第 4 行：备注（占 2 列，`rows={2}`）
- Label 改为更紧凑的 `text-sm` + `mb-1` 间距
- 保存按钮保持在 Footer

视觉上对话框由原来约 700px 高压缩到约 480px。

---

## 二、新增通用可搜索下拉组件

新建 `src/components/ui/searchable-select.tsx`：
- 基于已存在的 `Popover` + `Command`（cmdk）封装，外观贴近 `Select`
- API 与 `Select` 兼容，便于直接替换：
  ```ts
  type Option = { value: string; label: string; description?: string };
  interface Props {
    value?: string;
    onChange: (v: string) => void;
    options: Option[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    disabled?: boolean;
    allowClear?: boolean;
    className?: string;
  }
  ```
- 触发器样式复用 `Select` 的 trigger class，保证全站观感一致
- 使用 `CommandInput` 实时过滤（label + description）
- 列表超过约 8 项时自动启用滚动；少于则正常展示

---

## 三、接入"关联规则"搜索（核心需求）

在 `src/pages/admin/Cases.tsx` 中将 Select 替换为 `SearchableSelect`：
```tsx
<SearchableSelect
  value={form.rule_id}
  onChange={(v) => setForm({ ...form, rule_id: v })}
  options={[
    { value: "none", label: "未关联" },
    ...rules.map(r => ({ value: r.id, label: r.name }))
  ]}
  placeholder="选择规则"
  searchPlaceholder="搜索规则名称…"
  emptyText="无匹配规则"
/>
```

---

## 四、同步替换系统内其他"长列表 + 来自数据库"下拉

仅替换数据驱动、可能很长的下拉，固定枚举（合格/不合格、布局类型等）保持原 Select。

涉及文件：
| 文件 | 字段 | 选项来源 |
|---|---|---|
| `src/pages/super/Admins.tsx` | 所属学院 | colleges |
| `src/pages/admin/SubmissionWindows.tsx` | 所属学院 | colleges |
| `src/components/SingleUserDialog.tsx` | 所属学院 | colleges |
| `src/components/AigcStatsPanel.tsx` | 学院筛选 | colleges |
| `src/pages/admin/AiModels.tsx` | Provider / 模型名 | providers / models |
| `src/pages/admin/AuditLogs.tsx` | 操作类型 | actions 列表 |

筛选类下拉（专业/班级）多为短列表，本轮暂不动；待后续观察用户反馈。

---

## 技术细节

- `SearchableSelect` 内部使用项目已有的 `cmdk`（来自 `@/components/ui/command`）和 `Popover`，无需新增依赖
- 触发器使用 `<button>` + `ChevronsUpDown` 图标，与 shadcn Combobox 模式一致
- 选中值在 `options` 找到对应 label 后回显；找不到时显示 `placeholder`
- `allowClear` 在 trigger 右侧显示 `X`，点击后 `onChange("")`（仅当 `allowClear` 为 true）
- a11y：`role="combobox"`、`aria-expanded`，键盘上下/回车选择由 cmdk 提供

---

## 不在本次范围
- 不改动 `DatePicker` / `YmdPicker`
- 不改动 `Apply.tsx` 的关键词选择（已是搜索式交互）
- 不改业务逻辑、Schema、数据库