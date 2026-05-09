// DESTRUCTIVE admin utility:
//  1) Wipes business data: applications, application_reviews, submission_records, audit_logs
//  2) Deletes ALL non-admin auth users (students + teachers), plus orphan profiles/roles
//  3) Optionally creates a new admin account with random "A"+8-digit account and 12-char strong password
//
// Safety: caller MUST be an existing admin AND must pass body { confirm: "PURGE" }.
// The currently-logged-in admin is ALWAYS skipped from deletion.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function randomDigits(n: number): string {
  let out = "";
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) out += (buf[i] % 10).toString();
  return out;
}

function randomPassword(len = 12): string {
  // No 0/O/1/l/I to avoid confusion
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let pwd = "";
  // ensure at least one of each class
  pwd += upper[buf[0] % upper.length];
  pwd += lower[buf[1] % lower.length];
  pwd += digits[buf[2] % digits.length];
  for (let i = 3; i < len; i++) pwd += all[buf[i] % all.length];
  // shuffle
  const arr = pwd.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = buf[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

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
    const callerEmail = (claims.claims.email as string | undefined) ?? null;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: superRow, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "super_admin")
      .maybeSingle();
    if (roleErr) return json({ error: roleErr.message }, 500);
    if (!superRow) return json({ error: "Forbidden: super_admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "PURGE") {
      return json({ error: 'Confirmation required. Send body { "confirm": "PURGE" }.' }, 400);
    }
    const wantNewAdmin = body?.create_new_admin !== false; // default true

    const t0 = Date.now();
    const stats: Record<string, number> = {};

    // 1) Wipe business tables (order matters: dependent rows first)
    {
      const { count, error } = await admin
        .from("application_reviews").delete({ count: "exact" }).not("id", "is", null);
      if (error) return json({ error: `clear application_reviews failed: ${error.message}` }, 500);
      stats.deleted_reviews = count ?? 0;
    }
    {
      const { count, error } = await admin
        .from("submission_records").delete({ count: "exact" }).not("id", "is", null);
      if (error) return json({ error: `clear submission_records failed: ${error.message}` }, 500);
      stats.deleted_submission_records = count ?? 0;
    }
    {
      const { count, error } = await admin
        .from("applications").delete({ count: "exact" }).not("id", "is", null);
      if (error) return json({ error: `clear applications failed: ${error.message}` }, 500);
      stats.deleted_applications = count ?? 0;
    }
    {
      const { count, error } = await admin
        .from("audit_logs").delete({ count: "exact" }).not("id", "is", null);
      if (error) return json({ error: `clear audit_logs failed: ${error.message}` }, 500);
      stats.deleted_audit_logs = count ?? 0;
    }

    // 2) Delete all non-admin users
    //    - students + teachers via user_roles
    //    - orphan profiles whose user_id has no row in user_roles
    const adminIdSet = new Set<string>();
    {
      const { data: adminRoleRows, error } = await admin
        .from("user_roles").select("user_id").eq("role", "admin");
      if (error) return json({ error: `read admin roles failed: ${error.message}` }, 500);
      (adminRoleRows ?? []).forEach((r) => adminIdSet.add(r.user_id));
    }

    // Page through ALL auth users
    const allAuthUsers: { id: string; email: string | null }[] = [];
    {
      let page = 1;
      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return json({ error: `list users failed: ${error.message}` }, 500);
        const users = data?.users ?? [];
        users.forEach((u) => allAuthUsers.push({ id: u.id, email: u.email ?? null }));
        if (users.length < 1000) break;
        page += 1;
        if (page > 50) break; // safety
      }
    }

    const toDelete = allAuthUsers.filter((u) => u.id !== callerId && !adminIdSet.has(u.id));
    let deletedUsers = 0;
    const deleteFailures: string[] = [];
    const CONCURRENCY = 20;
    for (let i = 0; i < toDelete.length; i += CONCURRENCY) {
      const batch = toDelete.slice(i, i + CONCURRENCY);
      // Best-effort cleanup of FK-ish rows (no FK exists, so manual delete)
      const ids = batch.map((u) => u.id);
      await admin.from("user_roles").delete().in("user_id", ids);
      await admin.from("profiles").delete().in("user_id", ids);
      const settled = await Promise.allSettled(
        batch.map((u) => admin.auth.admin.deleteUser(u.id)),
      );
      settled.forEach((r, j) => {
        if (r.status === "fulfilled") deletedUsers++;
        else deleteFailures.push(`${batch[j].email ?? batch[j].id}: ${String(r.reason).slice(0, 120)}`);
      });
    }
    stats.deleted_users = deletedUsers;

    // Clean orphan profiles (profile rows without auth user OR without role)
    {
      const { data: profs } = await admin.from("profiles").select("user_id");
      const authIds = new Set(allAuthUsers.map((u) => u.id));
      const stillAuthIds = new Set(
        allAuthUsers.filter((u) => !toDelete.find((d) => d.id === u.id)).map((u) => u.id),
      );
      const orphanIds = (profs ?? [])
        .map((p) => p.user_id)
        .filter((id) => !stillAuthIds.has(id) && authIds.has(id) === false);
      if (orphanIds.length > 0) {
        await admin.from("user_roles").delete().in("user_id", orphanIds);
        await admin.from("profiles").delete().in("user_id", orphanIds);
      }
      stats.deleted_orphan_profiles = orphanIds.length;
    }

    // 3) Create a new admin (optional)
    let newAdmin: { account: string; email: string; password: string } | null = null;
    if (wantNewAdmin) {
      // Try up to 5 times to find a non-conflicting account
      for (let attempt = 0; attempt < 5; attempt++) {
        const account = "A" + randomDigits(8);
        const email = `${account}@admin.local`;
        const password = randomPassword(12);
        const { data: existing } = await admin
          .from("profiles").select("user_id").eq("student_no", account).maybeSingle();
        if (existing) continue;
        const { data: u, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: "系统管理员", student_no: account },
        });
        if (error) {
          if (attempt === 4) return json({ error: `create admin failed: ${error.message}` }, 500);
          continue;
        }
        const uid = u.user!.id;
        await admin.from("profiles").update({
          full_name: "系统管理员",
          student_no: account,
          email,
        }).eq("user_id", uid);
        const { error: re } = await admin.from("user_roles").insert({ user_id: uid, role: "admin" });
        if (re) {
          await admin.auth.admin.deleteUser(uid).catch(() => {});
          return json({ error: `assign admin role failed: ${re.message}` }, 500);
        }
        newAdmin = { account, email, password };
        break;
      }
      if (!newAdmin) return json({ error: "could not allocate a unique admin account after 5 tries" }, 500);
    }

    // Audit log (best-effort)
    await admin.from("audit_logs").insert({
      action: "admin_purge_and_bootstrap",
      actor_id: callerId,
      actor_email: callerEmail,
      target_ids: [],
      target_labels: [],
      affected_count: stats.deleted_users + stats.deleted_applications,
      success_count: stats.deleted_users,
      failure_count: deleteFailures.length,
      duration_ms: Date.now() - t0,
      metadata: {
        ...stats,
        new_admin_account: newAdmin?.account ?? null,
        delete_failures_sample: deleteFailures.slice(0, 10),
      },
    }).then(() => {}, () => {});

    return json({
      success: true,
      elapsed_ms: Date.now() - t0,
      ...stats,
      delete_failures_sample: deleteFailures.slice(0, 10),
      new_admin: newAdmin,
      caller_preserved: callerEmail,
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