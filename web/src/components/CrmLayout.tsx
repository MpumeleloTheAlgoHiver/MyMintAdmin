import { ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, BarChart3, FileText, TrendingUp, Landmark,
  Mail, Settings, SlidersHorizontal, UserCog, ShieldCheck, Search, Bell,
  ChevronLeft, ChevronRight, LogOut, Store,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

interface NavItem { label: string; href: string; icon: React.ElementType; adminOnly?: boolean; }
type Section = { title: string; items: NavItem[] };

// Mirrors the existing CRM sidebar sections, mapped to the new React routes.
const SECTIONS: Section[] = [
  { title: "Main", items: [
    { label: "Clients", href: "/", icon: Users },
    { label: "Client View Studio", href: "/studio", icon: Store },
  ]},
  { title: "Investments", items: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Strategies", href: "/strategies", icon: BarChart3 },
    { label: "Factsheets", href: "/factsheets", icon: FileText },
    { label: "Investors", href: "/investors", icon: TrendingUp },
    { label: "Order Book", href: "/orderbook", icon: BarChart3 },
  ]},
  { title: "Banking", items: [
    { label: "EFT Payments", href: "/eft", icon: Landmark },
  ]},
  { title: "Communications", items: [
    { label: "Mint Mornings", href: "/mint-mornings", icon: Mail },
    { label: "Emailers & Triggers", href: "/emailers", icon: Mail },
  ]},
  { title: "System", items: [
    { label: "Settings", href: "/settings", icon: Settings },
    { label: "App Settings", href: "/app-settings", icon: SlidersHorizontal, adminOnly: true },
    { label: "Team", href: "/team", icon: UserCog, adminOnly: true },
    { label: "Cyber Compliance", href: "/compliance", icon: ShieldCheck },
  ]},
];

function initials(name?: string | null, email?: string) {
  if (name) return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (email?.[0] || "A").toUpperCase();
}

export default function CrmLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { member, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = member?.role === "admin";

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={cn("flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200 shrink-0", collapsed ? "w-[68px]" : "w-[240px]")}>
        <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
          <div className="h-8 w-8 rounded-lg bg-sidebar-active flex items-center justify-center text-sidebar-active-foreground font-bold text-sm shrink-0">M</div>
          {!collapsed && (
            <div>
              <p className="text-sm font-semibold text-sidebar-active-foreground">Mint</p>
              <p className="text-[10px] text-sidebar-section uppercase tracking-wider">Admin Panel</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          {SECTIONS.map((section) => {
            const items = section.items.filter((i) => !i.adminOnly || isAdmin);
            if (!items.length) return null;
            return (
              <div key={section.title} className="mb-6">
                {!collapsed && <p className="px-4 mb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-section">{section.title}</p>}
                <nav className="space-y-0.5 px-2">
                  {items.map((item) => {
                    const isActive = location.pathname === item.href || (item.href !== "/" && location.pathname.startsWith(item.href));
                    return (
                      <Link key={item.href} to={item.href}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                          isActive ? "bg-sidebar-active text-sidebar-active-foreground shadow-sm" : "text-sidebar-foreground hover:bg-sidebar-hover"
                        )}>
                        <item.icon className="h-[18px] w-[18px] shrink-0" />
                        {!collapsed && <span className="flex-1">{item.label}</span>}
                      </Link>
                    );
                  })}
                </nav>
              </div>
            );
          })}
        </div>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-sidebar-active/20 flex items-center justify-center text-sidebar-active-foreground text-xs font-semibold shrink-0">
              {initials(member?.full_name, member?.email)}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-sidebar-active-foreground truncate">{member?.full_name || member?.email || "Admin"}</p>
                <p className="text-[10px] text-sidebar-section capitalize">{member?.role || "staff"}</p>
              </div>
            )}
          </div>
          {!collapsed && (
            <button onClick={signOut} className="flex items-center gap-2 mt-3 text-xs text-sidebar-section hover:text-sidebar-active-foreground transition-colors w-full">
              <LogOut className="h-3.5 w-3.5" />Sign out
            </button>
          )}
        </div>

        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center justify-center h-10 border-t border-sidebar-border text-sidebar-section hover:text-sidebar-active-foreground transition-colors">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search..." className="pl-9 h-9 text-sm bg-secondary border-0" />
          </div>
          <Button variant="ghost" size="icon" className="relative h-9 w-9">
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" />
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
