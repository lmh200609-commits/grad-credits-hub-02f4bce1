## 回答 + 历史数据清理

### Q：学生修改密码后能用新密码登录吗？

**能。** 调用的是 `supabase.auth.updateUser({ password })`，它直接更新 Supabase Auth 中该账户的密码。下次退出后用新密码即可登录；当前会话保持有效。无需额外配置。

> 备注：未要求输入旧密码（按当前 session 信任）。如以后想加旧密码二次校验，可补 `signInWithPassword` 验证，本次不动。

---

### 修复历史已产生的重复复核记录

**目标**：清理 `application_reviews` 中同一申请下，由同一复核人、同一动作、同一结果（含学分）连击产生的重复行，每组只保留最早一条。

**策略**（一次性 SQL 清理）：

```sql
-- 删除重复的复核记录：同 application_id + reviewer_id + action + decision
-- + COALESCE(credit, -1) + COALESCE(note,'') 完全相同的，保留 created_at 最早一条
DELETE FROM public.application_reviews a
USING public.application_reviews b
WHERE a.application_id = b.application_id
  AND a.reviewer_id    = b.reviewer_id
  AND a.action         = b.action
  AND a.decision       = b.decision
  AND COALESCE(a.credit, -1) = COALESCE(b.credit, -1)
  AND COALESCE(a.note, '')   = COALESCE(b.note, '')
  AND a.created_at > b.created_at;
```

执行方式：使用 `supabase--migration` 工具（DELETE 影响数据但同时新增防重复唯一索引，需迁移）。同时**新增防御性唯一索引**，从根上杜绝再次出现：

```sql
-- 复核动作的天然幂等键：同申请 + 同人 + 同动作 + 同结果（决定+学分+备注）只允许一条
CREATE UNIQUE INDEX IF NOT EXISTS uniq_review_dedup
ON public.application_reviews (
  application_id, reviewer_id, action, decision,
  COALESCE(credit, -1),
  COALESCE(note, '')
);
```

> 注：若以后教师真的需要"先通过 5 分、改判通过 6 分"，credit 不同 → 仍能写入，不会被拦。完全相同的连击才会被数据库直接拒绝（前端的 30 秒幂等门是第一道，索引是第二道兜底）。

### 涉及变更

- 1 条 migration：`DELETE` 历史重复 + `CREATE UNIQUE INDEX` 防御。
- 无前端代码改动（前端守卫上一轮已加）。

### 风险

- 唯一索引若与未来业务冲突（极少见），可后续 `DROP INDEX` 即可，不影响数据。
- DELETE 操作不可逆，但只删完全冗余的副本，保留每组最早一条，不影响最终学分（学分以 `applications.final_credit` 为准）。
