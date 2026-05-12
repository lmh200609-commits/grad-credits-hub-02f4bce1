// 人脸比对：用千问 qwen-vl-max 视觉模型对比学生证件照与申请材料中的人脸。
// 结果不影响 status / 学分，仅写入 face_match_* 字段供教师端提示。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL = "qwen-vl-max";
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function signedUrl(admin: any, path: string): Promise<string | null> {
  const { data } = await admin.storage.from("application-files").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const apiKey = Deno.env.get("DASHSCOPE_API_KEY");
    if (!apiKey) return json({ error: "DASHSCOPE_API_KEY 未配置" }, 500);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 校验调用者
    const caller = createClient(supaUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const application_id = String(body?.application_id ?? "");
    if (!application_id) return json({ error: "application_id required" }, 400);

    const admin = createClient(supaUrl, serviceKey);

    // 取申请、学生
    const { data: app, error: appErr } = await admin
      .from("applications")
      .select("id, student_id, file_path")
      .eq("id", application_id)
      .maybeSingle();
    if (appErr || !app) return json({ error: "application not found" }, 404);

    // 仅学生本人 / 教师 / 管理员可触发
    const callerId = userData.user.id;
    if (callerId !== app.student_id) {
      const { data: roles } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId);
      const ok = (roles ?? []).some((r: any) => r.role === "teacher" || r.role === "admin");
      if (!ok) return json({ error: "forbidden" }, 403);
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("photo_url, full_name")
      .eq("user_id", app.student_id)
      .maybeSingle();

    const note = (s: string, score: number | null, status: string) =>
      admin
        .from("applications")
        .update({
          face_match_status: status,
          face_match_score: score,
          face_match_note: s.slice(0, 500),
          face_checked_at: new Date().toISOString(),
        })
        .eq("id", application_id);

    if (!profile?.photo_url) {
      // 学生还没上传证件照：不写库，避免给申请打上"unknown"噪音
      return json({ status: "skipped", note: "学生未上传证件照，已跳过人脸比对" });
    }
    if (!app.file_path || !IMAGE_EXT.test(app.file_path)) {
      // 材料不是图片，无需比对，也不写库噪音
      return json({ status: "skipped", note: "申请材料不是图片，已跳过人脸比对" });
    }

    const [idPhotoUrl, materialUrl] = await Promise.all([
      signedUrl(admin, profile.photo_url),
      signedUrl(admin, app.file_path),
    ]);
    if (!idPhotoUrl || !materialUrl) {
      await note("无法获取图片", null, "error");
      return json({ status: "error", note: "无法获取图片" });
    }

    // 调用千问 VL
    const sys =
      "你是一名严谨的人脸核验助手。给你两张图：第一张是学生本人证件照，第二张是该学生提交的申请材料图片。" +
      "请判断材料图中是否出现明显的人脸，以及该人脸是否与证件照属于同一人。" +
      "只通过 face_compare 工具返回结构化结论，不要输出其他文字。";

    const tools = [
      {
        type: "function",
        function: {
          name: "face_compare",
          description: "返回人脸比对结论",
          parameters: {
            type: "object",
            properties: {
              has_face_in_material: { type: "boolean", description: "申请材料图中是否检测到人脸" },
              same_person: { type: "boolean", description: "材料中人脸是否与证件照属于同一人；无人脸时为 false" },
              similarity: { type: "number", description: "0-1 的相似度估计；无人脸时为 0" },
              reason: { type: "string", description: "用一句中文说明判断依据，<60字" },
            },
            required: ["has_face_in_material", "same_person", "similarity", "reason"],
            additionalProperties: false,
          },
        },
      },
    ];

    const payload = {
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: `证件照（学生：${profile.full_name ?? ""}）：` },
            { type: "image_url", image_url: { url: idPhotoUrl } },
            { type: "text", text: "申请材料图：" },
            { type: "image_url", image_url: { url: materialUrl } },
            { type: "text", text: "请调用 face_compare 返回结论。" },
          ],
        },
      ],
      tools,
      tool_choice: "auto",
    };

    const resp = await fetch(QWEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = `qwen-vl 调用失败 [${resp.status}]: ${JSON.stringify(data).slice(0, 300)}`;
      await note(msg, null, "error");
      return json({ status: "error", note: msg }, 500);
    }

    const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any = null;
    try {
      parsed = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : null;
    } catch {
      parsed = null;
    }
    // 兜底：模型没调用工具，而是直接输出文本时，尝试从文本中提取 JSON
    if (!parsed) {
      const text: string = data?.choices?.[0]?.message?.content ?? "";
      const m = typeof text === "string" ? text.match(/\{[\s\S]*\}/) : null;
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { parsed = null; }
      }
    }
    if (!parsed) {
      await note("AI 未返回结构化结论", null, "error");
      return json({ status: "error", note: "AI 未返回结构化结论" });
    }

    const score = Math.max(0, Math.min(1, Number(parsed.similarity) || 0));
    // 材料中没有人脸：视为不需要比对，不写入数据库，避免在教师端产生噪音
    if (!parsed.has_face_in_material) {
      return json({ status: "skipped", note: "申请材料中未检测到人脸，已跳过人脸比对" });
    }
    const status: "match" | "mismatch" =
      parsed.same_person && score >= 0.6 ? "match" : "mismatch";
    await note(String(parsed.reason ?? ""), score, status);
    return json({ status, score, note: parsed.reason });
  } catch (e) {
    console.error("[face-compare] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});