## 目标

把 **案例库 / 规则库 / 关键词库** 从「全局共享」改为「按学院隔离」，并在三个列表页加上搜索筛选。国贸学院（国际经济与贸易学院）作为模板：

- 现有 141 条 rules / 191 条 cases / 223 条 keywords，**全部归属国贸学院**
- 立即给其他 4 个已存在学院（经济、信息工程、法学、人工智能）**各复制一份独立副本**
- 之后任何**新建学院**会自动从国贸学院当前数据**克隆一份**
- 学院 admin 的增删改/启停**只影响本学院**；教师、学生端只看到本学院数据
- 超管可在三个页面顶部**切换学院**查看与管理任意学院数据

certificate_types 本轮**不动**（用户已确认）。

---

## 一、数据库改动（migration）

### 1. 三张表加 college_id

```text
rules.college_id    uuid  NOT NULL  →  references colleges(id) on delete cascade
cases.college_id    uuid  NOT NULL  →  同上
keywords.college_id uuid  NOT NULL  →  同上

索引：(college_id) + (college_id, active)
keywords 唯一约束从 (keyword) 改为 (college_id, keyword)
keywords_normalize_and_merge 触发器内的撞名检查改为 (college_id, keyword) 维度
```

### 2. 历史数据迁移（一次性 SQL）

```text
Step A：把现有 rules/cases/keywords 全部置为国贸学院
        UPDATE ... SET college_id = 'd66aa1e4-1872-44d2-a4e9-d638aa041cc2'

Step B：把国贸的数据原样 INSERT 复制给另外 4 个学院
        对 rules / cases / keywords 各跑一段 INSERT … SELECT
        cases.rule_id 通过临时映射表重新指向各学院克隆出的 rule.id
```

### 3. 新学院自动获得模板数据

新增触发器 `colleges_seed_from_template` AFTER INSERT，自动从国贸学院（硬编码 id 常量，封装在 SECURITY DEFINER 函数 `clone_college_libraries(_src uuid, _dst uuid)` 内）复制 rules → cases → keywords。

### 4. RLS 策略改写

| 表 | 读 | 写 |
|---|---|---|
| rules / cases / keywords | 认证用户可读**本学院** + 超管可读全部 | 学院 admin 仅本学院；超管全部 |

具体策略：
```text
"... read scoped":   college_id = current_user_college_id() OR is_super_admin(...)
"... admin manage":  has_role(admin) AND college_id = current_user_college_id()
"... super_admin all": is_super_admin(...)
```

### 5. 队列/评估端兼容

`enqueue_ai_eval` / `process-eval-queue` 在拼接候选 rules、cases、keywords 时，需按 `application.college_id` 过滤。会在边缘函数里改 select 增加 `.eq('college_id', app.college_id)`。

---

## 二、前端改动

### 通用：学院选择器

新建组件 `<CollegeScopeSelect />`：
- 学院 admin：只读，显示自己学院名（不展示选择器，或 disable）
- 超管：下拉切换；选中值通过自定义 hook `useScopedCollegeId()` 缓存到 sessionStorage

三个列表页（`pages/admin/Rules.tsx`、`Cases.tsx`、`Keywords.tsx`）：
- 顶部加 `<CollegeScopeSelect />`（仅超管可见）
- 所有 `supabase.from('rules' | 'cases' | 'keywords')` 查询追加 `.eq('college_id', scopedCollegeId)`
- 新增/编辑时 payload 注入 `college_id: scopedCollegeId`

### 搜索 / 筛选

| 页面 | 已有 | 新增 |
|---|---|---|
| Cases | 标题/摘要关键字搜索 ✅ | 按「关联规则」筛选（SearchableSelect，多选关闭）、按学分区间筛选 |
| Rules | （需查现状）补全 | 关键字搜索（name/description/keywords）、按 category、identity、level 筛选、active 状态筛选 |
| Keywords | （需查现状）补全 | 关键字模糊搜索、category 筛选、active 状态筛选 |

筛选交互：顶部一行 `Input` + 2~3 个 `SearchableSelect`，右侧"重置"按钮；筛选结果实时反映到表格 + 分页。

### 学生/教师/AI 评估端

- `pages/student/Apply.tsx`：拉 rules/keywords 时按 `profile.college_id` 过滤
- 教师端 ReviewHub、StudentDetail 同理
- 已有 `ai-router` / `evaluate-application` edge function：在 SQL 里追加 college_id 过滤

---

## 三、技术注意点（供工程参考）

- `keywords_normalize_and_merge` 触发器需要同时按 `college_id` 判重，否则不同学院相同关键词会被合并
- cases 复制时要先复制 rules 并保留 old→new id 映射，再用映射重写 cases.rule_id
- `refresh_certificate_types` 目前跨全表聚合，本轮不动；后续如需按学院隔离再单独处理
- 国贸学院 id 在 clone 函数里以常量存储；如未来要换模板源，仅改函数体一处
- RLS 调整后，要确认 `process-eval-queue` 边缘函数依然用 service role 调用（已是）

---

## 四、交付顺序

1. migration：加列 + 数据回填 + 复制到其他 4 学院 + RLS + clone 函数 + 触发器
2. 三个 admin 列表页：加 college 选择器、筛选、写入时注入 college_id
3. 学生 / 教师端取数加 college 过滤
4. 边缘函数（ai-router、evaluate-application、ai-eval-stress-test 等）取 rules/cases/keywords 处追加 college 过滤
5. 手动验证：A 学院 admin 删一条 → B 学院无影响；新建学院 → 自动出现完整模板
