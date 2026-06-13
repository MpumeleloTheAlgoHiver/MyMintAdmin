# Fable prompt — port the Mint CRM to the new React design system

You are working in the **Mint CRM** repo (MyMintAdmin), on branch **`features/redesign`**.
A new React frontend has been scaffolded in **`web/`** on the **Wealth Navigator** design
system. Your job is to **port the remaining CRM pages** from the existing vanilla
HTML pages into this React app — **same data, same functionality, new look**.

Build/verify from inside `web/`: `npm install` then `npm run build` (or `npm run dev` on :8080).

---

## Mission

Re-skin every CRM page to the new design system **without losing or changing any
data or functionality**. The existing pages are the **behavioural spec**; you are
re-implementing their UI in React while calling the **same** data sources.

## Non-negotiable rules (safety)

1. **Do NOT touch** `public/**` or `api/**`. The live CRM keeps running off those.
   Work only inside `web/`.
2. **Reuse the existing backend verbatim.** Every page must read/write through the
   **same `api/*` serverless functions** and/or the **same Supabase project** the
   vanilla page uses. Do **not** invent new endpoints, new tables, or new server
   logic. If a vanilla page calls `/api/x`, the React page calls `/api/x`.
3. Use the helpers already in `web/src/lib`:
   - `supabase` (`web/src/lib/supabase.ts`) — anon client, same project.
   - `apiGet(path)` / `apiSend(method, path, body)` (`web/src/lib/api.ts`) — attach
     the Supabase Bearer token automatically (exactly how the vanilla pages auth).
   - `useAuth()` (`web/src/contexts/AuthContext.tsx`) — `{ member, authed, ... }`;
     `member.role === "admin"` gates admin-only pages/actions.
4. **Preserve behaviour exactly**: filters, sorts, search, money/cents formatting,
   ZAR formatting, status logic, admin gating, downloads, modals, edit/save flows.
   When in doubt, open the matching `public/*.html` and mirror its logic precisely.
5. **No hardcoded colors.** Use the design tokens only (see below).

## The reference page (copy this pattern)

`web/src/pages/Team.tsx` is fully ported and is your template. It shows:
auth-gated fetch via `apiGet("/api/team?action=list")` → page anatomy → `StatCard`
KPI grid → shadcn `Card` + table with uppercase muted headers, `divide-y` rows,
`hover:bg-secondary/50`, and semantic tinted `Badge`s. Match this exactly.

Shell + nav already exist in `web/src/components/CrmLayout.tsx` and routes in
`web/src/App.tsx` (each unported route currently renders `<Placeholder/>`). To
"port" a page: build `web/src/pages/<Name>.tsx`, then swap its `<Placeholder/>`
route in `App.tsx` for the real component.

## Design system (Wealth Navigator) — use these, nothing else

- **Tokens** (HSL CSS vars in `web/src/index.css`, exposed via Tailwind): `bg-card`,
  `text-foreground`, `text-muted-foreground`, `bg-secondary`, `border-border`,
  `text-primary`/`bg-primary`, `text-success`/`bg-success/10`, `text-warning`,
  `text-destructive`, and **`text-ticker-positive` / `text-ticker-negative` for
  P&L/returns**. Dark mode is built in — never hardcode hex.
- **Font:** Inter (already wired).
- **Page anatomy:** `<div className="space-y-6">` → header (`h1 text-2xl
  font-semibold tracking-tight` + `p text-sm text-muted-foreground`, optional
  primary action `Button` on the right) → `StatCard` grid
  (`grid grid-cols-2 lg:grid-cols-4 gap-4`) → `Card` blocks → tables/lists.
- **StatCard** (`web/src/components/StatCard.tsx`): `{ label, value, change,
  changeType, icon, subtitle }`.
- **Tables:** `<Card><CardContent className="p-0">` → `<table>` with `thead` of
  uppercase `text-xs font-medium text-muted-foreground` headers, `tbody
  className="divide-y divide-border"`, rows `hover:bg-secondary/50`.
- **Badges:** semantic tints, e.g. `bg-success/10 text-success` (active),
  `bg-warning/10 text-warning` (pending), `bg-primary/10 text-primary`,
  `bg-destructive/10 text-destructive`.
- **P&L / returns:** `text-ticker-positive` / `text-ticker-negative` with
  `ArrowUpRight` / `ArrowDownRight` from `lucide-react`.
- **Charts:** `recharts`, colored with the token HSL values (see WN's
  `Dashboard.tsx` for the exact pattern — line/pie with `hsl(227 71% 55%)` etc.).
- **Forms/modals:** shadcn `Dialog`, `Input`, `Label`, `Select`, `Button`.
- Components live in `web/src/components/ui/*` (all 49 shadcn primitives).

## Pages to port (order: easy → hard; do the hard two LAST, with parity checks)

For each: open the listed `public/*.html` as the spec, replicate its data calls,
re-skin to the pattern above.

| # | Route | New file | Source (spec) | Data source |
|---|-------|----------|---------------|-------------|
| 1 | `/app-settings` | `pages/AppSettings.tsx` | `public/app-settings.html` | `/api/team?action=app-settings-get&key=fees` + `...save` (admin) |
| 2 | `/eft` | `pages/Eft.tsx` | `public/eft.html` | as in eft.html (Supabase + `/api/send-eft-email`) |
| 3 | `/strategies` | `pages/Strategies.tsx` | `public/strategies.html` | as in strategies.html (Supabase `strategies_c` etc.) |
| 4 | `/factsheets` | `pages/Factsheets.tsx` | `public/factsheets.html` | as in factsheets.html |
| 5 | `/mint-mornings` | `pages/MintMornings.tsx` | `public/mint-mornings.html` | `/api/mint-mornings` |
| 6 | `/emailers` | `pages/Emailers.tsx` | `public/emailers.html` | as in emailers.html |
| 7 | `/compliance` | `pages/Compliance.tsx` | `public/cyber-compliance.html` | `/api/cyber-compliance` |
| 8 | `/studio` | `pages/Studio.tsx` | `public/studio.html` | as in studio.html |
| 9 | `/settings` | `pages/Settings.tsx` | `public/settings.html` | profile/team (`/api/team?action=me`); admin rows gate App Settings + Team |
| 10 | `/` (Clients) | `pages/Clients.tsx` | `public/index.html` | as in index.html (Supabase profiles/family_members) — model after WN `Clients.tsx` table |
| 11 | `/investors` | `pages/Investors.tsx` | `public/investors.html` | `/api/investors/data` (raw payload — replicate investors.html's client-side aggregation EXACTLY, incl. value = positions+residual+buffer and the realised-P&L handling) |
| 12 | `/orderbook` | `pages/OrderBook.tsx` | `public/orderbook.html` | as in orderbook.html (Supabase + `/api/orderbook/*`) — **HARD, large** |
| 13 | `/dashboard` | `pages/Dashboard.tsx` | `public/dashboard.html` | as in dashboard.html — **HARDEST: the rebalance engine**. Port logic faithfully; verify rebalance math against the vanilla page before considering done. |

> Investors (#11), Orderbook (#12) and the Dashboard rebalance engine (#13) are
> thousands of lines of stateful logic. Port them **last**, incrementally, and
> diff behaviour against the live vanilla page. Do not "simplify" the math.

## Definition of done (per page)
- Renders inside `CrmLayout`, uses only tokens + shadcn, matches the Team pattern.
- Pulls the **same data** as the vanilla page (verified against it).
- All interactions (filters/search/sort/modals/edit/save/download/admin gates) work.
- `npm run build` passes. No `public/**` or `api/**` changes.
- Swap the route's `<Placeholder/>` in `App.tsx` for the real page.

## Deploy note (later, not your job)
The app builds to `web/dist`. Wiring Vercel to serve it (coexisting with the
current static deploy, or cutting over) is handled separately — do not change root
`vercel.json`.
