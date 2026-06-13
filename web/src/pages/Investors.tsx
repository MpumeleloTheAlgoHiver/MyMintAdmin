import { useEffect, useMemo, useState } from "react";
import { Users, Coins, TrendingUp, Percent, ArrowUpRight, ArrowDownRight, Search } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api";

/* Ported from public/investors.html — /api/investors/data (raw payload).
   Per-investor value = live positions + rebalance residual + held 8% buffer.
   P&L = unrealised (live − cost) + realised (Σ(avg_exit−avg_fill)×qty). Mirrors
   the MINT app + strategyValuation convention so every surface agrees. */

interface Row {
  key: string; name: string; isChild: boolean;
  invested: number; value: number; pnl: number; retPct: number;
}
const fmtR = (n: number) => "R" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function Investors() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const d = await apiGet("/api/investors/data");
      const holdings = d?.holdings || [], closed = d?.closedHoldings || [], residuals = d?.residuals || [];
      const txns = d?.txns || [], secLive = d?.secLive || [], profiles = d?.profiles || [], fam = d?.familyMembers || [];

      const liveMap: Record<string, number> = {};
      secLive.forEach((s: any) => { if (s.security_id != null && s.current_price != null) liveMap[s.security_id] = Number(s.current_price) / 100; });
      const txById: Record<string, any> = {}; txns.forEach((t: any) => { txById[t.id] = t; });
      const profMap: Record<string, any> = {}; profiles.forEach((p: any) => { profMap[p.id] = p; });
      const famMap: Record<string, any> = {}; fam.forEach((f: any) => { famMap[f.id] = f; });

      const k = (uid: string, fmId: any) => `${uid}:${fmId || ""}`;
      const residualByInv: Record<string, number> = {};
      residuals.forEach((r: any) => { residualByInv[k(r.user_id, r.family_member_id)] = (residualByInv[k(r.user_id, r.family_member_id)] || 0) + Number(r.balance_cents || 0) / 100; });
      const realizedByInv: Record<string, number> = {};
      closed.forEach((h: any) => {
        const fill = Number(h.avg_fill || 0), exit = Number(h.avg_exit || 0), qty = Number(h.quantity || 0);
        if (fill && exit && qty) realizedByInv[k(h.user_id, h.family_member_id)] = (realizedByInv[k(h.user_id, h.family_member_id)] || 0) + ((exit - fill) / 100) * qty;
      });

      const byInv: Record<string, { uid: string; fmId: any; invested: number; current: number; txIds: Set<string> }> = {};
      holdings.forEach((h: any) => {
        const key = k(h.user_id, h.family_member_id);
        if (!byInv[key]) byInv[key] = { uid: h.user_id, fmId: h.family_member_id || null, invested: 0, current: 0, txIds: new Set() };
        const qty = Number(h.quantity || 0);
        const avgFillR = Number(h.avg_fill || 0) / 100;
        const expR = Number(h.expected_fill || 0);
        const costR = expR > 0 ? (avgFillR > 0 && expR > avgFillR * 5 ? expR / 100 : expR) : avgFillR;
        const live = liveMap[h.security_id];
        const curR = live != null ? live * qty : Number(h.market_value || 0) / 100;
        byInv[key].invested += costR * qty;
        byInv[key].current += curR;
        if (h.transaction_id) byInv[key].txIds.add(h.transaction_id);
      });

      const out: Row[] = Object.entries(byInv).map(([key, inv]) => {
        let buffer = 0;
        inv.txIds.forEach((tid) => { const t = txById[tid]; if (t) buffer += (Number(t.buffer_cents || 0) - Number(t.buffer_consumed_cents || 0)) / 100; });
        const residual = residualByInv[key] || 0;
        const realized = realizedByInv[key] || 0;
        const value = inv.current + residual + buffer;
        const pnl = (inv.current - inv.invested) + realized;
        const retPct = inv.invested > 0 ? (pnl / inv.invested) * 100 : 0;
        const prof = profMap[inv.uid] || {};
        const parentName = [prof.first_name, prof.last_name].filter(Boolean).join(" ") || prof.email || inv.uid.slice(0, 8);
        let name = parentName, isChild = false;
        if (inv.fmId) {
          const fm = famMap[inv.fmId] || {};
          const child = [fm.first_name, fm.last_name].filter(Boolean).join(" ") || "Child";
          name = `${child} (${parentName})`; isChild = true;
        }
        return { key, name, isChild, invested: inv.invested, value, pnl, retPct };
      }).sort((a, b) => b.value - a.value);

      setRows(out);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const aum = rows.reduce((s, r) => s + r.value, 0);
  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);
  const totalInvested = rows.reduce((s, r) => s + r.invested, 0);
  const avgRet = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Investors</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Live portfolio value and P&amp;L per investor</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Investors" value={rows.length.toString()} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Total AUM" value={fmtR(aum)} icon={<Coins className="h-4 w-4" />} />
        <StatCard label="Total P&L" value={fmtR(totalPnl)} changeType={totalPnl >= 0 ? "positive" : "negative"} change={fmtPct(avgRet)} icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label="Avg Return" value={fmtPct(avgRet)} changeType={avgRet >= 0 ? "positive" : "negative"} icon={<Percent className="h-4 w-4" />} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search investors…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading investors…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Investor</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Invested</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Value</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">P&L</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((r) => (
                    <tr key={r.key} className="hover:bg-secondary/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium">{r.name}</td>
                      <td className="text-right px-6 py-4 text-sm tabular-nums">{fmtR(r.invested)}</td>
                      <td className="text-right px-6 py-4 text-sm font-medium tabular-nums">{fmtR(r.value)}</td>
                      <td className={cn("text-right px-6 py-4 text-sm font-medium tabular-nums", r.pnl >= 0 ? "text-ticker-positive" : "text-ticker-negative")}>{r.pnl >= 0 ? "+" : ""}{fmtR(r.pnl)}</td>
                      <td className={cn("text-right px-6 py-4 text-sm font-medium", r.retPct >= 0 ? "text-ticker-positive" : "text-ticker-negative")}>
                        <span className="inline-flex items-center justify-end gap-1">{r.retPct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{fmtPct(r.retPct)}</span>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-sm text-muted-foreground">No investors match.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
