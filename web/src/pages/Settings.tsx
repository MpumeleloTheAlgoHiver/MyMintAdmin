import { Link } from "react-router-dom";
import { UserCog, SlidersHorizontal, ShieldCheck, ChevronRight, LogOut } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";

/* Ported from public/settings.html — account + admin section. */
export default function Settings() {
  const { member, signOut } = useAuth();
  const isAdmin = member?.role === "admin";

  const adminRows = [
    { to: "/app-settings", icon: SlidersHorizontal, label: "App Settings", sub: "Platform fees & configuration" },
    { to: "/team", icon: UserCog, label: "Team", sub: "Manage admin team members and page access" },
    { to: "/compliance", icon: ShieldCheck, label: "Cyber Compliance", sub: "Platform health & incidents" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your account and platform administration</p>
      </div>

      <Card>
        <CardContent className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
              {(member?.full_name || member?.email || "A")[0].toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold">{member?.full_name || member?.email || "Admin"}</p>
              <p className="text-xs text-muted-foreground">{member?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="capitalize">{member?.role || "staff"}</Badge>
            <Button variant="outline" size="sm" className="gap-2" onClick={signOut}><LogOut className="h-4 w-4" />Sign out</Button>
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Admin</p>
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {adminRows.map((r) => (
                <Link key={r.to} to={r.to} className="flex items-center gap-4 px-6 py-4 hover:bg-secondary/50 transition-colors">
                  <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground"><r.icon className="h-4 w-4" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.sub}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
