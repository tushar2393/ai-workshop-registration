interface Row {
  [key: string]: unknown;
  status: string;
}
interface AdminData {
  seatLimit: number;
  seatsTaken: number;
  seatsLeft: number;
  waitlistCount: number;
  paidCount: number;
  total: number;
  registrations: Row[];
}

const COLS: [string, string][] = [
  ["createdAt", "Registered (IST)"], ["status", "Status"], ["paymentStatus", "Payment"], ["fullName", "Name"], ["email", "Email"],
  ["phone", "Phone"], ["city", "City"], ["role", "Role"], ["experience", "Exp"], ["jobFunction", "Function"],
  ["linkedin", "LinkedIn"], ["aiWorry", "AI worry"], ["source", "Source"], ["consent", "Consent"],
];

const errBox = document.getElementById("admin-error") as HTMLElement;
const csvBtn = document.getElementById("csv-btn") as HTMLButtonElement;
const form = document.getElementById("token-form") as HTMLFormElement;
const tokenInput = form.elements.namedItem("token") as HTMLInputElement;

const fmtIst = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

function showError(msg: string): void {
  errBox.textContent = msg;
  errBox.hidden = false;
}

function render(data: AdminData): void {
  const stats = document.getElementById("stats") as HTMLElement;
  stats.replaceChildren(
    ...[
      `Confirmed seats: ${data.seatsTaken}/${data.seatLimit}`,
      `Seats left: ${data.seatsLeft}`,
      `Waitlist: ${data.waitlistCount}`,
      `Paid: ${data.paidCount}`,
      `Total entries: ${data.total}`,
    ].map((t) => Object.assign(document.createElement("span"), { textContent: t })),
  );
  stats.hidden = false;

  const table = document.getElementById("table") as HTMLTableElement;
  const headRow = document.createElement("tr");
  for (const [, label] of COLS) headRow.append(Object.assign(document.createElement("th"), { textContent: label }));
  table.tHead!.replaceChildren(headRow);

  const rows = [...data.registrations].reverse().map((r) => {
    const tr = document.createElement("tr");
    for (const [key] of COLS) {
      const td = document.createElement("td");
      const v = r[key];
      if (key === "createdAt") td.textContent = fmtIst(String(v));
      else if (key === "paymentStatus") renderPaymentCell(td, r);
      else if (key === "consent") td.textContent = v ? "Yes" : "No";
      else if (key === "linkedin" && v) {
        const a = Object.assign(document.createElement("a"), { href: String(v), textContent: "Profile", target: "_blank", rel: "noopener noreferrer" });
        td.append(a);
      } else td.textContent = v == null ? "" : String(v);
      if (key === "status") td.className = `status-${String(v)}`;
      if (key === "aiWorry") td.className = "worry";
      tr.append(td);
    }
    return tr;
  });
  table.tBodies[0].replaceChildren(...rows);
  table.hidden = false;
}

function renderPaymentCell(td: HTMLTableCellElement, r: Row): void {
  const paid = r.paymentStatus === "paid";
  td.className = "pay-cell";
  const label = Object.assign(document.createElement("span"), {
    className: paid ? "pay-paid" : "pay-pending",
    textContent: paid ? "paid" : "pending",
    title: paid && r.paidAt ? `Marked paid ${fmtIst(String(r.paidAt))}` : "",
  });
  const btn = Object.assign(document.createElement("button"), {
    type: "button",
    className: paid ? "btn btn-ghost" : "btn btn-primary",
    textContent: paid ? "Undo" : "Mark paid",
  });
  btn.addEventListener("click", () => void setPayment(String(r.id), paid ? "pending" : "paid", String(r.fullName), btn));
  td.append(label, btn);
}

async function setPayment(id: string, status: "paid" | "pending", name: string, btn: HTMLButtonElement): Promise<void> {
  if (status === "pending" && !confirm(`Mark ${name} as NOT paid (pending) again?`)) return;
  btn.disabled = true;
  const token = tokenInput.value;
  const r = await fetch(`/api/admin/registrations/${encodeURIComponent(id)}/payment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paymentStatus: status }),
  }).catch(() => null);
  if (!r || !r.ok) {
    const body = r ? await r.json().catch(() => ({})) : {};
    btn.disabled = false;
    showError(body.error ?? "Could not update payment status. Please try again.");
    return;
  }
  await load(token);
}

async function load(token: string): Promise<void> {
  errBox.hidden = true;
  const r = await fetch("/api/admin/registrations", { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    csvBtn.disabled = true;
    showError(body.error ?? `Request failed (${r.status})`);
    return;
  }
  sessionStorage.setItem("adminToken", token);
  csvBtn.disabled = false;
  render(body as AdminData);
}

async function downloadCsv(): Promise<void> {
  const token = tokenInput.value;
  const r = await fetch("/api/admin/registrations.csv", { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return showError(`CSV export failed (${r.status})`);
  const blob = await r.blob();
  const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "registrations.csv";
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  void load(tokenInput.value);
});
csvBtn.addEventListener("click", () => void downloadCsv());

const saved = sessionStorage.getItem("adminToken");
if (saved) {
  tokenInput.value = saved;
  void load(saved);
}
