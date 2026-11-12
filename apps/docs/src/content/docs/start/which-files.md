---
title: Which files work in v0.1
description: What the engine reads as numbers, what it only searches and quotes, and what it does not read yet.
sidebar:
  order: 3
---

v0.1 is built for **tidy tables** in CSV or Excel. Documents are evidence: they are searched and quoted, never read as numbers. This page says exactly what that means, so you can shape your files before the first run. It comes from a backtest on public company-report, tourism, retail, SEC filing and rental-listing files, where files as published often did not work and the same files, tidied, did.

## What works

**For the numbers: CSV, TSV, XLSX and XLS**

- One tidy table per file, or per sheet: **one header row, then one row per transaction or per period**.
- At least 3 data rows (a smaller table is not registered), a **date column** and an **amount column**. Without both, no metric can be drafted and nothing is measured.
- Dates are safest as `YYYY-MM-DD` or `YYYY-MM`. The reader also understands `dd.mm.yyyy`, `dd/mm/yyyy`, `mm/dd/yyyy`, Excel date serials and month names in English, Russian and Uzbek. A year column plus a month-number column also works as the period.
- Amounts may use `1 234,56`, `1,234.56` or `(123)` for negatives. The currency is read from symbols and codes in the cells, or set with `--currency`.
- A sheet may hold titles, notes, several tables, merged header cells and total rows. These are tested on fixtures: titles and notes are skipped, merged headers are flattened, total rows are kept out of sums. A sheet with month labels across the top and one text label column down the left (at least three month columns) is turned into a long table.

**As supporting documents: text PDFs, DOCX, EML, TXT and MD**

They are split into sections with their page and character span, searched, and quoted as evidence for *why* a number moved. Numbers inside them are never read as data. A scanned PDF needs the optional Docling container (`docling-serve`) to be read at all.

## The header words it recognises

A column is recognised by its **header**, and by what its cells look like. A header counts when it **is** one of the words below, **ends with** one (`retail_turnover`, `net_sales`, `Revenue (USD mn)`), or, more weakly, contains one. Case, `_`, `-` and spaces do not matter, and `UnitPrice` reads as `unit price`. Words that only state a unit (`mln`, `thousand`, `k`, `usd`, ...) are ignored when the header is matched, so `amount_mln_uzs` reads as an amount.

| Column | Header words (English) |
|---|---|
| Date | `date`, `order date`, `invoice date`, `sale date`, `sales date`, `transaction date`, `arrival date`, `booking date`, `purchase date`, `posting date`; a period label: `period`, `month`, `quarter`, `reporting period`, `fiscal period` |
| Amount | `amount`, `revenue`, `sales`, `total`, `value`, `spend`, `turnover`, `net sales`, `gross sales`, `sum` |
| Quantity | `qty`, `quantity`, `units`, `pcs`, `pieces`, `nights` |
| Unit price | `price`, `unit price`, `rate`, `adr`, `selling price` |
| Cost | `cost`, `unit cost`, `std cost`, `standard cost`, `purchase price`, `buy price` (per unit); `cost amount`, `cogs`, `total cost`, `cost of goods sold`, `cost of sales` (total) |
| Discount, tax, refund | `discount`, `rebate`, `markdown`; `tax`, `vat`, `gst`; `refund`, `refunded`, `refund amount`, `returns amount` |
| Product | `product`, `item`, `product name`, `item name`, `description`, `goods`; id: `sku`, `stock code`, `article`, `item code`, `product code` |
| Product group | `category`, `product category`, `product group`, `item group`, `item type`, `product type`, `family` |
| Customer | `customer`, `client`, `buyer`, `account`, `company`, `customer name`, `client name`; id: `customer code`, `client code`, `customer number`, or `customer id` |
| Place | `store`, `shop`, `branch`, `region`, `country`, `city`, `warehouse`, `location`, `site`, `outlet` |
| Channel | `channel`, `sales channel`, `distribution channel`, `booking channel` |
| Status | `status`, `state`, `is canceled`, `is cancelled`, `cancelled`, `canceled`, `order status`, `payment status` |
| Salesperson | `salesperson`, `sales rep`, `rep`, `agent`, `manager`, `seller` |
| Order, invoice | `order`, `receipt`, `basket`; `invoice`, `bill` (with an optional `id`, `no`, `number` or `code`) |

Russian and Uzbek words work too, for example `дата`, `сумма`, `выручка`, `оборот`, `товар`, `регион`, `количество`, `sana`, `summa`, `tushum`, `mahsulot`, `viloyat`. The full list is the synonym table in `packages/profile/src/roles/synonyms.ts`.

A tiny file the engine reads:

```csv
date,region,product,amount_mln_uzs,quantity
2023-10-15,Tashkent,tea,412.5,80
2023-10-15,Samarkand,tea,198.0,41
2023-11-15,Tashkent,tea,455.3,86
```

**Columns it cannot use as an amount.** A header it does not recognise, such as `trips_thousand` or `expenditure`, is kept as a plain number column but is not used to draft a metric. Rename it to one of the words above, for example `amount`.

### Units and scale

If the header of a money column says the scale or the currency, the report names it and **never multiplies the values**. A value of 17,776,691.70 in a column called `amount_mln_uzs` is shown as `17,776,691.70 million UZS`, not as a plain number.

| Says | Header words |
|---|---|
| thousand | `thousand`, `thousands`, `thous`, `thsd`, `'000`, `k`, `тыс`, `ming` |
| million | `million`, `millions`, `mln`, `mn`, `mio`, `млн` |
| billion | `billion`, `billions`, `bln`, `bn`, `млрд`, `mlrd` |
| currency | `usd`, `eur`, `gbp`, `rub`, `uzs`, `kzt`, `cny` |

A word counts only as a whole word (`kg`, `monthly` and `bank` say nothing). A header with two different scales or two currencies says nothing. `price_per_k` is a price per thousand units, not an amount in thousands. If the header says nothing, the values are shown as they are in the file, and nothing in the file can tell the engine that they are in thousands: put the scale in the header.

## What the report tells you about your data

- **Rows dated after `--today` are not history.** They are left out of the analysis and a data-quality item says so.
- **Negative sales amounts** are flagged when the file has no refund or return marker (a column or a category such as `refund`, `return`, `credit`, `cancelled`).
- **A falling cumulative column** is flagged. A header such as `ytd`, `cumulative`, `year to date` or `accumulated` should not fall inside a year. Nothing is repaired or de-cumulated.
- **Amounts are nominal.** A report that compares money across periods says that the amounts are not adjusted for inflation.
- **December.** A finding that compares December with November carries a note that December is often a seasonal peak, to be compared with last year's December.
- **Recommendations.** If findings exist and no recommendation passed the checks, the report says so instead of leaving the section empty.

## What is not read yet

- **Other wide layouts**: years as column headers, or more than one label column before the periods (a code and a name column, as in portal exports). Their period columns are read as separate number columns, not as time. Unpivot them first into `date, region, amount`.
- **Counts-only tables** with no money column (trips, visits, reviews). With no amount column there is no metric, and a `quantity` column alone does not make one. Naming the count `amount` makes it readable, but the report then calls it "revenue", so read it with that in mind.
- **Descriptive headers** that do not end in one of the words above (`trips_thousand`, `expenditure`).
- **Annual or quarterly data is labelled by month.** A year of `2023-12-31` rows is read as the month `2023-12`.
- **Long statements** with a line code and a value (`line_code, line_name, value`). Pivot them to one column per line (`revenue`, `cost_of_sales`, ...).
- **Archives and compressed files.** `.gz` and `.zip` files are not unpacked. Unzip them, for example with `gunzip`, and add the file inside.
- **Files over the size limit** (50 MB per file, 50 files and 200 MB per job by default). Drop the columns the analysis does not need (free-text columns such as comments make files big), filter to the period you need, or split the file.
- **Text files with control characters** (binary files, or UTF-16). Save them as plain UTF-8.
- **Portal PDFs without statements.** The annual-report PDFs on openinfo.uz hold company details, a few ratios, dividends and material facts, not the balance sheet or the income statement. The numbers exist only in the portal's structured data. Supply a table of the statement lines (a CSV or XLSX) yourself.
- **10-K and other HTML filings.** An HTML file is indexed as text and its tables are not read as data. Copy the tables you need into a CSV.
- **SEC `companyfacts` JSON** and other large JSON files. They are not read as data.
- **Scanned PDFs** without the Docling container.
- **A snapshot is not a history.** A listings export with a price per listing and a "last review" date is not a sales history. Do not read it as revenue.

## When nothing could be read

If no number could be computed, the report no longer says "No material changes were found". Its headline starts with **"No numbers could be read from these files:"** and gives the reason, and `aa analyze` exits with **code 2** (1 stays for a failed job). A "Read:" line lists the files that were read, and a "Files not read" section lists the others, one line per file with the fix.

| Reason | What to do |
|---|---|
| `every file was rejected (see Files not read)` | Fix each file as its line says: unzip, make it smaller, save it as UTF-8. |
| `no table was found (add a spreadsheet or CSV with one header row)` | Add a table. Documents alone give no numbers. |
| `no column was recognised as a date and an amount (name them, for example, date and amount)` | Rename the headers to the words above. |
| `no date falls in a whole period before today's date (check the date the job ran as, or the dates)` | Check the `--today` value and the dates in the file. |

If you are unsure, start from the example in `examples/coffee-roaster`, or run `aa metrics <folder>`: it reads and profiles your files, prints the metrics it drafts, and needs no model. See [the quickstart](../quickstart/) and [your first report](../first-report/).
