# CRM Redesign — progress checklist

Branch: `features/redesign` · New app: `web/` (React + shadcn on the Wealth
Navigator design system) · Reuses the SAME Supabase + `api/*` (data/backend
untouched). The live vanilla CRM (`public/**`) keeps running the whole time.

## Foundation / infrastructure
- [x] Branch `features/redesign` created off `main`
- [x] `web/` scaffold (Vite + React + TS + Tailwind + shadcn) — builds clean
- [x] Design system lifted from WN (tokens `index.css`, tailwind config, 49 shadcn ui, Inter)
- [x] `CrmLayout` — dark-sidebar shell with real CRM nav + live auth/sign-out
- [x] `supabase.ts` (same project) + `api.ts` (Bearer to existing `api/*`) + `AuthContext` (`/api/team?action=me`)
- [x] `StatCard`, `SignIn`, `Placeholder`
- [x] Fable hand-off prompt (`REDESIGN_FABLE_PROMPT.md`) — fallback: porting manually

## Pages (port `public/*.html` → `web/src/pages/*.tsx`, same data, new look)
- [x] **Clients** (`/`) ← `index.html` — profiles + KYC + invested + children *(list; deep detail panel = follow-up)*
- [x] **Team** (`/team`) ← `team.html` — members table *(invite/edit actions = follow-up)*
- [x] **App Settings** (`/app-settings`) ← `app-settings.html` — fees editor (full)
- [x] **EFT Payments** (`/eft`) ← `eft.html` — wallets + balances *(upload/send actions = follow-up)*
- [x] **Strategies** (`/strategies`) ← `strategies.html` — strategy grid
- [x] **Factsheets** (`/factsheets`) ← `factsheets.html` — strategy returns cards
- [x] **Mint Mornings** (`/mint-mornings`) ← `mint-mornings.html` — status + preview
- [x] **Emailers & Triggers** (`/emailers`) ← `emailers.html` — email log *(trigger config = follow-up)*
- [x] **Cyber Compliance** (`/compliance`) ← `cyber-compliance.html` — health KPIs + incidents *(admin actions = follow-up)*
- [x] **Client View Studio** (`/studio`) ← `studio.html` — client list + impersonate preview
- [x] **Settings** (`/settings`) ← `settings.html` — account + admin links
- [x] **Investors** (`/investors`) ← `investors.html` — live value (positions+residual+buffer) + P&L (unrealised+realised) per investor *(per-investor detail drilldown = follow-up)*
- [ ] **Order Book** (`/orderbook`) ← `orderbook.html` *(HARD, large)*
- [ ] **Dashboard** (`/dashboard`) ← `dashboard.html` *(HARDEST: rebalance engine — parity-check)*

## Deploy (later)
- [ ] Wire Vercel to serve `web/dist` (coexist with/replace the static deploy)
- [ ] Cut over from vanilla pages once verified

## Notes
- Pages marked *(follow-up)* are functional but have advanced interactions still to port.
- Heavy pages (Investors / Order Book / Dashboard) ported last with behaviour parity checks.
