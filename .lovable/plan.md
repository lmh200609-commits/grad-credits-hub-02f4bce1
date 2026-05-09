## 操作

仅清理一条历史脏数据，不改导入模板，不改校验逻辑。

目标用户（已在数据库定位）：
- `user_id = a20f72a1-0b91-4f14-9da2-ba9288dddffb`
- student_no=`学号`、full_name=`姓名`、department=`学院`

## 删除步骤（一次性迁移）

```sql
DELETE FROM public.user_roles  WHERE user_id = 'a20f72a1-0b91-4f14-9da2-ba9288dddffb';
DELETE FROM public.profiles    WHERE user_id = 'a20f72a1-0b91-4f14-9da2-ba9288dddffb';
DELETE FROM auth.users         WHERE id      = 'a20f72a1-0b91-4f14-9da2-ba9288dddffb';
```

## 不改动

- 导入模板 / 解析逻辑 / 边端校验
- 其它任何用户、表结构、RLS

## 验证

刷新「学分排名」 → 总数从 295 → 294，#3 行（"姓名 / 学号 / 学院"）消失。