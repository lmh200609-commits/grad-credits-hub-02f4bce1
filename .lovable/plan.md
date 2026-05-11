## 学院归属强校验（澄清后的最终方案）

你说的"国际经济与贸易学院的管理员只能导入本学院的学生/教师，不能导入其他学院" —— 这点在批量导入和单条新增两条路径上都要保证。

### 当前状态

`supabase/functions/import-users/index.ts` 已经做了**后端硬约束**：

```ts
if (isSuperAdmin) {
  // 超管必须在每行填"学院"列，否则报错
} else {
  collegeIdByRow[i] = callerCollegeId;  // 强制 = 调用者所在学院
}
```

也就是说：非 super_admin 调用者，**无论行里写什么 `college_name`，都会被忽略，强制写入 `callerCollegeId`**。所以国际经济与贸易学院的管理员物理上不可能把账号建到其他学院。✅ 这条已经成立。

但是当前流程对学院管理员有两个体验问题：

1. **批量导入时**，如果模板里某行误填了"经济学院"或"信息工程学院"，系统**默默把它改写成本学院**，管理员不会察觉跨学院的笔误。
2. **新增的单条导入对话框**也需要把这条约束做成"用户能看见的提示"，而不只是后端默默改写。

### 改动

**A. 学院管理员批量导入时增加前端校验提示**

`src/pages/admin/ImportUsers.tsx`：上传 Excel 解析完成后、调用 Edge Function 前，做一道前端检查：

- 如果调用者是学院管理员（非 super_admin），且某些行的 `college_name` 既不为空、又不等于本学院名（按 `normalizeCollege` 比较），**弹出红色错误清单**列出"第 X 行：填写的学院「经济学院」与你管理的学院「国际经济与贸易学院」不一致"，并阻止提交，要求修正模板后重传。
- `college_name` 留空的行视为"默认本学院"，正常通过。

这样既防止误导入，也让管理员明确知道"我只能管自己学院"。

**B. 后端再加一道防线**

`supabase/functions/import-users/index.ts`：在非 super_admin 分支里，把上面的检查也搬到后端（防止前端被绕过）：

```ts
} else {
  const cname = r.college_name?.trim();
  if (cname) {
    const cid = collegeByName.get(cname) ?? collegeByNormalized.get(normalizeCollege(cname));
    if (cid && cid !== callerCollegeId) {
      errors.push({ line, message: `第 ${line} 行学院「${cname}」不属于你管理的学院，无法跨学院导入` });
    }
  }
  collegeIdByRow[i] = callerCollegeId;
}
```

> 注意：collegeByName 现在只在 super_admin 分支构建，要把它移到外面对所有调用者都构建。

**C. 单条新增对话框（`SingleUserDialog.tsx`）**

- 学院管理员：顶部显示只读"归属学院：国际经济与贸易学院（不可修改，跨学院请联系超级管理员）"。表单**没有**学院选择字段。
- 超级管理员：显示学院下拉（必选，列出 `colleges` active 项）。

提交时调用 `import-users`，由它的后端校验兜底。

### 其它仍按上一版计划执行

- **问题 1**：`parseRoster.ts` 的 `pickFirst` 修复"工号"识别为空的 bug。
- **问题 2**：`ImportUsers.tsx` 横幅常驻显示。
- **问题 3**：新建迁移加 `audit_logs` RLS：`USING (actor_id = auth.uid())`，让操作者看到自己的记录。
- **学生补全空字段**：扩展 `MyProfile.tsx` 可编辑字段（手机号、班级、专业、院系、年级、辅导员、性别、民族、政治面貌、出生日期、公寓号、宿舍号、床号、紧急联系人/电话、地址）；学号、学院、邮箱只读；顶部加"信息缺失提示"横幅。
- **单条新增必填**：学生侧学号、姓名、手机号、辅导员、班级、院系、出生日期、性别全部必填；教师侧工号、姓名、手机号必填。

### 文件清单

| 文件 | 改动 |
|---|---|
| `src/lib/parseRoster.ts` | `pickFirst` 修复学号识别 |
| `src/pages/admin/ImportUsers.tsx` | 横幅常驻 + 学院管理员前端拦截跨学院行 |
| `supabase/functions/import-users/index.ts` | 非超管也校验 `college_name` 是否本学院（不一致即报错） |
| `supabase/migrations/<新>.sql` | `audit_logs` 自查策略 |
| `src/components/SingleUserDialog.tsx`（新建） | 单条新增对话框，必填项严格校验 |
| `src/pages/admin/UsersManage.tsx` | "+ 新建学生账号"/"+ 新建教师账号" 按钮 |
| `src/pages/student/MyProfile.tsx` | 扩展可编辑字段 + 缺失提示 |