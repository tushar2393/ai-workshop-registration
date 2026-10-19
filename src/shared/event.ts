// Single source of truth for workshop details (used by server and client).
export const EVENT = {
  title: "Is AI coming for your job? Build your first AI project in 90 minutes.",
  shortTitle: "Build your first AI project in 90 minutes",
  host: "Tushar Khandelwal",
  hostBio: "Product manager (Assured, Innovaccer, Thirty Madison, MathWorks) · 7+ years in the US · Airtribe mentor",
  // 31 Oct 2026, 5:00–6:30 PM IST (UTC+5:30) => 11:30–13:00 UTC
  startUtc: "2026-10-31T11:30:00Z",
  endUtc: "2026-10-31T13:00:00Z",
  displayDate: "Saturday, 31 October 2026",
  displayTime: "5:00 – 6:30 PM IST",
  location: "Online (Zoom link sent after registration)",
  priceInr: 499,
  defaultSeatLimit: 50,
} as const;

function toGCalStamp(iso: string): string {
  // 2026-10-31T11:30:00Z -> 20261031T113000Z
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: EVENT.title,
    dates: `${toGCalStamp(EVENT.startUtc)}/${toGCalStamp(EVENT.endUtc)}`,
    ctz: "Asia/Kolkata",
    details:
      `Live online workshop hosted by ${EVENT.host} (${EVENT.hostBio}).\n` +
      `${EVENT.displayDate}, ${EVENT.displayTime}.\n` +
      "The Zoom link will be sent to your email/WhatsApp before the session.",
    location: "Online – Zoom",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
