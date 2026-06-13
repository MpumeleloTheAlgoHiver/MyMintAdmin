import { useEffect, useMemo, useState } from "react";
import { FileText, ArrowUpRight, ArrowDownRight, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

/* Ported from public/factsheets.html — strategies_c + strategies_returns_c. */

interface Strat { id: string; name: string; sector: string | null; risk_level: string | null; icon_url: string | null; }
interface Ret { strategy_id: string; ytd_pct: number | null; "1m_pct": number | null; "6m_pct": number | null; as_of_date: string | null; }

const pctClass = (n?: number | null) => (Number(n) >= 0 ? "text-ticker-positive" : "text-ticker-negative");
const fmtPct = (n?: number | null) => (n == null ? "—" : `${Number(n) >= 0 ? "+" : ""}${Number(n).toFixed(2)}%`);

export default function Factsheets() {
  const [strats, setStrats] = useState<Strat[]>([]);
  const [returns, setReturns] = useState<Record<string, Ret>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [s, r] = await Promise.all([
        supabase.from("strategies_c").select("id, name, sector, risk_level, icon_url").eq("status", "active"),
        supabase.from("strategies_returns_c").select("strategy_id, ytd_pct, 1m_pct, 6m_pct, as_of_date").order("as_of_date", { ascending: false }),
      ]);
      setStrats((s.data || []) as Strat[]);
      const rm: Record<string, Ret> = {};
      (r.data || []).forEach((row: any) => { if (!rm[row.strategy_id]) rm[row.strategy_id] = row; });
      setReturns(rm);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return strats.filter((s) => !q || (s.name || "").toLowerCase().includes(q) || (s.sector || "").toLowerCase().includes(q));
  }, [strats, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Factsheets</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Strategy factsheets and performance</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search factsheets…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading factsheets…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((s) => {
            const r = returns[s.id];
            const ytd = r?.ytd_pct;
            return (
              <Card key={s.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center overflow-hidden shrink-0">
                      {s.icon_url ? <img src={s.icon_url} alt="" className="h-full w-full object-cover" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.sector || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-end justify-between border-t border-border pt-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">YTD</p>
                      <p className={cn("text-lg font-semibold flex items-center gap-1", pctClass(ytd))}>
                        {ytd != null && (Number(ytd) >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />)}
                        {fmtPct(ytd)}
                      </p>
                    </div>
                    <div className="text-right text-xs space-y-0.5">
                      <p className="text-muted-foreground">1M <span className={cn("font-medium", pctClass(r?.["1m_pct"]))}>{fmtPct(r?.["1m_pct"])}</span></p>
                      <p className="text-muted-foreground">6M <span className={cn("font-medium", pctClass(r?.["6m_pct"]))}>{fmtPct(r?.["6m_pct"])}</span></p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">No factsheets match.</div>
          )}
        </div>
      )}
    </div>
  );
}
