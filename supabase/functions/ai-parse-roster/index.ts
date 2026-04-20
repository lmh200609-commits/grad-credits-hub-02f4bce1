// AI-powered roster parser: takes raw rows (any column layout) and normalizes
// them into the import schema using Lovable AI Gateway.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const body = await req.json();
    const rawRows = body.rows;
    const defaultRole = body.defaultRole ?? "student";
    const defaultPassword = body.defaultPassword ?? "123456";

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return json({ error: "rows 不能为空" }, 400);
    }

    const sample = JSON.stringify(rawRows.slice(0, Math.min(rawRows.length, 200)));

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY 未配置" }, 500);

    const sysPrompt = `你是一个名册解析助手。用户会传入一张 Excel/CSV 表的原始行（每行是一个对象，字段名是表头原文）。
请把每一行规范化为以下字段：
- student_no (string, 必填)：学号或工号
- full_name (string, 必填)：姓名
- phone (string, 可选)：手机号，纯数字
- class_name (string, 可选)：班级
- department (string, 可选)：院系/学院
- major (string, 可选)：专业
- role ("admin"|"teacher"|"student", 必填)：默认 "${defaultRole}"，识别"教师/老师"=teacher, "管理员"=admin, "学生"=student
- password (string, 必填, ≥6位)：默认 "${defaultPassword}"

规则：
1. 表头可能是任意写法（学号/学生编号/工号/编号/Student No 等），灵活匹配。
2. 缺少角色字段时填默认值。
3. 缺少密码字段时填默认值。
4. 跳过明显是表头说明、空行或汇总行。
5. 只输出 JSON，结构 {"rows":[{...}, ...], "notes":"简要说明你做了哪些识别/转换"}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: `共 ${rawRows.length} 行，下面是前 ${Math.min(rawRows.length, 200)} 行原始数据：\n${sample}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      if (aiResp.status === 429) return json({ error: "AI 调用过于频繁，请稍后重试" }, 429);
      if (aiResp.status === 402) return json({ error: "AI 额度不足，请在工作区设置中充值" }, 402);
      return json({ error: `AI 调用失败: ${t}` }, 500);
    }

    const aiData = await aiResp.json();
    const content = aiData.choices?.[0]?.message?.content ?? "{}";
    let parsed: { rows?: any[]; notes?: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      return json({ error: "AI 输出不是合法 JSON", raw: content }, 500);
    }

    const normalized = (parsed.rows ?? []).map((r: any) => ({
      student_no: String(r.student_no ?? "").trim(),
      full_name: String(r.full_name ?? "").trim(),
      phone: r.phone ? String(r.phone).trim() : undefined,
      class_name: r.class_name ? String(r.class_name).trim() : undefined,
      department: r.department ? String(r.department).trim() : undefined,
      major: r.major ? String(r.major).trim() : undefined,
      role: ["admin", "teacher", "student"].includes(r.role) ? r.role : defaultRole,
      password: r.password && String(r.password).length >= 6 ? String(r.password) : defaultPassword,
    }));

    return json({ success: true, rows: normalized, notes: parsed.notes ?? "" });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
