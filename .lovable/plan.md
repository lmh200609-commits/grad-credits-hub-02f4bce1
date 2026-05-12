## 目标

1. **图片去重（全平台）**：同一张图片一旦在 `applications` 中存在，任何学生都不能再次提交。
2. **关键词集合去重（按学生）**：当前学生的「已通过」申请如果已经存在「完全相同的关键词集合」，则不允许再次提交；被驳回的申请不影响后续提交。

---

## 一、数据库改动（migration）

### 1.1 `applications` 表新增列
- `file_hash text`：图片内容的 SHA-256 十六进制串。
- `keywords_fingerprint text`：`selected_keywords ∪ custom_keywords` 经规范化、排序、去重后拼接的稳定指纹。

两个字段都允许为空（兼容历史数据；新申请由前端填入）。

### 1.2 索引
- `CREATE INDEX idx_applications_file_hash ON public.applications (file_hash) WHERE file_hash IS NOT NULL;`
- `CREATE INDEX idx_applications_student_kwfp ON public.applications (student_id, keywords_fingerprint) WHERE keywords_fingerprint IS NOT NULL;`

不使用 UNIQUE 约束，理由：
- 图片：跨学生场景需要给出明确中文报错，trigger 比 unique 体验更好。
- 关键词：仅当目标行 status ∈ approved/auto_approved 时才视为冲突，UNIQUE 表达不出条件。

### 1.3 校验触发器 `applications_dedupe_guard`（BEFORE INSERT）
逻辑（仅对学生本人插入生效；teacher/admin/super_admin/服务端绕过）：

```text
若 NEW.file_hash 非空：
  存在 applications.file_hash = NEW.file_hash 且 id <> NEW.id 的任意一行
    → RAISE '该图片已被提交过，请勿重复使用'

若 NEW.keywords_fingerprint 非空：
  存在 student_id = NEW.student_id
       AND keywords_fingerprint = NEW.keywords_fingerprint
       AND status IN ('approved','auto_approved')
    → RAISE '该关键词组合你已审核通过，无需重复提交'
```

### 1.4 防绕过：`applications_student_update_guard` 增补
学生本人 UPDATE 时，强制保留 `file_hash` 与 `keywords_fingerprint`，避免提交后改写指纹绕过去重。

---

## 二、前端改动

### 2.1 新增工具 `src/lib/fileHash.ts`
```ts
export async function sha256Hex(file: Blob): Promise<string>
// 使用 crypto.subtle.digest('SHA-256', await file.arrayBuffer())
```

### 2.2 新增工具 `src/lib/keywordFingerprint.ts`
```ts
export function buildKeywordsFingerprint(
  selected: string[],
  custom: string[],
): string
// 1) 合并 → normalizeKeyword（复用 src/lib/keywords.ts 的 NFKC/全半角/小写）
// 2) 过滤空串、去重
// 3) sort()
// 4) join('|')
```

### 2.3 `src/pages/student/Apply.tsx` 提交流程改造
在 `submit()` 内、`upload` 之前：
1. `const fileHash = await sha256Hex(file)`
2. `const fingerprint = buildKeywordsFingerprint(selected_keywords, customKeywords)`
3. **预检 1**（明确文案，不消耗存储配额）：
   ```ts
   const { data: dupImg } = await supabase
     .from('applications')
     .select('id', { head: true, count: 'exact' })
     .eq('file_hash', fileHash)
     .limit(1);
   if (count > 0) → toast 「该图片已被提交过…」并 return
   ```
4. **预检 2**：
   ```ts
   const { count } = await supabase
     .from('applications')
     .select('id', { head: true, count: 'exact' })
     .eq('student_id', user.id)
     .eq('keywords_fingerprint', fingerprint)
     .in('status', ['approved','auto_approved'])
     .limit(1);
   if (count > 0) → toast 「该关键词组合你已审核通过…」并 return
   ```
5. 通过后再上传图片、insert，并把 `file_hash`、`keywords_fingerprint` 一起写入。
6. insert 失败时，若错误信息包含上述两条 trigger 文案，原样 toast，并执行 `storage.remove([filePath])` 回滚已上传的图片。

预检 + trigger 双保险：trigger 防绕过，预检给出即时友好提示并避免无谓上传。

---

## 三、历史数据回填（一次性 SQL，写在同一 migration 里）

```sql
-- keywords_fingerprint 可直接由 SQL 回填
UPDATE public.applications
SET keywords_fingerprint = (
  SELECT string_agg(k, '|' ORDER BY k)
  FROM (
    SELECT DISTINCT lower(btrim(regexp_replace(unnest, '\s+', ' ', 'g'))) AS k
    FROM unnest(selected_keywords || custom_keywords)
    WHERE coalesce(btrim(unnest), '') <> ''
  ) t
)
WHERE keywords_fingerprint IS NULL;
```

`file_hash` 无法在 SQL 里计算（图片在 Storage），不回填；老数据视为「未登记」，不参与去重判断（trigger 仅在 NEW.file_hash 非空时检查）。这样不会误伤历史申请。

---

## 四、不在本次范围

- 不改变任何审核流程、AI 评估、AIGC 检测、人脸比对逻辑。
- 不调整关键词维度选择 UI、对话框布局等视觉。
- 不为老申请的图片做 Storage 回扫与回填（成本高、价值低）；仅新提交开始受图片去重保护。

---

## 五、技术细节速查

| 文件 | 类型 | 说明 |
|---|---|---|
| `supabase/migrations/<ts>_add_dedupe.sql` | 新建 | 加列、加索引、加 trigger、回填 |
| `src/lib/fileHash.ts` | 新建 | SHA-256（Web Crypto） |
| `src/lib/keywordFingerprint.ts` | 新建 | 复用 `normalizeKeyword` |
| `src/pages/student/Apply.tsx` | 修改 | 预检 + 写入新字段 + 失败回滚上传 |
| `src/hooks/useAuth.tsx` 等 | 不动 | — |

报错文案集中在 trigger 的 `RAISE EXCEPTION` 里，前端做兜底拦截。