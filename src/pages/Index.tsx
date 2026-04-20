import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const Index = () => {
  const { user, roles, signOut } = useAuth();

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">学分认证系统</h1>
            <p className="text-sm text-muted-foreground">
              欢迎，{user?.email} · 角色：{roles.length ? roles.join(", ") : "未分配"}
            </p>
          </div>
          <Button variant="outline" onClick={signOut}>退出登录</Button>
        </header>
        <section className="rounded-lg border bg-card p-6 text-card-foreground">
          <h2 className="mb-2 text-lg font-semibold">第一阶段已完成</h2>
          <p className="text-sm text-muted-foreground">
            登录骨架、角色体系（admin/teacher/student）与权限校验函数已就绪。
            下一阶段将接入管理员账号导入与各角色工作台。
          </p>
        </section>
      </div>
    </main>
  );
};

export default Index;
