// sales-2026.xlsx: sheet "Orders" (transactions) and sheet "Monthly" with two table regions:
// the owner's monthly summary (A1:F7, the blueprint table) and a cost table (H1:L7) with a planted ×1000 typo.
import * as XLSX from "xlsx";
import { COSTS, generateOrders, MONTHS } from "./coffee-roaster.ts";

const EPOCH_1900 = Date.UTC(1899, 11, 30);

function excelSerial(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return (Date.UTC(y, m - 1, 1) - EPOCH_1900) / 86_400_000;
}

export function salesWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: "Sales 2026", Author: "Northside Coffee Roasters", CreatedDate: new Date(Date.UTC(2026, 6, 1)) };

  const orders = generateOrders();
  const orderSheet = XLSX.utils.aoa_to_sheet([
    ["Date", "Order ID", "Customer", "Channel", "Product", "Qty", "Amount", "Status"],
    ...orders.map((o) => [o.date, o.orderId, o.customer, o.channel, o.product, o.qty, o.amountCents / 100, o.status]),
  ]);
  for (let r = 2; r <= orders.length + 1; r++) {
    const cell = orderSheet[`G${r}`] as XLSX.CellObject | undefined;
    if (cell) cell.z = "#,##0.00";
  }
  XLSX.utils.book_append_sheet(wb, orderSheet, "Orders");

  const monthly: XLSX.WorkSheet = {};
  const put = (addr: string, cell: XLSX.CellObject) => {
    monthly[addr] = cell;
  };
  for (const [i, h] of ["Month", "Revenue", "Orders", "Wholesale", "Retail", "Refund rate"].entries())
    put(`${"ABCDEF"[i]}1`, { t: "s", v: h });
  for (const [i, h] of ["Month", "Beans", "Packaging", "Rent", "Staff"].entries()) put(`${"HIJKL"[i]}1`, { t: "s", v: h });
  MONTHS.forEach((m, i) => {
    const r = i + 2;
    put(`A${r}`, { t: "n", v: excelSerial(m.month), z: "mmm yyyy" });
    put(`B${r}`, { t: "n", v: m.revenueCents / 100, z: "#,##0" });
    put(`C${r}`, { t: "n", v: m.orders, z: "#,##0" });
    put(`D${r}`, { t: "n", v: m.wholesaleCents / 100, z: "#,##0" });
    put(`E${r}`, { t: "n", v: m.retailCents / 100, z: "#,##0" });
    put(`F${r}`, { t: "n", v: m.refundPermille / 1000, z: "0.0%" });
    const c = COSTS[i];
    if (!c) throw new Error(`missing cost row for ${m.month}`);
    put(`H${r}`, { t: "n", v: excelSerial(c.month), z: "mmm yyyy" });
    put(`I${r}`, { t: "n", v: c.beans, z: "#,##0" });
    put(`J${r}`, { t: "n", v: c.packaging, z: "#,##0" });
    put(`K${r}`, { t: "n", v: c.rent, z: "#,##0" });
    put(`L${r}`, { t: "n", v: c.staff, z: "#,##0" });
  });
  monthly["!ref"] = `A1:L${MONTHS.length + 1}`;
  XLSX.utils.book_append_sheet(wb, monthly, "Monthly");
  return wb;
}

export function salesXlsx(): Uint8Array {
  return XLSX.write(salesWorkbook(), { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
}
