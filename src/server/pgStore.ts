import pg from "pg";
import type { RegistrationInput } from "../shared/validation.js";
import {
  newRegistration,
  type AddResult,
  type PaymentStatus,
  type Registration,
  type RegistrationStore,
  type RequestMeta,
} from "./store.js";

// Arbitrary constant key for the advisory lock that serialises "count seats -> insert".
const SEAT_LOCK_KEY = 4_990_241_026;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS registrations (
  id             uuid PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL CHECK (status IN ('registered', 'waitlist')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  paid_at        timestamptz,
  full_name      text NOT NULL,
  email          text NOT NULL,
  phone          text NOT NULL,
  city           text NOT NULL DEFAULT '',
  role           text NOT NULL DEFAULT '',
  experience     text NOT NULL DEFAULT '',
  job_function   text NOT NULL DEFAULT '',
  linkedin       text NOT NULL DEFAULT '',
  ai_worry       text NOT NULL DEFAULT '',
  source         text NOT NULL DEFAULT '',
  consent        boolean NOT NULL DEFAULT false,
  ip             text,
  user_agent     text
);
CREATE UNIQUE INDEX IF NOT EXISTS registrations_email_lower_uq ON registrations (lower(email));
CREATE INDEX IF NOT EXISTS registrations_created_at_idx ON registrations (created_at);
`;

interface Row {
  id: string;
  created_at: Date;
  status: Registration["status"];
  payment_status: PaymentStatus;
  paid_at: Date | null;
  full_name: string;
  email: string;
  phone: string;
  city: string;
  role: string;
  experience: string;
  job_function: string;
  linkedin: string;
  ai_worry: string;
  source: string;
  consent: boolean;
  ip: string | null;
  user_agent: string | null;
}

function fromRow(r: Row): Registration {
  return {
    id: r.id,
    status: r.status,
    paymentStatus: r.payment_status,
    paidAt: r.paid_at ? r.paid_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    city: r.city,
    role: r.role,
    experience: r.experience,
    jobFunction: r.job_function,
    linkedin: r.linkedin,
    aiWorry: r.ai_worry,
    source: r.source,
    consent: r.consent,
    ip: r.ip ?? undefined,
    userAgent: r.user_agent ?? undefined,
  };
}

/** Postgres store (Neon, Supabase, Render Postgres, ...). Safe across multiple app instances. */
export class PgStore implements RegistrationStore {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
    // Idle clients can be dropped by serverless Postgres (e.g. Neon autosuspend); don't crash on that.
    this.pool.on("error", (err) => console.error("Postgres pool error (will reconnect):", err.message));
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async all(): Promise<Registration[]> {
    const { rows } = await this.pool.query<Row>("SELECT * FROM registrations ORDER BY created_at, id");
    return rows.map(fromRow);
  }

  async registeredCount(): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM registrations WHERE status = 'registered'",
    );
    return rows[0].n;
  }

  async add(input: RegistrationInput, seatLimit: number, meta: RequestMeta): Promise<AddResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialise concurrent sign-ups so the seat cap can't be exceeded (held until COMMIT/ROLLBACK).
      await client.query("SELECT pg_advisory_xact_lock($1)", [SEAT_LOCK_KEY]);
      const dup = await client.query("SELECT 1 FROM registrations WHERE lower(email) = lower($1)", [input.email]);
      if (dup.rowCount) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "duplicate" };
      }
      const { rows } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM registrations WHERE status = 'registered'",
      );
      const reg = newRegistration(input, rows[0].n < seatLimit ? "registered" : "waitlist", meta);
      const inserted = await client.query<Row>(
        `INSERT INTO registrations
           (id, created_at, status, payment_status, full_name, email, phone, city, role, experience,
            job_function, linkedin, ai_worry, source, consent, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          reg.id, reg.createdAt, reg.status, reg.paymentStatus, reg.fullName, reg.email, reg.phone, reg.city,
          reg.role, reg.experience, reg.jobFunction, reg.linkedin, reg.aiWorry, reg.source, reg.consent,
          reg.ip ?? null, reg.userAgent ?? null,
        ],
      );
      await client.query("COMMIT");
      return { ok: true, reg: fromRow(inserted.rows[0]) };
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      // Unique index on lower(email) is the final guard against duplicates.
      if (err?.code === "23505") return { ok: false, reason: "duplicate" };
      throw err;
    } finally {
      client.release();
    }
  }

  async setPaymentStatus(id: string, status: PaymentStatus): Promise<Registration | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null; // avoid a uuid cast error for junk ids
    const { rows } = await this.pool.query<Row>(
      `UPDATE registrations
          SET payment_status = $2,
              paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END
        WHERE id = $1
        RETURNING *`,
      [id, status],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
