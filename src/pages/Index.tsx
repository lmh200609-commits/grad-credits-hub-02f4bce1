import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderKanban, ClipboardCheck, FileText, BookOpen, Library, Upload } from "lucide-react";

const Index = () => {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ projects: 0, pending: 0, mine: 0 });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [projectsRes, pendingRes, mineRes] = await Promise.all([
        supabase.from("projects").select("id", { count: "exact", head: true }).eq("active", true),
        hasRole("admin") || hasRole("teacher")
          ? supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "pending_review")
          : Promise.resolve({ count: 0 }),
        hasRole("student")
          ? supabase.from("applications").select("id", { count: "exact", head: true }).eq("student_id", user.id)
          : Promise.resolve({ count: 0 }),
      ]);
      setStats({
        projects: projectsRes.count ?? 0,
        pending: (pendingRes as any).count ?? 0,
        mine: (mineRes as any).count ?? 0,
      });
    })();
  }, [user, hasRole]);

  const cards = [
    hasRole("admin") && { title: "批量导入账号", desc: "CSV 一键导入师生", icon: Upload, to: "/admin/import" },
    hasRole("admin") && { title: "规则库", desc: "维护学分认证规则", icon: BookOpen, to: "/admin/rules" },
    hasRole("admin") && { title: "案例库", desc: "维护历史认证案例", icon: Library, to: "/admin/cases" },
    (hasRole("admin") || hasRole("teacher")) && { title: "项目管理", desc: `共 ${stats.projects} 个激活项目`, icon: FolderKanban, to: "/projects" },
    (hasRole("admin") || hasRole("teacher")) && { title: "待审核申请", desc: `${stats.pending} 条待复核`, icon: ClipboardCheck, to: "/reviews" },
    hasRole("student") && { title: "可申请项目", desc: `共 ${stats.projects} 个开放项目`, icon: FolderKanban, to: "/projects" },
    hasRole("student") && { title: "我的申请", desc: `共 ${stats.mine} 条`, icon: FileText, to: "/my-applications" },
  ].filter(Boolean) as { title: string; desc: string; icon: any; to: string }[];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">工作台</h1>
          <p className="text-sm text-muted-foreground">欢迎回来，{user?.email}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Card
              key={c.to}
              className="cursor-pointer transition hover:border-primary"
              onClick={() => navigate(c.to)}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <c.icon className="h-5 w-5 text-primary" /> {c.title}
                </CardTitle>
                <CardDescription>{c.desc}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

export default Index;
