// Audit log writer: admin-only, best-effort logging for sensitive operations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ACTIONS = new Set([
  "delete_user",
  "role_change",
  "rule_create",
  "rule_update",
  "rule_delete",
]);

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
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden: admin role required" }, 403);

    const body = await req.json();
    const action = String(body.action ?? "");
    if (!ALLOWED_ACTIONS.has(action)) return json({ error: `unsupported action: ${action}` }, 400);

    const targetIds: string[] = Array.isArray(body.target_ids) ? body.target_ids.filter((x: unknown) => typeof x === "string") : [];
    const targetLabels: string[] = Array.isArray(body.target_labels) ? body.target_labels.map(String) : [];
    const affected = Number(body.affected_count ?? targetIds.length ?? 0);
    const success = Number(body.success_count ?? affected);
    const failure = Number(body.failure_count ?? 0);
    const metadata = (body.metadata && typeof body.metadata === "object") ? body.metadata : {};

    const { error } = await admin.from("audit_logs").insert({
      action,
      actor_id: callerId,
      actor_email: callerEmail,
      target_ids: targetIds,
      target_labels: targetLabels,
      affected_count: affected,
      success_count: success,
      failure_count: failure,
      duration_ms: body.duration_ms ?? null,
      metadata,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
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