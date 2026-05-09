## 目标
将"学院界面风格"和"实时一致性检查"两个页面中出现的英文/代码字样全部改为简体中文展示。

## 一、学院界面风格 (`src/pages/admin/Branding.tsx`)

颜色拾色器右侧的输入框当前显示形如 `#db2979` 的十六进制色值，用户认为是"乱码"。改动：

- 移除每个颜色字段右侧的 hex 文本 `Input`，仅保留：
  - 左侧色块拾色器（`<input type="color">`）
  - 下方 12 个预设色板
- 颜色色块下方新增一个中文标签描述当前颜色（例如"当前：玫红"或直接不显示色值），保持纯中文界面。
- 圆角大小输入框的 placeholder `0.5rem` 改为中文提示"如 0.5 倍字号"，并将该字段的标签下方加注"留空使用默认"。

## 二、实时一致性检查 (`src/pages/RealtimeDiagnostics.tsx`)

页面中夹杂大量英文（表名、事件类型、`user_roles` 等），全部改为简体中文：

1. **表标签 `SPECS[].label`**：去掉英文部分
   - `申请 applications` → `申请`
   - `审核明细 reviews` → `审核明细`
   - `提交记录 records` → `提交记录`
   - `用户档案 profiles` → `用户档案`
   - `用户角色 user_roles` → `用户角色`

2. **事件类型徽章**：当前显示 `INSERT/UPDATE/DELETE/RECONNECT/POLL` 等英文。新增映射：
   - `INSERT` → `新增`
   - `UPDATE` → `更新`
   - `DELETE` → `删除`
   - `RECONNECT` → `重连`
   - `POLL` → `轮询`
   - 其他 → `事件`

3. **使用说明区域**中的代码字样 `<code>user_roles</code>` 改为"用户角色表"。

4. **角色徽章**："当前角色：student" 等英文角色名，映射为：
   - `super_admin` → `超级管理员`
   - `college_admin` / `admin` → `学院管理员`
   - `teacher` → `教师`
   - `student` → `学生`
   - `guest` → `访客`

## 范围
- 仅前端展示文案改动，不动业务逻辑、表名、数据库字段。
- 不改动其它页面。
