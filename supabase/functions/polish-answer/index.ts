import { getAiConfig } from "../_shared/ai-router.ts";
import { stripDecorations } from "../_shared/format-answer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `你是中文排版编辑。把用户给你的内容改写为整洁的 markdown：
- 第一行用一句话给出结论；
- 然后用 ## 二级标题分段（如：依据、补充、操作建议）；
- 列表项用 - 开头；超过 5 行的并列信息必须改成表格；
- 删除任何寒暄语（"作为 AI 助手…""根据您提供的信息…""我将为您…"）和多余分割线/星号；
- 严禁修改任何数字、姓名、学号、学分、申请编号、日期；
- 严禁新增事实，也不要省略已有事实；
- 不要使用一级标题、emoji、HTML、整篇代码块包裹；
- 严禁使用 **加粗**、__加粗__、*斜体* 等强调符号；严禁使用 1️⃣2️⃣3️⃣ 等带圈数字和 ⚠️📎👇✅❌ 等装饰图标；
- 只输出整理后的 markdown 正文，不要解释。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { raw } = await req.json() as { raw: string };
    if (!raw || typeof raw !== "string") {
      return new Response(JSON.stringify({ error: "raw is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let aiCfg;
    try { aiCfg = await getAiConfig("polish-answer"); }
    catch {
      return new Response(JSON.stringify({ polished: raw, used: "none" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const endpoint = `${aiCfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const apiKey = aiCfg.apiKey;
    const model = aiCfg.model;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 4500);
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: raw },
        ],
        temperature: 0,
        max_tokens: 800,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) {
      return new Response(JSON.stringify({ polished: raw, used: "fallback" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const polished = stripDecorations(data?.choices?.[0]?.message?.content?.trim() || raw);
    return new Response(JSON.stringify({ polished, used: aiCfg.vendor }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ polished: "", error: e instanceof Error ? e.message : "polish failed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
