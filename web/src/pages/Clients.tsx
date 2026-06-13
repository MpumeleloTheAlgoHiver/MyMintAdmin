import { useEffect, useMemo, useState } from "react";
import { Users, ShieldCheck, TrendingUp, Baby, Search, Filter } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

/* Ported from public/index.html (Clients). Same Supabase reads: profiles +
   user_onboarding (KYC) + active stock_holdings_c (invested) + family_members
   (children). List view; the deep detail panel is a later port. */

interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  computershare_number: string | null;
  created_at: string | null;
}
interface Child { parent: string; name: string; computershare_number: string | null; }

const kycVerified = (s?: string) => {
  const n = String(s || "").toLowerCase();
  return ["completed", "complete", "approved", "verified", "done"].some((k) => n.includes(k));
};

export default function Clients() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [kyc, setKyc] = useState<Record<string, string>>({});
  const [invested, setInvested] = useState<Set<string>>(new Set());
  const [childrenByParent, setChildrenByParent] = useState<Record<string, Child[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kycFilter, setKycFilter] = useState("all");

  useEffect(() => {
    (async () => {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email, computershare_number, created_at")
        .order("created_at", { ascending: false });
      const list = (profs || []) as Profile[];
      setProfiles(list);
      const ids = list.map((p) => p.id).filter(Boolean);

      if (ids.length) {
        const [ob, holds, fam] = await Promise.all([
          supabase.from("user_onboarding").select("user_id, kyc_status").in("user_id", ids),
          supabase.from("stock_holdings_c").select("user_id").eq("is_active", true).eq("trade_side", "BUY").in("user_id", ids),
          supabase.from("family_members").select("primary_user_id, parent_id, first_name, last_name, computershare_number"),
        ]);
        const km: Record<string, string> = {};
        (ob.data || []).forEach((r: any) => { km[r.user_id] = r.kyc_status || ""; });
        setKyc(km);
        setInvested(new Set((holds.data || []).map((r: any) => r.user_id)));
        const cbp: Record<string, Child[]> = {};
        (fam.data || []).forEach((r: any) => {
          const parent = r.primary_user_id || r.parent_id;
          if (!parent) return;
          (cbp[parent] = cbp[parent] || []).push({
            parent,
            name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Child",
            computershare_number: r.computershare_number || null,
          });
        });
        setChildrenByParent(cbp);
      }
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return profiles.filter((p) => {
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ").toLowerCase();
      const matchesSearch = !q || name.includes(q) || (p.email || "").toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
      const verified = kycVerified(kyc[p.id]);
      const matchesKyc = kycFilter === "all" || (kycFilter === "verified" ? verified : !verified);
      return matchesSearch && matchesKyc;
    });
  }, [profiles, kyc, search, kycFilter]);

  const verifiedCount = profiles.filter((p) => kycVerified(kyc[p.id])).length;
  const childCount = Object.values(childrenByParent).reduce((s, c) => s + c.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground mt-0.5">All investor profiles, KYC status and allocations</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Clients" value={profiles.length.toString()} icon={<Users className="h-4 w-4" />} />
        <StatCard label="KYC Verified" value={verifiedCount.toString()} subtitle={`${profiles.length - verifiedCount} pending`} icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard label="Invested" value={invested.size.toString()} icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label="Children" value={childCount.toString()} subtitle="linked" icon={<Baby className="h-4 w-4" />} />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, email or UID…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={kycFilter} onValueChange={setKycFilter}>
          <SelectTrigger className="w-[160px]"><Filter className="h-3.5 w-3.5 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All KYC</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
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
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Computershare</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">KYC</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Invested</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">Children</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((p) => {
                    const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "—";
                    const verified = kycVerified(kyc[p.id]);
                    const kids = childrenByParent[p.id] || [];
                    return (
                      <tr key={p.id} className="hover:bg-secondary/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium">{name}</p>
                          <p className="text-xs text-muted-foreground">{p.email || p.id}</p>
                        </td>
                        <td className="px-6 py-4 text-sm font-mono text-muted-foreground">{p.computershare_number || "—"}</td>
                        <td className="text-center px-6 py-4">
                          <Badge variant="secondary" className={cn("text-[10px]", verified ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                            {verified ? "Verified" : "Pending"}
                          </Badge>
                        </td>
                        <td className="text-center px-6 py-4">
                          {invested.has(p.id)
                            ? <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">Invested</Badge>
                            : <span className="text-sm text-muted-foreground">—</span>}
                        </td>
                        <td className="text-center px-6 py-4 text-sm">{kids.length || "—"}</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} className="p-10 text-center text-sm text-muted-foreground">No clients match.</td></tr>
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
