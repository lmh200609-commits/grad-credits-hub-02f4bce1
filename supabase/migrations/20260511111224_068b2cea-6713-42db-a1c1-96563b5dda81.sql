-- 删除历史上由连击产生的完全冗余复核记录，每组保留最早一条
DELETE FROM public.application_reviews a
USING public.application_reviews b
WHERE a.application_id = b.application_id
  AND a.reviewer_id IS NOT DISTINCT FROM b.reviewer_id
  AND a.action = b.action
  AND a.decision = b.decision
  AND COALESCE(a.credit, -1) = COALESCE(b.credit, -1)
  AND COALESCE(a.note, '') = COALESCE(b.note, '')
  AND (a.created_at > b.created_at
       OR (a.created_at = b.created_at AND a.id > b.id));

-- 防御性唯一索引：同申请 + 同人 + 同动作 + 同结果（决定/学分/备注）只允许一条
CREATE UNIQUE INDEX IF NOT EXISTS uniq_review_dedup
ON public.application_reviews (
  application_id,
  reviewer_id,
  action,
  decision,
  (COALESCE(credit, -1)),
  (COALESCE(note, ''))
);