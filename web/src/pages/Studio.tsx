import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, Search, MonitorPlay } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { apiSend } from "@/lib/api";

/* Ported from public/studio.html — preview the live Mint client app signed in as
   a client, via the existing /api/team?action=impersonate (admin only). */

interface Prof { id: string; first_name: string | null; last_name: string | null; email: string | null; }

export default function Studio() {
  const [profs, setProfs] = useState<Prof[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<"dev" | "live">("dev");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, first_name, last_name, email").order("created_at", { ascending: false });
      setProfs((data || []) as Prof[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return profs.filter((p) => !q || [p.first_name, p.last_name, p.email].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [profs, search]);

  const preview = async (p: Prof) => {
    setBusyId(p.id);
    const r = await apiSend("POST", "/api/team?action=impersonate", { user_id: p.id, target });
    setBusyId(null);
    if (r?.ok && r.actionLink) window.open(r.actionLink, "_blank", "noopener,noreferrer");
    else toast.error(r?.error || "Could not start preview");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Client View Studio</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Preview the Mint client app signed in as any client</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={target} onValueChange={(v) => setTarget(v as "dev" | "live")}>
          <SelectTrigger className="w-[160px]"><MonitorPlay className="h-3.5 w-3.5 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="dev">Dev environment</SelectItem>
            <SelectItem value="live">Live environment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading clients…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Client</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-secondary/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium">{[p.first_name, p.last_name].filter(Boolean).join(" ") || "—"}</p>
                        <p className="text-xs text-muted-foreground">{p.email || p.id}</p>
                      </td>
                      <td className="text-right px-6 py-4">
                        <Button size="sm" variant="outline" className="gap-2" onClick={() => preview(p)} disabled={busyId === p.id}>
                          <Eye className="h-4 w-4" />{busyId === p.id ? "Opening…" : "Preview"}
                        </Button>
                      </td>
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
