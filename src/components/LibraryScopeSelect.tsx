import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export type LibraryScope = "template" | string; // "template" = NULL (总库), otherwise college uuid

type College = { id: string; name: string; short_name: string | null };

const STORAGE_KEY = "lib_scope_v1";

export function useLibraryScope(storageKey = STORAGE_KEY) {
  const { isSuperAdmin, collegeId, loading } = useAuth();
  const [scope, setScopeState] = useState<LibraryScope | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!isSuperAdmin) {
      setScopeState(collegeId ?? "template");
      return;
    }
    const saved = sessionStorage.getItem(storageKey);
    setScopeState(saved ?? "template");
  }, [isSuperAdmin, collegeId, loading, storageKey]);

  const setScope = (s: LibraryScope) => {
    setScopeState(s);
    if (isSuperAdmin) sessionStorage.setItem(storageKey, s);
  };

  return { scope, setScope, isSuperAdmin, ownCollegeId: collegeId, ready: !loading && scope !== null };
}

// Apply scope filter to a supabase query builder
export function applyScope<T>(q: T, scope: LibraryScope | null): T {
  if (!scope) return q;
  // @ts-expect-error - dynamic supabase query builder
  return scope === "template" ? q.is("college_id", null) : q.eq("college_id", scope);
}

// Get the college_id value to write for inserts under the current scope
export function scopeWriteCollegeId(scope: LibraryScope | null): string | null {
  if (!scope) return null;
  return scope === "template" ? null : scope;
}

export default function LibraryScopeSelect({
  storageKey,
}: {
  storageKey?: string;
}) {
  const { scope, setScope, isSuperAdmin, ownCollegeId } = useLibraryScope(storageKey);
  const [colleges, setColleges] = useState<College[]>([]);
  const [ownName, setOwnName] = useState<string>("");

  useEffect(() => {
    supabase
      .from("colleges")
      .select("id, name, short_name")
      .eq("active", true)
      .order("name")
      .then(({ data }) => {
        const list = (data as College[]) ?? [];
        setColleges(list);
        if (!isSuperAdmin && ownCollegeId) {
          setOwnName(list.find((c) => c.id === ownCollegeId)?.short_name
            ?? list.find((c) => c.id === ownCollegeId)?.name
            ?? "本学院");
        }
      });
  }, [isSuperAdmin, ownCollegeId]);

  if (!isSuperAdmin) {
    return (
      <Badge variant="secondary" className="font-normal">
        当前学院：{ownName || "—"}
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">查看范围</span>
      <Select value={scope ?? "template"} onValueChange={(v) => setScope(v)}>
        <SelectTrigger className="h-8 w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="template">总库（模板）</SelectItem>
          {colleges.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.short_name ?? c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}