import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload } from "lucide-react";

const Index = () => {
  const { user, roles, signOut, hasRole } = useAuth();
  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">学分认证系统</h1>
            <p className="text-sm text-muted-foreground">
              欢迎，{user?.email} · 角色：{roles.length ? roles.join(", ") : "未分配"}
            </p>
          </div>
          <Button variant="outline" onClick={signOut}>退出登录</Button>
        </header>

        {hasRole("admin") && (
          <section className="grid gap-4 md:grid-cols-2">
            <Card className="cursor-pointer transition hover:border-primary" onClick={() => navigate("/admin/import")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" /> 批量导入账号
                </CardTitle>
                <CardDescription>通过 CSV 一次性导入教师与学生</CardDescription>
              </CardHeader>
              <CardContent>
                <Button>进入</Button>
              </CardContent>
            </Card>
          </section>
        )}

        {!hasRole("admin") && (
          <section className="rounded-lg border bg-card p-6 text-card-foreground">
            <h2 className="mb-2 text-lg font-semibold">欢迎</h2>
            <p className="text-sm text-muted-foreground">
              当前阶段尚未为你的角色配置工作台，敬请期待后续功能。
            </p>
          </section>
        )}
      </div>
    </main>
  );
};

export default Index;
