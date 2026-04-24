

# 计划：清理整个数据库中所有"时间/届次"标识

## 目标
扫描数据库中所有可能包含"年份/届次/期/次"标识的文本字段，统一删除时间相关前缀，**保留项目/比赛名称本身**。

## 影响范围（涉及表与字段）

| 表 | 待清理字段 |
|---|---|
| `cases` | `title`, `summary`, `notes` |
| `rules` | `name`, `description`, `project`, `achievement` |
| `certificate_types` | `name`, `description` |
| `rule_library` | `content` |
| `keywords` | `keyword` |

不涉及：用户数据 (`profiles`)、申请记录 (`applications` / `submission_records`)、审核记录、审计日志——这些是真实业务数据快照，不应被改写。

## 清理规则（统一应用到上述所有字段）

按顺序使用 `regexp_replace`：

1. **届/期/次**：`第[一二三四五六七八九十百零0-9]+(届|期|次)` → 删除
2. **公元年份**：`(19|20)\d{2}年?` → 删除
3. **学年表达**：`\d{4}[-—]\d{2,4}(学年|年度)?` → 删除（如 `2022-2023学年`）
4. **收尾清理**：
   - 连续空格 → 单空格
   - 中文括号开头残留的 `（·` → `（`
   - 字段开头残留的空格、`年`、`·`、`-` 等

## 示例效果

- `2022年第八届"互联网+"大学生创新创业大赛（国家级一等奖·负责人）`
  → `"互联网+"大学生创新创业大赛（国家级一等奖·负责人）`
- `第十二届全国大学生数学建模竞赛` → `全国大学生数学建模竞赛`
- `2023-2024学年优秀学生干部` → `优秀学生干部`

## 执行方式

通过"修改数据库"工具执行**一个事务**，对上面 5 张表的目标字段统一跑同一套 `regexp_replace` 链：

```sql
BEGIN;

-- cases
UPDATE public.cases SET
  title   = clean_fn(title),
  summary = clean_fn(summary),
  notes   = clean_fn(notes)
WHERE title ~ '<pattern>' OR summary ~ '<pattern>' OR notes ~ '<pattern>';

-- rules
UPDATE public.rules SET
  name = clean_fn(name), description = clean_fn(description),
  project = clean_fn(project), achievement = clean_fn(achievement)
WHERE …;

-- certificate_types
UPDATE public.certificate_types SET
  name = clean_fn(name), description = clean_fn(description)
WHERE …;

-- rule_library
UPDATE public.rule_library SET content = clean_fn(content) WHERE …;

-- keywords
UPDATE public.keywords SET keyword = clean_fn(keyword) WHERE …;

COMMIT;
```

`clean_fn` 在 SQL 中以三层嵌套 `regexp_replace` 直接展开，不新增数据库函数。

## 安全性

- **只改 5 张"配置/知识库"性质的表**，不动任何申请/审核/用户/日志数据。
- 操作前先对每张表 `SELECT count(*)` 预估行数告知用户。
- 不可逆。建议同时建立一次性备份（推荐）：每张目标表先 `CREATE TABLE <name>_backup_YYYYMMDD AS SELECT * FROM <name>;`，便于回滚。
- `keywords` 字段较短，清理后若变成空字符串将自动跳过该行（在 `WHERE` 中加 `length(trim(...)) > 0` 保护）。
- `certificate_types.name` 是唯一索引 `(name, category, level)` 的一部分；若清理后产生重名将报错。届时会改为：先合并同名行的 `occurrence_count`，再删除冗余、再清理。

## 用户需要确认

请批准以下两件事：
1. 是否需要建立 `*_backup_<日期>` 备份表（推荐"是"）。
2. 对上述 5 张表的指定字段执行统一清理（默认本次执行）。

如只想清理其中部分表（例如只清理 `cases` 和 `rules`），请告知。默认按上述 5 张表全量执行。

