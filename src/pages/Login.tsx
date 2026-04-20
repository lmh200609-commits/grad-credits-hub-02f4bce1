import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { loginSchema, type LoginInput } from "@/lib/schemas";

const QUICK_ACCOUNTS: { label: string; email: string; role: string }[] = [
  { label: "白雪（学生）", email: "2024001@admin.local", role: "student" },
  { label: "李明（学生）", email: "2024002@admin.local", role: "student" },
  { label: "王芳（学生）", email: "2024003@admin.local", role: "student" },
  { label: "张老师（教师）", email: "T001@admin.local", role: "teacher" },
  { label: "测试管理员", email: "A001@admin.local", role: "admin" },
];
const QUICK_PASSWORD = "Test1234";

const Login = () => {
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [quickBusy, setQuickBusy] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  const onSubmit = async (values: LoginInput) => {
    setSubmitting(true);
    const { error } = await signIn(values.email, values.password);
    setSubmitting(false);
    if (error) {
      toast({
        title: "登录失败",
        description: "邮箱或密码错误，或该账号未被管理员导入。",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "登录成功" });
    navigate("/", { replace: true });
  };

  const quickLogin = async (email: string) => {
    setQuickBusy(email);
    const { error } = await signIn(email, QUICK_PASSWORD);
    setQuickBusy(null);
    if (error) {
      toast({ title: "快捷登录失败", description: "请稍后再试或联系管理员", variant: "destructive" });
      return;
    }
    navigate("/", { replace: true });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">学分认证系统</CardTitle>
          <CardDescription>请使用管理员分配的账号登录</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email")} aria-invalid={!!errors.email} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input id="password" type="password" autoComplete="current-password" {...register("password")} aria-invalid={!!errors.password} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "登录中…" : "登录"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              账号由管理员统一导入，本系统不支持自助注册
            </p>
          </form>

          <div className="border-t pt-4">
            <p className="mb-2 text-center text-xs font-medium text-muted-foreground">
              测试账号一键登录（开发用，密码 {QUICK_PASSWORD}）
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUICK_ACCOUNTS.map((a) => (
                <Button
                  key={a.email}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  disabled={!!quickBusy}
                  onClick={() => quickLogin(a.email)}
                >
                  {quickBusy === a.email ? "登录中…" : a.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
};

export default Login;
