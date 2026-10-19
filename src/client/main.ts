import { validateRegistration, type FieldErrors } from "../shared/validation.js";
import { displayWhatsapp, whatsappUrl, type PaymentInfo } from "../shared/payment.js";

interface EventInfo {
  seatLimit: number;
  seatsLeft: number;
  soldOut: boolean;
}

interface RegisterResponse extends Partial<EventInfo> {
  status?: "registered" | "waitlist";
  fullName?: string;
  email?: string;
  calendarUrl?: string;
  payment?: (PaymentInfo & { whatsappUrl?: string }) | null;
  error?: string;
  errors?: FieldErrors;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;


function renderSeats(info: EventInfo): void {
  const pill = $("#seats-pill");
  pill.hidden = false;
  if (info.soldOut) {
    pill.textContent = "Sold out · waitlist open";
    pill.classList.add("low");
    $("#hero-cta").textContent = "Join the waitlist";
    $("#form-title").textContent = "Join the waitlist";
    $("#soldout-banner").hidden = false;
    $("#submit-btn").textContent = "Join waitlist";
    $("#form-sub").innerHTML = 'Fields marked <span class="req">*</span> are required.';
  } else {
    pill.textContent = `${info.seatsLeft} of ${info.seatLimit} seats left`;
    pill.classList.toggle("low", info.seatsLeft <= 10);
  }
}

function clearErrors(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLElement>(".err").forEach((el) => (el.textContent = ""));
  form.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  $("#form-error").hidden = true;
}

function showErrors(form: HTMLFormElement, errors: FieldErrors): void {
  let first: HTMLElement | null = null;
  for (const [field, msg] of Object.entries(errors)) {
    const errEl = form.querySelector<HTMLElement>(`.err[data-for="${field}"]`);
    if (errEl) errEl.textContent = msg ?? "";
    const input = form.elements.namedItem(field) as HTMLElement | null;
    if (input) {
      input.closest(".field")?.classList.add("invalid");
      input.setAttribute("aria-invalid", "true");
      if (!first) first = input;
    }
  }
  first?.focus();
}

function readForm(form: HTMLFormElement): Record<string, unknown> {
  const fd = new FormData(form);
  const out: Record<string, unknown> = {};
  fd.forEach((v, k) => (out[k] = typeof v === "string" ? v : ""));
  out.consent = (form.elements.namedItem("consent") as HTMLInputElement).checked;
  return out;
}

function showThanks(res: RegisterResponse): void {
  $("#form-view").hidden = true;
  const view = $("#thanks-view");
  view.hidden = false;
  const firstName = (res.fullName ?? "").split(" ")[0] || "there";
  const gcal = $<HTMLAnchorElement>("#gcal-btn");
  gcal.href = res.calendarUrl ?? "#";
  const payBox = $("#pay-box");
  if (res.status === "waitlist") {
    $("#thanks-title").textContent = "You're on the waitlist";
    $("#thanks-msg").textContent =
      `Thanks, ${firstName}! This batch is full, but you're on the waitlist. We'll reach out on email/WhatsApp if a seat opens up or when the next batch is announced.`;
    payBox.hidden = true;
    $("#thanks-fine").textContent = "No payment needed for the waitlist.";
  } else {
    $("#thanks-title").textContent = "You're in!";
    $("#thanks-msg").textContent =
      `Thanks, ${firstName}! Your seat is held. Pay ₹499 below to confirm it. The Zoom link will be sent to your email and WhatsApp before the session.`;
    renderPayment(res);
    payBox.hidden = false;
    $("#thanks-fine").textContent = "Your seat is confirmed once payment goes through.";
  }
  if (typeof res.seatsLeft === "number" && typeof res.seatLimit === "number")
    renderSeats({ seatsLeft: res.seatsLeft, seatLimit: res.seatLimit, soldOut: !!res.soldOut });
  view.focus();
  view.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPayment(res: RegisterResponse): void {
  const p = res.payment;
  if (!p) return;
  if (p.paymentUrl) $<HTMLAnchorElement>("#pay-btn").href = p.paymentUrl;
  document.querySelectorAll<HTMLElement>("[data-upi-number]").forEach((el) => (el.textContent = p.upiNumber));
  document.querySelectorAll<HTMLElement>("[data-wa-number]").forEach((el) => (el.textContent = displayWhatsapp(p.whatsappNumber)));
  document.querySelectorAll<HTMLElement>("[data-amount]").forEach((el) => (el.textContent = `₹${p.amountInr}`));
  $<HTMLAnchorElement>("#wa-btn").href = p.whatsappUrl ?? whatsappUrl(p.whatsappNumber, res.fullName ?? "", res.email ?? "");
  const copyBtn = $<HTMLButtonElement>("#copy-upi-btn");
  copyBtn.onclick = () => void copyText(p.upiNumber, copyBtn);
}

async function copyText(text: string, btn: HTMLButtonElement): Promise<void> {
  const label = btn.dataset.label ?? (btn.dataset.label = btn.textContent ?? "Copy");
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // Fallback for older browsers / non-HTTPS contexts.
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
  }
  btn.textContent = ok ? "✓ Copied" : `Copy failed — number is ${text}`;
  setTimeout(() => (btn.textContent = label), 2000);
}

async function onSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  clearErrors(form);
  const raw = readForm(form);
  const check = validateRegistration(raw);
  if (!check.ok) {
    showErrors(form, check.errors);
    return;
  }
  const btn = $<HTMLButtonElement>("#submit-btn");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Submitting…";
  try {
    const r = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...check.data, website: raw.website ?? "" }),
    });
    const body = (await r.json().catch(() => ({}))) as RegisterResponse;
    if (r.ok) {
      showThanks(body);
      return;
    }
    if (body.errors) showErrors(form, body.errors);
    const banner = $("#form-error");
    banner.textContent = body.error ?? "Something went wrong. Please try again.";
    banner.hidden = false;
  } catch {
    const banner = $("#form-error");
    banner.textContent = "Network error — please check your connection and try again.";
    banner.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/** Campaign tag from the landing URL: ?src=ig-reel1 or utm_source/medium/campaign. Kept for the tab session. */
function captureUtm(): string {
  const q = new URLSearchParams(location.search);
  const parts = [q.get("src"), q.get("utm_source"), q.get("utm_medium"), q.get("utm_campaign")].filter(Boolean) as string[];
  let tag = parts.join("|").slice(0, 200);
  try {
    if (tag) sessionStorage.setItem("utm", tag);
    else tag = sessionStorage.getItem("utm") ?? "";
  } catch {
    /* storage blocked: use the URL value only */
  }
  return tag;
}

function init(): void {
  const form = $<HTMLFormElement>("#reg-form");
  $<HTMLInputElement>("#utm-field").value = captureUtm();
  form.addEventListener("submit", (e) => void onSubmit(e as SubmitEvent));
  // Clear a field's error as soon as the user edits it.
  form.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.name) return;
    t.closest(".field")?.classList.remove("invalid");
    t.removeAttribute("aria-invalid");
    const errEl = form.querySelector<HTMLElement>(`.err[data-for="${t.name}"]`);
    if (errEl) errEl.textContent = "";
  });
  // Keep the +91 prefix helpful: restore it if the field is emptied.
  const phone = form.elements.namedItem("phone") as HTMLInputElement;
  // Put the caret after the prefix so tabbing in doesn't select/overwrite "+91 ".
  phone.addEventListener("focus", () => {
    if (phone.value.trim() === "+91") {
      const toEnd = () => phone.setSelectionRange(phone.value.length, phone.value.length);
      toEnd();
      requestAnimationFrame(toEnd); // tab-focus selects all after the event in some browsers
    }
  });
  phone.addEventListener("blur", () => {
    if (!phone.value.trim()) phone.value = "+91 ";
  });

  fetch("/api/event", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((info: EventInfo | null) => info && renderSeats(info))
    .catch(() => undefined);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
