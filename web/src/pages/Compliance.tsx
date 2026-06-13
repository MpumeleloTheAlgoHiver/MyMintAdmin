import { useEffect, useState } from "react";
import { ShieldCheck, Activity, FileCheck, AlertTriangle } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api";

/* Ported from public/cyber-compliance.html — /api/cyber-compliance
   (health-summary + list-incidents). Admin actions (resolve/run-check) follow-up. */

interface Summary {
  lastChecked: string | null;
  uptimePct: number | null;
  apiPassRate: number | null;
  policyPassRate: number | null;
}
interface Incident {
  id: string;
  title?: string;
  severity?: string;
  status?: string;
  created_at?: string;
  description?: string;
}

const sevBadge = (s?: string) => {
  const n = String(s || "").toLowerCase();
  if (n.includes("crit") || n.includes("high")) return "bg-destructive/10 text-destructive";
  if (n.includes("med") || n.includes("warn")) return "bg-warning/10 text-warning";
  return "bg-secondary text-secondary-foreground";
};
const statusBadge = (s?: string) => {
  const n = String(s || "").toLowerCase();
  if (n.includes("resolv") || n.includes("closed")) return "bg-success/10 text-success";
  if (n.includes("open") || n.includes("active")) return "bg-destructive/10 text-destructive";
  return "bg-warning/10 text-warning";
};
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);

export default function Compliance() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, inc] = await Promise.all([
        apiGet("/api/cyber-compliance?action=health-summary"),
        apiGet("/api/cyber-compliance?action=list-incidents"),
      ]);
      if (s?.ok) setSummary(s);
      if (inc?.ok) setIncidents(inc.incidents || []);
      setLoading(false);
    })();
  }, []);

  const openCount = incidents.filter((i) => !/resolv|closed/i.test(i.status || "")).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cyber Compliance</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Platform health, API checks, policy compliance and incidents
          {summary?.lastChecked && ` · last checked ${new Date(summary.lastChecked).toLocaleString("en-ZA")}`}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Uptime (24h)" value={pct(summary?.uptimePct)} icon={<Activity className="h-4 w-4" />} changeType={summary?.uptimePct != null && summary.uptimePct >= 99 ? "positive" : "neutral"} change={summary?.uptimePct != null && summary.uptimePct >= 99 ? "healthy" : undefined} />
        <StatCard label="API Pass Rate" value={pct(summary?.apiPassRate)} icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard label="Policy Pass Rate" value={pct(summary?.policyPassRate)} icon={<FileCheck className="h-4 w-4" />} />
        <StatCard label="Open Incidents" value={openCount.toString()} subtitle={`${incidents.length} total`} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Incidents</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : incidents.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No incidents logged.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Incident</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Severity</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Status</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Logged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {incidents.map((i) => (
                    <tr key={i.id} className="hover:bg-secondary/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium">{i.title || "Untitled"}</p>
                        {i.description && <p className="text-xs text-muted-foreground line-clamp-1">{i.description}</p>}
                      </td>
                      <td className="text-center px-6 py-4"><Badge variant="secondary" className={cn("text-[10px] capitalize", sevBadge(i.severity))}>{i.severity || "—"}</Badge></td>
                      <td className="text-center px-6 py-4"><Badge variant="secondary" className={cn("text-[10px] capitalize", statusBadge(i.status))}>{i.status || "—"}</Badge></td>
                      <td className="text-right px-6 py-4 text-sm text-muted-foreground">{i.created_at ? new Date(i.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
