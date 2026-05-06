import { ReactNode } from "react";
import { NavLink, useNavigate, useLocation, matchPath } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCollegeTheme } from "@/hooks/useCollegeTheme";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import AiAssistant from "@/components/AiAssistant";
import StaffAiAssistant from "@/components/StaffAiAssistant";
import {
  LayoutDashboard, Upload, BookOpen, ClipboardCheck, FileText, Library, LogOut,
  Users, BarChart3, Trophy, UserCog, Inbox, Send, ScrollText, Tags, History, Cpu, IdCard,
  Activity, Palette, Building2, Shield,
} from "lucide-react";

type Item = { title: string; url: string; icon: typeof LayoutDashboard };

const adminItems: Item[] = [
  { title: "数据看板", url: "/admin/dashboard", icon: BarChart3 },
  { title: "复核中心", url: "/admin/review", icon: Inbox },
  { title: "全部审核", url: "/reviews", icon: ClipboardCheck },
  { title: "提交记录", url: "/submissions", icon: History },
  { title: "学分排名", url: "/admin/credits", icon: Trophy },
  { title: "规则库", url: "/admin/rules", icon: BookOpen },
  { title: "关键词库", url: "/admin/keywords", icon: Tags },
  { title: "案例库", url: "/admin/cases", icon: Library },
  { title: "学生管理", url: "/admin/users/students", icon: Users },
  { title: "教师管理", url: "/admin/users/teachers", icon: UserCog },
  { title: "批量导入账号", url: "/admin/import", icon: Upload },
  { title: "AI 模型设置", url: "/admin/ai-models", icon: Cpu },
  { title: "审计日志", url: "/admin/audit-logs", icon: ScrollText },
  { title: "学院品牌主题", url: "/admin/branding", icon: Palette },
  { title: "实时一致性", url: "/diagnostics/realtime", icon: Activity },
];

const superAdminItems: Item[] = [
  { title: "学院管理", url: "/super/colleges", icon: Building2 },
  { title: "学院管理员", url: "/super/admins", icon: Shield },
  { title: "数据看板", url: "/admin/dashboard", icon: BarChart3 },
  { title: "复核中心", url: "/admin/review", icon: Inbox },
  { title: "全部审核", url: "/reviews", icon: ClipboardCheck },
  { title: "提交记录", url: "/submissions", icon: History },
  { title: "学分排名", url: "/admin/credits", icon: Trophy },
  { title: "规则库", url: "/admin/rules", icon: BookOpen },
  { title: "关键词库", url: "/admin/keywords", icon: Tags },
  { title: "案例库", url: "/admin/cases", icon: Library },
  { title: "学生管理", url: "/admin/users/students", icon: Users },
  { title: "教师管理", url: "/admin/users/teachers", icon: UserCog },
  { title: "批量导入账号", url: "/admin/import", icon: Upload },
  { title: "AI 模型设置", url: "/admin/ai-models", icon: Cpu },
  { title: "审计日志", url: "/admin/audit-logs", icon: ScrollText },
  { title: "实时一致性", url: "/diagnostics/realtime", icon: Activity },
];

const teacherItems: Item[] = [
  { title: "数据看板", url: "/teacher/dashboard", icon: BarChart3 },
  { title: "待审核", url: "/reviews", icon: ClipboardCheck },
  { title: "提交记录", url: "/submissions", icon: History },
  { title: "学分排名", url: "/teacher/credits", icon: Trophy },
  { title: "学生管理", url: "/teacher/students", icon: Users },
  { title: "实时一致性", url: "/diagnostics/realtime", icon: Activity },
];

const studentItems: Item[] = [
  { title: "工作台", url: "/", icon: LayoutDashboard },
  { title: "申请学分", url: "/apply", icon: Send },
  { title: "我的申请", url: "/my-applications", icon: FileText },
  { title: "我的档案", url: "/profile", icon: IdCard },
  { title: "实时一致性", url: "/diagnostics/realtime", icon: Activity },
];

// Extra routes (detail pages, shared routes) for header title lookup only
const extraTitles: { pattern: string; title: string }[] = [
  { pattern: "/applications/:id", title: "申请详情" },
  { pattern: "/admin/users/students/:id", title: "学生详情" },
  { pattern: "/admin/users/teachers/:id", title: "教师详情" },
  { pattern: "/teacher/students/:id", title: "学生详情" },
];

const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { hasRole, isSuperAdmin } = useAuth();
  const location = useLocation();
  const items = isSuperAdmin
    ? superAdminItems
    : hasRole("admin") ? adminItems
    : hasRole("teacher") ? teacherItems
    : studentItems;

  const isItemActive = (url: string) =>
    url === "/"
      ? location.pathname === "/"
      : location.pathname === url || location.pathname.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="h-full">
        <SidebarGroup className="flex h-full flex-col">
          <SidebarGroupLabel>导航</SidebarGroupLabel>
          <SidebarGroupContent className="flex-1">
            <SidebarMenu className="flex h-full flex-col justify-between gap-1">
              {items.map((it) => {
                const active = isItemActive(it.url);
                return (
                  <SidebarMenuItem key={it.url} className="flex-1">
                    <SidebarMenuButton asChild tooltip={it.title}>
                      <NavLink
                        to={it.url}
                        end={it.url === "/"}
                        className={
                          `relative flex h-full min-h-[2.25rem] w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                            active
                              ? "bg-primary/15 font-medium text-primary hover:bg-primary/15 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r before:bg-primary"
                              : ""
                          }`
                        }
                      >
                        <it.icon
                          className={`h-4 w-4 shrink-0 ${active ? "text-primary" : ""}`}
                          strokeWidth={1.75}
                        />
                        {!collapsed && <span className="truncate">{it.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
};

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { user, roles, signOut, hasRole } = useAuth();
  const college = useCollegeTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };
  const roleLabel = roles.includes("super_admin") ? "超级管理员"
    : roles.includes("admin") ? "学院管理员"
    : roles.includes("teacher") ? "教师"
    : roles.includes("student") ? "学生"
    : "未分配";

  const allMenuItems = [...superAdminItems, ...adminItems, ...teacherItems, ...studentItems];
  const currentTitle =
    allMenuItems.find((it) =>
      it.url === "/"
        ? location.pathname === "/"
        : location.pathname === it.url || location.pathname.startsWith(it.url + "/"),
    )?.title ??
    extraTitles.find((e) => matchPath({ path: e.pattern, end: true }, location.pathname))?.title ??
    "";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-2 border-b bg-background px-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <SidebarTrigger />
              {college?.badge_url && (
                <img src={college.badge_url} alt="" className="h-7 w-7 rounded object-contain" />
              )}
              <span className="truncate font-semibold">{college?.system_title ?? "学分认证系统"}</span>
              {currentTitle && (
                <>
                  <span className="hidden text-muted-foreground sm:inline">·</span>
                  <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                    {currentTitle}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden max-w-[40vw] truncate text-muted-foreground md:inline">
                {roleLabel}
              </span>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">退出</span>
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-muted/30 p-3 sm:p-6">{children}</main>
        </div>
        {hasRole("student") && <AiAssistant />}
        {(hasRole("admin") || hasRole("teacher")) && <StaffAiAssistant />}
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
