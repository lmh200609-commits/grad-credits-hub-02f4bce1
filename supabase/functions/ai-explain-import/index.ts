// AI-powered import-failure explainer (Qwen-turbo).
// Input: structured error summary only (NEVER the raw Excel).
// Output: { summary, suggestions[] } in Chinese.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getAiConfig } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ErrItem = { line: number; message: string; student_no?: string };

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

    const body = await req.json();
    const errors = (body.errors ?? []) as ErrItem[];
    const total = Number(body.total ?? 0);
    const conflicts = (body.conflicts ?? []) as string[];
    if (errors.length === 0 && conflicts.length === 0) {
      return json({ summary: "无错误。", suggestions: [] });
    }

    let aiCfg;
    try { aiCfg = await getAiConfig("ai-explain-import"); }
    catch (e) { return json({ error: (e as Error).message }, 500); }
    const apiKey = aiCfg.apiKey;
    const aiUrl = `${aiCfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    // Aggregate error messages by frequency to keep prompt small.
    const counter = new Map<string, number>();
    for (const e of errors) counter.set(e.message, (counter.get(e.message) ?? 0) + 1);
    const topErrors = [...counter.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([msg, count]) => `${msg}（${count} 行）`).join("\n");
    const conflictPart = conflicts.length
      ? `\n冲突学号样例（最多 20 个）：${conflicts.slice(0, 20).join(", ")}`
      : "";

    const userPrompt = `共 ${total} 行，失败 ${errors.length + conflicts.length} 行。\n错误聚类：\n${topErrors}${conflictPart}`;

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
              { role: "system", content: "你是名册导入失败的诊断助手。基于错误聚类，给出中文【原因摘要】（1-2 句）和【修复建议】（3-5 条，可执行）。仅输出 JSON：{\"summary\": string, \"suggestions\": string[]}。" },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
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
        summary: `导入失败 ${errors.length + conflicts.length} 行（AI 解释暂不可用：${lastErr || aiResp?.status}）。`,
        suggestions: ["请检查表头与必填字段（学号、姓名、密码≥6 位）", "确认学号未与已有账号重复"],
      });
    }

    const data = await aiResp.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { summary?: string; suggestions?: string[] };
    try { parsed = JSON.parse(content); } catch {
      parsed = { summary: content.slice(0, 200), suggestions: [] };
    }
    return json({
      summary: parsed.summary ?? "（无摘要）",
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}