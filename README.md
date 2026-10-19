# AI Workshop Registration

Registration site for the live online workshop:

> **Is AI coming for your job? Build your first AI project in 90 minutes.**
> Host: Tushar Khandelwal (former US-based AI product manager, Airtribe mentor/instructor)
> **Saturday, 31 Oct 2026 · 5:00–6:30 PM IST** · Online (Zoom link sent after registration) · **₹499** · **50 seats**

TypeScript throughout: a small **Express** server plus a single static page whose scripts are compiled from TypeScript with `tsc`. No frontend or CSS framework. Runtime dependencies: `express` and `pg`. Storage is **Postgres** when `DATABASE_URL` is set (use this on free hosts), otherwise a local JSON file.

## Features
- Landing section with the pitch and event details, followed by the registration form
- Fields: full name\*, email\*, phone/WhatsApp\* (defaults to `+91`), city, role/job title\*, years of experience, function, LinkedIn (optional), "biggest worry about AI", how you heard, and a consent checkbox\*
- The same validation code (`src/shared/validation.ts`) runs in the browser and on the server
  - Phone numbers are normalised to E.164 (`98765 43210` → `+919876543210`). Indian mobiles must be 10 digits starting with 6–9, and other `+CC` numbers are allowed
  - LinkedIn URLs must be on `linkedin.com`. A missing `https://` is added automatically
- Duplicate emails are rejected with HTTP 409. The check ignores case and surrounding spaces
- **Seat cap** (default 50): once the confirmed seats are full, the page switches to a "Sold out · join the waitlist" state. Waitlist entries are still saved with `status: "waitlist"`
- **Payment by UPI** (no gateway): the thank-you screen says *Pay ₹499 via UPI to 9271286809* with a **Copy number** button (works in GPay/PhonePe/Paytm etc. via "pay to phone number"), then *Send the payment screenshot on WhatsApp* with a button to `https://wa.me/<WHATSAPP_NUMBER>?text=…` pre-filled with the person's name, email and "paid ₹499 for the AI workshop on 31 Oct". Waitlisted people see a waitlist message and no payment steps. No `upi://` link is generated (we only have a phone number, not a VPA)
- Thank-you screen also shows the event date/time in IST and an **Add to Google Calendar** link
- Every registration has `paymentStatus` (`pending` by default). Admin page at `/admin` (protected by `ADMIN_TOKEN`) shows the table with a **Payment** column and a **Mark paid** / Undo button, seat/waitlist/paid counts, and a CSV download (includes `paymentStatus` and `paidAt`)
- Small extras: a honeypot anti-bot field, a per-IP rate limit (10 submissions/min), a 20 KB body limit, protection against spreadsheet formula injection in the CSV, a UTF-8 BOM so Excel opens the CSV correctly, atomic file writes (JSON) / transactional inserts (Postgres), and `/healthz` for health checks

## Quick start
```bash
npm install
cp .env.example .env        # optional; edit the values (see "Environment variables")
npm run dev                 # http://localhost:3000  (rebuilds the client TS and restarts the server on change)
```
Production:
```bash
npm run build               # compiles the client to public/js and the server to dist/
ADMIN_TOKEN=... npm start                                  # JSON file storage
ADMIN_TOKEN=... DATABASE_URL=postgresql://... npm start    # Postgres storage
```
Node 18+ is required (tested on Node 20). The app doesn't load `.env` itself, so export the variables in your shell or set them in your host's dashboard. For local use you can also run `node --env-file=.env dist/server/index.js` (Node 20.6+).

> `npm run dev` uses `&` to run two watchers, so it works in macOS/Linux/WSL shells. On plain Windows cmd, run `npm run build && npm start` instead.

## Environment variables
| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port (Render and Railway set this automatically) |
| `ADMIN_TOKEN` | *(unset → admin disabled)* | Secret for `/admin` and `/api/admin/*`. Use a long random string |
| `UPI_NUMBER` | `9271286809` | Mobile number people pay via UPI (digits; spaces are stripped) |
| `WHATSAPP_NUMBER` | `919271286809` | WhatsApp number for payment screenshots, with country code, no `+` |
| `SEAT_LIMIT` | `50` | Number of confirmed seats before the waitlist starts |
| `DATABASE_URL` | *(unset)* | Postgres connection string. If set, Postgres is used (table auto-created); otherwise `DATA_FILE` |
| `DATA_FILE` | `data/registrations.json` | JSON storage file (only when `DATABASE_URL` is unset) |

`PAYMENT_URL` from earlier versions is no longer used (a warning is logged if it's set).

Event details (title, date and time) are in `src/shared/event.ts`. The copy on the landing page is in `public/index.html`.

## API
| Method & path | Notes |
|---|---|
| `GET /healthz` (also `/api/health`) | `{ok: true, storage: "json"\|"postgres"}` |
| `GET /api/event` | Public config: event info, `seatsLeft`/`soldOut`, and `payment: {amountInr, upiNumber, whatsappNumber}` |
| `POST /api/register` | JSON body. Returns `201` with `{id, status: "registered"\|"waitlist", paymentStatus, calendarUrl, payment: {upiNumber, whatsappNumber, whatsappUrl, amountInr} \| null}`, `400` with `{errors}`, `409` for a duplicate email, or `429` when rate limited |
| `GET /api/admin/registrations` | JSON list. Send the token as `Authorization: Bearer <token>`, `X-Admin-Token: <token>` or `?token=` |
| `GET /api/admin/registrations.csv` | CSV download (same auth) |
| `POST /api/admin/registrations/:id/payment` | Mark paid (same auth). Optional body `{"paymentStatus":"paid"\|"pending"}` (default `paid`) |
| `GET /admin` | Admin UI |

```bash
curl -X POST localhost:3000/api/register -H 'Content-Type: application/json' -d '{
  "fullName":"Priya Sharma","email":"priya@example.com","phone":"+91 98765 43210",
  "role":"Support Lead","experience":"5-8","jobFunction":"Customer support","consent":true}'
curl -H "Authorization: Bearer $ADMIN_TOKEN" localhost:3000/api/admin/registrations.csv -o registrations.csv
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" localhost:3000/api/admin/registrations/<id>/payment   # mark paid
```

## Project structure
```
src/shared/event.ts        event config + Google Calendar link builder (used by server and client)
src/shared/validation.ts   shared validation/normalisation
src/shared/payment.ts      UPI/WhatsApp config types + wa.me link builder
src/server/index.ts        Express app: API, admin auth, static files, store selection
src/server/store.ts        RegistrationStore interface + JSON-file store (serialised writes, atomic rename)
src/server/pgStore.ts      Postgres store (auto-creates table; advisory-lock transaction + unique lower(email) index)
src/server/csv.ts          CSV export
src/client/main.ts         registration page logic → public/js/client/main.js
src/client/admin.ts        admin page logic       → public/js/client/admin.js
public/index.html, admin.html, styles.css
tsconfig.server.json / tsconfig.client.json
render.yaml                Render Blueprint (free web service)
```

## Deploy for free (Neon Postgres + Render)
Free web hosts have **ephemeral disks** (Render free loses local files on every restart, redeploy or sleep), so in production keep data in a free hosted Postgres via `DATABASE_URL`. The app creates its table on startup.

**Accounts needed (all free, no card):** GitHub, Neon (or Supabase), Render.

1. **Push to GitHub.** Create an empty repo (private is fine) on github.com, then in this folder:
   ```bash
   git remote add origin https://github.com/<you>/ai-workshop-registration.git
   git push -u origin main
   ```
2. **Create the database (Neon).** Sign up at [neon.tech](https://neon.tech) → New project (pick **AWS Asia Pacific (Singapore)** for low latency from India) → **Connect** → copy the connection string (`postgresql://…neon.tech/neondb?sslmode=require…`). Use the **pooled** string if offered.
   - *Supabase alternative:* New project → **Connect** → copy the **Session pooler** URI (the direct `db.<ref>.supabase.co` host is IPv6-only and may not be reachable from Render). If you get a `self-signed certificate` error, change `sslmode=require` to `sslmode=no-verify` at the end of the URL. Note that Supabase pauses free projects after about a week of inactivity.
3. **Deploy on Render.** Sign up at [render.com](https://render.com) with GitHub → **New → Blueprint** → choose the repo. Render reads `render.yaml` (free web service in Singapore, `npm install && npm run build`, `npm start`, health check `/healthz`). When asked, paste the connection string into **`DATABASE_URL`**. `ADMIN_TOKEN` is generated for you; `UPI_NUMBER`, `WHATSAPP_NUMBER` and `SEAT_LIMIT=50` are preset (edit them in the service's **Environment** tab).
   - Manual alternative: **New → Web Service** → repo → Runtime Node, Build `npm install && npm run build`, Start `npm start`, Instance type **Free**, then add the same env vars.
4. Open `https://<service>.onrender.com`. Logs should say `Storage: Postgres (DATABASE_URL)`. Check `https://<service>.onrender.com/healthz` → `{"ok":true,"storage":"postgres"}`.
5. **Admin:** copy `ADMIN_TOKEN` from Render → Environment, then open `/admin`.

**Free tier notes**
- Render free services **sleep after 15 minutes without traffic**; the next visit takes about a minute to wake up. Optionally keep it awake with a free uptime pinger (e.g. UptimeRobot or cron-job.org hitting `/healthz` every 10–14 min). One always-on service uses about 744 of Render's 750 free hours/month, so that's fine for one service.
- Neon's free compute also scales to zero when idle; the first query after a pause adds a short delay.
- If `DATABASE_URL` is missing on Render, the app falls back to the JSON file and logs a loud warning: data **will** be lost on restart.
- Alternatives: Railway and Koyeb no longer offer a free tier for new accounts (Railway has a one-time trial credit, then about $5/mo; Koyeb now starts at a paid plan). Any host that can run Node works with the same `DATABASE_URL` setup.

Always serve over HTTPS (Render does) because the admin token travels in a header. Download the CSV from `/admin` now and then as a backup.

## Caveats / next steps
- **Payment is manual.** People pay by UPI to a phone number and send a screenshot on WhatsApp; you check your UPI app and click **Mark paid** in `/admin`. A seat counts as taken when someone registers, not when they pay, so unpaid seats aren't released automatically.
- **No emails or WhatsApp messages are sent.** The Zoom link has to be sent separately, using the CSV, a mail tool or WhatsApp broadcast.
- The JSON store is meant for one server process on a persistent disk. The Postgres store is safe across instances (an advisory-lock transaction enforces the seat cap; a unique index on `lower(email)` blocks duplicates).
- The rate limiter keeps its counts in memory and resets when the server restarts.
