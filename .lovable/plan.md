## 排查结论

这次失败不是因为“之前已经上传过一个院徽所以不能覆盖”。

原因是前端每次上传都会生成新的文件名，例如：

```text
college-badges/{collegeId}/badge-{timestamp}.jpg
```

所以它并没有覆盖旧文件，而是在同一学院目录下新增一个文件。当前浏览器网络记录显示真正失败的是新增对象：

```text
POST /storage/v1/object/college-badges/d66aa1e4-.../badge-1778480228556.jpg
400 / 403
new row violates row-level security policy
```

我查到当前数据库里这个用户确实是该学院的 `admin`，目标路径的学院 ID 也匹配，因此问题更像是 Storage 写入策略在 Supabase Storage 执行上下文里仍然没有稳定通过，而不是文件已存在导致的冲突。

## 实施方案

1. **修正 Storage RLS 策略**
   - 改写 `college-badges` 的上传、更新、删除策略。
   - 不再依赖之前的 `can_manage_college_badge_object()` 函数作为策略判断入口。
   - 直接在策略里校验：
     - 当前登录用户是 `super_admin`；或
     - 当前登录用户是 `admin`，并且上传路径第一段等于该管理员绑定的 `college_id`。
   - 保留公开读取院徽图片的能力。

2. **增加“删除旧院徽”功能**
   - 在品牌设置页当前院徽旁增加删除按钮。
   - 删除时：
     - 从 `college-badges` bucket 删除当前 `badge_url` 对应文件；
     - 清空 `colleges.badge_url`；
     - 保留学院主题配置，不强制重置配色。
   - 增加确认弹窗，避免误删。

3. **优化“重新上传院徽”流程**
   - 上传新院徽成功并更新 `badge_url` 后，尝试删除旧院徽文件，避免 bucket 中堆积历史院徽。
   - 即使旧文件删除失败，也不阻断新院徽生效，只提示上传结果。
   - 清空文件 input 的值，避免选择同一个文件时浏览器不触发 `change`。

4. **验证**
   - 用数据库查询确认新的 Storage 策略已生效。
   - 检查页面逻辑：上传、删除、重新上传三条路径都调用正确的 bucket 路径和学院更新逻辑。

## 需要改动的文件

- 新增 Supabase migration：修复 `college-badges` Storage 写入/删除策略。
- 修改 `src/pages/admin/Branding.tsx`：加入删除旧院徽和重新上传后的旧文件清理逻辑。