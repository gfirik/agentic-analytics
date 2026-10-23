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

## 2. The role detector (`detectRoles(ws, table)`)

It runs after PROFILE. For each column it returns a ranked list of candidates `{ role, score, evidence[] }`. The detector is deterministic: the same profile gives the same candidates.

### 2.1 Signals and score

Each candidate's score is the sum of four signals, capped at 1. The weights below are the initial values. PR 4 records the values as built in this section.

| Signal | Weight | Source |
|---|---|---|
| **Name** | exact synonym 0.5; a synonym as a whole token of the header 0.35 | the header, lower-cased, with punctuation and case-joins split (`UnitPrice` → `unit price`), matched against the synonym list (§2.3) |
| **Type** | a gate, plus 0.1 | the profile's inferred type (ingestion-and-profiling §5). A role whose typical types (§1) exclude the column's type is not a candidate at all: a text column is never `quantity`. |
| **Value pattern** | up to 0.2 | the profile's statistics: a date column whose values are on or after another date column's on ≥ 95% of rows is a `due_date` candidate against that `issue_date`; whole numbers with few distinct values (≤ 1% of rows, or ≤ 50) look like a code, not a `quantity`; a numeric column whose values are mostly negative where another is positive suggests a signed `amount` (bank) or a `discount` stored as a negative |
| **Cross-column identity** | 0.3 | the identities in §2.2, checked in SQL |

A column's proposal is its top candidate when that score is ≥ 0.4. Otherwise it is `none`. Ties are broken by the higher score, then by the role's order in §1, then by the column's position in the table. A column with no evidence at all gets no role.

### 2.2 Cross-column identities (SQL, `roles.sql.ts`)

Identities are checked in DuckDB with parameterized templates over the table's non-null rows. Each identity's rate is stored as an SQL fact (`role_identity.<check>.<table>`, unit percent) so the confirm screen and the report can show it. The fact is a measurement of the data, not a business figure, and V2 re-runs it like any other SQL fact.

| Identity | Holds when | Supports |
|---|---|---|
| gross line | \|q × p − a\| ≤ tol(a) on ≥ 95% of rows where q, p and a are non-null | `quantity`, `unit_price`, `amount` (gross) |
| net line | \|q × p − d − a\| ≤ tol(a) on ≥ 95% of such rows | the same, plus `discount`; `amount` is net of the discount |
| margin | needs a cost candidate: \|a − q × c − m\| ≤ tol(m) on ≥ 95% of rows | a column `m` as a margin (recorded as `measure`; margin is computed, never read from the file) |
| dates | due ≥ issue on ≥ 95% of rows where both are non-null | `issue_date`, `due_date` |
| balance | balanceᵢ − balanceᵢ₋₁ = amountᵢ on ≥ 95% of consecutive rows in file order | `balance`, signed `amount` (bank/cash) |

**Tolerance per row:** tol(a) = max(half a minor unit, 0.5% × \|a\|). Half a minor unit is 0.005 for currencies with two decimals, and 0.5 for currencies with none (for example JPY). Rows with a null in any term don't count either way.

**Hand-computed examples** (the same cases are used in PR 4's tests):

- *Tolerance.* q = 3, p = 33.33, a = 100.00: 3 × 33.33 = 99.99, \|99.99 − 100.00\| = 0.01 ≤ max(0.005, 0.5% × 100.00 = 0.50) = 0.50, so the row matches. q = 3, p = 0.33, a = 1.00: 3 × 0.33 = 0.99, \|0.99 − 1.00\| = 0.01 > max(0.005, 0.5% × 1.00 = 0.005) = 0.005, so the row doesn't match.
- *Threshold.* 19 matching rows of 20 → 19 ÷ 20 = 95% ≥ 95%: the identity holds. 18 of 20 → 90% < 95%: it doesn't hold, and the roles it would support get no identity points.
- *Gross vs net.* On the 10-line KPI fixture (analysis-library §8.2), lines 6 and 9 carry a discount (20.00 and 30.00), so q × p − a is 20.00 and 30.00 there. The gross identity holds on 8 of 10 rows (80%, rejected). The net identity holds on 10 of 10 (100%, accepted), so `amount` is read as net of discount.

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

"Std cost" is listed under `unit_cost`, so a name rule alone can't misread it as a standard deviation. The margin dataset of PR 2 plants this header on purpose.

### 2.4 The model's tie-break

When the top two candidates of a column are within 0.1 of each other, and a model is configured and `--yes` is not set, the extractor-tier model receives the column's header, type, five masked sample values and the candidate list. It returns one role from that list or `"undecided"`.

- The answer is validated against the candidate list. A role outside it is discarded, and the top score wins.
- The call goes through `ModelClient`. Tests use `FakeModel`.
- The model sees no other column's values and no document text (security §2).
- The choice is recorded in the role's evidence (`tie broken by model`). Small-model mode skips the call.

### 2.5 Storage

Roles are stored in the workspace next to the profile (a migration adds them):

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

The shares are SQL facts (`business_model.<signal>`). They support the assumption but are not claims, and the assumption's text carries no numerals, for example "Business model assumed: wholesale (a few customers hold most of the revenue)."

**Effect on order:** for `wholesale`, Pareto and concentration by customer come first; for `retail`, AOV and units per order come before customer concentration; for `subscription`, customers and new vs returning come first. For `unknown` the order is the one in analysis-library §8. Ranking (analysis-library §6) still decides what reaches EXPLAIN.

## 5. Confirmation

Roles are confirmed on the same screen as the metrics (analyst-grade §6.2; metric-layer §3; interfaces §1–§3). The job waits at AWAIT_CONFIRM as today.

- **What is shown:** only columns that have a proposed role, one line each, for example `UnitCost → unit_cost (name "unit cost"; the margin identity holds on 100% of rows)`, where the rate is the identity's fact (§2.2), rendered from its value. Each table's kind and the business model are shown too.
- **What the user can do:** accept, edit or drop each role. An edited role must be in the vocabulary (§1), and its column must exist. Otherwise the door refuses it with a typed error (`UNKNOWN_ROLE`, `UNKNOWN_COLUMN`). Dropping a role sets it to `none`. Editing a role re-runs the table-kind classifier and the code-drafted packs, so the metrics shown are always those the confirmed roles produce.
- **`--yes` / `auto_confirm`:** every proposed role is kept with `status: assumed`. Each assumed role that an analysis reads becomes an `Assumption` attached to the findings that use it ("Column ‘Std cost’ read as unit cost").
- **Saved:** confirmed roles are written with the confirmed metrics (`./agentic-analytics.metrics.yaml`, metric-layer §1 `roles:`), so the next run reuses them.

## 6. Roles in `report.json`

`report.json` gains `roles`, `table_kinds` and `business_model` (report-schema §5b). Scores are not in the report: they rank candidates inside the detector, and the report carries the evidence instead, with each identity rate as a fact. The workspace keeps the scores for `aa explain` and the roles eval.

## 7. Evaluation

Role detection is measured by `aa eval --suite roles` against a hand-labelled answer file (accuracy §11). The detector's proposal before confirmation and without a model is what is scored. The model's tie-break is measured separately, as information.
