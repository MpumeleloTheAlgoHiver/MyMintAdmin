import { useEffect, useState } from "react";
import { Users, ShieldCheck, UserCheck, Clock } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api";

/* REFERENCE PAGE — the pattern Fable should follow for every other CRM page:
   1. Fetch from the EXISTING api/* function (here /api/team?action=list).
   2. Page anatomy: h1 + muted subtitle -> StatCard KPI grid -> Card + table.
   3. WN design vocabulary: uppercase muted column headers, divide-y rows,
      hover:bg-secondary/50, semantic tinted Badges, tokens (no hardcoded colors). */

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "staff";
  page_access: string[];
  status: string;
  last_sign_in_at: string | null;
}

const roleBadge: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  staff: "bg-secondary text-secondary-foreground",
};
const statusBadge: Record<string, string> = {
  active: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
};

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export default function Team() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet("/api/team?action=list");
        if (res?.ok) setMembers(res.members || []);
        else setError(res?.error || "Failed to load team");
      } catch (e: any) {
        setError(e?.message || "Failed to load team");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const admins = members.filter((m) => m.role === "admin").length;
  const active = members.filter((m) => m.status === "active").length;
  const pending = members.filter((m) => m.status === "pending").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Admin team members and page access</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Members" value={members.length.toString()} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Admins" value={admins.toString()} icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard label="Active" value={active.toString()} icon={<UserCheck className="h-4 w-4" />} />
        <StatCard label="Pending" value={pending.toString()} subtitle="invites" icon={<Clock className="h-4 w-4" />} />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading team…</div>
          ) : error ? (
            <div className="p-10 text-center text-sm text-destructive">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Member</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Role</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Page Access</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Status</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Last Sign-in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((m) => (
                    <tr key={m.id} className="hover:bg-secondary/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium">{m.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </td>
                      <td className="text-center px-6 py-4">
                        <Badge variant="secondary" className={cn("text-[10px] capitalize", roleBadge[m.role])}>{m.role}</Badge>
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground">
                        {m.role === "admin" ? "All pages" : (m.page_access?.length ? m.page_access.join(", ") : "—")}
                      </td>
                      <td className="text-center px-6 py-4">
                        <Badge variant="secondary" className={cn("text-[10px] capitalize", statusBadge[m.status] || "bg-secondary text-secondary-foreground")}>{m.status}</Badge>
                      </td>
                      <td className="text-right px-6 py-4 text-sm text-muted-foreground">{fmtDate(m.last_sign_in_at)}</td>
                    </tr>
                  ))}
                  {members.length === 0 && (
                    <tr><td colSpan={5} className="p-10 text-center text-sm text-muted-foreground">No team members.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
