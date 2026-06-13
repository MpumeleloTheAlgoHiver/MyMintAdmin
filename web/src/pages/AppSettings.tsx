import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiGet, apiSend } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

/* Ported from public/app-settings.html — same /api/team app-settings-get/save
   endpoints, same app_settings('fees') JSONB, same percent/money handling. */

type Kind = "money" | "percent";
interface FieldDef { key: string; group: string; kind: Kind; label: string; hint: string; }

const FIELDS: FieldDef[] = [
  { key: "isinFeePerAsset",      group: "Purchase fees (app)", kind: "money",   label: "Custody fee per asset",        hint: "Charged per underlying security in a basket" },
  { key: "brokerFeeRate",        group: "Purchase fees (app)", kind: "percent", label: "Broker fee",                   hint: "Percent of the buffered investment" },
  { key: "transactionFeeRate",   group: "Purchase fees (app)", kind: "percent", label: "Transaction fee",              hint: "Percent of the buffered investment" },
  { key: "executionReserveRate", group: "Cash asset class",    kind: "percent", label: "Execution reserve",            hint: "Held cash set aside on every buy — a cash asset, not a fee" },
  { key: "monthlyStrategyFee",   group: "Strategy",            kind: "money",   label: "Monthly additional-strategy fee", hint: "Charged per extra strategy, per month" },
  { key: "rebBrokerageRate",     group: "CRM rebalance engine", kind: "percent", label: "Rebalance brokerage",         hint: "Brokerage applied during rebalances" },
  { key: "rebCustodyFee",        group: "CRM rebalance engine", kind: "money",   label: "Rebalance custody fee",       hint: "Custody per asset, per affected client" },
];
const GROUPS = ["Purchase fees (app)", "Cash asset class", "Strategy", "CRM rebalance engine"];

const toInput = (f: FieldDef, v: number) => (f.kind === "percent" ? +(v * 100).toFixed(6) : v);
const fromInput = (f: FieldDef, raw: string) => (f.kind === "percent" ? Number(raw) / 100 : Number(raw));

export default function AppSettings() {
  const { member } = useAuth();
  const isAdmin = member?.role === "admin";

  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState<{ updated_at?: string; updated_by?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    (async () => {
      const r = await apiGet("/api/team?action=app-settings-get&key=fees");
      if (r?.notice) setNotice(r.notice);
      const v = r?.value || {};
      const next: Record<string, string> = {};
      FIELDS.forEach((f) => { next[f.key] = v[f.key] == null ? "" : String(toInput(f, Number(v[f.key]))); });
      setValues(next);
      setOriginal(next);
      setMeta({ updated_at: r?.updated_at, updated_by: r?.updated_by });
      setLoading(false);
    })();
  }, [isAdmin]);

  const dirty = FIELDS.some((f) => values[f.key] !== original[f.key]);
  const valid = FIELDS.every((f) => values[f.key] !== "" && !isNaN(Number(values[f.key])) && Number(values[f.key]) >= 0);

  const save = async () => {
    const value: Record<string, number> = {};
    FIELDS.forEach((f) => { value[f.key] = fromInput(f, values[f.key]); });
    setSaving(true);
    const r = await apiSend("POST", "/api/team?action=app-settings-save", { key: "fees", value });
    setSaving(false);
    if (r?.ok) {
      toast.success("Fees saved");
      setOriginal(values);
      setMeta({ updated_at: new Date().toISOString(), updated_by: member?.email });
    } else {
      toast.error(r?.error || "Save failed");
    }
  };

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-semibold tracking-tight">App Settings</h1></div>
        <div className="rounded-xl border border-border bg-card p-16 text-center text-sm text-muted-foreground">Admins only.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">App Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Platform-wide configuration. Changes apply to new transactions within ~1 minute — no deploy needed.</p>
      </div>

      {notice && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">⚠ {notice}</div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Fees</CardTitle>
          <p className="text-xs text-muted-foreground">The single source of truth for platform fees. The app and CRM read these values.</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              {GROUPS.map((group) => (
                <div key={group} className="mb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-1">{group}</p>
                  <div className="divide-y divide-border">
                    {FIELDS.filter((f) => f.group === group).map((f) => (
                      <div key={f.key} className="flex items-center justify-between gap-4 py-3">
                        <div>
                          <p className="text-sm font-medium">{f.label}</p>
                          <p className="text-xs text-muted-foreground">{f.hint}</p>
                        </div>
                        <div className="relative shrink-0">
                          {f.kind === "money" && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R</span>}
                          <Input
                            type="number" step="0.01" min="0"
                            value={values[f.key] ?? ""}
                            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                            className={cn("w-36 text-right tabular-nums", f.kind === "money" ? "pl-7" : "pr-7")}
                          />
                          {f.kind === "percent" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-4 mt-6">
                <Button onClick={save} disabled={!dirty || !valid || saving}>{saving ? "Saving…" : "Save changes"}</Button>
                {meta?.updated_at && (
                  <span className="text-xs text-muted-foreground">
                    Last updated {new Date(meta.updated_at).toLocaleString("en-ZA")}{meta.updated_by ? ` · ${meta.updated_by}` : ""}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
