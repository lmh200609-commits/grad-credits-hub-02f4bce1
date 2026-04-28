// Q&A assistant for the admin batch import page.
// Answers questions about: Excel format, default password/role, how table data
// overrides defaults, common errors, etc. Uses Qwen via DashScope.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatMsg = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `你是「学分认证系统」管理员端「批量导入账号」页面的中文助手。
请用简洁、友好的中文回答管理员关于批量导入的问题。

【导入规则 — 必须严格遵守并准确告知用户】
1. 文件格式：仅支持 Excel（.xlsx / .xls）和 CSV。第一行必须是表头，从第二行开始是数据。
2. 必填列：学号/工号、姓名。其他列（手机号、班级、院系、专业、角色、密码）可选。
3. 表头识别：列名可任意写法（学号 / 学生编号 / 工号 / Student No 等），AI 会自动匹配。
4. 默认值：管理员可在输入框设置「默认角色」「默认密码」（密码 ≥ 6 位）。
   - 设置方式：发送「默认角色=学生」「默认密码=Abc12345」即可。
   - 支持的角色：管理员 / 教师 / 学生。
5. 优先级（重要）：**表格内每一行如果填写了角色或密码列，以表格中的数据为准；只有当该行该列为空时，才使用默认角色 / 默认密码。**
6. 角色映射：表格中可写「管理员 / 教师 / 老师 / 学生」或英文 admin/teacher/student，会自动归一。
7. 密码规则：表格中密码若 < 6 位会被忽略，回退到默认密码。
8. 重复处理：学号已存在的账号会被跳过并在结果中报告，不会覆盖已有账号。
9. 批量上限：单次最多约 2000 行，超过会自动分批提交（每批 200 行）。

【回答风格】
- 直接回答问题；如果用户问"怎么用 / 怎么导入"，分步骤简短说明。
- 如果用户问的内容与导入无关，礼貌引导回到导入主题。
- 不要编造表格内没有的字段。
- 不输出 Markdown 代码块以外的多余前缀；可使用项目符号。
- 回答控制在 200 字以内，除非用户明确要求详细。`;

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
    const { data: roleRow } = await admin
      .from("user_roles").select("role")
      .eq("user_id", callerId).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const messages = (body.messages ?? []) as ChatMsg[];
    const defaults = body.defaults ?? { role: "student", password: "123456" };

    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content?.trim();
    if (!lastUser) return json({ error: "messages 不能为空" }, 400);

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
            temperature: 0.3,
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
        answer: `抱歉，AI 暂时无法回答（${lastErr || aiResp?.status}）。\n你可以直接点 📎 上传 Excel/CSV，或发送「默认角色=学生」「默认密码=Abc12345」调整默认值。`,
      });
    }

    const data = await aiResp.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || "（无回答）";
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
