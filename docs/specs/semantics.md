# Spec: business semantics (`packages/profile`): column roles, table kinds, business model

Why it exists: the engine has to know what a column means before it can choose the right analysis. A column can hold a unit cost, a due date or a customer id. A table can be sales lines, an invoice register or a monthly summary. Until M15 the engine guessed these from column names with regexes (`packages/analysis/src/runner.ts` `QTY`/`ITEM`, `packages/metrics/src/draft.ts` `fallbackMetrics`). M15 replaces the guesses with **roles** and **table kinds**. Code proposes them with evidence, the user confirms them on the same screen as the metrics, and they decide which analysis packs run (analysis-library §8–§13). Source: docs/plans/analyst-grade.md §2.1, §3 and §6.2; docs/plans/m15.md.

Rules that hold throughout:

- **Code proposes, the model may only break a tie.** Every role candidate comes from a deterministic score (§2). A model may choose between the top candidates when their scores are close (§2.4). It may never propose a role the code didn't, and with no model, or with `--yes`, the top score wins.
- **Roles never produce numbers.** A role changes which metrics are drafted and which analyses run. Every number still comes from SQL or a function in `packages/analysis`, with a `computation` record and provenance (AGENTS.md §2). The cross-column identity rates that support a role are themselves SQL facts (§2.2).
- **Graceful absence.** When an analysis needs a role or table kind that is missing, the analysis is not run, and the report lists it under "Analyses not run" with its reason (analysis-library §13). It never guesses.

## 1. The role vocabulary

Each column of each table gets one role (or `none`). The vocabulary is fixed here. Packs read roles, never column names. It covers every role analyst-grade §2.1 names, so M16–M17 add packs, not roles.

| Group | Role | Meaning | Typical types |
|---|---|---|---|
| dates | `transaction_date` | when a sale, payment or movement happened | date, datetime |
| | `issue_date` | when an invoice or bill was issued | date |
| | `due_date` | when it is due (on or after its issue date) | date |
| | `paid_date` | when it was paid | date |
| | `period` | a period label for already-aggregated rows (`2026-03`, `2002.10`, "March 2026") | date, text |
| | `snapshot_date` | the as-of date of a stock or balance snapshot | date |
| ids | `order_id` | an order, receipt or basket number | id, integer, text |
| | `invoice_id` | an invoice or bill number | id, integer, text |
| | `line_id` | a line number within an order or invoice | integer, id |
| | `customer_id` | a customer code or number | id, integer, text |
| | `product_id` | a SKU, stock code or article number | id, integer, text |
| | `supplier_id` | a supplier code | id, integer, text |
| dimensions | `customer` | a customer's name | category, text |
| | `product` | a product's name or description used as a dimension | category, text |
| | `product_group` | a category, family or item type | category |
| | `channel` | a sales channel (wholesale, retail, online, a booking channel) | category |
| | `location` | a store, region, country or warehouse | category |
| | `supplier` | a supplier's name | category, text |
| | `salesperson` | a sales rep, agent or manager | category, id |
| | `dimension` | any other grouping column | category |
| money and measures | `amount` | a line's or row's money value (revenue, sales, spend) | currency, decimal |
| | `quantity` | units sold or moved; may be negative on returns | integer, decimal |
| | `unit_price` | price per unit | currency, decimal |
| | `unit_cost` | cost per unit (standard or actual) | currency, decimal |
| | `cost_amount` | a line's total cost (COGS) | currency, decimal |
| | `discount` | a discount given on the line, in money | currency, decimal |
| | `tax` | tax on the line | currency, decimal |
| | `refund_amount` | money refunded on the line | currency, decimal |
| | `paid_amount` | money received against an invoice or bill | currency, decimal |
| | `balance` | a running or closing balance | currency, decimal |
| | `stock_on_hand` | units in stock at a snapshot | integer, decimal |
| | `count` | a count already aggregated in the file (bookings, visits) | integer |
| | `measure` | any other numeric measure | integer, decimal, percent |
| other | `status` | an order, payment or booking status (paid, refunded, cancelled) | category |
| | `currency` | a currency code per row | category |
| | `description` | free text | text |
| | `none` | no role (a technical column, a constant, a note) | any |

**Entities.** Some roles name the same business entity, and packs group by the entity: `customer` and `customer_id` are the entity *customer*; `product` and `product_id` are *product*; `supplier` and `supplier_id` are *supplier*. A pack that needs "a customer dimension" accepts either role, and prefers the id when both exist (names drift, codes don't). Fact labels name the entity, not the column (analysis-library §14).

## 2. The role detector (`detectRoles(ws, table, profile, options?)`)

It runs after PROFILE, on the table's `ColumnProfile`s. For each column it returns a ranked list of candidates `{ role, score, evidence[] }`, the proposal, and the identities it measured. The detector is deterministic: the same profile gives the same candidates. Source: `packages/profile/src/roles/`.

### 2.1 Signals and score

Each candidate's score is the sum of its signals' weights, capped at 1. The weights are the values as built (PR 4). A candidate needs name or value evidence; the type gate alone creates none.

| Signal | Weight | Source |
|---|---|---|
| **Name** | the whole header is a synonym 0.5; the header *ends with* a synonym (its head word) 0.35; a synonym is inside the header but not its head 0.15 | the header, lower-cased, with punctuation and case-joins split (`UnitPrice` → `unit price`), a trailing index dropped (`Series_title_2`), matched against the synonym list (§2.3). `customer type` ends in `type`, so `customer` scores 0.15 there and the column is not a customer. A header `<entity> + id/code/no/number` is the entity's id role at the same weights (`Customer ID` → `customer_id` 0.5), and a bare entity word on an id or integer column is its code too. |
| **Type** | a gate, plus 0.1 | the profile's inferred type (ingestion-and-profiling §5). A role whose typical types (§1) exclude the column's type is not a candidate at all: a text column is never `quantity`, a category never a `period` (`ArrivalDateMonth` is a part of a date, not a label). Id roles admit id, integer, text and category columns (a stock code is often a category); amount-like roles admit integer columns (whole-currency sheets); a `status` may be a 0/1 integer with at most 10 distinct values. |
| **Value pattern** | 0.2 on a role that has name evidence; 0.3 on its own for two residual roles | `quantity` +0.2 unless the column looks like a code (whole numbers, ≤ 50 distinct values and ≤ 1% of rows); `status` +0.2 with ≤ 10 distinct values; `currency` +0.2 when the top values are three-letter codes. On their own: a varying numeric column nothing else explains is a `measure` (0.3 + type 0.1 = 0.4) and a varying category column is a `dimension` (0.3 + 0.1), so the proposal threshold is met and any name evidence outranks them. The profile's own date column gets `transaction_date` +0.3. |
| **Cross-column identity** | 0.3 | the identities in §2.2, checked in SQL |

A column's proposal is its top candidate when that score is ≥ 0.4. Otherwise it is `none`. Ties are broken by the higher score, then by the role's order in §1, then by the column's position in the table. A column with no evidence at all gets no role.

Rules as built that the table above doesn't show (the synonym additions in §2.3 were chosen while the role labels were in view; the rules below name no column):

- **Empty or constant columns have no role.** A column with no values, or one value over at least 100 rows, or all-distinct whole numbers over at least 100 rows (a key or index), is a technical column (`none`). Over fewer rows the equality proves nothing: twelve or twenty-four equal monthly rents are a flat cost, still a `measure`.
- **Period parts.** In a table with no date column, an integer column whose values all lie in 1900–2100 and whose header has a year word (`year`, `yr`, `год`, `yil`) is a `period` (score 0.75: name 0.35, range 0.2, no date column 0.2), and so is an integer column of values 1–12 with a month word (`month`, `mon`, `месяц`, `oy`) when such a year column exists. Together they are one period: `TableRoles.period_parts = { year, month? }` names the two columns, and the pair is read from there (a year alone meaning annual rows). As built (PR 9): `profile_period_parts` stores the pair; the catalog gives such a table the stand-in time column `_period` (the first day of the month), which the metric compiler reads, so a metric on a year/month table has periods, and the Pareto windows work on it. As built (M15 PR 11 prep): profiling gives such a table a date range, the first day of its first and last month dated as the compiler dates rows (`periodPartsCoverage`; grain month), so the job's period range is the data's and not open-ended; the KPI pack, the margin pack and the channel slices draft on it with `time_column: _period` (`timeColumn` in packages/metrics), and validation accepts `_period` because the catalog lists it as a date column. With a date column the numbers are only parts of it and keep their other roles (`ArrivalDateYear`). A header with a year word anywhere (`year_built`) on such a column also qualifies; accepted, since a table with no date column and a year-range integer is rarely anything but a period or a dimension, and the user confirms roles. A month number with no year column beside it, a 1–12 quantity with no month word and a year-range amount with no year word are not periods.
- **One transaction date per table.** When several date columns score for `transaction_date`, the highest keeps it and the others lose it (`ReservationStatusDate` next to `ArrivalDate`). A date with a due/issue name or an identity (§2.2) keeps that role.
- **Model tie-break:** §2.4, off by default.

### 2.2 Cross-column identities (SQL, `roles.sql.ts`)

Identities are checked in DuckDB with parameterized templates over the table's non-null rows. Each identity's rate is stored as an SQL fact (`role_identity.<check>.<table>`, unit percent) so the confirm screen and the report can show it. The fact is a measurement of the data, not a business figure, and V2 re-runs it like any other SQL fact.

| Identity | Holds when | Supports |
|---|---|---|
| gross line | \|q × p − a\| ≤ tol(a) on ≥ 95% of rows where q, p and a are non-null | `quantity`, `unit_price`, `amount` (gross) |
| net line | \|q × p − d − a\| ≤ tol(a) on ≥ 95% of such rows | the same, plus `discount`; `amount` is net of the discount |
| margin | needs a cost candidate: \|a − q × c − m\| ≤ tol(m) on ≥ 95% of rows | a column `m` as a margin (recorded as `measure`; margin is computed, never read from the file) |
| dates | due ≥ issue on ≥ 95% of rows where both are non-null | `issue_date`, `due_date` |
| balance | balanceᵢ − balanceᵢ₋₁ = amountᵢ on ≥ 95% of consecutive rows in file order | `balance`, signed `amount` (bank/cash). **Not built in PR 4:** no M15 pack reads a `bank_cash` table (M16 adds it); the name signal covers `balance` meanwhile. |

**Tolerance per row:** tol(a) = max(half a minor unit, 0.5% × \|a\|). Half a minor unit is 0.005 for currencies with two decimals, and 0.5 for currencies with none (for example JPY). Rows with a null in any term don't count either way.

**Hand-computed examples** (the same cases are used in PR 4's tests):

- *Tolerance.* q = 3, p = 33.33, a = 100.00: 3 × 33.33 = 99.99, \|99.99 − 100.00\| = 0.01 ≤ max(0.005, 0.5% × 100.00 = 0.50) = 0.50, so the row matches. q = 3, p = 0.33, a = 1.00: 3 × 0.33 = 0.99, \|0.99 − 1.00\| = 0.01 > max(0.005, 0.5% × 1.00 = 0.005) = 0.005, so the row doesn't match.
- *Threshold.* 19 matching rows of 20 → 19 ÷ 20 = 95% ≥ 95%: the identity holds. 18 of 20 → 90% < 95%: it doesn't hold, and the roles it would support get no identity points.
- *Gross vs net.* On the 10-line KPI fixture (analysis-library §8.2), lines 6 and 9 carry a discount (20.00 and 30.00), so q × p − a is 20.00 and 30.00 there. The gross identity holds on 8 of 10 rows (80%, rejected). The net identity holds on 10 of 10 (100%, accepted), so `amount` is read as net of discount.

As built: an identity needs at least 5 rows where every term is non-null; it is measured for the top two candidates of each role (so at most a handful of queries); for the dates identity, a column equal to the issue date on every row is a copy and gets no points; the margin identity is tried against the first 12 numeric columns (in table order) not already used by the line identities; a fact per check keeps the best-measured pairing. The result carries each identity as `{ check, fact: "role_identity.<check>.<table>", columns, matched, total, rate, holds }`; PR 5 writes them as facts.

An identity below 95% is evidence against the roles it would support, never a hard rule: messy files (cancellations, rounding, returns) can still get their roles from names and types.

### 2.3 The synonym list

Synonyms live in code (`packages/profile/src/roles/synonyms.ts`), in English, Russian and Uzbek (Latin and Cyrillic), and they are matched after the header normalization in §2.1. A representative extract:

| Role | EN | RU | UZ |
|---|---|---|---|
| `transaction_date` | date, order date, invoice date, sale date, arrival date | дата, дата продажи, дата заказа | sana, sotuv sanasi |
| `due_date` | due date, due, payment due | срок оплаты, дата оплаты по договору | to'lov muddati |
| `order_id` | order, order id, order no, receipt, basket | заказ, номер заказа, чек | buyurtma, chek |
| `invoice_id` | invoice, invoice no, bill no | счёт, счет-фактура, номер счёта | hisob-faktura |
| `customer` / `customer_id` | customer, client, buyer, account / customer id, client code | клиент, покупатель, контрагент / код клиента | mijoz, xaridor / mijoz kodi |
| `product` / `product_id` | product, item, description / sku, stock code, article | товар, наименование / артикул, код товара | mahsulot, tovar / artikul |
| `quantity` | qty, quantity, units, pcs, nights | кол-во, количество, шт | soni, miqdori, dona |
| `unit_price` | price, unit price, rate, adr | цена, цена за ед. | narx, birlik narxi |
| `unit_cost` | cost, unit cost, std cost, cogs per unit, purchase price | себестоимость, закупочная цена | tannarx, xarid narxi |
| `cost_amount` | cost amount, cogs, total cost | себестоимость продаж, сумма себестоимости | tannarx summasi |
| `amount` | amount, revenue, sales, total, value, spend | сумма, выручка, оборот | summa, tushum, savdo |
| `discount` | discount, rebate, markdown | скидка | chegirma |
| `refund_amount` | refund, refunded, returns amount | возврат, сумма возврата | qaytarish |
| `status` | status, state, is_canceled, cancelled | статус, состояние | holat |
| `supplier` | supplier, vendor | поставщик | yetkazib beruvchi |

As built the list also carries `company` under `customer` (a booking's company is its account), `agent` under `salesperson`, `nights` under `quantity`, `bookings`, `visits` and `visitors` under `count`, `margin` and `profit` under `measure` (so the margin identity can name a column), `category`, `item type` and `family` under `product_group`, and Uzbek in Cyrillic script beside the Latin forms. Entity words (`customer`, `client`, `product`, `supplier`, `order`, `invoice`) plus an id suffix (`id`, `code`, `no`, `number`, and their RU/UZ forms) name the entity's id role without being listed.

"Std cost" is listed under `unit_cost`, so a name rule alone can't misread it as a standard deviation. The margin dataset of PR 2 plants this header on purpose.

### 2.4 The model's tie-break

When the top two candidates of a column are within 0.1 of each other, and a model is configured and `--yes` is not set, the extractor-tier model receives the column's header, type, five masked sample values and the candidate list. It returns one role from that list or `"undecided"`.

- The answer is validated against the candidate list. A role outside it is discarded, and the top score wins.
- The call goes through `ModelClient`. Tests use `FakeModel`.
- The model sees no other column's values and no document text (security §2).
- The choice is recorded in the role's evidence (`tie broken by model`). Small-model mode skips the call.

### 2.5 Storage

Roles are stored in the workspace next to the profile (a migration adds them):

- (migration 6 creates all three tables; PR 4 fills the first two, PR 5 the third, and gives the PROFILE stage the whole path: detect, store, classify, infer)
- `profile_roles(table_id, column_name, role, score, status, source, evidence_json)`, where `status` is `proposed | confirmed | assumed` and `source` is `detector | model | user`;
- `profile_role_candidates(table_id, column_name, role, score)`;
- `profile_table_kinds(table_id, kind, evidence_json)`.

`profile.json` gains each column's proposed role, so metric drafting reads roles, not names.

## 3. Table kinds

A table kind is classified from the table's roles (after confirmation, or the proposals under `--yes`). The rules are checked in order and the first match wins. Each kind records its evidence: the roles that matched.

| Order | Kind | Needs |
|---|---|---|
| 1 | `invoices` | `invoice_id` + `issue_date` + `due_date`, a customer entity, and no supplier entity (`paid_date`/`paid_amount` optional) |
| 2 | `bills` | the same, with a supplier entity instead of a customer (the payable side) |
| 3 | `inventory_snapshot` | `snapshot_date` (or a date with a single value per snapshot) + a product entity + `stock_on_hand` |
| 4 | `bank_cash` | a date + a signed `amount` (both signs present) + `balance`, or + `description` with no product or customer entity |
| 5 | `budget_plan` | `period` (or a date) + `amount` or `measure`, and a table or header name that says budget, plan, target, forecast (RU бюджет, план; UZ reja, byudjet) |
| 6 | `period_summary` | rows already aggregated per period: a `period` role, or a date whose values together with the dimension columns form a unique key, with no id role (`order_id`, `invoice_id`, `line_id`) and no `quantity` × `unit_price` identity. Examples: the 30 generated businesses' `Costs` sheet, Stats NZ card spend. |
| 7 | `sales_lines` | a date + (`amount`, or `quantity` and `unit_price`) + at least one of the customer or product entity, `order_id` or `channel` |
| 8 | `other` | anything else |

`period_summary` and `other` are not in analyst-grade §2.1's six kinds. They are added so that an aggregated sheet or an unrelated table isn't forced into a wrong kind (docs/plans/m15.md, decision 2).

**What each kind unlocks in M15** (analysis-library §8–§13; M16+ add receivables, payables, inventory and cash):

| Kind | Packs |
|---|---|
| `sales_lines` | sales KPI pack, margin and margin PVM (with a cost role), PVM (with quantity and price), Pareto and concentration (with a dimension), scorecard |
| `invoices` | in M15: revenue and customer KPIs only when no `sales_lines` table exists; Pareto by customer |
| `period_summary` | the confirmed metrics on the scorecard; Pareto and concentration over its dimension |
| `bills`, `inventory_snapshot`, `bank_cash`, `budget_plan` | none in M15: they are classified and reported, and their packs come with M16 |
| `other` | none beyond today's model-drafted metrics |

**As built (PR 5).** `classifyKind` in `packages/profile/src/roles/kinds.ts` is a pure function of the roles, the detector's identities and a small context; `classifyTable` measures the context in SQL and stores the result in `profile_table_kinds`.

- Entities follow §1: a customer entity is `customer_id` or `customer`, a supplier entity `supplier_id` or `supplier`, a product entity `product_id` or `product`. `invoices` needs a customer entity and no supplier entity, `bills` a supplier entity and no customer entity, so a register with both is neither and falls through to the later rules.
- `inventory_snapshot` needs the `snapshot_date` role; the "a date with a single value per snapshot" alternative is not built (no M15 dataset has such a table, and M16 owns inventory).
- `bank_cash`: "both signs present" is read from the amount column's profile minimum and maximum (a negative minimum and a positive maximum). The date is `transaction_date` or `issue_date`.
- `budget_plan`: the words are matched as whole words in the table's sheet, file and table names and in every column header (`planet` is not `plan`). `period` or a date, and `amount` or `measure`, are the roles.
- `period_summary`: a `period` role qualifies. A date whose values with the dimension columns (`customer`, `product`, `product_group`, `channel`, `location`, `supplier`, `salesperson`, `dimension`, `status`, `currency`) form a unique key over more than one row also qualifies, but only when the table has a money or measure role (`amount`, `measure`, `count`, `quantity`, `cost_amount`): rows of dimensions with no numbers are not a summary. An id role (`order_id`, `invoice_id`, `line_id`) or a holding gross or net line identity rules both out. The key check is the SQL in `roles.sql.ts` (`uniqueKey`).
- `sales_lines` takes `transaction_date` or `issue_date` as its date.
- `evidence` lists the role names that matched, in the order the rule names them; `other` has none.
- `aa eval --suite roles` also scores each labelled table's kind and prints the count as information (no bar).

**Tests** (PR 5): one classifier fixture per kind, plus an ambiguity fixture: an invoice register with a supplier column and no customer column is `bills`, not `invoices`.

## 4. Business model

The business model is inferred from table kinds, roles and a few SQL facts. It is **an assumption**: it is shown and editable on the confirm screen, and recorded as an `Assumption` in the report. It changes only which packs run and in what order, never a number.

| Model | Signals (any one is enough; checked in this order) |
|---|---|
| `subscription` | customers with revenue in 3 or more consecutive months, with each month within ±5% of the one before, hold ≥ 50% of revenue over the last 12 months |
| `wholesale` | a `channel` member named wholesale, B2B, опт or ulgurji holds ≥ 50% of revenue; or the top 10 customers hold ≥ 50% of revenue over the last 12 months |
| `retail` | a `channel` member named retail, store, розница or chakana holds ≥ 50% of revenue; or the customer entity is missing or empty on ≥ 20% of sales rows |
| `services` | a `sales_lines` table with no `quantity` role and no product entity |
| `unknown` | none of the above |

The shares are SQL facts (`business_model.<signal>.<table>`). They support the assumption but are not claims, and the assumption's text carries no numerals, for example "Business model assumed: wholesale (a few customers hold most of the revenue)."

**Effect on order:** for `wholesale`, Pareto and concentration by customer come first; for `retail`, AOV and units per order come before customer concentration; for `subscription`, customers and new vs returning come first. For `unknown` the order is the one in analysis-library §8. Ranking (analysis-library §6) still decides what reaches EXPLAIN.

**As built (PR 5).** `inferBusinessModel` in `packages/profile/src/roles/business.ts`, with its SQL in `business.sql.ts`. It reads the largest `sales_lines` table (an `invoices` register when there is none) and the top-scoring `amount`, `transaction_date` (or `issue_date`), customer-entity (the id role first) and `channel` columns. Without a sales or invoices table the model is `unknown` with no signals. The signals are tried in the spec's order and the first that holds decides; every signal that was measured is kept as a fact:

- *subscription*: `business_model.subscription_steady.<table>`, the share of the last 12 months' revenue held by customers with at least one run of 3 consecutive months in which each month is within 5% of the month before (a customer's monthly revenue is summed first; a gap month breaks the run).
- *wholesale*: `business_model.wholesale_channel.<table>` (the revenue of every channel member whose value contains `wholesale`, `b2b`, `опт` or `ulgurji`, case-insensitive, summed: a substring match, so "Wholesale EU" counts and so would "оптика") and `business_model.wholesale_top10.<table>` (the ten largest customers, nulls excluded from the ranking but not from the total). With ten customers or fewer the second signal holds trivially; that follows the spec's wording, and the user can edit the assumption.
- *retail*: `business_model.retail_channel.<table>` (`retail|store|розниц|chakana`) and `business_model.retail_no_customer.<table>` (the share of detail rows with no customer; 20% or more holds). A sales table with no customer column at all reads as retail, with the signal "the sales table has no customer column" and no fact.
- *services*: a `sales_lines` table with no `quantity` role and no product entity. Because retail's "no customer" signal is checked first, services is reached only when customers are named on at least 80% of the rows.
- "The last 12 months" are the 12 calendar months ending with the table's latest month. All facts are percents (0–100) and V2 re-runs their SQL.

## 5. Confirmation

Roles are confirmed on the same screen as the metrics (analyst-grade §6.2; metric-layer §3; interfaces §1–§3). The job waits at AWAIT_CONFIRM as today.

- **What is shown:** only columns that have a proposed role, one line each, for example `UnitCost → unit_cost (name "unit cost"; the margin identity holds on 100% of rows)`, where the rate is the identity's fact (§2.2), rendered from its value. Each table's kind and the business model are shown too.
- **What the user can do:** accept, edit or drop each role. An edited role must be in the vocabulary (§1), and its column must exist. Otherwise the door refuses it with a typed error (`UNKNOWN_ROLE`, `UNKNOWN_COLUMN`). Dropping a role sets it to `none`. Editing a role re-runs the table-kind classifier and the code-drafted packs, so the metrics shown are always those the confirmed roles produce.
- **`--yes` / `auto_confirm`:** every proposed role is kept with `status: assumed`. Each assumed role that an analysis reads becomes an `Assumption` attached to the findings that use it ("Column “Std cost” read as unit cost").
- **Saved:** confirmed roles are written with the confirmed metrics (`./agentic-analytics.metrics.yaml`, metric-layer §1 `roles:`), so the next run reuses them.

**As built (PR 6).** One request carries both halves, in the metric file's format (metric-layer §1): a `roles:` block (`table`, `column`, `role`), an optional `business_model:` and, optionally, `metrics:`.

- **Posted means confirmed.** Every role in the body gets `status: confirmed` and `source: user`, as every metric in a body is confirmed. A role not posted stays as proposed, shown `assumed`. A role posted with a value different from the proposal also takes the person's evidence in place of the detector's (`set by the user (proposed unit_cost)`, or `no role: dropped by the user (proposed …)` for `none`) and ranks first (score 1). `table` is the table's name (`t_t1`, as metrics use it) or its id.
- **Roles only, or both.** A body with `metrics:` confirms and the job resumes. A body without it (only roles, or a business model) is a **revision**: the roles are stored, the changed ones re-classify their table's kind, the business model is re-inferred, the code's metric drafts are made again from the new roles, and the job keeps waiting at AWAIT_CONFIRM. The next `GET` shows the new drafts. That is how "editing a role re-drafts the metrics before the metric list is shown again" works in every door.
- **Re-drafting is deterministic and makes no model call** (`redraftMetrics`, metrics). A model's draft does not depend on roles (its digest carries none), so it is validated again as proposed; the deterministic drafts (`fallbackMetrics`, and from PR 7 the KPI pack) are rebuilt from the roles. The first draft's model proposals are kept in the METRICS_DRAFT stage output for this.
- **Validation before any write.** Metrics, roles and the business model are all checked first; a refused request changes nothing. An unknown role is `UNKNOWN_ROLE`, an unknown column or table `UNKNOWN_COLUMN`, an unknown business model `UNKNOWN_BUSINESS_MODEL`, over HTTP a 400 with that code.
- **Business model.** Posting a `business_model:` confirms it. If it equals the inferred model it keeps its signals; if not, its only signal is "set by the user". Later role edits do not re-infer a model the person set.
- **Everything reads the confirmed roles.** The edits are written to `profile_roles` (read by the runner's PVM), the semantics after the edit are kept in the job (`job_meta` key `semantics`), and the report is built from them, so metric drafting, PVM's item and quantity columns, the table kinds and the report's `roles` all agree.
- **Assumptions.** After the findings are known, each *assumed* role that a metric reads (its expression, filters, time column, dimensions or ratio terms) or, for `quantity`, that a price-volume-mix finding used, gets its own `Assumption`: `Column “<header>” read as <role with spaces>.` It affects the findings that use those metrics, the findings list it, and `ColumnRole.assumption` names it. The header is inside quotes, which the report's numeral check skips. Confirmed roles get none. A business model the person set reads `Business model: <model>, as set or confirmed by the user.`
- **Untrusted text.** The screen (also what an MCP client's model reads) leaves out quarantined tables and any column whose header `screen()`s as addressed to a model, as the report does. The planner never sees the screen.
- **`aa metrics`** (the standalone metric review) is unchanged: it reviews metrics only. Roles are reviewed in `aa analyze`, the API, MCP and the viewer.

## 6. Roles in `report.json`

`report.json` gains `roles`, `table_kinds` and `business_model` (report-schema §5b). Scores are not in the report: they rank candidates inside the detector, and the report carries the evidence instead, with each identity rate as a fact. The workspace keeps the scores for `aa explain` and the roles eval.

**As built (PR 5).**

- The PROFILE stage detects roles, stores them (`profile_roles`, status `proposed`), classifies each table (`profile_table_kinds`), infers the business model, and returns all three in `ProfileSummary.semantics`. `reportSemantics` (profile) turns that into the report's parts and `buildDraft` (agent, `semantics.ts`) gives the measurements fact ids.
- A role's report status is `assumed` while its stored status is `proposed` (auto-confirm keeps every proposal, §5) and `confirmed` once a person confirms it (PR 6, §5 "As built"). Columns with role `none` are left out.
- Evidence text has no numerals. The detector's texts were made numeral-free for this ("few distinct values", "whole numbers in the range of years"), and an identity's rate is not in the text but in the fact the evidence names: the report writes `margin identity holds on {{N41}} of rows`. Business-model signals do the same.
- The measurements are facts in the report: `role_identity.<check>.<table>` (percent) and `business_model.<signal>.<table>` (percent), with an SQL computation that V2 re-runs and a citation of the table. Only identities that a reported role's evidence names are included.
- The business model is also an `Assumption` ("Business model assumed: wholesale (a few customers or a wholesale channel hold most of the revenue)."), which affects no finding in PR 5; `business_model.assumption` is its id. From PR 10 it affects the findings of what the model puts first ("Effect on order", §4): for wholesale the `concentration_risk` findings over the customer dimension, for retail the findings on `aov` and `units`, for subscription those on `customers`, `new_customers` and `returning_customers`; services and unknown affect none (`businessModelAffects`, agent). The pack order itself is not wired yet: ranking decides what reaches EXPLAIN.
- A quarantined table's roles, kind and facts, and any role whose column name addresses a model (`screen`), are left out of the report (security §3). If the business model was read from a quarantined table, it is reported as `unknown` with no signals.
- The runner's PVM and `fallbackMetrics` read the stored roles: PVM needs a `quantity` column and an item dimension (`product`, `product_id` or `product_group`), the fallback revenue needs an `amount` column of type currency (or `quantity` and `unit_price`), and its channel split a `channel` column with 2–5 values. A summary with no roles drafts nothing.

## 7. Evaluation

Role detection is measured by `aa eval --suite roles` against a hand-labelled answer file (accuracy §11). The detector's proposal before confirmation and without a model is what is scored. The model's tie-break is measured separately, as information.
