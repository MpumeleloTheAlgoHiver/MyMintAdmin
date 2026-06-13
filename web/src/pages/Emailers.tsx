import { useEffect, useState } from "react";
import { Mail, Send, AlertTriangle } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api";

/* Ported from public/emailers.html — /api/email-logs. Trigger config = follow-up. */

interface Log {
  id?: string;
  to_email?: string; to?: string;
  subject?: string;
  status?: string;
  created_at?: string; sent_at?: string;
  error?: string;
}

const statusBadge = (s?: string) => {
  const n = String(s || "").toLowerCase();
  if (n.includes("sent") || n.includes("deliver") || n.includes("ok") || n.includes("success")) return "bg-success/10 text-success";
  if (n.includes("fail") || n.includes("error") || n.includes("bounce")) return "bg-destructive/10 text-destructive";
  return "bg-warning/10 text-warning";
};

export default function Emailers() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiGet("/api/email-logs");
        const arr = Array.isArray(r) ? r : (r?.logs || r?.data || []);
        setLogs(arr);
      } catch { /* endpoint optional */ }
      setLoading(false);
    })();
  }, []);

  const sent = logs.filter((l) => /sent|deliver|ok|success/i.test(l.status || "")).length;
  const failed = logs.filter((l) => /fail|error|bounce/i.test(l.status || "")).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Emailers &amp; Triggers</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Outbound email log and delivery status</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Emails Logged" value={logs.length.toString()} icon={<Mail className="h-4 w-4" />} />
        <StatCard label="Sent" value={sent.toString()} changeType="positive" change="delivered" icon={<Send className="h-4 w-4" />} />
        <StatCard label="Failed" value={failed.toString()} changeType={failed ? "negative" : "neutral"} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Recent emails</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : logs.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No email logs available.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Recipient</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Subject</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Status</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Sent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((l, i) => (
                    <tr key={l.id || i} className="hover:bg-secondary/50 transition-colors">
                      <td className="px-6 py-4 text-sm">{l.to_email || l.to || "—"}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{l.subject || "—"}</td>
                      <td className="text-center px-6 py-4"><Badge variant="secondary" className={cn("text-[10px] capitalize", statusBadge(l.status))}>{l.status || "—"}</Badge></td>
                      <td className="text-right px-6 py-4 text-sm text-muted-foreground">{(l.created_at || l.sent_at) ? new Date(l.created_at || l.sent_at!).toLocaleString("en-ZA") : "—"}</td>
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
