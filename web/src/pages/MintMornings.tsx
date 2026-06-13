import { useEffect, useState } from "react";
import { Sun, CheckCircle2, Clock, Eye } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";

/* Ported from public/mint-mornings.html — /api/mint-mornings (status + preview).
   Sending is gated server-side; this surfaces status + the day's preview. */

export default function MintMornings() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ html: string | null; articleCount: number; title?: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await apiGet("/api/mint-mornings?action=status");
      setStatus(s);
      setLoading(false);
    })();
  }, []);

  const loadPreview = async () => {
    setPreviewing(true);
    const p = await apiGet("/api/mint-mornings?action=preview");
    setPreview(p);
    setPreviewing(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mint Mornings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Daily market briefing — status and preview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Today" value={loading ? "…" : (status?.today || "—")} icon={<Sun className="h-4 w-4" />} />
        <StatCard label="Sent Today" value={loading ? "…" : status?.alreadySentToday ? "Yes" : "No"}
          changeType={status?.alreadySentToday ? "positive" : "neutral"} change={status?.alreadySentToday ? "delivered" : "not yet"}
          icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Last Send" value={loading ? "…" : (status?.lastSend ? new Date(status.lastSend).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "—")} icon={<Clock className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">Today's edition{preview?.title ? ` · ${preview.title}` : ""}</CardTitle>
          <Button size="sm" variant="outline" className="gap-2" onClick={loadPreview} disabled={previewing}>
            <Eye className="h-4 w-4" />{previewing ? "Loading…" : "Preview"}
          </Button>
        </CardHeader>
        <CardContent>
          {!preview ? (
            <p className="text-sm text-muted-foreground py-10 text-center">Click Preview to render today's briefing.</p>
          ) : preview.html ? (
            <>
              <p className="text-xs text-muted-foreground mb-3">{preview.articleCount} article{preview.articleCount !== 1 ? "s" : ""}</p>
              <div className="rounded-lg border border-border overflow-hidden bg-white">
                <iframe title="Mint Mornings preview" srcDoc={preview.html} className="w-full" style={{ height: 600, border: 0 }} />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-10 text-center">{(preview as any).message || "No articles available today."}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
