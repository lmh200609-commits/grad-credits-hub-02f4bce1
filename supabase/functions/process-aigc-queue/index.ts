// AIGC 鉴别队列 worker。仿 process-eval-queue：service-role only，批量领任务并发执行。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const DEFAULT_BATCH = 5;
const DEFAULT_CONCURRENCY = 3;
const PER_JOB_TIMEOUT_MS = 30_000;

type Job = { id: string; application_id: string; attempts: number };

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function runOne(admin: ReturnType<typeof createClient>, supaUrl: string, key: string, job: Job) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_JOB_TIMEOUT_MS);
  try {
    const resp = await fetch(`${supaUrl}/functions/v1/aigc-detect`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ application_id: job.application_id }),
    });
    clearTimeout(t);
    if (!resp.ok) {
      const txt = (await resp.text()).slice(0, 400);
      await admin.rpc("mark_aigc_failed", { _id: job.id, _error: `HTTP ${resp.status}: ${txt}` });
      return { id: job.id, ok: false, error: txt };
    }
    await resp.text();
    await admin.rpc("mark_aigc_done", { _id: job.id });
    return { id: job.id, ok: true };
  } catch (e) {
    clearTimeout(t);
    const msg = (e as Error).message ?? String(e);
    await admin.rpc("mark_aigc_failed", { _id: job.id, _error: msg });
    return { id: job.id, ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  let allowed = auth.includes(key);
  if (!allowed && auth.startsWith("Bearer ")) {
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const uid = userData?.user?.id;
    if (uid) {
      const adminCheck = createClient(supaUrl, key);
      const { data: roles } = await adminCheck
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .eq("role", "super_admin")
        .limit(1);
      allowed = !!(roles && roles.length > 0);
    }
  }
  if (!allowed) return json({ error: "Forbidden" }, 403);

  let batch = DEFAULT_BATCH, concurrency = DEFAULT_CONCURRENCY;
  try {
    const b = await req.json().catch(() => ({}));
    if (typeof b?.batch === "number") batch = Math.min(Math.max(1, b.batch), 20);
    if (typeof b?.concurrency === "number") concurrency = Math.min(Math.max(1, b.concurrency), 10);
  } catch {}

  const admin = createClient(supaUrl, key);
  const { data: jobs, error } = await admin.rpc("claim_aigc_jobs", { _limit: batch });
  if (error) return json({ error: error.message }, 500);
  const list: Job[] = (jobs as Job[]) ?? [];
  if (list.length === 0) return json({ claimed: 0, results: [] });

  const results: any[] = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const slice = list.slice(i, i + concurrency);
    const r = await Promise.all(slice.map((j) => runOne(admin, supaUrl, key, j)));
    results.push(...r);
  }
  return json({ claimed: list.length, results });
});