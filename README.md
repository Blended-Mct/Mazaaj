# Mizaj (مزاج) — Customer Mood Intelligence

**Know the mood before you say hello.**

Mizaj gives Omantel call centre and outlet agents a quick read on how a customer is *likely* feeling before the conversation starts. It also explains why it thinks so, and suggests how to open the conversation and what to do next.

> **Demo build.** All customers are fictional and every customer data source is simulated. The app labels this everywhere (banner, `DEMO DATA` chips, and `meta.dataMode: "demo"` in every API response). The integrations page shows which parts are simulated and which are live endpoints.

## Quick start

```bash
npm start            # Node 18+. No dependencies to install.
# → http://localhost:3000
```

There is no login screen, by design. Type a phone number such as `9000 1001` and press Enter.

### Hosted demo (no server)

```bash
npm run build:demo   # → dist/mizaj-demo.html
```

This builds the whole web app into **one self-contained HTML page** that runs in any browser with no server. The same API handlers, demo data and mood engine run inside the page (`src/browser/local-server.js`), and agent corrections and follow-ups are saved in the viewer's browser. Use it to share the demo. The CTI webhook, REST API and iframe embed only exist when the server runs, and the hosted page says so on its Integrations and API views.

## Three channels

| Channel | Where | What it's for |
|---|---|---|
| **Web app** | `/` | Search by phone number to open the unified profile: mood, greeting, tone, next actions, alerts, unresolved issues, follow-ups, services and bills, surveys and the full timeline. Also includes the team dashboard and the integrations page. |
| **Call popup** | `/popup` | The brief an agent needs while the phone rings. Keep it open beside the softphone and it updates on each incoming call. A CTI system can also open `/popup?phone=…` directly. The **Call popup** tab in the web app shows the same thing in-page. |
| **API** | `/api/v1`, docs at `/docs` | JSON for CRM, IVR and chat systems: `GET /lookup?phone=`, the full profile, mood feedback, follow-ups, the dashboard, a live **CTI webhook** (`POST /calls/incoming`), a Server-Sent Events stream and an embeddable card (`/popup?phone=…&embed=1`). OpenAPI spec: `/api/v1/openapi.json`. |

## Two-minute tour

| Demo customer | Phone | What it shows |
|---|---|---|
| Salim Al-Harthy | 9000 1001 | **Upset**, high confidence. Two missed commitments and a cancellation threat in Arabic, so escalation is **urgent**. |
| Fatma Al-Balushi | 9000 1002 | **Positive**. A resolved roaming issue still appears under "points the other way". |
| Ahmed Al-Rawahi | 9000 1003 | **Frustrated**. His bill doubled and the dispute is open. |
| Maryam Al-Lawati | 9000 1004 | **Unknown**. A brand-new customer with too little evidence. |
| Khalid Al-Saadi | 9000 1005 | **Neutral, low confidence**: the signals are mixed. |
| Aisha Al-Hinai | 9000 1006 | **Frustrated**. A device repair is overdue and the "ready for collection" promise was missed. |
| Yousuf Al-Busaidi | 9000 1007 | **Unknown**. His evidence is over two months old. |
| Noura Al-Kindi | 9000 1008 | **Neutral**. Routine, everyday contact. |
| Hamed Al-Maskari | 9000 1009 | **Agent-reported Neutral** overrides a system estimate of Frustrated. |
| Said Al-Mamari | 9000 1010 | **Frustrated** business customer. His installation slot was missed. |
| Zainab Al-Riyami | 9000 1011 | **Positive**, with feedback in Arabic. |

To try the call flow, click **Simulate call** (top bar), or click **Call popup ↗** first and then simulate. Then open **Dashboard**: frustration has been rising for three weeks because of a simulated fibre fault in Seeb. You can see it in the weekly mood mix, in recurring issues (slow home internet ▲) and in the region chart.

## How the mood estimate works

The engine is in `src/core/mood-engine.js`. It is rule-based on purpose, so every number can be explained.

* **Evidence only.** Mizaj uses tickets (age against SLA, reopens), calls (outcome, hold time, transfers, wrap-up notes), inbound messages (English and Arabic keyword cues, including escalation phrases), CSAT/NPS surveys, outlet visits (wait time, outcome), commitments (kept, late or missed), network incidents, bill shock and repeat contacts about the same issue. It never uses age, gender, nationality or tenure.
* **Recency.** A signal's weight halves every 21 days and the evidence window is 90 days. Open tickets, missed promises and active incidents count in full for as long as they stay open.
* **Score → mood.** ≤ −40 Upset · ≤ −12 Frustrated · < +12 Neutral · ≥ +12 Positive.
* **Unknown when evidence is thin.** With fewer than 2 meaningful signals, or total weight under 8, the mood is **Unknown** and the reason is shown. Mizaj does not guess.
* **Confidence** (High, Medium or Low) depends on the amount, consistency, freshness and strength of the evidence. It drops when signals are mixed or when the most recent interaction points the other way.
* **Never a fact.** Every mood carries a label ("Estimated", "Agent-reported" or "Agent-confirmed"), the reasons and counter-evidence behind it, when it was computed, when the latest evidence arrived, and the disclaimer.
* **Agents have the last word.** An agent can confirm the estimate with one click, or correct it with two clicks and an optional note. The observation leads the display for up to 72 hours, or until newer evidence arrives. The system estimate stays visible beside it. The dashboard tracks how often agents agree with the estimate, and which corrections are most common, so the rules can be tuned.

The suggestions are in `src/core/insights.js`:
* **Greeting** in Arabic and English, in the customer's preferred language first. It is time-of-day aware and has call-centre and outlet versions. It acknowledges the customer's issue without telling them how they feel.
* **Tone**, plus a list of things to avoid.
* **Prioritised next actions**: escalate, deliver missed commitments, chase tickets past SLA, explain bill shock.
* **Escalation flags.** Raised for mentions of cancelling, switching provider, the regulator, legal action or going public; for two or more missed commitments; for a ticket open more than twice its SLA; for four or more contacts about the same issue in 14 days; and for a customer who is upset, either estimated with high confidence or reported by an agent. Each flag is routed to a team.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where the server listens |
| `MIZAJ_CTI_KEY` | _(unset)_ | Require `X-Api-Key` on `POST /api/v1/calls/incoming` |
| `MIZAJ_CORS_ORIGIN` | `*` | CORS origin for `/api` |
| `MIZAJ_EMBED_ORIGINS` | `*` | `frame-ancestors` for the embeddable popup |
| `MIZAJ_STATE_FILE` | `.mizaj/state.json` | Where agent corrections and follow-ups are saved (`""` = memory only) |

## Project layout

```
server.js                 entry point (node:http, no dependencies)
src/core/                 mood engine, sentiment cues, insights, timeline, profile/brief, dashboard
src/data/                 demo data generator, store (+ JSON state), integration registry
src/server/               API route handlers (api.js), HTTP layer, Server-Sent Events
src/browser/              in-browser API for the hosted demo
public/                   web app (index.html), call popup (popup.html), API docs (docs.html), OpenAPI
scripts/                  build-hosted-demo.mjs (single-page hosted demo)
test/                     node:test suites for the engine and the API
```

```bash
npm test
```

## Going to production

* **Connect real systems.** Replace the demo generator in `src/data/` with adapters that map CRM, billing, ticketing, contact centre, messaging, survey, queue and network-incident records to the same shapes. The engine, API and UI stay the same. Update `src/data/integrations.js` so each source reports `live`.
* **No login by design.** Run Mizaj only on the agent network or behind the existing gateway or SSO proxy. Set `MIZAJ_CTI_KEY`, and narrow `MIZAJ_CORS_ORIGIN` and `MIZAJ_EMBED_ORIGINS` to the systems that need them.
* **Customer data.** Review the use of message content and the retention of agent notes against Oman's Personal Data Protection Law and internal policy before connecting real data.
