// Q&A assistant for the admin batch import page.
// Answers questions about: Excel format, default password/role, how table data
// overrides defaults, common errors, etc. Uses Qwen via DashScope.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getAiConfig } from "../_shared/ai-router.ts";
import { stripDecorations } from "../_shared/format-answer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatMsg = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `你是「学分认证系统」管理员端「批量导入账号」页面的中文助手。
请用简洁、友好的简体中文回答管理员关于批量导入的问题。

【输出风格 — 强制】
- 只输出纯文本简体中文，禁止任何 markdown 强调符号（** __ * _ # >）。
- 禁止任何装饰性 emoji（⚠️ 📎 👇 ✅ ❌ 🎉 🤖 💡 等）和带圈数字（1️⃣ 2️⃣ ...）。
- 禁止出现数据库字段名或表名，例如 student_no、full_name、college_name、colleges、user_roles、profiles、applications；统一翻译成「学号/工号」「姓名」「学院」「学院名单」「角色记录」「用户档案」「申请记录」。
- 需要强调时直接用「」或换行；分步骤用 1) 2) 3) 这种纯数字写法。
- 语气克制，像同事之间正常说话即可。

【最重要的规则】
- 必须针对用户当前这一句的具体问题作答；不要每次都重复完整的导入流程。
- 只有在用户明确说「怎么导入 / 怎么用 / 我要导入」并且尚未上传文件时，才完整介绍 4 步流程。
- 其他问题（密码、学院、表头、失败排查等）只回答与该问题相关的内容，2-5 句话即可。
- 同一段流程介绍不要在对话中重复输出。如果上一条助手回复已经说过流程，本条不要再重复。

【导入规则 — 必须严格遵守并准确告知用户】
1. 文件格式：仅支持 Excel（.xlsx / .xls）和 CSV。第一行必须是表头，从第二行开始是数据。
2. 必填列：学号/工号、姓名。其他列（学院、专业、班级、年级、性别、民族、政治面貌、出生日期、辅导员、手机号、公寓号、宿舍号、床号、角色）可选。
3. 表头识别：列名可任意写法（学号 / 学生编号 / 工号 / Student No 等），AI 会自动匹配。
4. 默认角色：管理员可在输入框设置「默认角色」（管理员 / 教师 / 学生）。设置方式：发送「默认角色=学生」即可。
5. 优先级（重要）：表格内每一行如果填写了角色列，以表格中的数据为准；为空时才用默认角色。
6. 角色映射：表格中可写「管理员 / 教师 / 老师 / 学生」或英文 admin/teacher/student，会自动归一。
7. 密码规则（系统统一生成，无法自定义默认密码）：每个账号的初始密码 = 学号 + 该账号电话号码后 6 位。如果电话不足 6 位，会在左侧补 0 至 6 位。如表格自带「密码」列且 ≥ 6 位则以该列为准。
8. 重复处理：学号已存在的账号会让本批整体失败并提示冲突列表，不会覆盖已有账号。
9. 批量上限：单次最多约 2000 行，超过会自动分批提交（每批 200 行）。
10. 学院归属：超级管理员导入教师 / 管理员时，每行必须填写「学院」列（须与系统中的学院名称完全一致）；普通学院管理员导入时，新账号自动归属到该管理员所在学院，无需在表中填写。

【关键操作流程 — 必须告诉用户】
本助手不会通过聊天直接创建账号。导入必须按下面步骤手工操作：
1) 点击聊天输入框左侧的「上传文件」按钮，选择 .xlsx / .xls / .csv
2) 助手会自动读取并用 AI 识别字段，弹出预览表（带格式校验，异常行标红）
3) 核对预览后，点击预览下方的「确认导入」按钮才会真正写入数据库
4) 完成后会出现绿色的「导入成功」卡片，并提供「去学生管理查看」按钮

如果用户说"已经导入了/导入完成了/为什么没看到"，先提醒他：必须完成 1) 2) 3) 三步并出现 4) 的绿色成功卡片才算成功；只在聊天框打字是不会创建账号的。请引导他点左下角的「上传文件」按钮。

【回答风格】
- 直接回答问题；如果用户问"怎么用 / 怎么导入"，分步骤简短说明。
- 如果用户问的内容与导入无关，礼貌引导回到导入主题。
- 不要编造表格内没有的字段。
- 不输出 Markdown 代码块以外的多余前缀；可使用项目符号。
- 回答控制在 200 字以内，除非用户明确要求详细。
- 如果用户问题非常模糊（如"什么"、"你好"、"在吗"），先用一句话打招呼，然后列出 3-5 条本页常见提问让用户挑选。`;

// 字段/表名 -> 中文，用于在返回给前端前清洗，避免任何残留英文标识。
const FIELD_MAP: Array<[RegExp, string]> = [
  [/\bstudent_no\b/g, "学号/工号"],
  [/\bfull_name\b/g, "姓名"],
  [/\bcollege_name\b/g, "学院"],
  [/\bcollege_id\b/g, "学院"],
  [/\bclass_name\b/g, "班级"],
  [/\benrollment_year\b/g, "年级"],
  [/\bbirth_date\b/g, "出生日期"],
  [/\bpolitical_status\b/g, "政治面貌"],
  [/\bapartment_no\b/g, "公寓号"],
  [/\bdorm_room\b/g, "宿舍号"],
  [/\bbed_no\b/g, "床号"],
  [/\bdepartment\b/g, "院系"],
  [/\bmajor\b/g, "专业"],
  [/\bphone\b/g, "手机号"],
  [/\bcolleges\b/g, "学院名单"],
  [/\buser_roles\b/g, "角色记录"],
  [/\bprofiles\b/g, "用户档案"],
  [/\bapplications\b/g, "申请记录"],
];
function translateFields(s: string): string {
  let out = s;
  for (const [re, zh] of FIELD_MAP) out = out.replace(re, zh);
  return out;
}

// 常见问题的确定性回答 —— 命中后直接返回，绕过模型，避免反复输出同一段流程。
const QUICK_ANSWERS: Array<{ test: (q: string) => boolean; answer: string }> = [
  {
    test: (q) =>
      /(初始|默认)?密码.{0,8}(规则|怎么|如何|是什么|是啥|生成|设置|改|修改|自定义)/.test(q) ||
      /(默认密码|初始密码)/.test(q),
    answer:
      "初始密码由系统统一生成，规则是「学号 + 手机号后 6 位」。手机号不足 6 位时左侧补 0；没有手机号则后 6 位全部为 0。如果在表里填写了「密码」列且长度不少于 6 位，则以表里那一列为准。不支持自定义默认密码。",
  },
  {
    test: (q) =>
      /学院.{0,6}(列|字段).{0,8}(怎么|如何|要|必填|可选|填|写)/.test(q) ||
      /(怎么|如何).{0,4}填.{0,4}学院/.test(q) ||
      /学院.{0,4}是否.{0,4}必填/.test(q),
    answer:
      "学院列要填写系统里已存在的学院名称，必须完全一致。超级管理员导入教师或管理员账号时，每一行都必须填写学院列；普通学院管理员导入时学院列可以留空，新账号会自动归属到管理员本人所在的学院。",
  },
  {
    test: (q) =>
      /(怎么|如何|怎样|步骤|流程).{0,8}(导入|创建|添加).{0,6}(教师|老师)/.test(q) ||
      /(导入|创建|添加).{0,6}(教师|老师).{0,8}(怎么|如何|步骤|流程)/.test(q),
    answer:
      "导入教师账号步骤：1) 在页面顶部点「下载教师模板」；2) 按列填写工号、姓名、学院、手机号等；3) 点输入框左侧的「上传文件」按钮选择填好的 Excel；4) 在弹出的预览表里核对，没问题再点下方的「确认导入」。学院列必须填写系统里已有的学院名称。",
  },
  {
    test: (q) =>
      /导入失败|失败.{0,4}排查|为什么.{0,8}(失败|没成功|没导入|报错|出错)|(怎么|如何).{0,4}(失败|报错|出错)/.test(q),
    answer:
      "导入失败常见原因：1) 学号或工号已经在系统里存在，可勾选「跳过已存在」后重试；2) 必填项（学号、姓名、角色）有空值；3) 出生日期格式不是 YYYY-MM-DD；4) 学院名称与系统里的不一致；5) 单元格里有多余的空格或全角符号。预览表里红色高亮的单元格就是出问题的字段，修正源表后重新上传即可。",
  },
  {
    test: (q) =>
      /(表头|列名|字段|模板).{0,6}(有哪些|哪些|什么|是什么|包含|包括|怎么|如何)/.test(q) ||
      /有哪些(列|字段)/.test(q),
    answer:
      "模板共 17 列，必填的是学号/工号、姓名、角色；其余可选项包括性别、民族、政治面貌、出生日期、手机号、学院、院系、专业、班级、年级、辅导员、公寓号、宿舍号、床号。直接点页面顶部「下载学生模板」或「下载教师模板」获取最新表头。",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimErr } = await userClient.auth.getClaims(token);
    if (claimErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // 用户可能同时拥有多条角色记录（admin + super_admin），用 limit(1) 而非
    // maybeSingle() 以避免 PostgREST 多行错误导致的误 Forbidden。
    const { data: roleRows } = await admin
      .from("user_roles").select("role")
      .eq("user_id", callerId).in("role", ["admin", "super_admin"]).limit(1);
    if (!Array.isArray(roleRows) || roleRows.length === 0) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const messages = (body.messages ?? []) as ChatMsg[];
    const defaults = body.defaults ?? { role: "student", password: "123456" };

    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content?.trim();
    if (!lastUser) return json({ error: "messages 不能为空" }, 400);

    // 命中常见问题的快速回答，直接返回，避免模型每次重复同一段导入流程。
    for (let i = 0; i < QUICK_ANSWERS.length; i++) {
      const qa = QUICK_ANSWERS[i];
      if (qa.test(lastUser)) {
        console.log(`[import-assistant] quick-answer hit #${i} for: ${lastUser.slice(0, 60)}`);
        return json({ answer: qa.answer });
      }
    }

    // Trim history to last 6 messages to keep prompts small.
    const trimmed = messages.slice(-6).map((m) => ({
      role: m.role,
      content: String(m.content ?? "").slice(0, 2000),
    }));

    let aiCfg;
    try { aiCfg = await getAiConfig("import-assistant-chat"); }
    catch (e) { return json({ error: (e as Error).message }, 500); }
    const apiKey = aiCfg.apiKey;
    const aiUrl = `${aiCfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const contextHint = `[当前默认值] 角色=${defaults.role}，密码=${defaults.password}`;

    let aiResp: Response | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        aiResp = await fetch(aiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: aiCfg.model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "system", content: contextHint },
              ...trimmed,
            ],
            temperature: 0.4,
          }),
        });
        if (aiResp.ok) break;
        if (aiResp.status === 429 || aiResp.status >= 500) {
          lastErr = `HTTP ${aiResp.status}`;
          await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
          continue;
        }
        break;
      } catch (e) {
        lastErr = (e as Error).message;
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
      }
    }
    if (!aiResp || !aiResp.ok) {
      return json({
        answer: `抱歉，AI 暂时无法回答（${lastErr || aiResp?.status}）。\n你可以直接点下方「上传文件」按钮上传 Excel/CSV，或发送「默认角色=学生」调整默认值。`,
      });
    }

    const data = await aiResp.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || "（无回答）";
    const answer = translateFields(stripDecorations(raw));
    return json({ answer });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
