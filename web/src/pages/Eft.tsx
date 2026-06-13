import { useEffect, useMemo, useState } from "react";
import { Wallet, Landmark, Coins, Search } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

/* Ported from public/eft.html — live wallets + profiles. */

interface WalletRow {
  id: string;
  user_id: string;
  balance: number | null;
  currency: string | null;
  mint_number: string | null;
  updated_at: string | null;
}
interface Prof { id: string; first_name: string | null; last_name: string | null; email: string | null; }

const fmtR = (n?: number | null) =>
  "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Eft() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [profs, setProfs] = useState<Record<string, Prof>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [w, p] = await Promise.all([
        supabase.from("wallets").select("id, user_id, balance, currency, mint_number, updated_at").order("updated_at", { ascending: false }),
        supabase.from("profiles").select("id, first_name, last_name, email"),
      ]);
      setWallets((w.data || []) as WalletRow[]);
      const pm: Record<string, Prof> = {};
      (p.data || []).forEach((r: any) => { pm[r.id] = r; });
      setProfs(pm);
      setLoading(false);
    })();
  }, []);

  const name = (uid: string) => {
    const p = profs[uid];
    return p ? ([p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || uid) : uid;
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return wallets.filter((w) => !q || name(w.user_id).toLowerCase().includes(q) || (w.mint_number || "").toLowerCase().includes(q));
  }, [wallets, profs, search]);

  const totalBalance = wallets.reduce((s, w) => s + Number(w.balance || 0), 0);
  const funded = wallets.filter((w) => Number(w.balance || 0) > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">EFT Payments</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Client wallets and balances</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Wallets" value={wallets.length.toString()} icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Total Balance" value={fmtR(totalBalance)} icon={<Coins className="h-4 w-4" />} />
        <StatCard label="Funded" value={funded.toString()} subtitle="with balance" icon={<Landmark className="h-4 w-4" />} />
        <StatCard label="Empty" value={(wallets.length - funded).toString()} icon={<Wallet className="h-4 w-4" />} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by client or Mint number…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading wallets…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Client</th>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Mint No.</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Balance</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Currency</th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((w) => (
                    <tr key={w.id} className="hover:bg-secondary/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium">{name(w.user_id)}</td>
                      <td className="px-6 py-4 text-sm font-mono text-muted-foreground">{w.mint_number || "—"}</td>
                      <td className="text-right px-6 py-4 text-sm font-medium tabular-nums">{fmtR(w.balance)}</td>
                      <td className="text-center px-6 py-4 text-sm text-muted-foreground">{w.currency || "ZAR"}</td>
                      <td className="text-right px-6 py-4 text-sm text-muted-foreground">{w.updated_at ? new Date(w.updated_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-sm text-muted-foreground">No wallets match.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
