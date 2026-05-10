// AI 评估队列 worker。由 pg_cron 或外部调度（HTTP）触发；
// 每次领最多 N 条任务并发交给 evaluate-application 函数处理，
// 处理结果回写 ai_eval_queue / ai_eval_failures。
// 不依赖学生端 / 教师端的 JWT —— 用 service role 直接转发。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BATCH = 5;        // 每次最多领 5 条
const DEFAULT_CONCURRENCY = 5;  // 同时跑 5 条
const PER_JOB_TIMEOUT_MS = 60_000;

type Job = { id: string; application_id: string; attempts: number };

async function runOne(admin: ReturnType<typeof createClient>, supabaseUrl: string, serviceKey: string, job: Job) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_JOB_TIMEOUT_MS);
  try {
    // 直接 HTTP 调用 evaluate-application（服务端→服务端，绕过浏览器 CORS）
    // 用 service-role JWT，里面 has_role(callerId,'teacher') 会通过 has_role 自身的服务端豁免
    const resp = await fetch(`${supabaseUrl}/functions/v1/evaluate-application`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ application_id: job.application_id }),
    });
    clearTimeout(t);
    if (!resp.ok) {
      const txt = (await resp.text()).slice(0, 400);
      await admin.rpc("mark_ai_eval_failed", { _id: job.id, _error: `HTTP ${resp.status}: ${txt}` });
      return { id: job.id, ok: false, error: txt };
    }
    await admin.rpc("mark_ai_eval_done", { _id: job.id });
    return { id: job.id, ok: true };
  } catch (e) {
    clearTimeout(t);
    const msg = (e as Error).message ?? String(e);
    await admin.rpc("mark_ai_eval_failed", { _id: job.id, _error: msg });
    return { id: job.id, ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  // 鉴权：允许 service-role（服务端调用）或 anon key（pg_cron 定时任务）调用。
  // 函数内部一律用 service-role 执行实际工作，外部只能触发"取队列"。
  const auth = req.headers.get("Authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  const allowed =
    (serviceKey && (auth.includes(serviceKey) || apikey === serviceKey)) ||
    (anonKey && (auth.includes(anonKey) || apikey === anonKey));
  if (!allowed) {
    console.warn("[process-eval-queue] forbidden call, auth.len=", auth.length, "apikey.len=", apikey.length);
    return json({ error: "Forbidden" }, 403);
  }

  let batch = DEFAULT_BATCH;
  let concurrency = DEFAULT_CONCURRENCY;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.batch === "number") batch = Math.min(Math.max(1, body.batch), 20);
    if (typeof body?.concurrency === "number") concurrency = Math.min(Math.max(1, body.concurrency), 10);
  } catch { /* ignore */ }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: jobs, error } = await admin.rpc("claim_ai_eval_jobs", { _limit: batch });
  if (error) {
    console.error("claim error:", error);
    return json({ error: error.message }, 500);
  }
  const list: Job[] = (jobs as Job[]) ?? [];
  console.log("[process-eval-queue] claimed:", list.length);
  if (list.length === 0) {
    return json({ claimed: 0, results: [] });
  }

  // 并发分组执行
  const results: any[] = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const slice = list.slice(i, i + concurrency);
    const r = await Promise.all(slice.map((j) => runOne(admin, supabaseUrl, serviceKey, j)));
    results.push(...r);
  }

  console.log("[process-eval-queue] done:", JSON.stringify(results.map((x) => ({ id: x.id, ok: x.ok }))));
  return json({ claimed: list.length, results });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}