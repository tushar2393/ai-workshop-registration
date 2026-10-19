import type { Registration } from "./store.js";

const COLUMNS: (keyof Registration | "createdAtIST")[] = [
  "createdAtIST", "createdAt", "status", "paymentStatus", "paidAt", "fullName", "email", "phone", "city", "role", "experience",
  "jobFunction", "linkedin", "aiWorry", "source", "utm", "consent", "id",
];

function cell(value: unknown): string {
  let s = value === undefined || value === null ? "" : String(value);
  // Guard against spreadsheet formula injection (but keep phone numbers like +9198... intact).
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d+$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function istString(iso: string): string {
  // e.g. 2026-10-18 22:08:56 (IST)
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function toCsv(rows: Registration[]): string {
  const lines = [COLUMNS.join(",")];
  for (const r of rows) {
    const withIst = { ...r, createdAtIST: istString(r.createdAt) };
    lines.push(COLUMNS.map((c) => cell(withIst[c])).join(","));
  }
  // BOM so Excel opens UTF-8 (₹, Hindi names, etc.) correctly.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
