// Shared validation used by both the browser form and the API.

export const EXPERIENCE_OPTIONS = ["0-2", "2-5", "5-8", "8-12", "12+"] as const;
export const FUNCTION_OPTIONS = [
  "Customer support",
  "Content/marketing",
  "QA/testing",
  "Operations/back-office",
  "Other",
] as const;
export const SOURCE_OPTIONS = [
  "LinkedIn",
  "WhatsApp group",
  "Instagram",
  "X / Twitter",
  "YouTube",
  "Airtribe",
  "Friend or colleague",
  "Other",
] as const;

export interface RegistrationInput {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  role: string;
  experience: string;
  jobFunction: string;
  linkedin: string;
  aiWorry: string;
  source: string;
  consent: boolean;
}

export type FieldErrors = Partial<Record<keyof RegistrationInput, string>>;

const LIMITS = { fullName: 100, email: 254, city: 80, role: 120, linkedin: 300, aiWorry: 1500 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Normalise an Indian/international phone. Returns E.164 (e.g. +919876543210) or null. */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`; // bare 10-digit Indian mobile
  if (/^0[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned.slice(1)}`;
  if (cleaned.startsWith("+91")) {
    return /^\+91[6-9]\d{9}$/.test(cleaned) ? cleaned : null;
  }
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned; // other countries
  return null;
}

export function normalizeLinkedin(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "";
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    if (u.pathname.length < 2) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Validates and normalises raw input. Returns cleaned data or field errors. */
export function validateRegistration(
  raw: Record<string, unknown>,
): { ok: true; data: RegistrationInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const data: RegistrationInput = {
    fullName: str(raw.fullName).replace(/\s+/g, " "),
    email: str(raw.email).toLowerCase(),
    phone: str(raw.phone),
    city: str(raw.city),
    role: str(raw.role),
    experience: str(raw.experience),
    jobFunction: str(raw.jobFunction),
    linkedin: str(raw.linkedin),
    aiWorry: str(raw.aiWorry),
    source: str(raw.source),
    consent: raw.consent === true || raw.consent === "true" || raw.consent === "on",
  };

  if (data.fullName.length < 2) errors.fullName = "Please enter your full name.";
  else if (data.fullName.length > LIMITS.fullName) errors.fullName = "Name is too long.";

  if (!data.email) errors.email = "Email is required.";
  else if (data.email.length > LIMITS.email || !EMAIL_RE.test(data.email))
    errors.email = "Please enter a valid email address.";

  const phone = normalizePhone(data.phone);
  if (!data.phone || data.phone === "+91") errors.phone = "Phone/WhatsApp number is required.";
  else if (!phone) errors.phone = "Enter a valid mobile number, e.g. +91 98765 43210.";
  else data.phone = phone;

  if (data.city.length > LIMITS.city) errors.city = "City is too long.";

  if (data.role.length < 2) errors.role = "Please tell us your current role/job title.";
  else if (data.role.length > LIMITS.role) errors.role = "Role is too long.";

  if (data.experience && !(EXPERIENCE_OPTIONS as readonly string[]).includes(data.experience))
    errors.experience = "Please pick an option.";
  if (data.jobFunction && !(FUNCTION_OPTIONS as readonly string[]).includes(data.jobFunction))
    errors.jobFunction = "Please pick an option.";
  if (data.source && !(SOURCE_OPTIONS as readonly string[]).includes(data.source))
    errors.source = "Please pick an option.";

  if (data.linkedin) {
    const li = data.linkedin.length > LIMITS.linkedin ? null : normalizeLinkedin(data.linkedin);
    if (li === null) errors.linkedin = "Enter a valid LinkedIn profile URL (linkedin.com/in/...).";
    else data.linkedin = li;
  }

  if (data.aiWorry.length > LIMITS.aiWorry)
    errors.aiWorry = `Please keep this under ${LIMITS.aiWorry} characters.`;

  if (!data.consent)
    errors.consent = "Please agree so we can send you the Zoom link and workshop updates.";

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}
