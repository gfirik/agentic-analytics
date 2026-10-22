// Deterministic derivations from the downloaded public files (evals/real/README.md). Each is a pure function from
// the verified download's bytes to the file the engine reads, so the derived file has a fixed SHA-256 too.
import * as XLSX from "xlsx";
import { RealDataError } from "./errors.ts";

/** RFC 4180 field: quoted only when it has to be. */
function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel serial (1900 system) → "YYYY-MM-DD HH:MM:SS", rounded to the second, with no time zone involved. */
export function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25_569) * 86_400) * 1000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export const ONLINE_RETAIL_COLUMNS = ["Invoice", "StockCode", "Description", "Quantity", "InvoiceDate", "Price", "Customer ID", "Country"];

/** Keeps an invoice when the number in it is divisible by `every` ("C489450" → 489450). */
export function keepInvoice(invoice: string, every: number): boolean {
  const digits = /(\d+)$/.exec(invoice.trim())?.[1];
  return digits !== undefined && Number(digits) % every === 0;
}

/**
 * Online Retail II → one CSV of every 10th invoice (by invoice number, cancellations included) from both sheets
 * (Dec 2009 – Dec 2011). The full workbook decompresses past the engine's 300 MB ZIP limit and has 1,067,371 rows;
 * sampling whole invoices keeps each invoice's lines together, and keeps the monthly shape, cancellations, missing
 * customer IDs and negative quantities. Dates are written as ISO text, numbers in JS shortest form.
 */
export function deriveOnlineRetailSample(xlsx: Uint8Array, every = 10): string {
  const wb = XLSX.read(xlsx, { type: "array", dense: true, cellDates: false, cellText: false, cellHTML: false, cellStyles: false });
  const lines = [ONLINE_RETAIL_COLUMNS.join(",")];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    const header = (rows[0] ?? []).map((h) => String(h ?? "").trim());
    if (header.join("|") !== ONLINE_RETAIL_COLUMNS.join("|"))
      throw new RealDataError("UNEXPECTED_LAYOUT", `unexpected header in sheet ${name}: ${header.join(", ")}`);
    for (const row of rows.slice(1)) {
      const invoice = String(row[0] ?? "");
      if (!keepInvoice(invoice, every)) continue;
      const cells = ONLINE_RETAIL_COLUMNS.map((col, i) => {
        const v = row[i];
        if (v === null || v === undefined) return "";
        if (col === "InvoiceDate") return typeof v === "number" ? serialToIso(v) : String(v);
        return String(v);
      });
      lines.push(cells.map(csvField).join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Stats NZ Electronic Card Transactions → the monthly, actual (not seasonally adjusted) spending values by industry
 * group: series ECTM.S1GA1–ECTM.S1GA8, the file's own lines unchanged. The full CSV mixes 137 series with different
 * units (dollars, counts, percentages) and frequencies (monthly, quarterly, annual) in one column, which is no
 * single table to analyse; this is the slice a business user would export.
 */
export function deriveCardSpendByIndustry(csv: string): string {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const out = [lines[0] ?? ""];
  for (const l of lines.slice(1)) if (/^ECTM\.S1GA[1-8],/.test(l)) out.push(l);
  return `${out.join("\n")}\n`;
}

/** The 31 columns of both hotel files (H1.csv and H2.csv), in the published order. */
export const HOTEL_COLUMNS = [
  "IsCanceled",
  "LeadTime",
  "ArrivalDateYear",
  "ArrivalDateMonth",
  "ArrivalDateWeekNumber",
  "ArrivalDateDayOfMonth",
  "StaysInWeekendNights",
  "StaysInWeekNights",
  "Adults",
  "Children",
  "Babies",
  "Meal",
  "Country",
  "MarketSegment",
  "DistributionChannel",
  "IsRepeatedGuest",
  "PreviousCancellations",
  "PreviousBookingsNotCanceled",
  "ReservedRoomType",
  "AssignedRoomType",
  "BookingChanges",
  "DepositType",
  "Agent",
  "Company",
  "DaysInWaitingList",
  "CustomerType",
  "ADR",
  "RequiredCarParkingSpaces",
  "TotalOfSpecialRequests",
  "ReservationStatus",
  "ReservationStatusDate",
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Hotel booking demand (Antonio, de Almeida & Nunes 2019) → one CSV of both hotels' bookings: H1.csv (the resort
 * hotel) then H2.csv (the city hotel), each line unchanged behind two added fields, `Hotel` and `ArrivalDate`
 * (ISO, from the year, month name and day columns). The engine reads one file per job, and the files carry no
 * single date column: the only ISO date, ReservationStatusDate, is when the booking was cancelled or checked out,
 * which would put every cancellation in the wrong month. The published padding ("BB       ", "       NULL") is
 * kept: it is part of the real mess the engine has to handle.
 */
export function deriveHotelBookings(h1: string, h2: string): string {
  const out = [["Hotel", "ArrivalDate", ...HOTEL_COLUMNS].join(",")];
  for (const [hotel, csv] of [
    ["Resort Hotel", h1],
    ["City Hotel", h2],
  ] as const) {
    const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
    if (lines[0] !== HOTEL_COLUMNS.join(","))
      throw new RealDataError("UNEXPECTED_LAYOUT", `unexpected header in the ${hotel} file: ${(lines[0] ?? "").slice(0, 120)}`);
    for (const [i, line] of lines.slice(1).entries()) {
      if (line === "") continue;
      // The published files have no quoted fields; a quote would mean a comma could sit inside a field.
      const f = line.split(",");
      if (line.includes('"') || f.length !== HOTEL_COLUMNS.length)
        throw new RealDataError("UNEXPECTED_LAYOUT", `${hotel} line ${i + 2}: expected ${HOTEL_COLUMNS.length} unquoted fields`);
      const month = MONTHS.indexOf((f[3] ?? "").trim()) + 1;
      const year = Number(f[2]);
      const day = Number(f[5]);
      if (!month || !Number.isInteger(year) || !Number.isInteger(day) || day < 1 || day > 31)
        throw new RealDataError("UNEXPECTED_LAYOUT", `${hotel} line ${i + 2}: no arrival date in ${f[2]}, ${f[3]}, ${f[5]}`);
      out.push(`${hotel},${year}-${pad(month)}-${pad(day)},${line}`);
    }
  }
  return `${out.join("\n")}\n`;
}
