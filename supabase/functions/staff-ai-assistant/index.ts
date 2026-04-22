import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Msg = { role: "user" | "assistant" | "system" | "tool"; content: string; tool_call_id?: string; name?: string; tool_calls?: any[] };

const SYSTEM_PROMPT = `你是「教师/管理员工作助手」，仅为学校学分认定系统的教师与管理员服务。

【你的能力】
你可以调用以下工具完成用户的指令：
- navigate_to(path)：跳转到系统内的某个页面
- find_student(query)：根据姓名/学号/班级模糊查询学生
- list_failing_students(threshold)：列出累计学分低于阈值（默认 4）的学生
- query_stats(metric)：查询统计数据。可用 metric：
    · pending_review        — 待人工复核的申请数
    · pending_ai            — 系统核验中的申请数
    · approved_week         — 近 7 天人工复核通过数
    · rejected_week         — 近 7 天驳回数
    · total_students        — 学生总人数
    · total_apps_month      — 近 30 天提交申请数
    · submitted_total       — 累计提交过申请的去重学生人数
    · submitted_count       — 累计申请总数
    · passed_students       — 累计学分 ≥ 4 的学生人数（合格）
    · failing_students      — 累计学分 < 4 的学生人数（不合格）
    · auto_approved_total   — 系统初审自动通过的申请数
    · manual_approved_total — 人工复核通过的申请数
    · rejected_total        — 累计驳回数（含系统驳回 + 人工驳回）

【路径白名单（仅可使用以下路径）】
- /admin/dashboard           数据看板
- /admin/review              复核中心
- /admin/credits             学分排名（支持 ?passFilter=fail|pass|all、?dept=xxx）
- /admin/users/students      学生管理（支持 ?search=xxx）
- /admin/users/teachers      教师管理
- /admin/rules               规则库
- /admin/cases               案例库
- /admin/import              批量导入
- /admin/audit-logs          审计日志
- /reviews                   审核列表（支持 ?status=pending_review 等）
- /teacher/students          教师学生列表
- /teacher/students/{id}     学生档案
- /applications/{id}         单个申请详情

【行为约束】
1. 只能调用上面定义的工具，禁止臆造其他工具或路径。
2. 如果用户请求"查看 XX 档案"但姓名有多人匹配，先调用 find_student 拿到候选，让用户选择，不要擅自跳转。
3. 如果用户请求与学分系统无关，礼貌拒绝并提醒可用功能。
4. 回答简洁，不超过两句话；执行动作时直接调工具，不要冗长解释。
5. 教师角色不要给出"管理员后台"建议；管理员角色可访问全部页面。
6. 【严禁幻觉】凡涉及任何数量、人数、统计的提问（"多少人"、"几个"、"提交了多少"、"合格/不合格人数"、"通过/驳回数"等），必须先调用 query_stats（或对应工具如 list_failing_students）拿到真实数字，绝不允许凭对话上下文、记忆或推测给出数字。
7. 如果用户问的统计指标不在上面 metric 列表中，回复"暂不支持该统计"，不要编造。`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate_to",
      description: "跳转到系统内的某个页面（必须来自路径白名单）",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "完整路径，含 query string（如 /admin/credits?passFilter=fail）" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_student",
      description: "根据姓名/学号/班级/专业模糊查询学生，返回候选列表供用户选择",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "搜索关键词" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_failing_students",
      description: "列出累计学分不达标的学生",
      parameters: {
        type: "object",
        properties: { threshold: { type: "number", description: "学分阈值，默认 4" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_stats",
      description: "查询常用统计数字",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: [
              "pending_review",
              "pending_ai",
              "approved_week",
              "rejected_week",
              "total_students",
              "total_apps_month",
              "submitted_total",
              "submitted_count",
              "passed_students",
              "failing_students",
              "auto_approved_total",
              "manual_approved_total",
              "rejected_total",
            ],
          },
        },
        required: ["metric"],
      },
    },
  },
];

async function execTool(name: string, args: any, supabase: ReturnType<typeof createClient>) {
  if (name === "navigate_to") {
    return { ok: true, path: String(args?.path || "") };
  }

  if (name === "find_student") {
    const q = String(args?.query || "").trim();
    if (!q) return { candidates: [] };
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, student_no, department, class_name, major")
      .or(
        `full_name.ilike.%${q}%,student_no.ilike.%${q}%,class_name.ilike.%${q}%,major.ilike.%${q}%`,
      )
      .limit(10);
    const ids = (profiles || []).map((p: any) => p.user_id);
    let students: any[] = [];
    if (ids.length) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("user_id", ids)
        .eq("role", "student");
      const sset = new Set((roles || []).map((r: any) => r.user_id));
      students = (profiles || []).filter((p: any) => sset.has(p.user_id));
    }
    return { candidates: students };
  }

  if (name === "list_failing_students") {
    const threshold = Number(args?.threshold ?? 4);
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "student");
    const ids = new Set((roles || []).map((r: any) => r.user_id));
    const { data: apps } = await supabase
      .from("applications")
      .select("student_id, status, final_credit, ai_suggested_credit");
    const credit = new Map<string, number>();
    (apps || []).forEach((a: any) => {
      if (!["approved", "auto_approved"].includes(a.status)) return;
      const c = Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
      credit.set(a.student_id, (credit.get(a.student_id) ?? 0) + c);
    });
    const failingIds = Array.from(ids).filter((id: any) => (credit.get(id) ?? 0) < threshold);
    return {
      threshold,
      failing_count: failingIds.length,
      total_students: ids.size,
      navigate_path: `/admin/credits?passFilter=fail`,
    };
  }

  if (name === "query_stats") {
    const metric = String(args?.metric || "");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
    if (metric === "pending_review") {
      const { count } = await supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "pending_review");
      return { metric, value: count ?? 0, navigate_path: "/reviews?status=pending_review" };
    }
    if (metric === "approved_week") {
      const { count } = await supabase.from("application_reviews").select("id", { count: "exact", head: true }).eq("decision", "approved").gte("created_at", weekAgo.toISOString());
      return { metric, value: count ?? 0 };
    }
    if (metric === "rejected_week") {
      const { count } = await supabase.from("application_reviews").select("id", { count: "exact", head: true }).eq("decision", "rejected").gte("created_at", weekAgo.toISOString());
      return { metric, value: count ?? 0 };
    }
    if (metric === "total_students") {
      const { count } = await supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "student");
      return { metric, value: count ?? 0 };
    }
    if (metric === "total_apps_month") {
      const { count } = await supabase.from("applications").select("id", { count: "exact", head: true }).gte("submitted_at", monthAgo.toISOString());
      return { metric, value: count ?? 0 };
    }
    if (metric === "pending_ai") {
      const { count } = await supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "pending_ai");
      return { metric, value: count ?? 0 };
    }
    if (metric === "submitted_total") {
      const { data } = await supabase.from("applications").select("student_id");
      const set = new Set((data || []).map((r: any) => r.student_id));
      return { metric, value: set.size, navigate_path: "/admin/users/students" };
    }
    if (metric === "submitted_count") {
      const { count } = await supabase.from("applications").select("id", { count: "exact", head: true });
      return { metric, value: count ?? 0 };
    }
    if (metric === "passed_students" || metric === "failing_students") {
      const threshold = 4;
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "student");
      const ids = new Set((roles || []).map((r: any) => r.user_id));
      const { data: apps } = await supabase
        .from("applications")
        .select("student_id, status, final_credit, ai_suggested_credit");
      const credit = new Map<string, number>();
      (apps || []).forEach((a: any) => {
        if (!["approved", "auto_approved"].includes(a.status)) return;
        const c = Number(a.final_credit ?? a.ai_suggested_credit ?? 0);
        credit.set(a.student_id, (credit.get(a.student_id) ?? 0) + c);
      });
      const passing = Array.from(ids).filter((id: any) => (credit.get(id) ?? 0) >= threshold).length;
      const failing = ids.size - passing;
      const value = metric === "passed_students" ? passing : failing;
      return {
        metric,
        value,
        threshold,
        navigate_path: `/admin/credits?passFilter=${metric === "passed_students" ? "pass" : "fail"}`,
      };
    }
    if (metric === "auto_approved_total") {
      const { count } = await supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "auto_approved");
      return { metric, value: count ?? 0 };
    }
    if (metric === "manual_approved_total") {
      const { count } = await supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "approved");
      return { metric, value: count ?? 0 };
    }
    if (metric === "rejected_total") {
      const { count } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .in("status", ["rejected", "rejected_by_ai"]);
      return { metric, value: count ?? 0 };
    }
    return { metric, value: 0 };
  }

  return { error: `unknown tool: ${name}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as { messages: Msg[]; role?: string; provider?: "deepseek" | "qwen" };
    const messages = body.messages || [];
    const userRole = body.role || "teacher";
    const provider = body.provider ?? "deepseek";

    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    const DASHSCOPE_API_KEY = Deno.env.get("DASHSCOPE_API_KEY");
    if (provider === "deepseek" && !DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY 未配置");
    if (provider === "qwen" && !DASHSCOPE_API_KEY) throw new Error("DASHSCOPE_API_KEY 未配置");

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages 不能为空" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const endpoint = provider === "qwen"
      ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
      : "https://api.deepseek.com/chat/completions";
    const apiKey = provider === "qwen" ? DASHSCOPE_API_KEY! : DEEPSEEK_API_KEY!;
    const model = provider === "qwen" ? "qwen-plus" : "deepseek-chat";

    const sysMsg: Msg = { role: "system", content: `${SYSTEM_PROMPT}\n\n当前用户角色：${userRole}` };
    let convo: Msg[] = [sysMsg, ...messages.slice(-12)];

    let action: any = null;
    let candidates: any[] | null = null;
    let stats: any = null;

    // Up to 3 tool-call rounds
    for (let round = 0; round < 3; round++) {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: convo,
          temperature: 0.2,
          tools: TOOLS,
          tool_choice: "auto",
          stream: false,
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        console.error(`AI provider (${provider}) error:`, resp.status, t);
        if (resp.status === 429) return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 401 || resp.status === 402) return new Response(JSON.stringify({ error: "AI 服务认证失败或额度不足，请联系管理员" }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: "AI 服务暂时不可用" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const data = await resp.json();
      const choice = data?.choices?.[0];
      const message = choice?.message;
      const toolCalls = message?.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        convo.push({ role: "assistant", content: message.content || "", tool_calls: toolCalls });
        for (const tc of toolCalls) {
          let args: any = {};
          try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { args = {}; }
          const result = await execTool(tc.function?.name, args, supabase);

          if (tc.function?.name === "navigate_to" && (result as any).path) {
            action = { type: "navigate", payload: { path: (result as any).path } };
          }
          if (tc.function?.name === "find_student") {
            candidates = (result as any).candidates || [];
          }
          if (tc.function?.name === "list_failing_students") {
            stats = result;
            action = { type: "navigate", payload: { path: (result as any).navigate_path } };
          }
          if (tc.function?.name === "query_stats") {
            stats = result;
            if ((result as any).navigate_path) {
              action = { type: "navigate", payload: { path: (result as any).navigate_path } };
            }
          }

          convo.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function?.name,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      const answer = (message?.content || "").trim() || "好的。";
      return new Response(JSON.stringify({
        answer,
        action,
        candidates,
        stats,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      answer: "已完成多轮工具调用，请查看结果。",
      action, candidates, stats,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("staff-ai-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});