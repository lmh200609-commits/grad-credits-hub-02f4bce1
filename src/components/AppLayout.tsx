import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Upload, BookOpen, FolderKanban, ClipboardCheck, FileText, Library, LogOut, Users,
} from "lucide-react";

type Item = { title: string; url: string; icon: typeof LayoutDashboard };

const adminItems: Item[] = [
  { title: "工作台", url: "/", icon: LayoutDashboard },
  { title: "批量导入账号", url: "/admin/import", icon: Upload },
  { title: "规则库", url: "/admin/rules", icon: BookOpen },
  { title: "案例库", url: "/admin/cases", icon: Library },
  { title: "项目管理", url: "/projects", icon: FolderKanban },
  { title: "全部审核", url: "/reviews", icon: ClipboardCheck },
  { title: "学生管理", url: "/teacher/students", icon: Users },
];

const teacherItems: Item[] = [
  { title: "工作台", url: "/", icon: LayoutDashboard },
  { title: "我的项目", url: "/projects", icon: FolderKanban },
  { title: "待审核", url: "/reviews", icon: ClipboardCheck },
  { title: "学生管理", url: "/teacher/students", icon: Users },
];

const studentItems: Item[] = [
  { title: "工作台", url: "/", icon: LayoutDashboard },
  { title: "可申请项目", url: "/projects", icon: FolderKanban },
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
  const { user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b bg-background px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <span className="font-semibold">学分认证系统</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {user?.email} · {roles.join(", ") || "未分配"}
              </span>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="mr-1 h-4 w-4" /> 退出
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-muted/30 p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
