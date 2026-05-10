// AIGC 鉴别（阿里云内容安全 · ImageModeration aigcCheck_pro 旗舰版）
// 仅检测学生上传图片是否为 AI 生成（Midjourney / SD / 豆包 Seedream / 通义万相 / Flux 等）。
// 写入 applications.aigc_* 字段，并按学院阈值更新 status：
//   real    → 保持 pending_ai，正常进学分评估
//   suspect → 保持 pending_ai，但 evaluate-application 看到后会强制降级 pending_review
//   fake    → 直接 rejected_by_ai，跳过学分评估
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const DEFAULT_SUSPECT = 0.40;
const DEFAULT_FAKE = 0.80;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ---------- Aliyun V3 (ACS3-HMAC-SHA256) signing ----------
const enc = new TextEncoder();
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacSha256Hex(key: string | Uint8Array, msg: string): Promise<string> {
  const keyBytes = typeof key === "string" ? enc.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function callAliyunImageModeration(opts: {
  ak: string; sk: string; region: string; service: string; imageUrl: string;
}): Promise<{ ok: boolean; status: number; raw: any; requestId?: string }> {
  const host = `green-cip.${opts.region}.aliyuncs.com`;
  const action = "ImageModeration";
  const version = "2022-03-02";
  // 阿里云 ACS3-HMAC-SHA256 要求 ISO8601 扩展格式：2026-05-10T12:18:38Z（保留 - 和 :，去掉毫秒）
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const bodyObj = {
    Service: opts.service,
    ServiceParameters: JSON.stringify({ imageUrl: opts.imageUrl, dataId: nonce }),
  };
  const body = JSON.stringify(bodyObj);
  const bodyHash = await sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    "x-acs-action": action,
    "x-acs-version": version,
    "x-acs-date": date,
    "x-acs-signature-nonce": nonce,
    "x-acs-content-sha256": bodyHash,
    "content-type": "application/json; charset=utf-8",
  };

  // Canonical request
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = sortedKeys.join(";");
  const canonicalRequest =
    "POST\n/\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + bodyHash;

  const stringToSign = "ACS3-HMAC-SHA256\n" + (await sha256Hex(canonicalRequest));
  const signature = await hmacSha256Hex(opts.sk, stringToSign);
  const authorization =
    `ACS3-HMAC-SHA256 Credential=${opts.ak},SignedHeaders=${signedHeaders},Signature=${signature}`;

  const resp = await fetch(`https://${host}/`, {
    method: "POST",
    headers: { ...headers, Authorization: authorization, "x-acs-action": action },
    body,
  });
  const txt = await resp.text();
  let raw: any = {};
  try { raw = JSON.parse(txt); } catch { raw = { raw_text: txt.slice(0, 500) }; }
  return { ok: resp.ok, status: resp.status, raw, requestId: raw?.RequestId };
}

// 解析阿里云 aigcCheck_pro 返回，归一到 0-1 概率。
// 旗舰版返回示例：{ Code: 200, Data: { Result: [{ Label: "ai", Confidence: 92.3, Description: "..." }, ...], RiskTips, RiskWords } }
// 若顶层非 200，视为错误。
function parseAliyunResult(raw: any): { score: number; labels: string[]; suspectedModels: { name: string; score: number }[]; topLabel: string } {
  const data = raw?.Data ?? {};
  const results: any[] = Array.isArray(data?.Result) ? data.Result : [];
  let aiScore = 0;
  const labels: string[] = [];
  const suspectedModels: { name: string; score: number }[] = [];
  for (const r of results) {
    const label = String(r?.Label ?? "").toLowerCase();
    const conf = Math.max(0, Math.min(100, Number(r?.Confidence ?? 0))) / 100;
    if (label) labels.push(`${label}:${(conf * 100).toFixed(1)}%`);
    // ai / aigc / fake / generated 视为 AI 生成正向证据
    if (/^(ai|aigc|fake|generated|ai_generated|sd|midjourney|seedream|flux|kling)/.test(label)) {
      aiScore = Math.max(aiScore, conf);
      // 旗舰版有时把模型名写在 Description 或 SubLabels
      const desc = r?.Description ?? "";
      const m = String(desc).match(/(midjourney|stable\s*diffusion|sd|flux|seedream|豆包|通义万相|wanxiang|kling|可灵|dalle|sora)/i);
      if (m) suspectedModels.push({ name: m[0], score: conf });
      else suspectedModels.push({ name: label, score: conf });
    }
  }
  const topLabel = aiScore >= 0.5 ? "aigc" : "real";
  return { score: aiScore, labels, suspectedModels, topLabel };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const ak = Deno.env.get("ALIYUN_AK_ID");
    const sk = Deno.env.get("ALIYUN_AK_SECRET");
    const region = Deno.env.get("ALIYUN_GREEN_REGION") || "cn-shanghai";
    const service = Deno.env.get("ALIYUN_AIGC_SERVICE") || "aigcCheck_pro";
    if (!ak || !sk) return json({ error: "ALIYUN_AK_ID / ALIYUN_AK_SECRET 未配置" }, 500);

    const auth = req.headers.get("Authorization") ?? "";
    const isService = auth.includes(serviceKey);

    let callerId: string | null = null;
    if (!isService) {
      if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const caller = createClient(supaUrl, anonKey, { global: { headers: { Authorization: auth } } });
      const token = auth.slice("Bearer ".length);
      const { data: cd, error: ce } = await caller.auth.getClaims(token);
      if (ce || !cd?.claims?.sub) {
        console.error("[aigc-detect] getClaims failed:", ce?.message);
        return json({ error: "Unauthorized" }, 401);
      }
      callerId = cd.claims.sub as string;
    }

    const body = await req.json().catch(() => ({}));
    const application_id = String(body?.application_id ?? "");
    if (!application_id) return json({ error: "application_id required" }, 400);

    const admin = createClient(supaUrl, serviceKey);

    const { data: app, error: appErr } = await admin
      .from("applications")
      .select("id, student_id, file_path, college_id, aigc_status")
      .eq("id", application_id)
      .maybeSingle();
    if (appErr || !app) return json({ error: "application not found" }, 404);

    if (!isService && callerId !== app.student_id) {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
      const ok = (roles ?? []).some((r: any) => r.role === "teacher" || r.role === "admin" || r.role === "super_admin");
      if (!ok) return json({ error: "forbidden" }, 403);
    }

    // 学院阈值
    let suspectTh = DEFAULT_SUSPECT, fakeTh = DEFAULT_FAKE, enabled = true;
    if (app.college_id) {
      const { data: col } = await admin.from("colleges").select("theme").eq("id", app.college_id).maybeSingle();
      const cfg = (col?.theme as any)?.aigc;
      if (cfg) {
        if (typeof cfg.suspect === "number") suspectTh = cfg.suspect;
        if (typeof cfg.fake === "number") fakeTh = cfg.fake;
        if (cfg.enabled === false) enabled = false;
      }
    }

    const writeResult = (patch: Record<string, unknown>) =>
      admin.from("applications").update({
        ...patch,
        aigc_checked_at: new Date().toISOString(),
        aigc_provider: `aliyun:${service}`,
      }).eq("id", application_id);

    if (!enabled) {
      await writeResult({ aigc_status: "skipped", aigc_score: null, aigc_detail: { reason: "disabled by college config" } });
      return json({ status: "skipped", note: "AIGC 检测已被学院关闭" });
    }

    if (!app.file_path || !IMAGE_EXT.test(app.file_path)) {
      await writeResult({ aigc_status: "skipped", aigc_score: null, aigc_detail: { reason: "not an image" } });
      return json({ status: "skipped", note: "非图片附件，无需 AIGC 检测" });
    }

    const { data: signed } = await admin.storage.from("application-files").createSignedUrl(app.file_path, 300);
    const imageUrl = signed?.signedUrl;
    if (!imageUrl) {
      await writeResult({ aigc_status: "error", aigc_detail: { reason: "no signed url" } });
      return json({ status: "error", note: "无法生成图片访问链接" });
    }

    const aly = await callAliyunImageModeration({ ak, sk, region, service, imageUrl });
    if (!aly.ok || (aly.raw?.Code && aly.raw.Code !== 200)) {
      const msg = `阿里云 [${aly.status}] ${JSON.stringify(aly.raw).slice(0, 300)}`;
      await writeResult({ aigc_status: "error", aigc_detail: { error: msg, request_id: aly.requestId } });
      return json({ status: "error", note: msg }, 500);
    }

    const parsed = parseAliyunResult(aly.raw);
    let aigc_status: "real" | "suspect" | "fake";
    if (parsed.score >= fakeTh) aigc_status = "fake";
    else if (parsed.score >= suspectTh) aigc_status = "suspect";
    else aigc_status = "real";

    const detail = {
      provider: "aliyun",
      service,
      labels: parsed.labels,
      suspected_models: parsed.suspectedModels.slice(0, 5),
      request_id: aly.requestId,
      thresholds: { suspect: suspectTh, fake: fakeTh },
      raw: aly.raw,
    };

    await writeResult({
      aigc_status,
      aigc_score: Number(parsed.score.toFixed(3)),
      aigc_detail: detail,
    });

    // fake → 直接拒；不再交给学分评估
    if (aigc_status === "fake") {
      await admin.from("applications").update({
        status: "rejected_by_ai",
        ai_reasoning: `材料未通过初审：检测到该图片为 AI 生成（概率 ${(parsed.score * 100).toFixed(1)}%）。请提交真实证书原件照片。`,
        ai_reasoning_short: "AI 生成图，已拒",
        ai_check_authenticity: false,
      }).eq("id", application_id);
    }

    return json({ status: aigc_status, score: parsed.score, suspected_models: parsed.suspectedModels });
  } catch (e) {
    console.error("[aigc-detect] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});