import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RegistrationInput } from "../shared/validation.js";

export type RegistrationStatus = "registered" | "waitlist";
export type PaymentStatus = "pending" | "paid";
export const PAYMENT_STATUSES: readonly PaymentStatus[] = ["pending", "paid"];

export interface Registration extends RegistrationInput {
  id: string;
  status: RegistrationStatus;
  paymentStatus: PaymentStatus;
  paidAt?: string | null; // ISO UTC, set when marked paid
  createdAt: string; // ISO UTC
  ip?: string;
  userAgent?: string;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export type AddResult = { ok: true; reg: Registration } | { ok: false; reason: "duplicate" };

/** Storage backend used by the server. Implemented by JsonStore (file) and PgStore (Postgres). */
export interface RegistrationStore {
  readonly kind: "json" | "postgres";
  init(): Promise<void>;
  all(): Promise<Registration[]>;
  registeredCount(): Promise<number>;
  /** Atomically rejects duplicate emails and assigns "registered" or "waitlist" based on seatLimit. */
  add(input: RegistrationInput, seatLimit: number, meta: RequestMeta): Promise<AddResult>;
  /** Returns the updated registration, or null if the id doesn't exist. */
  setPaymentStatus(id: string, status: PaymentStatus): Promise<Registration | null>;
  close(): Promise<void>;
}

export function newRegistration(input: RegistrationInput, status: RegistrationStatus, meta: RequestMeta): Registration {
  return {
    id: randomUUID(),
    status,
    paymentStatus: "pending",
    paidAt: null,
    createdAt: new Date().toISOString(),
    ...input,
    ...meta,
  };
}

/**
 * Tiny JSON-file store. All mutations go through a promise queue so the
 * "count seats -> insert" sequence is atomic within this process, and writes
 * are done via temp-file + rename so a crash can't leave a half-written file.
 */
export class JsonStore implements RegistrationStore {
  readonly kind = "json" as const;
  private items: Registration[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly file: string) {}

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw);
      // Older files have no paymentStatus: default those rows to "pending".
      this.items = (Array.isArray(parsed) ? parsed : []).map((r: Registration) => ({
        ...r,
        paymentStatus: r.paymentStatus === "paid" ? "paid" : "pending",
      }));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
      this.items = [];
      await this.persist();
    }
  }

  async all(): Promise<Registration[]> {
    return this.items.map((r) => ({ ...r }));
  }

  async registeredCount(): Promise<number> {
    return this.count();
  }

  private count(): number {
    return this.items.filter((r) => r.status === "registered").length;
  }

  add(input: RegistrationInput, seatLimit: number, meta: RequestMeta): Promise<AddResult> {
    return this.enqueue(async () => {
      const email = input.email.trim().toLowerCase();
      if (this.items.some((r) => r.email.toLowerCase() === email)) return { ok: false as const, reason: "duplicate" as const };
      const reg = newRegistration(input, this.count() < seatLimit ? "registered" : "waitlist", meta);
      this.items.push(reg);
      try {
        await this.persist();
      } catch (e) {
        this.items.pop();
        throw e;
      }
      return { ok: true as const, reg: { ...reg } };
    });
  }

  setPaymentStatus(id: string, status: PaymentStatus): Promise<Registration | null> {
    return this.enqueue(async () => {
      const idx = this.items.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      const before = this.items[idx];
      const after: Registration = {
        ...before,
        paymentStatus: status,
        paidAt: status === "paid" ? before.paidAt || new Date().toISOString() : null,
      };
      this.items[idx] = after;
      try {
        await this.persist();
      } catch (e) {
        this.items[idx] = before;
        throw e;
      }
      return { ...after };
    });
  }

  async close(): Promise<void> {
    await this.queue;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async persist(): Promise<void> {
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.items, null, 2), "utf8");
    await fs.rename(tmp, this.file);
  }
}
