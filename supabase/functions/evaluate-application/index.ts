// 系统材料核验：仅校验"材料 vs 关键词 vs 学生姓名"一致性，及是否存在
// 明显篡改 / AI 生成痕迹 / 无关图片。其他内容（学分大小等）不严格校验。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HIGH_CONFIDENCE = 0.85;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ---- AuthN: verify caller JWT ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const callerId = claimsData.claims.sub as string;

    const { application_id } = await req.json();
    if (!application_id) return json({ error: "application_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: app, error: appErr } = await admin
      .from("applications")
      .select("*")
      .eq("id", application_id)
      .single();
    if (appErr || !app) return json({ error: "Application not found" }, 404);

    // ---- AuthZ: caller must own the application OR be teacher/admin ----
    if (app.student_id !== callerId) {
      const [{ data: isTeacher }, { data: isAdmin }] = await Promise.all([
        admin.rpc("has_role", { _user_id: callerId, _role: "teacher" }),
        admin.rpc("has_role", { _user_id: callerId, _role: "admin" }),
      ]);
      if (!isTeacher && !isAdmin) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    const { data: studentProfile } = await admin
      .from("profiles")
      .select("full_name, student_no")
      .eq("user_id", app.student_id)
      .single();

    const selected: string[] = app.selected_keywords ?? [];
    const custom: string[] = app.custom_keywords ?? [];
    const allKw = [...selected, ...custom];

    // 学生端 AI 初审佐证：仅来自案例库（cases）
    // 服务端按关键词 ilike 匹配，避免数千案例时漏检 / 超量传输
    type CaseRow = { id: string; title: string; summary: string; awarded_credit: number | null };
    let relatedCases: CaseRow[] = [];
    const cleanedKw = allKw.filter((k) => k && k.trim().length > 0).slice(0, 8);
    if (cleanedKw.length) {
      const orExpr = cleanedKw
        .flatMap((k) => [`title.ilike.%${k}%`, `summary.ilike.%${k}%`])
        .join(",");
      const { data: matched } = await admin
        .from("cases")
        .select("id, title, summary, awarded_credit")
        .or(orExpr)
        .order("created_at", { ascending: false })
        .limit(8);
      relatedCases = (matched as CaseRow[]) ?? [];
    }

    // 计分：按命中关键词数量挑选最相关的"候选案例"
    const scoreCase = (c: CaseRow) => {
      const hay = `${c.title}\n${c.summary ?? ""}`.toLowerCase();
      return cleanedKw.reduce((n, k) => n + (hay.includes(k.toLowerCase()) ? 1 : 0), 0);
    };
    const candidateCase: CaseRow | null = relatedCases.length
      ? [...relatedCases].sort((a, b) => scoreCase(b) - scoreCase(a))[0]
      : null;

    // 下载附件图片
    let imageDataUrl: string | null = null;
    let attachmentNote = "无附件";
    if (app.file_path) {
      if (IMAGE_EXT.test(app.file_path)) {
        const { data: blob, error: dlErr } = await admin.storage
          .from("application-files")
          .download(app.file_path);
        if (!dlErr && blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          const b64 = btoa(bin);
          const ext = app.file_path.split(".").pop()!.toLowerCase();
          const mime = ext === "jpg" ? "jpeg" : ext;
          imageDataUrl = `data:image/${mime};base64,${b64}`;
          attachmentNote = "已附图片";
        } else {
          attachmentNote = "附件下载失败";
        }
      } else {
        attachmentNote = `非图片附件 (${app.file_path.split(".").pop()})，未做视觉核验`;
      }
    }

    const systemPrompt = `你是大学学分材料核验助手。

【认定范围参考】本科生创新实践学分的认定范围包括：科研成果（论文）、知识产权、科研训练（科研项目 / 大创项目）、学科竞赛、职业技能证书、创业实践、文体竞赛、第二课堂等。

【参考依据】只以"历史人工通过案例库"作为佐证依据；不要把学校规则库作为唯一标准。

【语言要求 — 必须严格遵守】
- 所有字段值（含 reasoning、reasoning_short、detected_*）必须使用简体中文。
- 禁止输出 "null"、"N/A"、"none" 等英文占位符；无法识别时一律写「未识别」。
- 如必须引用英文缩写（如 SCI、ACM、CET），请用括号附中文解释，例如「ACM（国际大学生程序设计竞赛）」。

你需要做两类工作：

A. 四项核验（输出 4 个布尔字段 + name_match_ok 可为 null）：
1. 材料与关键词一致性：图片/文件展示的内容（证书名称、奖项、级别、身份）是否与学生选择的关键词完全一致。**关键：级别、身份、奖项等级有任何差异都算不一致**。例如学生选"国家级一等奖"但图片是"省级三等奖"，即使都是竞赛类，consistency_ok 也必须 = false。
2. 是否无关图片：图片是否完全与申请主题无关。
3. 篡改 / AI 生成痕迹：是否有明显 PS、拼接、AI 生成痕迹。
4. 姓名匹配：图片中姓名是否与学生姓名一致；图片中无姓名信息则填 null。

B. 从图片中实际识别的属性（detected_*，全部用中文，无法识别填「未识别」）：
- detected_project：项目大类（科研成果/知识产权/科研训练/学科竞赛/职业技能证书/创业实践/文体竞赛/第二课堂等）
- detected_achievement：成果细类（如"论文"、"专利"、"大创项目"、"英语等级证书"等）
- detected_level：级别（如"国家级一等奖"、"省级二等奖"、"校级"、"六级"等）
- detected_identity：身份（如"第一作者"、"主持人"、"第一参与人"等）

【判定规则 — 必须严格遵守，否则视为输出错误】
- 全部四项核验通过且 detected_* 与关键词的级别/身份/成果一致 → recommendation="approve"，confidence ∈ [0.85, 0.98]。
- 任一核验项为 false（含 consistency_ok / relevance_ok / authenticity_ok / name_match_ok=false）或明显造假 → 必须 recommendation="reject"，confidence ∈ [0.85, 0.98]。**禁止在任一核验失败的情况下输出 review。**
- 仅在"图片模糊到无法判断 / 信息缺失 / 同名同姓无法甄别 / 无可视觉核验的附件"时才能输出 recommendation="review"，且 confidence 必须 ∈ [0.40, 0.70]。**review 严禁出现 confidence ≥ 0.80 的情况，否则属于自相矛盾。**
- 无附件 → 默认 review，confidence ∈ [0.40, 0.55]。

reasoning 字段为详细中文说明，结构固定为：「材料一致性：…；图片相关性：…；真实性：…；姓名匹配：…；图片实际识别：项目=…，成果=…，级别=…，身份=…；结论：…」。每段不少于 8 字，禁止只写"是/否"。

reasoning_short：一句话（≤60 字）给学生看，只点出"是否通过 / 关键不通过原因"，不要暴露内部核验维度名称。例：「证书级别与所选关键词不一致」「材料清晰，已通过」「图片与申请主题无关」。`;

    const userPayload = {
      student: {
        name: studentProfile?.full_name ?? "未知",
        student_no: studentProfile?.student_no ?? "未知",
      },
      application: {
        description: app.description,
        selected_keywords: selected,
        custom_keywords: custom,
        attachment: attachmentNote,
      },
      candidate_case: candidateCase
        ? { title: candidateCase.title, awarded_credit: candidateCase.awarded_credit }
        : null,
      reference_cases: relatedCases.map((c) => ({
        title: c.title,
        summary: c.summary,
        awarded_credit: c.awarded_credit,
      })),
    };

    const userContent: unknown[] = [{ type: "text", text: JSON.stringify(userPayload) }];
    if (imageDataUrl) {
      userContent.push({ type: "image_url", image_url: { url: imageDataUrl } });
    }

    const aiResp = await fetch(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("DASHSCOPE_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen3-vl-32b-thinking",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          tools: [{
            type: "function",
            function: {
              name: "submit_evaluation",
              description: "提交材料核验结果",
              parameters: {
                type: "object",
                properties: {
                  consistency_ok: { type: "boolean", description: "材料是否与关键词一致（含级别/身份精确匹配）" },
                  relevance_ok: { type: "boolean", description: "图片是否与申请相关" },
                  authenticity_ok: { type: "boolean", description: "是否无篡改/AI 生成痕迹" },
                  name_match_ok: { type: ["boolean", "null"], description: "姓名是否匹配，无附件时为 null" },
                  detected_project: { type: ["string", "null"], description: "图片中实际识别到的项目大类" },
                  detected_achievement: { type: ["string", "null"], description: "图片中实际识别到的成果细类" },
                  detected_level: { type: ["string", "null"], description: "图片中实际识别到的级别" },
                  detected_identity: { type: ["string", "null"], description: "图片中实际识别到的身份" },
                  confidence: { type: "number" },
                  recommendation: { type: "string", enum: ["approve", "review", "reject"] },
                  reasoning: { type: "string" },
                  reasoning_short: { type: "string", description: "一句话给学生看的简短结论，≤60 字" },
                },
                required: ["consistency_ok", "relevance_ok", "authenticity_ok", "name_match_ok", "detected_project", "detected_achievement", "detected_level", "detected_identity", "confidence", "recommendation", "reasoning", "reasoning_short"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "submit_evaluation" } },
        }),
      },
    );

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("Qwen gateway error:", aiResp.status, t);
      if (aiResp.status === 429) return json({ error: "系统繁忙，请稍后再试" }, 429);
      return json({ error: `系统核验失败: ${t.slice(0, 200)}` }, 500);
    }

    const aiJson = await aiResp.json();
    const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      console.error("Qwen unexpected payload:", JSON.stringify(aiJson).slice(0, 500));
      return json({ error: "系统返回格式错误" }, 500);
    }
    const result = JSON.parse(call.function.arguments);

    // 用 AI 从图片中识别到的真实属性重新匹配案例（防止学生选高分关键词配低级别证书）
    const detected = {
      project: result.detected_project as string | null,
      achievement: result.detected_achievement as string | null,
      level: result.detected_level as string | null,
      identity: result.detected_identity as string | null,
    };
    const hasDetection = !!(detected.project || detected.achievement || detected.level);
    // 在 relatedCases 中按 detected 关键词再次评分，得到 detectedCase
    const detectedTokens = [detected.project, detected.achievement, detected.level, detected.identity]
      .filter((x): x is string => !!x && x.length > 0);
    const detectedCase: CaseRow | null = (hasDetection && relatedCases.length)
      ? [...relatedCases].sort((a, b) => {
          const ha = `${a.title}\n${a.summary ?? ""}`.toLowerCase();
          const hb = `${b.title}\n${b.summary ?? ""}`.toLowerCase();
          const sa = detectedTokens.reduce((n, t) => n + (ha.includes(t.toLowerCase()) ? 1 : 0), 0);
          const sb = detectedTokens.reduce((n, t) => n + (hb.includes(t.toLowerCase()) ? 1 : 0), 0);
          return sb - sa;
        })[0]
      : null;

    // 优先使用 detected 匹配的案例；若与学生关键词派生的 candidateCase 不一致，强制走人工复核
    const effectiveCase = detectedCase ?? candidateCase;
    const detectedMismatch = hasDetection && candidateCase && detectedCase && detectedCase.id !== candidateCase.id;

    let nextStatus: string;
    if (detectedMismatch) {
      // 学生选的关键词与图片识别结果对应不同案例 → 不能自动通过
      nextStatus = result.recommendation === "reject" ? "rejected_by_ai" : "pending_review";
    } else if (result.recommendation === "approve" && result.confidence >= HIGH_CONFIDENCE) {
      nextStatus = "auto_approved";
    } else if (result.recommendation === "reject" && result.confidence >= HIGH_CONFIDENCE) {
      nextStatus = "rejected_by_ai";
    } else {
      nextStatus = "pending_review";
    }

    // 不再指向 rules 表；ai_matched_rule_id 写 null
    const matchedRuleId: string | null = null;
    const suggestedCredit = effectiveCase?.awarded_credit ?? null;

    await admin.from("application_reviews").insert({
      application_id,
      reviewer_id: null,
      action: "ai_evaluation",
      decision: nextStatus,
      credit: suggestedCredit,
      confidence: result.confidence,
      matched_rule_id: matchedRuleId,
      note: result.reasoning,
    });

    // 系统通过时直接落实学分，无需教师确认；教师仍可在详情页修改
    const isAutoApproved = nextStatus === "auto_approved";
    await admin
      .from("applications")
      .update({
        status: nextStatus,
        ai_matched_rule_id: matchedRuleId,
        ai_suggested_credit: suggestedCredit,
        ai_confidence: result.confidence,
        ai_reasoning: result.reasoning,
        ai_reasoning_short: typeof result.reasoning_short === "string"
          ? result.reasoning_short.slice(0, 80)
          : null,
        final_credit: isAutoApproved ? suggestedCredit : null,
        reviewed_at: isAutoApproved ? new Date().toISOString() : null,
      })
      .eq("id", application_id);

    return json({
      success: true,
      status: nextStatus,
      vision_used: !!imageDataUrl,
      ...result,
      matched_rule_id: matchedRuleId,
    });
  } catch (e) {
    console.error("evaluate error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
