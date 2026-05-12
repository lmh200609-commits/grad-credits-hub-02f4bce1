## 问题定位

用户问「现在有几个学院管理员，几个学院，多少个学生？」助手回答：学生 295、**学院 0、学院管理员 0**。

通过 `supabase--read_query` 实测数据库：
- 学院数（active）：**2**
- 学院管理员（user_roles.role='admin'）：**2**
- 学生：295（这条对的）

根因：`staff-ai-assistant` 的 `query_stats` 工具的 metric 枚举里**根本没有**「学院总数 / 学院管理员数 / 教师数」对应的指标，只有 `total_students` 这一个用户类计数。模型按系统提示「指标不存在就回答 0 / 暂不支持」的兜底逻辑，强行用 0 作答，导致虚构数据。

另外 system prompt 里也没有任何允许「全校学院 / 学院管理员」类问题的说明，模型不知道应该用什么工具。

## 修复方案（仅改 `supabase/functions/staff-ai-assistant/index.ts`）

### 1. 在 `query_stats` 工具里新增 4 个 metric

| metric | 含义 | 实现 |
|---|---|---|
| `colleges_overview` | 学院总数 + active/停用拆分 + 学院列表（名称、简称、是否停用） | `colleges` 表 select 全量 |
| `college_admins_count` | 学院管理员人数 + 按学院分布（学院名 → 管理员姓名/邮箱） | `user_roles where role='admin'` join `profiles` & `colleges` |
| `teachers_count` | 教师人数 + 按学院分布 | `user_roles where role='teacher'` 同上 |
| `super_admins_count` | 超级管理员人数 | `user_roles where role='super_admin'` |

学院/全校角色统计**不**按调用者学院过滤——这些是全局元数据，超管/管理员/教师都可以看条数（管理员/教师只能看到全校 colleges 的数量与各学院 admin/teacher 计数；不暴露不属于自己学院的具体姓名手机邮箱即可，但姓名+学院是公开信息，可以列出）。

### 2. 同步更新 system prompt

在 `query_stats` 的 metric 列表中加入 4 行说明，并在「行为约束」第 6 条把「学院数 / 学院管理员数 / 教师数 / 超级管理员数」明确加进必须调工具的清单。

### 3. 仍保留 `dataToolUsed → 跳过 polish-answer`，避免数字被二次模型改写。

## 验证

部署后重新提问：
- 「现在有几个学院管理员，几个学院，多少个学生？」 → 学院 2，学院管理员 2，学生 295
- 「全校有几位教师 / 几位超级管理员？」 → 与数据库一致

## 涉及文件

- `supabase/functions/staff-ai-assistant/index.ts`
