# MINT UCT Treasury Dashboard — Build Brief for Cursor

## What We Are Building

A **mock UCT Treasury Dashboard** — a realistic prototype for a sales/demo meeting with UCT (University of Cape Town) treasury team.

**Purpose:** Show UCT what AI-powered treasury management looks like — before we build the real thing. This wins the meeting, gets them to say "I wish I had this yesterday," and secures the pilot.

---

## The Client: UCT Treasury

### Who They Are
- Public university — operates under **PFMA (Public Finance Management Act)**
- Annual cash flows: **R2-4 billion**
- Primary bank: **Standard Bank**
- Other banks: Absa, FNB, Nedbank (possibly)
- Treasury team: 3-8 people managing all cash, investments, payments, compliance

### Their Core Pain
- Multiple bank portals (one per bank) — no single view
- Cash flow forecasting is spreadsheet-based and manual
- No real-time visibility — they find out about cash problems end-of-day
- Yield optimization is reactive — they check rates when they remember
- PFMA compliance reporting is manual and time-consuming

### Their Goals (inferred)
1. **One dashboard** — complete cash position across all banks, real-time
2. **Accurate forecasting** — know what cash they'll have 30/60/90 days out
3. **Yield optimization** — idle cash is placed in the best available instrument automatically
4. **Compliance** — PFMA reporting is effortless

---

## What to Build: The Prototype

### The Concept
A web dashboard simulating a UCT Treasury Command Center. Data is **mock/simulated** but realistic. It demonstrates the concept — the AI and real data integration comes later.

### Screens to Build

**1. DASHBOARD (main view)**
- Total cash position across all banks (big number)
- Breakdown by bank (Standard Bank / Absa / FNB / Nedbank)
- Breakdown by fund type (Student Fees / NSFAS / Research / Endowment / Operating)
- Intraday change indicator (up/down vs yesterday)
- Last updated timestamp

**2. CASH FLOW FORECAST (30 days)**
- Line chart showing: actual cash position (past) + AI forecast (future, 30 days)
- Shaded confidence band (AI gives ranges, not just single numbers)
- Key inflow/outflow markers on the chart (fee payments, payroll dates, grant disbursements)
- Toggle: 7-day / 30-day / 90-day views

**3. YIELD OPTIMIZATION PANEL**
- Current investment portfolio breakdown
- Each investment: instrument type, principal, rate, maturity date
- "AI Recommendation" card: "You have R45M in call deposit at 6.5%. Placing R45M in a 91-day T-bill at 7.8% would yield R87,500 extra over 91 days. View opportunity →"
- Real-time SA money market rates feed (mock data, realistic numbers)

**4. ALERTS & NOTIFICATIONS**
- Cash position alerts (e.g., "Cash position dropped below R100M threshold")
- Forecast deviation alerts (actual vs. predicted significantly different)
- Investment maturity approaching
- PFMA compliance items due

**5. PFMA COMPLIANCE REPORT (simple view)**
- Current period's permitted investments vs. actual
- One-click export to PFMA-compliant format
- Audit trail summary

---

## Design Direction

**Visual style:** Professional, institutional, trustworthy — not startup flashy.
**Color palette:** 
- Primary: Deep navy (#0A1628) + white
- Accent: Gold/amber (#D4A843) for key metrics
- Success: Green (#22C55E)
- Warning: Amber (#F59E0B)
- Error: Red (#EF4444)
- Background: Very light grey (#F8FAFC)

**Typography:** Clean, professional — Google Fonts: Inter or DM Sans (no decorative fonts)

**Layout:** Dense but organized. Financial dashboards are information-rich. Don't be afraid of tables and numbers.

**Charts:** Use Chart.js (CDN) — simple, no build step needed.

---

## Data: Realistic Mock Data for UCT

### Cash Position (as of today)
| Account | Bank | Balance (R) | Fund Type |
|---|---|---|---|
| Main Operating Account | Standard Bank | 487,500,000 | Operating |
| Student Fees Account | Standard Bank | 234,200,000 | Student Fees |
| NSFAS Disbursement | Standard Bank | 89,750,000 | NSFAS |
| Research Grants | Absa | 156,300,000 | Research |
| Endowment Fund | Nedbank | 312,000,000 | Endowment |
| Call Deposit | Standard Bank | 200,000,000 | Operating Reserve |
| Money Market Fund | FNB | 150,000,000 | Operating Reserve |
| **TOTAL** | | **R1,629,750,000** | |

### Cash Flow Pattern (Typical University Year)
- **February:** Large inflow (student fees first semester)
- **March:** NSFAS disbursement
- **April-June:** Steady outflow (payroll, operations)
- **August:** Second fee inflow
- **September:** NSFAS disbursement
- **October-December:** Research payments, year-end

### Current Investment Portfolio
| Instrument | Principal (R) | Rate | Maturity |
|---|---|---|---|
| Standard Bank Call Deposit | 200,000,000 | 6.50% | On-demand |
| FNB Money Market Fund | 150,000,000 | 7.10% | On-demand |
| RSA 91-Day T-Bill | 100,000,000 | 7.85% | 2026-05-15 |
| RSA 182-Day T-Bill | 75,000,000 | 8.10% | 2026-06-30 |

### AI Forecast Parameters (mock)
- Model confidence: 94%
- 30-day forecast accuracy (historical): ±3.2%
- Predicted inflow (next 30 days): R312M
- Predicted outflow (next 30 days): R287M
- Net position change: +R25M

---

## Technical Approach

**Single HTML file — no build step required**

- Pure HTML + CSS + JavaScript
- Chart.js from CDN for charts
- All data defined as JavaScript objects (no backend needed for prototype)
- Responsive (works on laptop in meeting room)
- Can be opened directly from file:// or hosted on any web server

---

## Key Interactions to Demonstrate

1. **Date picker** — change the forecast horizon (7/30/90 days)
2. **"Run Scenario" button** — shows what happens if NSFAS payment is delayed 2 weeks
3. **Alert dismiss** — click to acknowledge an alert
4. **Recommendation accept/decline** — AI yield recommendation (Accept → shows confirmation)
5. **Export PFMA report** — downloads a mock PDF (just a blank page with header is fine for demo)

---

## What Success Looks Like

When UCT sees the dashboard, they should:
1. Immediately recognize their own data (numbers that make sense for a university their size)
2. See something they don't have: AI confidence bands on forecasts, yield recommendations
3. Feel the difference between "data" and "insight"
4. Say: "Where has this been all my life?"

---

## Deliverable

One file: `MINT_UCT_DASHBOARD.html`

Open it in any browser. No server needed. Looks professional enough to show a CFO.

---

## File Structure

```
/MINT_UCT_DASHBOARD.html  — the complete prototype (HTML + CSS + JS + Chart.js)
/MYMINT_CURSOR_CONTEXT.md — this file
```

---

*Context prepared by Enigma for Cursor/AI coding agent — 2026-04-23*
