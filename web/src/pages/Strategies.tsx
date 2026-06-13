import { useEffect, useMemo, useState } from "react";
import { BarChart3, Star, Globe, Layers, Search } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

/* Ported from public/strategies.html — live strategies_c. */

interface Strategy {
  id: string;
  name: string;
  short_name: string | null;
  description: string | null;
  objective: string | null;
  risk_level: string | null;
  sector: string | null;
  min_investment: number | null;
  base_currency: string | null;
  is_featured: boolean | null;
  is_public: boolean | null;
  status: string | null;
  holdings: any[] | null;
}

const riskBadge = (r?: string | null) => {
  const n = String(r || "").toLowerCase();
  if (n.includes("high") || n.includes("aggress")) return "bg-destructive/10 text-destructive";
  if (n.includes("low") || n.includes("conserv")) return "bg-success/10 text-success";
  return "bg-warning/10 text-warning";
};
const fmtR = (n?: number | null) =>
  n == null ? "—" : "R" + Number(n).toLocaleString("en-ZA", { maximumFractionDigits: 0 });

export default function Strategies() {
  const [rows, setRows] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("strategies_c")
        .select("id, name, short_name, description, objective, risk_level, sector, min_investment, base_currency, is_featured, is_public, status, holdings, created_at")
        .order("created_at", { ascending: false });
      setRows((data || []) as Strategy[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((s) => !q || (s.name || "").toLowerCase().includes(q) || (s.sector || "").toLowerCase().includes(q));
  }, [rows, search]);

  const pub = rows.filter((s) => s.is_public).length;
  const featured = rows.filter((s) => s.is_featured).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Strategies</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Investment strategies on the platform</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Strategies" value={rows.length.toString()} icon={<Layers className="h-4 w-4" />} />
        <StatCard label="Public" value={pub.toString()} icon={<Globe className="h-4 w-4" />} />
        <StatCard label="Featured" value={featured.toString()} icon={<Star className="h-4 w-4" />} />
        <StatCard label="Active" value={rows.filter((s) => (s.status || "").toLowerCase() === "active").length.toString()} icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search strategies…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading strategies…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((s) => {
            const holdingsCount = Array.isArray(s.holdings) ? s.holdings.length : 0;
            return (
              <Card key={s.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.sector || "—"}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {s.is_featured && <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">Featured</Badge>}
                      <Badge variant="secondary" className={cn("text-[10px]", (s.status || "").toLowerCase() === "active" ? "bg-success/10 text-success" : "bg-secondary text-secondary-foreground")}>
                        {s.status || "—"}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3 min-h-[2rem]">{s.description || s.objective || ""}</p>
                  <div className="flex items-center justify-between text-xs border-t border-border pt-3">
                    <Badge variant="secondary" className={cn("text-[10px] capitalize", riskBadge(s.risk_level))}>{s.risk_level || "—"} risk</Badge>
                    <span className="text-muted-foreground">{holdingsCount} holdings</span>
                    <span className="font-medium">Min {fmtR(s.min_investment)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">No strategies match.</div>
          )}
        </div>
      )}
    </div>
  );
}
