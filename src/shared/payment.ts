// UPI + WhatsApp payment helpers (used by server and client).
import { EVENT } from "./event.js";

export interface PaymentInfo {
  amountInr: number;
  /** Hosted payment page (Razorpay). Primary way to pay. */
  paymentUrl: string;
  /** Mobile number to pay via UPI ("pay to phone number" in GPay/PhonePe/Paytm). Digits only. */
  upiNumber: string;
  /** WhatsApp number in international format, digits only (e.g. 919271286809). */
  whatsappNumber: string;
}

/** Razorpay payment page. Set PAYMENT_URL to override, or PAYMENT_URL=off to fall back to UPI only. */
export const DEFAULT_PAYMENT_URL = "https://rzp.io/rzp/Fu5CQ8QD";
export const DEFAULT_UPI_NUMBER = "9271286809";
export const DEFAULT_WHATSAPP_NUMBER = "919271286809";

export const digitsOnly = (s: string) => s.replace(/\D/g, "");

/** Human-friendly WhatsApp number: Indian numbers shown as the 10-digit mobile, others as +CC... */
export function displayWhatsapp(intl: string): string {
  const d = digitsOnly(intl);
  return d.length === 12 && d.startsWith("91") ? d.slice(2) : `+${d}`;
}

export function whatsappMessage(fullName: string, email: string): string {
  return (
    `Hi Tushar, I'm ${fullName} (${email}). I have paid ₹${EVENT.priceInr} for the AI workshop on 31 Oct ` +
    `(Sat, 5:00-6:30 PM IST). Sharing the payment screenshot here.`
  );
}

export function whatsappUrl(whatsappNumber: string, fullName: string, email: string): string {
  return `https://wa.me/${digitsOnly(whatsappNumber)}?text=${encodeURIComponent(whatsappMessage(fullName, email))}`;
}
