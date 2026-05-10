# 修复材料预览模糊 + 批量导入助手答非所问

## 问题 1 — 学生材料图片在审核界面看不清

**根因**：`src/pages/ApplicationDetail.tsx:586-594` 中提交材料图片直接用一张固定 `max-h-96`（约 384px）的 `<img>` 渲染，没有缩放/全屏预览能力。点击图片虽然会在新标签页打开原图，但 1) 在新标签页里没有缩放控件，浏览器默认 fit-to-window 仍然偏小；2) 教师/管理员/超管在审核时希望能就地放大看清证件细节。三种角色用的是同一个 `ApplicationDetail.tsx`，所以一处修复即可全部生效。

**修复**：
- 给材料图片加一个就地的「放大查看」交互：点击缩略图弹出 `Dialog`，内部用 `react-zoom-pan-pinch` 风格（已无外部依赖时改用纯 CSS + transform 受控缩放）的查看器，支持滚轮缩放、拖动、双击复位、按下载键打开原图。
- 缩略图本身保留，但加上"点击放大"提示文案与放大镜图标。
- 弹窗内 `<img>` 用 `image-rendering: high-quality`，并显式设置 `loading="eager" decoding="sync"`，避免浏览器在弹窗里继续按缩略图采样。
- 不引入新依赖，用一个轻量自写的 Zoomable 组件（按住拖动 + 滚轮 zoom，1x~5x），约 60 行。

## 问题 2 — 批量导入 AI 助手对不同问题输出相同的无关回答

**根因有两层**：

1. **前端拦截过宽**：`src/pages/admin/ImportUsers.tsx:198`
   ```ts
   const importIntent = /(导入|上传|开始|帮我|怎么(用|做|导)|如何(导入|上传))/.test(text);
   if (importIntent && !pendingRows) { push 固定文案; return; }
   ```
   "帮我"、"怎么用"、"开始" 等字眼一律命中，永远返回同一段"三步导入"模板，根本不会调用 AI。用户问「为什么导入失败」「学院列怎么填」「能不能改默认密码」都先被拦走。

2. **Edge Function 的 QUICK_ANSWERS 误匹配**：`supabase/functions/import-assistant-chat/index.ts:88-114`
   ```ts
   { test: (q) => /(导入|创建).*(教师|老师|工号)/.test(q), answer: "导入教师账号步骤..." }
   ```
   只要句子里同时出现"导入"和"教师/老师/工号"，无论问什么都返回同一段教师导入步骤；类似地另几条 QUICK_ANSWERS 也偏宽。命中后直接 return，绕过模型。

**修复**：
- 前端 `importIntent` 正则收紧为 **明确的"我要导入/怎么导入"句式**：`/^(我要|我想|怎么|如何)(导入|上传|批量(导入|创建))/.test(text)`，并且只在 messages 长度 ≤ 2（首次对话）时拦截；后续问题一律放行给 AI。
- Edge Function QUICK_ANSWERS 增加更严格的 anchor：每条规则要求出现明确的疑问词（怎么/如何/是什么/能不能/为什么/规则/步骤/流程）+ 关键名词，避免句子里偶然出现"导入"就被吞。例如：
  - 教师导入条改成 `/(导入|创建).{0,6}(教师|老师|工号).{0,8}(步骤|流程|怎么|如何|方法)/`
  - 失败排查条改成 `/(为什么|怎么|如何|哪里|哪些).{0,8}(失败|出错|报错)|失败.*排查/`
  - 表头条改成 `/(表头|列名|字段|模板).{0,6}(有哪些|哪些|什么|是什么|怎么)/`
- Edge Function 在调用 AI 之前再加一道护栏：将命中 QUICK_ANSWERS 的判定记录到日志（包含命中条目编号），便于以后回看是否还有误命中。
- AI 调用本身的 messages 已正确发送完整历史，不动；temperature 从 0.3 改 0.4，让回答更贴用户具体问题。

---

## 技术细节

**新增组件**：`src/components/ZoomableImage.tsx`（轻量缩放查看器，无新依赖）。

**改动文件**：
- `src/pages/ApplicationDetail.tsx` — 把 `<img>` 包成可点击缩略图，弹 Dialog + ZoomableImage。
- `src/components/ZoomableImage.tsx`（新增）。
- `src/pages/admin/ImportUsers.tsx` — 收紧 `importIntent` 正则与触发条件。
- `supabase/functions/import-assistant-chat/index.ts` — 收紧 QUICK_ANSWERS 正则；调高 temperature；命中日志。

不需要数据库迁移，不需要新 secrets。

完成后预期：
- 三个审核角色（超管/学院管理员/教师）在申请详情页都可以滚轮放大学生材料图，看清证件号、签名等细节。
- 批量导入助手不再把每个问题都回成同一段流程；只有用户明确问"怎么开始导入"或问到密码/学院/失败排查/表头等具体话题时才走快速回答，其余真正交给大模型回答。
