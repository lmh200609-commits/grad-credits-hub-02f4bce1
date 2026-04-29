// AI-powered roster parser: AI identifies column mapping from a sample,
// then we apply it to ALL rows server-side (supports 2000+ rows).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getAiConfig } from "../_shared/ai-router.ts";

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

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return json({ error: "rows 不能为空" }, 400);
    }

    let aiCfg;
    try {
      aiCfg = await getAiConfig("ai-parse-roster");
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
    const apiKey = aiCfg.apiKey;
    const aiUrl = `${aiCfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    // Send only a small sample to AI to get the COLUMN MAPPING (not parsed rows)
    // Hard cap sample at 8KB to prevent prompt injection / over-billing.
    const sampleSize = Math.min(rawRows.length, 5);
    let sample = JSON.stringify(rawRows.slice(0, sampleSize));
    if (sample.length > 8192) sample = sample.slice(0, 8192) + "...[truncated]";
    const allKeys = Object.keys(rawRows[0] ?? {});

    const sysPrompt = `你是一个名册解析助手。用户会传入一张 Excel/CSV 表的前几行样本数据。
你的任务不是解析所有数据，而是输出一个**列名映射表**，告诉我哪一列对应哪个字段。

目标字段：
- student_no：学号或工号（必须能找到）
- full_name：姓名（必须能找到）
- phone：手机号
- class_name：班级
- department：院系/学院
- major：专业
- role：角色（教师/学生/管理员）
- password：密码

原始表头列名：${JSON.stringify(allKeys)}

请输出 JSON，结构：
{
  "mapping": {
    "student_no": "原始列名",
    "full_name": "原始列名",
    "phone": "原始列名或null",
    "class_name": "原始列名或null",
    "department": "原始列名或null",
    "major": "原始列名或null",
    "role": "原始列名或null",
    "password": "原始列名或null"
  },
  "role_map": {"教师": "teacher", "老师": "teacher", "管理员": "admin", "学生": "student"},
  "notes": "简要说明你识别了什么"
}

规则：
1. 表头可能是任意写法（学号/学生编号/工号/编号/Student No 等），灵活匹配。
2. 找不到对应列的填 null。
3. student_no 和 full_name 必须找到，否则报错。`;

    // Call Qwen (DashScope OpenAI-compatible endpoint) with retry/backoff.
    let aiResp: Response | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        aiResp = await fetch(aiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: aiCfg.model,
            messages: [
              { role: "system", content: sysPrompt },
              { role: "user", content: `共 ${rawRows.length} 行，样本：\n${sample}` },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
          }),
        });
        if (aiResp.ok) break;
        if (aiResp.status === 429 || aiResp.status >= 500) {
          lastErr = `HTTP ${aiResp.status}`;
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
          continue;
        }
        break;
      } catch (e) {
        lastErr = (e as Error).message;
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
    if (!aiResp) return json({ error: `AI 调用失败: ${lastErr}` }, 502);

    if (!aiResp.ok) {
      const t = await aiResp.text();
      if (aiResp.status === 429) return json({ error: "AI 调用过于频繁，请稍后重试" }, 429);
      if (aiResp.status === 402) return json({ error: "AI 额度不足，请联系管理员充值通义千问账号" }, 402);
      if (aiResp.status === 401) return json({ error: "DASHSCOPE_API_KEY 无效，请联系管理员" }, 401);
      return json({ error: `AI 调用失败: ${t}` }, 500);
    }

    const aiData = await aiResp.json();
    const content = aiData.choices?.[0]?.message?.content ?? "{}";
    let parsed: { mapping?: Record<string, string | null>; role_map?: Record<string, string>; notes?: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      return json({ error: "AI 输出不是合法 JSON", raw: content }, 500);
    }

    const mapping = parsed.mapping;
    if (!mapping?.student_no || !mapping?.full_name) {
      return json({ error: "AI 无法识别学号和姓名列，请检查表头" }, 400);
    }

    const roleMap: Record<string, string> = {
      ...{ "教师": "teacher", "老师": "teacher", "管理员": "admin", "学生": "student", "teacher": "teacher", "admin": "admin", "student": "student" },
      ...(parsed.role_map ?? {}),
    };

    // Apply mapping to ALL rows (fast, no AI needed)
    const normalized = rawRows.map((raw: Record<string, unknown>) => {
      const get = (field: string) => {
        const col = (mapping as Record<string, string | null>)[field];
        if (!col) return undefined;
        const v = raw[col];
        return v != null ? String(v).trim() : undefined;
      };

      const rawRole = get("role");
      const role = rawRole ? (roleMap[rawRole] ?? defaultRole) : defaultRole;
      const rawPwd = get("password");
      const studentNo = get("student_no") ?? "";
      const phoneRaw = get("phone") ?? "";
      // Default rule: 学号 + 电话号码后六位；不足或缺失时左侧补 0 至 6 位
      const phoneDigits = phoneRaw.replace(/\D+/g, "");
      const last6 = phoneDigits.length >= 6
        ? phoneDigits.slice(-6)
        : phoneDigits.padStart(6, "0");
      const computedDefault = studentNo ? `${studentNo}${last6}` : defaultPassword;
      // Priority: explicit valid password column > computed (学号+电话后6) > global defaultPassword
      const password = rawPwd && rawPwd.length >= 6
        ? rawPwd
        : (computedDefault.length >= 6 ? computedDefault : defaultPassword);

      return {
        student_no: get("student_no") ?? "",
        full_name: get("full_name") ?? "",
        phone: get("phone") || undefined,
        class_name: get("class_name") || undefined,
        department: get("department") || undefined,
        major: get("major") || undefined,
        role: ["admin", "teacher", "student"].includes(role) ? role : defaultRole,
        password,
      };
    }).filter((r: { student_no: string; full_name: string }) => r.student_no && r.full_name);

    return json({
      success: true,
      rows: normalized,
      notes: `${parsed.notes ?? ""} | 列映射：${JSON.stringify(mapping)} | 共处理 ${rawRows.length} 行，有效 ${normalized.length} 行`,
    });
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
