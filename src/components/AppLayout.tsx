import { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import AiAssistant from "@/components/AiAssistant";
import StaffAiAssistant from "@/components/StaffAiAssistant";
import { LogOut, ChevronRight } from "lucide-react";
import { getNavItems, getPageTitle, isItemActive } from "@/lib/navigation";

const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { hasRole } = useAuth();
  const location = useLocation();
  const items = getNavItems({ isAdmin: hasRole("admin"), isTeacher: hasRole("teacher") });

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="h-full">
        <SidebarGroup className="flex h-full flex-col">
          <SidebarGroupLabel>导航</SidebarGroupLabel>
          <SidebarGroupContent className="flex-1">
            <SidebarMenu className="flex h-full flex-col justify-between gap-1">
              {items.map((it) => {
                const active = isItemActive(location.pathname, it);
                return (
                  <SidebarMenuItem key={it.url} className="flex-1">
                    <SidebarMenuButton asChild tooltip={it.title} isActive={active}>
                      <NavLink
                        to={it.url}
                        aria-current={active ? "page" : undefined}
                        className={`relative flex h-full min-h-[2.25rem] w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground font-semibold shadow-sm hover:bg-primary hover:text-primary-foreground before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:rounded-r before:bg-primary-foreground/80"
                            : "text-sidebar-foreground hover:bg-muted"
                        }`}
                      >
                        <it.icon
                          className={`h-4 w-4 shrink-0 ${active ? "" : ""}`}
                          strokeWidth={active ? 2.25 : 1.75}
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
  const navigate = useNavigate();
  const location = useLocation();
  const items = getNavItems({ isAdmin: hasRole("admin"), isTeacher: hasRole("teacher") });
  const pageTitle = getPageTitle(location.pathname, items);
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
              <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5">
                <span className="hidden truncate font-semibold sm:inline">学分认证系统</span>
                {pageTitle && (
                  <>
                    <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:inline" aria-hidden />
                    <span className="truncate text-sm font-medium text-foreground sm:text-base">
                      {pageTitle}
                    </span>
                  </>
                )}
                {!pageTitle && (
                  <span className="truncate font-semibold sm:hidden">学分认证系统</span>
                )}
              </nav>
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
        {(hasRole("admin") || hasRole("teacher")) && <StaffAiAssistant />}
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
