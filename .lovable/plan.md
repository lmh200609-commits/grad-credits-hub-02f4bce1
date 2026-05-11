# 修复：上传院徽 RLS 拒绝（new row violates row-level security policy）

## 根因
`storage.objects` 上 `college-badges` 桶的 3 条策略（INSERT/UPDATE/DELETE）使用了 `public.current_user_college_id()` 和 `public.has_role()` 这两个 SECURITY DEFINER 函数。Postgres 数据校验显示：

- `authenticator` / `supabase_storage_admin` 角色对这两个函数 **没有 EXECUTE 权限**
- 因此 storage 在评估 RLS 时函数调用直接失败，`WITH CHECK` 判为 false，返回 403

而 `application-files` 桶的策略只用 `auth.uid()`，所以学生上传 PDF 不受影响。

## 修改（一次 SQL 迁移）

重写 `college-badges` 桶的 3 条策略，**不再调用 SECURITY DEFINER 函数**，改为内联子查询直接读 `user_roles`：

- DROP 现有 3 条策略：`college-badges admin write` / `... admin update` / `... admin delete`
- 新建 INSERT 策略：
  ```sql
  CREATE POLICY "college-badges admin write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'college-badges'
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (
          ur.role = 'super_admin'
          OR (ur.role = 'admin'
              AND ur.college_id IS NOT NULL
              AND ur.college_id::text = (storage.foldername(name))[1])
        )
    )
  );
  ```
- UPDATE 与 DELETE 用相同的内联表达式分别作为 USING / WITH CHECK。
- 桶仍保持 `public: true`，下载走公开 URL，无需新增 SELECT 策略。

## 不改动
- `application-files` 桶的策略；
- `current_user_college_id` / `has_role` 函数本身（其它表的 RLS 仍正常使用）；
- 前端代码（上一轮已恢复"上传即应用"逻辑，无需再改）。

## 验收
- 国际经济与贸易学院管理员重新上传院徽 → 不再弹出 RLS 报错 → 自动提取主色并刷新 UI 主题。
