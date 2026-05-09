## 三个问题的根因与修复

### 1. 学院界面风格 — 配色改为色盘（拾色器）
`src/pages/admin/Branding.tsx` 现在让用户手填 `222 76% 38%` 这类 HSL 字符串，体验差。改为可视化拾色器 + 预设色卡。

- 主色/辅色/背景色：每项渲染一个 `<input type="color">` + 6–8 个常用预设色块（蓝、青、靛、绿、红、橙、灰、品红）+ 当前色 HEX 文本回显。
- 选色后内部转换为 `H S% L%` 字符串写入 `theme.primary/accent/background`，与现有应用主题逻辑（`hsl(var(--primary))`）保持兼容。
- 圆角、布局变体保留为下拉（已是可选项形式）。
- 新增工具函数 `src/lib/colorConvert.ts`：`hexToHslTokens(hex)` 与 `hslTokensToHex(tokens)`，用于双向转换。

### 2. 提交时间窗口 — 操作按钮显式化
现状：`PageHeader.actions` 已有「新建批次」按钮，但学院管理员视角下不够显眼，列表为空时也没有 CTA。

- 在「批次列表」卡片 `CardHeader` 右侧再放一个「新建批次」按钮，与表头同行，常驻可见。
- 空状态行替换为带主按钮的 empty state：「暂无批次 · 新建第一个批次」。
- 保留行内的编辑/生成报告/下载/删除图标按钮不变。

### 3. 学生管理看不到学生 — 数据回填 + 导入容错

**根因**：数据库里 294 条 `profiles` 的 `department='国际经济贸易学院'`，而 `colleges.name='国际经济与贸易学院'`（多一个"与"字），导入时未匹配到学院，`college_id` 留空；profiles 的 RLS 要求 `college_id` 与当前管理员一致才可见，于是学院管理员看到「共 0 人」。还有 2 条 `department='信息工程学院'` 系统未创建对应学院。

**修复**：
- **新建一次性数据迁移**：用归一化函数对比 `department` 与 `colleges.name`（去除字符 `与/&/空白/院`，转小写后比较），批量回填：
  - `UPDATE profiles SET college_id = ... WHERE college_id IS NULL AND normalize(department)=normalize(colleges.name)`
  - 同步 `UPDATE user_roles SET college_id=profiles.college_id` 对仍为空的角色记录。
  - 已知会命中：294 条「国际经济贸易学院」→「国际经济与贸易学院」。「信息工程学院」无对应学院，保持 NULL，事后由 super_admin 创建该学院后可再跑同样规则（在迁移中写成幂等可重复执行）。
- **导入 Edge Function 容错** `supabase/functions/import-users/index.ts`：
  - 抽出 `normalizeCollegeName()`：去除 `与、和、&、空白、（…）`。
  - super_admin 导入：`collegeByName` 同时索引归一化键，匹配时优先精确，再 fallback 归一化。
  - 学院管理员导入：仍使用 callerCollegeId，无需变化。
- **不动 RLS**（当前 RLS 设计正确，问题在数据本身）。

## 验证
- Branding：选色后预览主色变化，刷新仍生效；HSL token 形式正确。
- SubmissionWindows：学院管理员看到顶部 + 卡内双处「新建批次」按钮，空态有主按钮 CTA。
- UsersManage：国际经济与贸易学院管理员登录后「学生管理」共显示 294 人，可分页。