-- Clean invalid HSL tokens in colleges.theme
UPDATE public.colleges SET theme = theme - 'primary'
  WHERE theme ? 'primary' AND NOT ((theme->>'primary') ~ '^\s*\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%\s*$');
UPDATE public.colleges SET theme = theme - 'background'
  WHERE theme ? 'background' AND NOT ((theme->>'background') ~ '^\s*\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%\s*$');
UPDATE public.colleges SET theme = theme - 'accent'
  WHERE theme ? 'accent' AND NOT ((theme->>'accent') ~ '^\s*\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%\s*$');