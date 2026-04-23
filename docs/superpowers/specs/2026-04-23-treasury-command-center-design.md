# MINT Treasury Command Center - Design Specification

**Date:** April 23, 2026
**Project:** UCT Treasury Management System Demo
**Objective:** Revolutionary AI-powered treasury dashboard for UCT Financial Operations

---

## Overview

A demo-ready treasury management system that showcases MINT's AI capabilities alongside professional-grade treasury features. The system tells a compelling story: MINT as the intelligent layer that analyzes, recommends, and explains - with beautiful visualizations that impress stakeholders.

**Design Philosophy:** MINT is the hero. Treasury features are the content. AI ties it together.

---

## Screen 1: Overview (The Hero Screen)

### Layout Structure
- **Left Panel (60%):** MINT AI Chat Interface - full height, prominent
- **Right Panel (40%):** Quick metrics cards stacked vertically

### MINT Chat Interface
- Full-height chat panel with dark theme (#0a0a0f background)
- Animated typing indicator when MINT is "thinking" (3 bouncing dots)
- Quick action chips below input: "Analyze Liquidity" | "Yield Opportunity" | "Today's Cash Flow" | "Compliance Status"
- Message bubbles with timestamps
- MINT responses have purple gradient background (linear-gradient 135deg #7c3aed → #06b6d4)
- User messages have subtle dark background (#12121a)

### Quick Metrics (right side)
1. **Total Cash Position** - R1.63B with animated counter
2. **30-Day Forecast** - R1.52B with trend arrow
3. **Active Yield Opportunities** - Count (e.g., "3") with pulsing glow
4. **Compliance Status** - Green badge "100% Compliant"

### Below the Fold
- **Live Transaction Feed** - Horizontal scrolling cards showing latest transactions
  - Each card: Transaction type icon, description, amount, timestamp
  - Auto-scroll animation every 10 seconds
- **Bank Connectivity Grid** - 2x2 grid showing:
  - Standard Bank - "API Live" (green dot)
  - Absa - "API Live" (green dot)
  - FNB - "API Live" (green dot)
  - Nedbank - "Disconnected" (red dot)

---

## Screen 2: Yield Optimization

### AI Opportunity Card (top, prominent)
- Gradient border card (purple to cyan)
- Icon: 🎯 emoji or target icon
- Content: "AI Yield Opportunity Detected - Confidence: 94%"
- Details: "Reallocating R200M from 6.50% to 7.85% = +R87,500 over 91 days"
- Actions: "View Analysis" (expands detailed comparison) | "Dismiss"
- Expanded view shows:
  - Side-by-side rate comparison
  - Projected extra yield
  - Risk assessment
  - "Execute Reallocation" button

### Current Holdings Grid (3 cards)
1. **Standard Bank Call Deposit** - R200M at 6.50%, Call/Maturity
2. **RSA 91-Day T-Bill** - R175M at 7.85%, maturing May 15
3. **Money Market Fund** - R150M at 7.20%

Each card shows:
- Institution name + logo placeholder
- Current amount
- Interest rate (large, prominent)
- Maturity type/date
- Progress bar showing time elapsed
- Status badge: Active | Maturing | Reallocating

### Market Rates Comparison
- Table: Institution | Product | Rate | Maturity
- Visual bar chart overlay showing rate comparison
- Best rate highlighted with green border
- "Last updated: 30 seconds ago" with pulsing dot

---

## Screen 3: Forex Strategy

### Portfolio Performance Chart (top)
- Line chart showing cumulative returns indexed to 100
- Three lines:
  - **MINT Portfolio** (solid purple #7c3aed, 3px width)
  - **ZAR Only** (dashed amber #f59e0b)
  - **USD Only** (dashed cyan #06b6d4)
- Time range: Jan-Apr 2026 (daily data points)
- Y-axis: 99-108 (zoomed for clarity)
- Legend with toggle visibility

### Performance Metrics (4 cards in grid)
1. **+2.68%** vs ZAR Only (green)
2. **+4.04%** vs USD Only (green)
3. **R13.4M** Extra Return generated (green)
4. **8** Rotations YTD

### RSI Live Signals
- Three signals: ZAR/USD, EUR/USD, GBP/USD
- Each shows: Pair name | Status badge | RSI value
- Status colors:
  - PREMIUM (RSI>70): Red badge
  - DISCOUNT (RSI<30): Green badge
  - NEUTRAL (30-70): Amber badge

### Current Allocation
- ZAR Position: 60% (R315M) - green highlight
- USD Hedge: 40% (R210M) - cyan highlight
- Explanation text: "Currently hedged to USD due to ZAR RSI at 72 (PREMIUM)"

### Rotation History Timeline
- Horizontal scrollable timeline
- Each event: Date | Action | RSI trigger
- Events: ZAR→USD, USD Hold, USD→ZAR, ZAR Hold
- Color-coded by action type

---

## Screen 4: Risk Dashboard

### Risk Score Gauge (top center)
- Large semicircular gauge (200px diameter)
- Needle animation pointing to score
- Score zones: Low (green 0-33), Medium (amber 34-66), High (red 67-100)
- Current score: "Low" with green color
- Subtitle: "Risk Score"

### Three Pillars Grid
1. **Liquidity Coverage**
   - Current: 15.3x
   - Minimum required: 1.0x
   - Progress bar: 95% filled (green)

2. **Market Risk**
   - Status: Medium
   - FX Exposure: R525M
   - Progress bar: 55% filled (amber)

3. **Credit Risk**
   - Status: Low
   - Counterparties: 4 Banks
   - Progress bar: 25% filled (green)

### Stress Test Simulator
- Card with interactive slider
- Label: "What if ZAR depreciates [slider]%?"
- Default position: 20%
- Result panel showing:
  - Portfolio Impact: R+12M (green) or R-8.5M (red)
  - Adjusted risk score
- Reset button

### Key Risk Indicators Table
| Indicator | Current | Limit | Status |
|-----------|---------|-------|--------|
| Daily Cash Flow Variance | ±3.2% | ±10% | OK (green) |
| Investment Concentration | 38% | 40% | Warning (amber) |
| FX Open Position | R315M | R500M | OK (green) |
| Minimum Liquid Assets | R1.53B | R500M | OK (green) |

### VaR Section
- 1-Day VaR: R8.5M
- 10-Day VaR: R26.9M
- Max Drawdown (YTD): -2.1%

---

## Screen 5: PFMA Compliance

### Compliance Status Card (top)
- Large circular progress ring (100%)
- Center text: "100%"
- Badge: "100% Compliant" (green)
- Subtitle: "All requirements met for Q1 2026"
- Audit info: "Last audit: April 15, 2026 | Next review: May 15, 2026"

### Permitted Investments Table
| Category | Limit | Current | Utilization | Status |
|----------|-------|---------|-------------|--------|
| Call Deposits | R500M | R200M | 40% | OK |
| Money Market Funds | R300M | R150M | 50% | OK |
| National Treasury Bills | R400M | R175M | 44% | OK |
| NCDs (Banks) | R200M | R0 | 0% | Available |

Each row has progress bar for utilization.

### Audit Trail Timeline
- Timeline view (vertical)
- Each entry: Date | Action | User
- Recent entries:
  - Apr 15: Quarterly PFMA report generated (System)
  - Apr 10: Investment limits reviewed (J. van der Merwe)
  - Mar 28: T-Bill purchase confirmed (System)

### Export Section
- "Generate PFMA-compliant reports for submission to National Treasury"
- Buttons: "Generate PDF" | "Generate Excel"

---

## Screen 6: Reports

### Report Generation Cards (3 cards in grid)
1. **Monthly Summary** - 📊 icon - "Cash position, flows, and yield performance for April 2026"
2. **Quarterly Report** - 📈 icon - "Q1 2026 comprehensive treasury operations review"
3. **PFMA Compliance** - 📋 icon - "National Treasury submission-ready report"

Each card is clickable with hover effect.

### Recent Reports Table
| Report | Generated | Period | Actions |
|--------|-----------|--------|---------|
| Monthly Treasury Summary | Apr 15, 2026 | March 2026 | Download PDF |
| PFMA Compliance Certificate | Apr 10, 2026 | Q1 2026 | Download PDF |
| Bank Reconciliation | Apr 5, 2026 | March 2026 | Download PDF |
| Cash Flow Analysis | Mar 31, 2026 | Q1 2026 | Download PDF |

---

## MINT AI Capabilities

### Chat Interface
- Dark theme input field with placeholder: "Ask MINT about your treasury..."
- Send button with arrow icon
- Quick action chips (clickable pills)

### Pre-loaded Intelligence
1. **Liquidity Analysis**
   - "Your liquidity position is strong at R1.63B. With R100M operational minimum and R1.53B in liquid assets, you maintain a 15.3x coverage ratio."

2. **Yield Opportunity**
   - "I've identified a yield opportunity: Reallocating R200M from 6.50% to 7.85% would generate +R87,500 over 91 days."

3. **Transaction Summary**
   - "Today you've received R45.2M (student fees) and disbursed R28.45M (payroll). Net positive R16.75M."

4. **Compliance Status**
   - "Excellent news! You're 100% PFMA compliant. All investments within limits."

### Proactive Insights
- Auto-populated cards that appear when relevant
- Example: "📊 New yield opportunity detected - T-Bill rates have increased 15bp"

---

## Visual Design System

### Color Palette
```
--bg-primary: #0a0a0f (main background)
--bg-secondary: #12121a (card backgrounds)
--bg-card: rgba(20, 20, 30, 0.8)
--border-color: rgba(124, 58, 237, 0.2)
--text-primary: #ffffff
--text-secondary: #a1a1aa
--text-muted: #6b6b7b
--accent-purple: #7c3aed
--accent-purple-light: #a78bfa
--accent-cyan: #06b6d4
--buy-green: #10b981
--sell-red: #ef4444
--gold: #f59e0b
```

### Typography
- Primary font: Space Grotesk (Google Fonts)
- Headings: 600-700 weight
- Body: 400-500 weight
- Monospace numbers: for financial figures

### Animations
- Fade in: 0.3s ease
- Slide in: 0.3s ease-out
- Pulse: 2s infinite (indicators)
- Counter: animated number counting

### Card Styling
- Border-radius: 16px
- Backdrop-filter: blur(10px)
- Border: 1px solid rgba(255,255,255,0.1)
- Box-shadow: 0 4px 24px rgba(0,0,0,0.3)

---

## Implementation Priority

### Phase 1: Core (MVP)
1. Overview page with MINT chat + metrics
2. Yield optimization with AI recommendations
3. Basic transaction feed

### Phase 2: Depth
4. Forex strategy with benchmarks
5. Risk dashboard with stress testing
6. PFMA compliance

### Phase 3: Polish
7. Reports generation
8. Animated visualizations
9. Proactive insights

---

## Technical Approach

- **Stack:** Vanilla HTML/CSS/JavaScript (current)
- **Charts:** Chart.js via CDN
- **Styling:** Tailwind via CDN + custom CSS
- **Animation:** CSS transitions + requestAnimationFrame for counters
- **Data:** Simulated with realistic mock data
- **Responsive:** Mobile-friendly where possible

---

## Success Criteria

1. ✅ Demo-ready within 1 week
2. ✅ Impresses non-technical stakeholders
3. ✅ Clearly demonstrates MINT AI capabilities
4. ✅ Shows professional treasury management features
5. ✅ UCT can use as template for actual implementation
