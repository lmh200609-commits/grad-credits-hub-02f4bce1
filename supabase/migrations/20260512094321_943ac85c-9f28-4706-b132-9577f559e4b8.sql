-- 回填历史审核理由：把英文枚举与旧"上调/下调"措辞替换为新中文文案
UPDATE public.application_reviews
SET note = regexp_replace(
  regexp_replace(
    regexp_replace(note, '「review」',  '「需人工复核」', 'g'),
    '「approve」', '「通过」',     'g'),
  '「reject」',  '「驳回」',     'g')
WHERE note ~ '「(review|approve|reject)」';

UPDATE public.application_reviews
SET note = regexp_replace(
  note,
  'AI 置信度 \d+% 与"明确不通过"不一致，已上调至 90%。',
  '（判定确信度按系统改判后的"明确驳回"重置为 90%。）',
  'g')
WHERE note LIKE '%已上调至 90%%';

UPDATE public.application_reviews
SET note = regexp_replace(
  note,
  'AI 给出"需人工复核"但置信度 (\d+)% 偏高，已下调至 70%（不确定不应高置信）。',
  'AI 给出"需人工复核"但确信度 \1% 偏高（不确定本不应高确信），系统已校正为 70%。',
  'g')
WHERE note LIKE '%已下调至 70%%';

-- applications.ai_reasoning 同步处理
UPDATE public.applications
SET ai_reasoning = regexp_replace(
  regexp_replace(
    regexp_replace(ai_reasoning, '「review」',  '「需人工复核」', 'g'),
    '「approve」', '「通过」',     'g'),
  '「reject」',  '「驳回」',     'g')
WHERE ai_reasoning ~ '「(review|approve|reject)」';

UPDATE public.applications
SET ai_reasoning = regexp_replace(
  ai_reasoning,
  'AI 置信度 \d+% 与"明确不通过"不一致，已上调至 90%。',
  '（判定确信度按系统改判后的"明确驳回"重置为 90%。）',
  'g')
WHERE ai_reasoning LIKE '%已上调至 90%%';

UPDATE public.applications
SET ai_reasoning = regexp_replace(
  ai_reasoning,
  'AI 给出"需人工复核"但置信度 (\d+)% 偏高，已下调至 70%（不确定不应高置信）。',
  'AI 给出"需人工复核"但确信度 \1% 偏高（不确定本不应高确信），系统已校正为 70%。',
  'g')
WHERE ai_reasoning LIKE '%已下调至 70%%';

-- ai_override_note 同步处理
UPDATE public.applications
SET ai_override_note = regexp_replace(
  regexp_replace(
    regexp_replace(ai_override_note, '「review」',  '「需人工复核」', 'g'),
    '「approve」', '「通过」',     'g'),
  '「reject」',  '「驳回」',     'g')
WHERE ai_override_note ~ '「(review|approve|reject)」';

UPDATE public.applications
SET ai_override_note = regexp_replace(
  ai_override_note,
  'AI 置信度 \d+% 与"明确不通过"不一致，已上调至 90%。',
  '（判定确信度按系统改判后的"明确驳回"重置为 90%。）',
  'g')
WHERE ai_override_note LIKE '%已上调至 90%%';

UPDATE public.applications
SET ai_override_note = regexp_replace(
  ai_override_note,
  'AI 给出"需人工复核"但置信度 (\d+)% 偏高，已下调至 70%（不确定不应高置信）。',
  'AI 给出"需人工复核"但确信度 \1% 偏高（不确定本不应高确信），系统已校正为 70%。',
  'g')
WHERE ai_override_note LIKE '%已下调至 70%%';

-- submission_records.ai_reasoning 同步处理
UPDATE public.submission_records
SET ai_reasoning = regexp_replace(
  regexp_replace(
    regexp_replace(ai_reasoning, '「review」',  '「需人工复核」', 'g'),
    '「approve」', '「通过」',     'g'),
  '「reject」',  '「驳回」',     'g')
WHERE ai_reasoning ~ '「(review|approve|reject)」';

UPDATE public.submission_records
SET ai_reasoning = regexp_replace(
  ai_reasoning,
  'AI 置信度 \d+% 与"明确不通过"不一致，已上调至 90%。',
  '（判定确信度按系统改判后的"明确驳回"重置为 90%。）',
  'g')
WHERE ai_reasoning LIKE '%已上调至 90%%';

UPDATE public.submission_records
SET ai_reasoning = regexp_replace(
  ai_reasoning,
  'AI 给出"需人工复核"但置信度 (\d+)% 偏高，已下调至 70%（不确定不应高置信）。',
  'AI 给出"需人工复核"但确信度 \1% 偏高（不确定本不应高确信），系统已校正为 70%。',
  'g')
WHERE ai_reasoning LIKE '%已下调至 70%%';