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

const QUICK_ACCOUNTS: { label: string; account: string }[] = [
  { label: "白雪（学生）", account: "2024001" },
  { label: "李明（学生）", account: "2024002" },
  { label: "王芳（学生）", account: "2024003" },
  { label: "张老师（教师）", account: "T001" },
  { label: "测试管理员", account: "A001" },
];

const QUICK_STUDENTS: { label: string; account: string }[] = [
  { label: "赵子轩（学生）", account: "S2024101" },
  { label: "钱思雨（学生）", account: "S2024102" },
  { label: "孙浩然（学生）", account: "S2024103" },
  { label: "周梦琪（学生）", account: "S2024104" },
  { label: "吴佳怡（学生）", account: "S2024105" },
  { label: "郑俊杰（学生）", account: "S2024106" },
  { label: "王雨欣（学生）", account: "S2024107" },
  { label: "冯志强（学生）", account: "S2024108" },
  { label: "陈语桐（学生）", account: "S2024109" },
  { label: "褚思源（学生）", account: "S2024110" },
];
const QUICK_PASSWORD = "Test1234";

const accountToEmail = (account: string) => `${account}@admin.local`;

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
    defaultValues: { account: "", password: "" },
  });

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  const onSubmit = async (values: LoginInput) => {
    setSubmitting(true);
    const { error } = await signIn(accountToEmail(values.account), values.password);
    setSubmitting(false);
    if (error) {
      toast({
        title: "登录失败",
        description: "账号或密码错误，或该账号未被管理员导入。",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "登录成功" });
    navigate("/", { replace: true });
  };

  const quickLogin = async (account: string) => {
    setQuickBusy(account);
    const { error } = await signIn(accountToEmail(account), QUICK_PASSWORD);
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
              <Label htmlFor="account">账号</Label>
              <Input
                id="account"
                type="text"
                inputMode="numeric"
                autoComplete="username"
                placeholder="学号 / 工号 / 手机号"
                {...register("account")}
                aria-invalid={!!errors.account}
              />
              {errors.account && <p className="text-xs text-destructive">{errors.account.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register("password")}
                aria-invalid={!!errors.password}
              />
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
                  key={a.account}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  disabled={!!quickBusy}
                  onClick={() => quickLogin(a.account)}
                >
                  {quickBusy === a.account ? "登录中…" : a.label}
                </Button>
              ))}
            </div>

            <p className="mt-4 mb-2 text-center text-xs font-medium text-muted-foreground">
              更多学生测试账号（共 10 个）
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUICK_STUDENTS.map((a) => (
                <Button
                  key={a.account}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  disabled={!!quickBusy}
                  onClick={() => quickLogin(a.account)}
                >
                  {quickBusy === a.account ? "登录中…" : a.label}
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
