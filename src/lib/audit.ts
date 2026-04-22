import { supabase } from "@/integrations/supabase/client";

export type AuditAction =
  | "delete_user"
  | "role_change"
  | "rule_create"
  | "rule_update"
  | "rule_delete"
  | "keyword_create"
  | "keyword_delete";

export type AuditPayload = {
  action: AuditAction;
  target_ids?: string[];
  target_labels?: string[];
  affected_count?: number;
  success_count?: number;
  failure_count?: number;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Best-effort audit log writer. Failures are swallowed so they
 * never break the main user-facing operation.
 */
export async function writeAuditLog(payload: AuditPayload): Promise<void> {
  try {
    await supabase.functions.invoke("audit-log", { body: payload });
  } catch {
    // intentionally ignored
  }
}