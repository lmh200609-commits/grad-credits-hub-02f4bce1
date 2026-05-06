// Super-admin only: create a new college admin account.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

    const { data: superRow } = await admin.from("user_roles")
      .select("role").eq("user_id", callerId).eq("role", "super_admin").maybeSingle();
    if (!superRow) return json({ error: "Forbidden: super_admin only" }, 403);

    const body = await req.json();
    const { email, password, full_name, college_id } = body as {
      email: string; password: string; full_name: string; college_id: string;
    };
    if (!email || !password || password.length < 6 || !full_name || !college_id) {
      return json({ error: "缺少必填字段（email/password/full_name/college_id）" }, 400);
    }

    const { data: c } = await admin.from("colleges").select("id").eq("id", college_id).maybeSingle();
    if (!c) return json({ error: "学院不存在" }, 400);

    // Pre-check: account (email) already taken?
    {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const exists = list?.users?.some((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
      if (exists) return json({ error: `该账号已存在：${email.split("@")[0]}` }, 400);
    }

    const { data: u, error: ce } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name },
    });
    if (ce) {
      const msg = ce.message || "";
      if (/already|registered|exists/i.test(msg)) {
        return json({ error: `该账号已存在：${email.split("@")[0]}` }, 400);
      }
      return json({ error: `创建账号失败: ${msg}` }, 400);
    }
    const uid = u.user!.id;

    await admin.from("profiles").update({
      full_name, email, college_id,
    }).eq("user_id", uid);

    const { error: re } = await admin.from("user_roles")
      .insert({ user_id: uid, role: "admin", college_id });
    if (re) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
      return json({ error: `分配角色失败: ${re.message}` }, 500);
    }

    return json({ success: true, user_id: uid });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});