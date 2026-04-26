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
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, RotateCw, AlertCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

type AccountStatus = "ready" | "pending" | "failed";
type AccountInfo = { status: AccountStatus; reason?: string };

const humanizeReason = (raw: string): string => {
  const s = raw.toLowerCase();
  if (s.includes("already") && (s.includes("registered") || s.includes("exists") || s.includes("user"))) {
    return "邮箱已注册（auth.users 中已存在同邮箱）";
  }
  if (s.includes("not allowed") || s.includes("forbidden") || s.includes("permission") || s.includes("unauthorized")) {
    return "权限不足（service_role 未生效或被拒绝）";
  }
  if (s.includes("rate limit") || s.includes("too many")) return "触发频率限制，请稍后重试";
  if (s.includes("invalid") && s.includes("email")) return "邮箱格式无效";
  if (s.includes("password")) return "密码不符合策略";
  if (s.includes("network") || s.includes("fetch") || s.includes("timeout")) return "网络/超时错误";
  return `创建流程错误：${raw.replace(/^create failed:\s*/i, "")}`;
};

const Login = () => {
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [quickBusy, setQuickBusy] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AccountInfo>>({});
  const [checking, setChecking] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

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
    let { error } = await signIn(accountToEmail(account), QUICK_PASSWORD);

    // 账号不存在/密码不对 → 自动调 dev-seed 补齐后重试一次
    if (error) {
      toast({ title: "账号未就绪，正在自动补齐…", description: account });
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("dev-seed", { body: {} });
        if (fnErr) throw fnErr;
        const results: { email: string; status: string }[] = data?.results ?? [];
        const map = buildStatusMap(results);
        setStatuses(map);
        if (map[account]?.status !== "ready") {
          throw new Error("账号补齐失败，请稍后再试");
        }
        ({ error } = await signIn(accountToEmail(account), QUICK_PASSWORD));
      } catch (e) {
        setQuickBusy(null);
        toast({
          title: "快捷登录失败",
          description: (e as Error).message ?? "无法自动补齐账号",
          variant: "destructive",
        });
        return;
      }
    }

    setQuickBusy(null);
    if (error) {
      toast({ title: "快捷登录失败", description: "请稍后再试或联系管理员", variant: "destructive" });
      return;
    }
    navigate("/", { replace: true });
  };

  const buildStatusMap = (results: { email: string; status: string }[]): Record<string, AccountInfo> => {
    const map: Record<string, AccountInfo> = {};
    for (const a of [...QUICK_ACCOUNTS, ...QUICK_STUDENTS]) {
      const r = results.find((x) => x.email === accountToEmail(a.account));
      if (!r) {
        map[a.account] = { status: "pending", reason: "dev-seed 未返回该账号（可能函数版本未更新）" };
      } else if (r.status.startsWith("create failed")) {
        map[a.account] = { status: "failed", reason: humanizeReason(r.status) };
      } else {
        map[a.account] = { status: "ready" };
      }
    }
    return map;
  };

  const checkAccounts = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("dev-seed", { body: {} });
      if (error) throw error;
      const results: { email: string; status: string }[] = data?.results ?? [];
      const map = buildStatusMap(results);
      setStatuses(map);
      const all = [...QUICK_ACCOUNTS, ...QUICK_STUDENTS];
      const ready = Object.values(map).filter((s) => s.status === "ready").length;
      toast({ title: "检查完成", description: `${ready}/${all.length} 个账号已就绪` });
    } catch (e) {
      toast({
        title: "检查失败",
        description: (e as Error).message ?? "无法连接到 dev-seed 服务",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  const retryOne = async (account: string) => {
    setRetrying(account);
    try {
      const { data, error } = await supabase.functions.invoke("dev-seed", { body: {} });
      if (error) throw error;
      const results: { email: string; status: string }[] = data?.results ?? [];
      const map = buildStatusMap(results);
      setStatuses(map);
      const info = map[account];
      if (info?.status === "ready") {
        toast({ title: "重试成功", description: `${account} 已就绪` });
      } else {
        toast({
          title: "重试仍失败",
          description: info?.reason ?? "未知原因",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "重试失败",
        description: (e as Error).message ?? "无法连接到 dev-seed 服务",
        variant: "destructive",
      });
    } finally {
      setRetrying(null);
    }
  };

  const renderStatusBadge = (account: string) => {
    const info = statuses[account];
    if (!info) return null;
    const cfgMap = {
      ready: { label: "已就绪", variant: "default" as const },
      pending: { label: "待创建", variant: "secondary" as const },
      failed: { label: "失败", variant: "destructive" as const },
    };
    const cfg = cfgMap[info.status];
    if (info.status !== "failed") {
      return (
        <Badge variant={cfg.variant} className="ml-auto h-4 px-1.5 text-[10px]">
          {cfg.label}
        </Badge>
      );
    }
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={cfg.variant} className="ml-auto h-4 gap-0.5 px-1.5 text-[10px]">
              <AlertCircle className="h-2.5 w-2.5" />
              {cfg.label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs">
            {info.reason ?? "未知原因"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const renderAccountRow = (a: { label: string; account: string }) => {
    const info = statuses[a.account];
    const isFailed = info?.status === "failed";
    return (
      <div key={a.account} className="space-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start"
          disabled={!!quickBusy}
          onClick={() => quickLogin(a.account)}
        >
          <span className="truncate">{quickBusy === a.account ? "登录中…" : a.label}</span>
          {renderStatusBadge(a.account)}
        </Button>
        {isFailed && (
          <div className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/5 px-1.5 py-1">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
            <p className="flex-1 text-[10px] leading-tight text-destructive">{info?.reason}</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[10px]"
              disabled={retrying === a.account}
              onClick={() => retryOne(a.account)}
            >
              <RotateCw className={`mr-1 h-2.5 w-2.5 ${retrying === a.account ? "animate-spin" : ""}`} />
              {retrying === a.account ? "重试中…" : "重试创建"}
            </Button>
          </div>
        )}
      </div>
    );
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mb-3 w-full"
              disabled={checking}
              onClick={checkAccounts}
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
              {checking ? "检查中…（同时创建缺失账号）" : "检查账号是否已创建"}
            </Button>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUICK_ACCOUNTS.map(renderAccountRow)}
            </div>

            <p className="mt-4 mb-2 text-center text-xs font-medium text-muted-foreground">
              更多学生测试账号（共 10 个）
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUICK_STUDENTS.map(renderAccountRow)}
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
};

export default Login;
