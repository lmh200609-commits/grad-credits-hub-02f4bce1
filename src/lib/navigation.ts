import {
  LayoutDashboard, Upload, BookOpen, ClipboardCheck, FileText, Library,
  Users, BarChart3, Trophy, UserCog, Inbox, Send, ScrollText, Tags,
} from "lucide-react";
import type { ComponentType } from "react";

export type NavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Extra path prefixes that should also mark this item as active. */
  matchPrefixes?: string[];
};

export const adminItems: NavItem[] = [
  { title: "数据看板", url: "/admin/dashboard", icon: BarChart3 },
  { title: "复核中心", url: "/admin/review", icon: Inbox, matchPrefixes: ["/applications/"] },
  { title: "全部审核", url: "/reviews", icon: ClipboardCheck },
  { title: "学分排名", url: "/admin/credits", icon: Trophy },
  { title: "规则库", url: "/admin/rules", icon: BookOpen },
  { title: "关键词库", url: "/admin/keywords", icon: Tags },
  { title: "案例库", url: "/admin/cases", icon: Library },
  { title: "学生管理", url: "/admin/users/students", icon: Users, matchPrefixes: ["/teacher/students"] },
  { title: "教师管理", url: "/admin/users/teachers", icon: UserCog },
  { title: "批量导入账号", url: "/admin/import", icon: Upload },
  { title: "审计日志", url: "/admin/audit-logs", icon: ScrollText },
];

export const teacherItems: NavItem[] = [
  { title: "工作台", url: "/", icon: LayoutDashboard },
  { title: "待审核", url: "/reviews", icon: ClipboardCheck, matchPrefixes: ["/applications/"] },
  { title: "学生管理", url: "/teacher/students", icon: Users },
];

export const studentItems: NavItem[] = [
  { title: "工作台", url: "/", icon: LayoutDashboard },
  { title: "申请学分", url: "/apply", icon: Send },
  { title: "我的申请", url: "/my-applications", icon: FileText, matchPrefixes: ["/applications/"] },
];

export const getNavItems = (opts: { isAdmin: boolean; isTeacher: boolean }): NavItem[] => {
  if (opts.isAdmin) return adminItems;
  if (opts.isTeacher) return teacherItems;
  return studentItems;
};

/** Returns true if `pathname` is considered "inside" the given menu item. */
export const isItemActive = (pathname: string, item: NavItem): boolean => {
  if (item.url === "/") return pathname === "/";
  if (pathname === item.url) return true;
  if (pathname.startsWith(item.url + "/")) return true;
  if (item.matchPrefixes?.some((p) => pathname === p || pathname.startsWith(p))) return true;
  return false;
};

/** Pick the most specific active item (longest matching url wins). */
export const getActiveItem = (pathname: string, items: NavItem[]): NavItem | undefined => {
  const matches = items.filter((it) => isItemActive(pathname, it));
  if (matches.length === 0) return undefined;
  return matches.sort((a, b) => b.url.length - a.url.length)[0];
};

/** Human title for the current page; falls back to a friendly default. */
export const getPageTitle = (pathname: string, items: NavItem[]): string => {
  const active = getActiveItem(pathname, items);
  if (active) {
    // Detail sub-page (e.g. /applications/:id under "复核中心" / "我的申请")
    if (pathname !== active.url && !active.matchPrefixes?.includes(pathname)) {
      return `${active.title} / 详情`;
    }
    return active.title;
  }
  return "";
};
