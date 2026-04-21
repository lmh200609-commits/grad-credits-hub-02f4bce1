import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import AiAssistant from "@/components/AiAssistant";
import {
  LayoutDashboard, Upload, BookOpen, ClipboardCheck, FileText, Library, LogOut,
  Users, BarChart3, Trophy, UserCog, Inbox, Send,
} from "lucide-react";

type Item = { title: string; url: string; icon: typeof LayoutDashboard };

const adminItems: Item[] = [
  { title: "数据看板", url: "/admin/dashboard", icon: BarChart3 },
  { title: "复核中心", url: "/admin/review", icon: Inbox },
  { title: "全部审核", url: "/reviews", icon: ClipboardCheck },
  { title: "学分排名", url: "/admin/credits", icon: Trophy },
  { title: "规则库", url: "/admin/rules", icon: BookOpen },
  { title: "案例库", url: "/admin/cases", icon: Library },
  { title: "学生管理", url: "/admin/users/students", icon: Users },
  { title: "教师管理", url: "/admin/users/teachers", icon: UserCog },
  { title: "批量导入账号", url: "/admin/import", icon: Upload },
];

const teacherItems: Item[] = [
  { title: "工作台", url: "/", icon: LayoutDashboard },
  { title: "待审核", url: "/reviews", icon: ClipboardCheck },
  { title: "学生管理", url: "/teacher/students", icon: Users },
];

const studentItems: Item[] = [
  { title: "工作台", url: "/", icon: LayoutDashboard },
  { title: "申请学分", url: "/apply", icon: Send },
  { title: "我的申请", url: "/my-applications", icon: FileText },
];

const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { hasRole } = useAuth();
  const items = hasRole("admin") ? adminItems : hasRole("teacher") ? teacherItems : studentItems;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>导航</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => (
                <SidebarMenuItem key={it.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={it.url}
                      end
                      className={({ isActive }) =>
                        `flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted ${isActive ? "bg-muted font-medium text-primary" : ""}`
                      }
                    >
                      <it.icon className="h-4 w-4" />
                      {!collapsed && <span>{it.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
};

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { user, roles, signOut, hasRole } = useAuth();
  const navigate = useNavigate();
  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };
  const account = user?.email?.split("@")[0] ?? "";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-2 border-b bg-background px-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <SidebarTrigger />
              <span className="truncate font-semibold">学分认证系统</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden max-w-[40vw] truncate text-muted-foreground md:inline">
                {account} · {roles.join(", ") || "未分配"}
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
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
