import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { EVENT, googleCalendarUrl } from "../shared/event.js";
import { validateRegistration } from "../shared/validation.js";
import { DEFAULT_PAYMENT_URL, DEFAULT_UPI_NUMBER, DEFAULT_WHATSAPP_NUMBER, digitsOnly, whatsappUrl, type PaymentInfo } from "../shared/payment.js";
import { JsonStore, PAYMENT_STATUSES, type PaymentStatus, type RegistrationStore } from "./store.js";
import { PgStore } from "./pgStore.js";
import { toCsv } from "./csv.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const SEAT_LIMIT = Number(process.env.SEAT_LIMIT) || EVENT.defaultSeatLimit;
const DATA_FILE = path.resolve(ROOT, process.env.DATA_FILE || "data/registrations.json");
const DATABASE_URL = (process.env.DATABASE_URL ?? "").trim();
const PAYMENT: PaymentInfo = {
  amountInr: EVENT.priceInr,
  paymentUrl: (process.env.PAYMENT_URL ?? "").trim() || DEFAULT_PAYMENT_URL,
  upiNumber: digitsOnly(process.env.UPI_NUMBER ?? "") || DEFAULT_UPI_NUMBER,
  whatsappNumber: digitsOnly(process.env.WHATSAPP_NUMBER ?? "") || DEFAULT_WHATSAPP_NUMBER,
};

// Postgres when DATABASE_URL is set (durable on free hosts), otherwise the local JSON file.
const store: RegistrationStore = DATABASE_URL ? new PgStore(DATABASE_URL) : new JsonStore(DATA_FILE);
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true); // Render/Railway sit behind a proxy

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use(express.json({ limit: "20kb" }));

// ---- Very small in-memory rate limiter for the register endpoint ----
const hits = new Map<string, number[]>();
function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (recent.length > max) {
      res.status(429).json({ error: "Too many attempts. Please wait a minute and try again." });
      return;
    }
    next();
  };
}

async function seatInfo() {
  const taken = await store.registeredCount();
  return { seatLimit: SEAT_LIMIT, seatsTaken: taken, seatsLeft: Math.max(0, SEAT_LIMIT - taken), soldOut: taken >= SEAT_LIMIT };
}

// ---- Public API ----
const health = (_req: Request, res: Response) => res.json({ ok: true, storage: store.kind });
app.get("/healthz", health);
app.get("/api/health", health);

// Public config: event details, seats and UPI/WhatsApp payment numbers.
app.get("/api/event", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...EVENT, ...(await seatInfo()), calendarUrl: googleCalendarUrl(), payment: PAYMENT });
  } catch (err) {
    next(err);
  }
});

app.post("/api/register", rateLimit(10, 60_000), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Honeypot: bots fill hidden "website" field. Pretend success, store nothing.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    const name = typeof body.fullName === "string" ? body.fullName.slice(0, 100) : "";
    const email = typeof body.email === "string" ? body.email.slice(0, 254) : "";
    res.status(201).json({
      status: "registered", fullName: name, email, calendarUrl: googleCalendarUrl(),
      payment: { ...PAYMENT, whatsappUrl: whatsappUrl(PAYMENT.whatsappNumber, name, email) },
    });
    return;
  }
  const result = validateRegistration(body);
  if (!result.ok) {
    res.status(400).json({ error: "Please fix the highlighted fields.", errors: result.errors });
    return;
  }
  try {
    const out = await store.add(result.data, SEAT_LIMIT, {
      ip: req.ip,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
    });
    if (!out.ok) {
      res.status(409).json({
        error: "This email is already registered. Check your inbox (and spam) for details.",
        errors: { email: "This email is already registered." },
      });
      return;
    }
    const { reg } = out;
    res.status(201).json({
      id: reg.id,
      status: reg.status,
      fullName: reg.fullName,
      email: reg.email,
      calendarUrl: googleCalendarUrl(),
      paymentStatus: reg.paymentStatus,
      payment:
        reg.status === "registered"
          ? { ...PAYMENT, whatsappUrl: whatsappUrl(PAYMENT.whatsappNumber, reg.fullName, reg.email) }
          : null,
      event: { title: EVENT.title, displayDate: EVENT.displayDate, displayTime: EVENT.displayTime },
      ...(await seatInfo()),
    });
  } catch (err) {
    console.error("Failed to save registration", err);
    res.status(500).json({ error: "Something went wrong saving your registration. Please try again." });
  }
});

// ---- Admin API (token protected) ----
function tokenMatches(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: "Admin is disabled. Set the ADMIN_TOKEN environment variable." });
    return;
  }
  const header = req.headers.authorization ?? "";
  const given =
    (header.startsWith("Bearer ") ? header.slice(7) : "") ||
    String(req.headers["x-admin-token"] ?? "") ||
    String(req.query.token ?? "");
  if (!given || !tokenMatches(given)) {
    res.status(401).json({ error: "Invalid or missing admin token." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  next();
}

app.get("/api/admin/registrations", requireAdmin, async (_req, res, next) => {
  try {
    const rows = await store.all();
    res.json({
      ...(await seatInfo()),
      waitlistCount: rows.filter((r) => r.status === "waitlist").length,
      paidCount: rows.filter((r) => r.paymentStatus === "paid").length,
      total: rows.length,
      payment: PAYMENT,
      registrations: rows,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/admin/registrations.csv", requireAdmin, async (_req, res, next) => {
  try {
    const csv = toCsv(await store.all());
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ai-workshop-registrations-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// Mark a registration as paid (default) or back to pending. Body: {"paymentStatus":"paid"|"pending"}.
app.post("/api/admin/registrations/:id/payment", requireAdmin, async (req, res, next) => {
  try {
    const wanted = (req.body?.paymentStatus ?? "paid") as PaymentStatus;
    if (!PAYMENT_STATUSES.includes(wanted)) {
      res.status(400).json({ error: `paymentStatus must be one of: ${PAYMENT_STATUSES.join(", ")}` });
      return;
    }
    const reg = await store.setPaymentStatus(String(req.params.id), wanted);
    if (!reg) {
      res.status(404).json({ error: "Registration not found." });
      return;
    }
    res.json({ ok: true, registration: reg });
  } catch (err) {
    next(err);
  }
});

// ---- Static frontend ----
app.get("/admin", (_req, res) => res.sendFile(path.join(ROOT, "public", "admin.html")));
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use((_req, res) => res.status(404).sendFile(path.join(ROOT, "public", "index.html")));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body." });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Request too large." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

await store.init();
if (store.kind === "json" && process.env.RENDER) {
  console.warn("WARNING: DATABASE_URL is not set. Render's disk is ephemeral, so registrations WILL BE LOST on restart/sleep.");
}
// Bind on all interfaces so PaaS routers (Render etc.) can reach the app on $PORT.
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI workshop registration running on http://localhost:${PORT}`);
  const storage = store.kind === "postgres" ? "Postgres (DATABASE_URL)" : `JSON file ${DATA_FILE}`;
  console.log(`Storage: ${storage} | Seat limit: ${SEAT_LIMIT} | Pay: ${PAYMENT.paymentUrl} | UPI fallback: ${PAYMENT.upiNumber} | WhatsApp: ${PAYMENT.whatsappNumber} | Admin: ${ADMIN_TOKEN ? "enabled" : "DISABLED (set ADMIN_TOKEN)"}`);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    server.close(() => void store.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
