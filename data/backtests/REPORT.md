# v0.1 real-data backtest

Report only: no engine code was changed. The engine ran on public data up to the end of 2023 (company reports:
up to the FY2023 annual report), and its findings and recommendations were scored against 2024 onward.
Raw data is in `data/backtests/raw/` (gitignored); source URLs and SHA-256 for every file are in
`raw/MANIFEST.json`. Method: `BRIEF.md`. Only this report is in the repo; the files and folders it names
(`BRIEF.md`, `raw/`, `runs/`, `sections/`, `tools/`) stay on the machine that ran it. Datasets, in run order:

1. Uzbek company reports (openinfo.uz): the main single-business test
2. Uzbekistan inbound tourism (SIAT)
3. Uzbekistan retail (SIAT + stat.uz press releases)
4. SEC EDGAR: small US food companies (no alcohol)
5. Inside Airbnb Istanbul (demand proxy only)

Sections are added as each dataset finishes; the combined fix list is at the end (section 6).

## Summary

**What we ran.**
- **Runs:** 5 datasets and about 40 engine runs, each first on the files as published (raw), then on a minimally
  cleaned copy.
- **Scripted baseline:** ran on everything.
- **Configured model:** ran only on the cement company (2 runs). The rest are deferred by the quota gate: one
  configured run can cost about 130k of the 200k daily planner tokens, and the 22:00 UTC nightly needs the same
  quota.

**Scorecard** (scripted baseline, the best clean run of each dataset; configured model in brackets):

| Dataset | right | partly | wrong | notes |
|---|---|---|---|---|
| 1 openinfo.uz (3 companies) | 8 (4) | 1 (1) | 0 (0) | no recommendations from either model; the 2023 "improvements" reversed in 2024 |
| 2 Tourism (SIAT) | 6 | 1 | 0 | trips, the main measure, never analysed |
| 3 Retail (SIAT) | 2 | 0 | 4 | December seasonality and source revisions reported as business events |
| 4 SEC (3 food companies) | 3 | 7 | 1 | losses never reported; cause quotes don't match the 10-K's own causes |
| 5 Airbnb Istanbul (proxy) | 4 | 1 | 2 groups | a 2026 price snapshot read as revenue history |

**What the scores mean.**
- **Numbers are right:** every number the engine reported matched the source (0 verifier mismatches in every run).
- **Raw files fail:** on the files as published, the engine read nothing numeric in all 5 datasets. Each time it
  still said "No material changes were found in this period."
- **Clean files mostly fail too:** they only worked once the column headers used the engine's own words
  (`date`, `amount`, `product`, `region`).
- **Weak forward value:** the findings describe the past correctly, but about half of them are seasonal effects,
  source artefacts or rebound-year comparisons. Recommendations were missing or were generic templates. Of the 5
  that came out (all from the scripted baseline), 1 was partly borne out in 2024 and 4 were wrong.
- **Hindsight risk:** none found in the 5 configured-model findings. They describe the numbers only. The deferred
  runs carry the high-risk cases: the tourism boom, cocoa prices, the Lifeway bid.

**Still to run.**
- **Configured runs:** run `bash data/backtests/tools/deferred-configured.sh` once a day after the nightly. It
  starts the next deferred configured run only if the gate allows it.
- **Scoring:** each result still has to be scored into its section.

## 0. Data and selection notes
- **Licences:** openinfo.uz is the official disclosure portal (public disclosure); SIAT and stat.uz are under CC BY 4.0;
  Inside Airbnb is CC BY 4.0; SEC EDGAR is public domain.
- **openinfo.uz:**
  - **Picked:** of 816 organisations, the first candidate per sector with an NSBU annual report for every fiscal
    year 2020–2025 (`raw/openinfo/coverage.json`):
    - Qizilqumsement (cement, manufacturer, id 238);
    - Chilonzor buyum savdo kompleksi (trade complex, id 633);
    - Turon sanatoriyasi (health resort, id 562). No hotel company is on the portal, so a sanatorium stands in
      for tourism.
  - **Left out:** banks, insurers, alcohol and tobacco makers (e.g. the Samarqand wine plant).
  - **Files:** the portal's Excel export failed for every report (HTTP 400). Its PDF failed for Turon's
    FY2021–2025 reports (HTTP 502). Each report's structured JSON (balance sheet and P&L lines) downloaded for
    every year.
- **SEC:** the halal rule ruled out RAVE ("beer and wine in some locations"), BTBD ("wine, beer, and cocktails",
  and no FY2020 10-K) and NROM ("16 different beers on tap"); Bridgford was ruled out for pork products.
  Used: Coffee Holding (JVA), Lifeway Foods (LWAY) and Rocky Mountain Chocolate Factory (RMCF), each with a 10-K
  for every fiscal year 2020–2025 and no alcohol sales (`raw/sec/CHECK.json`).
- **Inside Airbnb:** only the 2026-09-25 snapshot is downloadable. Prices are a current snapshot, so the monthly
  series is review counts per neighbourhood, a demand proxy only.
- **stat.uz:** 13 English internal-trade press-release PDFs downloaded. Their periods and release dates are read
  from each file.

## 1. Uzbek company reports (openinfo.uz)

**What we ran.**
- **Companies** (each its own business, one job per company and run type): 238 Qizilqumsement (cement), 633 Chilonzor buyum savdo kompleksi (trade complex), 562 Turon sanatoriyasi (health resort, the tourism stand-in).
- **Sources:** `raw/openinfo/<id>/FY<year>_annual_report-<id>_pub-<date>.{pdf,json}`.
  - Input window: FY2020-FY2023 reports. Answer key: FY2024 and FY2025 reports (JSON).
  - `--today` = day after the FY2023 pub date (238: 2024-07-25, 633: 2024-05-04, 562: 2024-05-29). `--currency UZS`.
  - Inputs live in `inputs/openinfo/<id>/{raw,clean,clean-wide}/`. 562 raw = its single FY2020 PDF (FY2021+ PDFs failed to download, HTTP 502).
- **What the files really are** (checked, the brief's assumptions needed two corrections):
  - **The published PDFs hold no financial statements.** They carry only company details, 6 ratios, dividends, material facts and the affiliates list (238 FY2023 PDF: 5 pages, no line "Чистая выручка" or "ВСЕГО по активу"; same for all input PDFs of 633 and 562). The numbers exist only in the JSON. A raw run by an owner who has just the PDFs cannot see revenue, cost or profit, whatever the engine does.
  - **P&L column order is the reverse of the brief.** `value1/value2` = PRIOR year income/expense, `value3/value4` = CURRENT year. Proof: for every company, report N's `value1` equals report N-1's `value3` (238 revenue: FY2022 report v3 = 1,722,515,153 = FY2023 report v1). Balance sheet: `value1` = start of year, `value2` = end of year (FY2023 `value1` = FY2022 `value2` = 2,792,335,740 for 238). I used each year's own report, current columns, as originally published (no restatements).
  - **Units are not stated anywhere** (no header in PDF or JSON). I inferred thousand soums: 633 and 562 values carry one decimal (hundreds of soums), and 238 revenue of 1.8bn read as soums would be about USD 140k, impossible for a cement plant. Label used: `value_thousand_uzs`.
- **Runs** (all in `runs/openinfo/`):

| run | out dir | result | wall |
|---|---|---|---|
| raw baseline 238 / 633 / 562 | `238-raw-baseline` (+ `238-raw-baseline-today` with the dated flags), `633-raw-baseline`, `562-raw-baseline` | all three: headline "No material changes were found in this period.", period 0000-9999, engine 0.0.0, model "unknown", 0 metrics, 0 facts | 1 s each |
| clean long baseline x3 | `<id>-clean-baseline` | same empty headline, period 2020-12 to 2023-12, 0 facts | 1 s each |
| clean wide baseline x3 | `<id>-cleanwide-baseline` | 3 / 2 / 4 findings (see scorecard) | 1-2 s each |
| raw configured 238 | `238-raw-configured` | same empty headline, 0 facts, 1 extractor call only | 3 s |
| clean wide configured 238 | `238-cleanwide-configured` | 5 findings, 122 facts, 0 recommendations | about 15 min (EXPLAIN 673 s, DECIDE 203 s) |
| clean wide configured 633, 562 | not run (see below) | SKIPPED by the quota rule | n/a |

- **Quota rule deviation (my error, recorded).** The planner route had about 3% of 200,000 tokens used at the start; the 238 clean run alone took the planner route to 131,317 tokens (65.7%) because of 42 planner calls (4 failed). My driver loop printed the usage line before each run but did not enforce the 100,000 gate, so it started 633 and then 562 straight after. I killed both within seconds (partial logs `633-cleanwide-configured.cli.txt`, `562-cleanwide-configured.cli.txt`; about 4,000 extra tokens; final planner-route total 135,319). No further configured runs were done. Nothing else is running.

- **What was cleaned** (script `tools/openinfo-clean.mjs`, from the JSON only):
  - **Long** (`clean/<id>_statements_long_FY2020-2023.csv`, 468 rows): columns `fiscal_year, period_end (YYYY-12-31), statement (balance|pnl), line_code, line_name (original Russian), value_thousand_uzs`. P&L value = current income column minus current expense column (so costs are negative); balance value = end-of-year column. Title rows dropped; zero lines kept.
  - **Wide** (`clean-wide/<id>_statements_wide_FY2020-2023.csv`, 4 rows): `period_end, revenue (line 010), cost_of_sales (020, shown positive), gross_profit (030), operating_expenses (040, positive), operating_profit (100), net_profit (270), total_assets (400), equity (480), cash (320)`.
  - Source typos left in on purpose (an owner would have them): 633 FY2021 `total_assets` 13,860,612,300 (next year's report says 138,606,123 for the same date, a x100 slip).
- **Outcome:** long format got nothing from either model. Wide format worked. The configured model was run on wide only.

**Scorecard.** Actuals from `tools/openinfo-actuals.mjs` (thousand UZS). "Verdict" judges the change the engine reported (real and correctly sized?). The right-hand column adds what 2024 did, because the findings are labelled improvements.

| # | claim (engine's words, short) | run | verdict | actual (FY2022 to FY2023; then 2024, 2025) | hindsight risk |
|---|---|---|---|---|---|
| 1 | 238 gross margin 638,113,927 to 809,861,277 (+26.9%) | clean-wide baseline | right | exact. Then 436,417,976 (-46.1%), 425,783,954 | none |
| 2 | 238 gross margin % 37.0 to 45.1 | clean-wide baseline | right | exact. Then 28.4%, 30.0% | none |
| 3 | 238 cost of goods sold -9.0% (1,084,401,226 to 987,073,071) | clean-wide baseline | right | exact. Then +11.5% (1,100,352,844), 995,864,988 | none |
| 4 | 633 revenue 75,792,455.8 to 105,105,254 (+38.7%) | clean-wide baseline | right | exact. Then 77,468,288 (-26.3%), 95,132,336 | none |
| 5 | 633 "gross margin" +38.7% (identical to revenue) | clean-wide baseline | partly | the change is real but it is revenue: the company reports no cost of sales (line 020 is 0 all years), so "gross margin" is 100% and the finding duplicates #4 | none |
| 6 | 562 revenue +23.1% (25,366,835.9 to 31,220,242.9) | clean-wide baseline | right | exact. Then 34,420,254.6 (+10.2%), 39,311,326.5 | none |
| 7 | 562 gross margin % 17.1 to 20.3 | clean-wide baseline | right | exact. Then 17.2%, 12.1% (fell back) | none |
| 8 | 562 cost +18.3% (regression) | clean-wide baseline | right | exact. Then +14.6%, +21.2% | none |
| 9 | 562 gross margin +46.1% | clean-wide baseline | right | exact (4,346,004.2 to 6,348,118.9). Then 5,916,361.3 (-6.8%), 4,764,725.6 | none |
| 10 | 238 total equity +18.3% (2,562,455,361 to 3,030,788,389) | clean-wide configured | right | exact. 2024: 3,029,732,456 (flat, -0.03%) | low (numbers only) |
| 11 | 238 net margin 17.4% to 26.1% ("expanded significantly") | clean-wide configured | right | exact. 2024: 0.03% (net profit 527,145), 2025: 0.07% | low |
| 12 | 238 total assets +16.0% | clean-wide configured | right | exact. 2024: 4,081,642,152 (+26.0%), 2025: 3,913,574,918 | low |
| 13 | 238 "Average Monthly Gross Profit" 638,113,927 to 809,861,277 | clean-wide configured | partly | value right but the label is wrong: it is the full-year figure, not a monthly average | low |
| 14 | 238 gross margin +26.9% "year over year" | clean-wide configured | right | exact (same as #1) | low |
| 15 | Recommendations (any run, any model) | all | untestable | none produced. The configured run's candidate actions failed validation twice ("claims_dropped": candidate actions); the scripted baseline's candidate list was empty | n/a |
| 16 | Headline "No material changes were found in this period." | raw baseline x3, raw configured 238, clean long baseline x3 | wrong | no numbers were read at all. 238 revenue actually moved -9.7% (FY2022) and +4.3% (FY2023), net profit +56.9% in FY2023 | none |

Counts. Scripted baseline: 8 right, 1 partly, 0 wrong on the 9 clean-wide findings; the empty headline (#16) is wrong in 7 of 7 runs where it appeared. Configured model: 4 right, 1 partly, 0 wrong on 5 findings; 0 recommendations; the configured raw run repeats the empty headline. Forward value: every finding is a true description of 2022 to 2023, but the "improvement" tags did not hold: 238 gross margin, net profit and equity all stalled or collapsed in 2024; 633 revenue fell 26.3%; 562 margin fell back. No finding warned about this (no data to), and no recommendation exists to score. Hindsight risk: none found; the configured model's text is arithmetic description with no event named (no construction boom, price liberalisation or tourism boom mentioned).

**Engine bugs and UX problems.** (all repro from repo root; `I=data/backtests/inputs/openinfo`)

1. **Empty headline when nothing numeric was read** (major, trust). Raw PDFs give "No material changes were found in this period.", period `0000`-`9999`, engine `0.0.0`, model "unknown", 0 facts, a "no cost column" list, and no warning that nothing was read. Same with a tidy long statements CSV. Expected: "I could not read any numbers from these files" and a non-zero or flagged exit. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/633/raw /tmp/o --today 2024-05-04 --currency UZS` then `node data/backtests/tools/summarize.mjs /tmp/o/report.json`. Configured: `bun run aa analyze $I/238/raw/*.pdf --yes --today 2024-07-25 --currency UZS --embedder hash --out /tmp/o2`.
2. **Published annual-report PDFs carry no statements** (major, data/scope). The portal PDF is ratios, facts and dividends only; the engine treats it as prose and extracts nothing numeric (the ratios, e.g. 238's six coefficients, are not read as metrics either). Repro: `pdftotext -layout $I/238/raw/FY2023*.pdf - | grep -c "ВСЕГО по активу"` prints 0. Fix is a spec/doc statement of what an owner must supply, plus a message (see #1).
3. **Units are lost: thousand UZS reported as UZS** (major, wrong magnitude). The wide CSV has `value` columns in thousand soums; the report prints "3,239,314,563 UZS" (a thousand times too small; real value 3.24 trillion soums). There is no way to say "thousand" (header word `_thousand_uzs` is ignored). Repro: `bun run aa analyze $I/238/clean-wide/*.csv --yes --today 2024-07-25 --currency UZS --embedder hash --out /tmp/o3`, then read the "Total Assets" finding.
4. **Long (tidy) statements are unreadable** (major). A `statement, line_code, line_name, value` table gives roles `fiscal_year:measure, line_code:line_id, value:measure` and no metrics: the engine cannot pick "line 010" as revenue. Also `line_name` (Russian text) gets no role at all and is dropped without a note, and `line_code` "010" is read as an integer ("type integer fits"), losing the leading zero. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/238/clean /tmp/o4 --today 2024-07-25 --currency UZS` then `node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/o4/report.json")).roles.map(r=>r.column+":"+r.role))'`.
5. **Annual data under grain "month"** (minor/major). Annual rows at 12-31 become periods `2022-12`, `2023-12`; findings read "in 2022-12 to 2023-12", and the configured model produced "Average Monthly Gross Profit" and "Average Monthly Revenue" metrics that are annual values (finding #13). The question "Can you add more than a year of history?" is asked although 4 years were given, because only the last two periods are compared (the 4 years never get a trend or YoY). Repro: wide run above, open `report.json` `.open_questions`.
6. **Missing cost line gives a fake "gross margin"** (minor). 633 reports no cost of sales; cost column is 0, gross margin equals revenue (100%) and is reported as a second finding. Expected: skip gross margin when cost is all zero. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/633/clean-wide /tmp/o5 --today 2024-05-04 --currency UZS` (F2 = F1).
7. **Wide statements only yield revenue and cost findings** (minor, baseline-model side). With `net_profit`, `total_assets`, `equity`, `cash` as measures, the scripted baseline produced no metric for them (the configured model did: 16 metrics). Not an engine fault by itself; noted so nobody reads the baseline as the engine's ceiling.
8. **Configured run cost and time on tiny input** (major, UX/quota). A 4-row, 10-column file took about 15 minutes and 131,317 planner-route tokens (65.7% of the daily 200,000) because EXPLAIN made 5 findings x several calls (42 planner calls, 4 failed). The CLI prints only "... finding N of 5 explained" with no token or time hint, and `aa analyze` has no "this will spend about N tokens" notice before `--yes`. Repro: `bun run aa analyze $I/238/clean-wide/*.csv --yes --today 2024-07-25 --currency UZS --embedder hash --out /tmp/o3; bun run aa usage --day $(date -u +%F)`.
9. **Recommendations silently missing** (major). Both models end with 0 recommendations: the candidate-actions step fails schema validation ("Too small: expected array to have >=1 items" on the baseline, a type-validation error on the configured model) after 3 attempts and is recorded only in `verification.claims_dropped`. The CLI summary says nothing about it, so the user sees a report with no "what to do next". Repro: any wide run, `report.json` `.verification.claims_dropped`.
10. **Duplicate claims per finding** (minor). Each configured finding carries two near-identical sentences ("Total Equity went from ... " and "Total Equity rose from ..."), and the CLI summary lists only 3 of the 5 findings. Repro: `node data/backtests/tools/openinfo-dump.mjs data/backtests/runs/openinfo/238-cleanwide-configured/agentic-analytics/report.json`.
11. **Output path nesting and warning noise** (minor). `--out X` writes `X/agentic-analytics/report.json`, not `X/report.json`; every run prints "AI SDK Warning ... responseFormat is not supported" plus a Node warning. The confirm screen was not exercised (`--yes` used on every run; non-interactive).
12. **Good catch worth keeping** (positive). The 633 x100 balance typo was flagged as `unit_error` on `total_assets` and `equity` (row 3) in the scripted baseline. The check works on mixed magnitudes inside a column; it does not flag the wrong unit of the whole column (#3).
13. **Source-data traps seen** (note for any user): the portal's value1/value3 order (see above); restated prior-year values differ slightly from the original (238 FY2020 net profit 599,995,377 vs 589,995,377 shown in the next report); 238 FY2025 prior-year revenue typo (1,538,770,820 vs 1,536,770,820). Nothing in the engine checks that a new report's "prior" column matches the old report.

**Fix candidates.**
- #1 No-numbers-read warning and no "No material changes" headline: `before v0.1 tag` (a false all-clear on the first thing an owner tries).
- #3 Units (thousand/million) from header words or a one-line question, and print them in the report: `before v0.1 tag` (numbers 1,000x off are a headline error); otherwise `v0.2` with a documented warning.
- #9 Say in the CLI and report when recommendations were dropped: `before v0.1 tag` (cheap, honest).
- #2 Docs: state that portal PDFs have no statements and what to supply: `before v0.1 tag` (docs only).
- #8 Token/time notice before a configured run and fewer planner calls per finding: `v0.2`.
- #4 Long-format statement support (line-code to metric mapping, text columns as labels, keep leading zeros): `v0.2`.
- #5 Annual-grain handling (grain "year", no "monthly" metric names, YoY over all years): `v0.2`.
- #6 Skip gross margin when cost is zero: `v0.2`.
- #10, #11 duplicate claims, `--out` nesting, warning noise: `v0.2`.

## 2. Uzbekistan inbound tourism (SIAT)

**What we ran.**
- **Business:** Uzbekistan's inbound tourism sector (analyst at a tourism board or hotel group). Sources: SIAT statistics portal, CC BY 4.0, `raw/uz-tourism/siat-<id>.xlsx` and `-table.json`. Tables: 1038 (total trips), purposes 1012 leisure, 1018 medical, 1024 visiting relatives, 1044 study, 1053 commercial, 1066 business; 1031 (by country, 205 countries); 3312 (expenditure total) and 3313 (by product). 1059/1062 (women/men) not used. All annual.
- **Window:** input = years up to 2023. Answer key = 2024 and 2025 (trips), 2024 (expenditure; 3312/3313 have no 2025). `--today 2024-01-01 --currency UZS`.
- **Units, checked in the xlsx "Metama'lumot" sheet** (the JSON states none): 1038 "thousand people" (its xlsx title says "foreign persons who entered ... for tourist purposes, officially declared", the JSON says "tourist trips": persons vs trips are not the same word); 1012 "thousands of people"; **1031 "persons"** (not thousands, unlike 1038); 3312 and 3313 "national currency, mln soums". So trips are thousands and expenditure is million UZS, confirmed, but the engine never sees that sheet as metadata (bug 2).
- **Source traps found (kept in the input, as an owner would have them):** purposes only sum to the total from 2014 (2012-13 hold only "leisure", 2,711k and 3,145k, above the 1,895k and 1,969k total); 3313 mixes subtotal rows (A, A.1; the code "A" is a Cyrillic letter) with leaf rows; 3313 "Transport equipment rental" is 0 from 2022; "Travel agencies" 2023 is exactly 1,350,000; "Other consumption products" jumps 799,872 to 5,383,375 (+573%) in 2023 and "Road passenger transport" falls -59.6% in 2023: likely definition changes, nothing in the files says so. The metadata sheet carries "last modified 2026-04-22" (a 2026 date inside a pre-2024 input; left untouched).
- **Runs** (out dirs in `runs/uz-tourism/`, all scripted baseline; wall time of the job):

| run | input | result | wall |
|---|---|---|---|
| raw baseline (`raw-baseline`) | 10 SIAT xlsx, 2024+ columns removed | headline "No material changes were found in this period.", period 0000-9999, 0 metrics, 0 facts | 2.9 s |
| clean long baseline (`clean-baseline`) | 3 tidy CSV (purpose, country, product; descriptive headers) | same empty headline, period 2014-12 to 2023-12, 0 metrics | 1.1 s |
| clean wide baseline (`clean-wide-baseline`) | 2 CSV, one row per year, one column per series | same empty headline, 0 metrics | 1.1 s |
| clean "engine words" baseline (`clean-engine-words-baseline`), the variant | same data as long, headers renamed `date, product, amount` / `date, product, quantity` | 5 findings, 1 recommendation, 126 facts, 126 numbers checked, 0 mismatched | 3.7 s |
| diagnostic: trips only (`diag-trips-only-baseline`) | `date, product, quantity` alone | empty headline, 0 facts | 0.6 s |
| configured model | clean "engine words" (2 files) | **DEFERRED (quota)**: gate said `NO: planner route at 135319 tokens today (limit for backtests 40,000)` at 19:47 UTC | not run |

- **Raw input build:** `tools/tourism-raw.mjs`. It opens each xlsx, and on the data sheet only ("Ma'lumot") deletes every cell of the columns whose header year is 2024 or later (2024 and 2025 in the trip tables; 2024 in 3312/3313) and shrinks the sheet range. Layout, four-language headers, `Code` column and the whole "Metama'lumot" sheet are untouched. It rewrites the file with the same library the engine uses (so the bytes differ from the published file; cell content does not).
- **Clean input build:** `tools/tourism-clean.mjs`, from the JSON. Years 2014-2023 for trips (the 2012-13 purpose rows are not comparable), 2019-2023 for expenditure. English names only; subtotal rows (Consumption products, Tourism characteristic products) and the total dropped so nothing is counted twice (the 11 leaf products sum to the 3312 total within 0.1); dates `YYYY-12-31`; unit in the column name (`trips_thousand`, `trips_persons`, `expenditure_mln_uzs`). Long = 3 files; wide = 2 files. The variant (what finally worked) = rename headers to the engine's own words and drop the country file: `date, product (=purpose or expenditure product), quantity (=trips, thousand)` and `date, product, amount (=expenditure, mln UZS)`. This relabels visitor spend as "revenue" and trips as "quantity", which is a stretch, but it is the only form the engine would read.
- **Actuals:** `tools/tourism-actuals.mjs` (JSON, node).

**Scorecard.** Actuals in thousand trips or million UZS. "right" = the change is real and correctly sized against the source.

| # | claim (engine's words, short) | run | verdict | actual (2022 to 2023; then 2024, 2025) | hindsight risk |
|---|---|---|---|---|---|
| 1 | "No material changes were found in this period." | raw, clean long, clean wide (3 runs) | wrong | no numbers read. Real: trips 5,232.8 to 6,626.3 (+26.6%), spend 17,776,692 to 25,169,190 (+41.6%). Then trips 7,957.2 (+20.1%), 11,679.6 (+46.8%); spend 34,037,552 (+35.2%) | none |
| 2 | Revenue 17,776,691.7 to 25,169,190.1 (+41.6%) [F1] | engine-words baseline | right | exact (source total 25,169,190; 0.1 is leaf rounding). 2024: +35.2%, 2025 not published | none |
| 3 | "Other consumption products" 62.0% of the change (4,583,502.2) [F1] | engine-words baseline | right | exact. Source jump +573% persisted (2024: 6,799,230, +26.3%), so it is a level reset, not a spike | none |
| 4 | Travel agencies 374,329.1 to 1,350,000 (+260.6%) [F2] | engine-words baseline | right | exact. 2024: 1,888,011 (+39.9%). Source value is a round number, likely an estimate | none |
| 5 | Other consumption products 799,872.3 to 5,383,374.5 (+573.0%) [F3] | engine-words baseline | right | exact (same as #3) | none |
| 6 | Air passenger transport 4,327,560.2 to 6,176,298 (+42.7%) [F4] | engine-words baseline | right | exact. 2024: 7,998,988.9 (+29.5%) | none |
| 7 | Road passenger transport 2,402,984.6 to 970,760.8 (-59.6%), "regression" [F5] | engine-words baseline | right | exact. 2024: 1,312,053.6 (+35.2%), still below the 2022 level | none |
| 8 | R1 "Win back road passenger transport", impact 408,184 to 952,429 next quarter, check revenue >= 17,776,692 by 2024-03-31 | engine-words baseline | partly | direction held (road +341,293 in 2024, 23.8% of the 1,432,224 drop), below the engine's low case (30% = 408,184). The check cannot be evaluated: data is annual, no 2024-03 period exists | none |
| 9 | Trips (total, purposes, countries): no finding at all | all runs | untestable (omission) | the main story is absent: 2023 trips +26.6% but still -1.8% vs 2019 (6,748.5); visiting relatives 83.9% of 2023 trips (81.8% in 2019); business trips +71.2% in 2023 and +135.9% in 2024; Tajikistan + Kyrgyzstan + Kazakhstan 78.9% of 2023 trips | none |

Counts. Scripted baseline: 6 right, 1 partly, 0 wrong on the 7 findings/recommendation of the one run that read data; the empty headline is wrong in 3 of 3 runs that showed it. Configured model: not run (DEFERRED). Forward value: all five findings describe 2022 to 2023 correctly and the growth carried on in 2024 (spend +35.2%, air +29.5%, accommodation +44.5%), but the engine said nothing about trips, the 2025 trips surge (+46.8%) or the country mix, and its one action is a generic "win back" template.

**Hindsight section (configured model not run, so nothing to score; rules for when it runs).** Trips 6.63m (2023) to 7.96m (2024) to 11.68m (2025) was widely reported. Any configured-model claim that forecasts growth beyond 2023, names a 2024-25 boom, visa-free regimes, new routes or "record" arrivals is **high hindsight risk**, because the input holds nothing after 2023 that supports it. Plain descriptions of 2022 to 2023 changes (arithmetic from the data) are low risk, as in dataset 1. The scripted baseline has no hindsight risk, and its findings above are pure arithmetic.

**COVID (2020-21).** The input holds 2020 (trips 1,504.1k, -77.7%; spend 2,489,966, -78.6%) and 2021 (spend 4,492,937). The engine compares only the last two periods, so 2022 is the base: spend 17,776,692 was itself +295.7% on 2021 and +52.7% on 2019. The F1 "+41.6%" is therefore a rebound-year comparison; the engine does not notice. No data-quality note, no "base year is abnormal" caveat, no comparison to 2019 (2023 trips are still 1.8% below 2019; spend is 2.16x 2019 in soums). The scripted baseline's open question "Can you add more than a year of history" is asked although 5 years were given (bug 6).

**Engine bugs and UX problems.** (`I=data/backtests/inputs/uz-tourism`, repo root)

1. **Empty "No material changes" headline when nothing numeric was read** (major, trust). Same as 1#1. Raw xlsx, clean long and clean wide all end with period `0000`-`9999` (raw) or `2014-12..2023-12`, 0 metrics, and no warning. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/raw /tmp/o --today 2024-01-01 --currency UZS` then `node data/backtests/tools/summarize.mjs /tmp/o/report.json`.
2. **Single-row data sheets are not read, and the metadata sheet is read as the table** (major). For 8 of 10 raw files (6 purpose files and 3312, one data row each) the "Ma'lumot" sheet is not registered as a table; only the "Metama'lumot" sheet (the unit and title block, with `name_uz/name_ru/name_en/name_uzc` all assumed `dimension`) is. So the one place that states the unit is parsed as data and the real numbers are lost. Repro: `node -e 'const r=require("/tmp/o/report.json");console.log(r.sources.map(s=>s.file+" "+s.locator.sheet+" "+s.locator.range).join("\n"))'` (siat-1012 lists only Metama'lumot A1:H17).
3. **Years-as-columns layout becomes measures, not time** (major, wide layout). In 1031 and 3313 the tables are read, but each year header becomes a measure `c_2014 ... c_2023`; no date column, no metric, no period. The four name columns are not given a role (1031: no dimension at all; 3313: only `klassifikator_en`), `Code` is ignored. Repro: print `r.roles` for tables T4 and T11 of the run above.
4. **Tidy long tables with honest headers are unreadable** (major). `purpose, trips_thousand` / `product, expenditure_mln_uzs` get `measure` roles and no metric, in both long and wide form (same family as 1#4, 1#7). It reads only when headers use the engine's words (`amount`, `quantity`, `product`, `date`). Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/clean /tmp/o2 --today 2024-01-01 --currency UZS` (empty) versus `$I/clean-engine-words` (5 findings).
5. **A count-only table yields no metric** (major for tourism). `date, product, quantity` alone gives an empty headline and facts 0; trips (the sector's main measure) can only be analysed if disguised as an amount. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/diag-trips-only /tmp/o3 --today 2024-01-01 --currency UZS`. Also in the combined run the `quantity` table is ignored (no trips finding) and the report only says "no quantity column" for pvm, which is false.
6. **Units lost** (major, same as 1#3). Million UZS is printed as plain "currency", e.g. "Revenue went from 17776691.699999996 currency ... to 25169190.1 currency": a millionfold too small (real 25.2 trillion soums), 16-digit float noise, no thousand separators, and the word "mln" in the header is ignored. Repro: `node data/backtests/tools/openinfo-dump.mjs data/backtests/runs/uz-tourism/clean-engine-words-baseline/report.json`.
7. **Annual data under grain "month"** (minor, same as 1#5). Period `2014-12` to `2023-12`, "in 2022-12 to 2023-12", and Q1 "Can you add more than a year of history for Revenue?" with 5 years supplied (only the last two are compared). Repro: same report, `.open_questions`.
8. **Uninformative titles** (minor). All five findings are titled "A change in revenue" and the headline is the same words, with no figure; a reader must open each claim. Repro: same report, `.summary.headline` and `.findings[].title`.
9. **Template recommendation does not fit the business** (major, quality). R1 is the retail template ("Win back X", risk "A discount lowers the margin on recovered orders", horizon "next quarter", check "by 2024-03-31" against the 2022 annual total). For annual visitor spend, no margin exists, "discount" is meaningless and the check date has no data period. No finding about trips or countries, so nothing in the report is actionable for a tourism board. Repro: same report, `.recommendations[0]`.
10. **Source breaks reported as business changes, no data-quality note** (minor/major, same as 1#13). +573% (other consumption), -59.6% (road), 1,350,000 (round figure) and a series that is 0 from 2022 (equipment rental) all pass as real movements; `data_quality` is empty. Repro: same report.
11. **COVID and abnormal base years not noticed** (minor, v0.2). See the COVID paragraph. Repro: same report; no mention of 2020-21 anywhere.
12. **Not tested here:** raw 3313 with subtotal rows (A, A.1) could double-count; unreadable in the raw run, and I removed them for the clean run. The `_is_total` guard in the metric SQL may handle it; unverified.
13. **Two ways to read the same input differ across file kinds:** the metadata sheet in every SIAT file ships a 2026 "last modified" date. It is harmless to the engine (not read as data) but it would count as post-2023 information in a strict pre-2024 input; flagged for the next dataset builder.

**Fix candidates.**
- #1 no-numbers-read warning instead of the all-clear headline: `before v0.1 tag` (same fix as dataset 1).
- #6 units from header words (`mln`, `thousand`) or a one-line question, printed in the report, plus number formatting: `before v0.1 tag` (million-fold error, same as dataset 1).
- #2 read single-row data sheets and treat the sheet with the unit line as metadata: `before v0.1 tag` (a published statistics-portal file is the likely first input for this market; the fix is small).
- #3 years-as-columns to periods (unpivot) and name columns to dimensions: `v0.2` (larger feature).
- #4, #5 accept descriptive measure headers and count-only tables (visits, trips, units): `v0.2` (semantics work).
- #9 recommendation templates by business kind / skip when no margin: `v0.2`.
- #7, #8 annual grain, titled findings: `v0.2`.
- #10, #11 break and abnormal-year checks: `v0.2`.
- Deferred configured run, to execute when the gate says OK (one command, once):
  `bash data/backtests/tools/quota-ok.sh && bash scripts/heavy.sh bun run aa analyze data/backtests/inputs/uz-tourism/clean-engine-words/spend_by_product.csv data/backtests/inputs/uz-tourism/clean-engine-words/visits_by_purpose.csv --yes --today 2024-01-01 --currency UZS --embedder hash --out data/backtests/runs/uz-tourism/clean-engine-words-configured`

## 3. Uzbekistan retail (SIAT + stat.uz)

**What we ran.**
- **Business:** analyst for a retail chain planning regional expansion in Uzbekistan. Input = data up to 2023-12-31, answer key = 2024 and 2025 (2026 YTD to September exists in the files, used only as a side check). `--today 2024-01-01 --currency UZS`. Inputs in `inputs/uz-retail/`, runs in `runs/uz-retail/`.
- **Tables** (`raw/uz/siat-<id>.xlsx` + `-table.json`), units read from the "Metama'lumot" sheet (the JSON states none):
  - **2699** monthly retail turnover by region (Republic + 14 regions), **"million sums", cumulative year-to-date** (2020-M01 .. 2026-M09; M12 = full year). Confirmed: 2022 Republic = 270,687,151.7 mln = 270.7 trillion soums. The sheet never says "cumulative"; it is visible only in the numbers (Jan 12.9m, Feb 27.1m, ...). Note field says "for 2021-2025" although 2020 is present.
  - **2822** monthly "growth rate", **"in percents"**. The sheet gives no definition. The stat.uz press releases say "increased by 112.3% compared to the same period of the previous year", so it is a year-on-year index of the cumulative period, and (see below) a real, not nominal, index: the 2022 index is 112.3 while 2699 grows only +7.4% nominal. Title says 2023-2024 in the JSON and 2023-2025 in the xlsx; headers list 2025-M06 before 2025-M05.
  - **454** small-business retail turnover by region, **"billion soums"**, columns `2010 .. 2025` (annual) and `2026-Q1..Q3` (cumulative YTD, quarterly). So one table mixes annual and quarterly columns with a different unit from 2699 (billion vs million).
- **Source traps found** (kept in the input): (a) **2699 cumulative series are revised retroactively**: de-cumulated, national 2023-M11 = 15.4 trillion between 29.7 (Oct) and 57.8 (Dec) and 38.9 (Sep); Fergana 2023-M11 is **negative** (-213,822.8: YTD falls from 22,136,841.1 to 21,923,018.3); in the answer key Karakalpakstan 2025-M10 is negative (-36,206.5) and national 2025-M10 = 15.3 trillion vs 46.3 in Nov. Neither is a business event. (b) **2699 vs the stat.uz PDFs disagree by about 15-20%**: PDF Jan-Dec 2022 = 319,288.2 bln; SIAT 2022-M12 = 270,687.2 bln (ratio 0.848); Jan 2022 PDF 18,426.5 vs SIAT 15,282.1; Jan-Sep 2022 PDF 214,086.7 vs SIAT 172,653.7. The PDFs are the preliminary and likely wider-coverage series; the table is a revised or narrower one. (c) **2699 nominal growth 2022 = +7.4%** against a real index of 112.3 (implied deflator 0.956, impossible with about 10-12% inflation): a series break around 2022. (d) The metadata sheet of every file carries a named official, a phone number and an email, and a 2026 last-modified date inside a pre-2024 input (as in dataset 2, bug 13).
- **PDFs** (13 files, period read with `pdftotext`; release dates mostly printed). Used only those whose period ends before 2024-01:

| file | period covered | published | used |
|---|---|---|---|
| `ichki-savdo-yanvar-dekabr-ang.pdf` | January 2022 (the cover says "January 2021", a typo; body says January 2022) | Feb 2022 (PDF creation date) | yes |
| `ichki-savdo_sentabr_201022_ang.pdf` | January-September 2022 | Oct 2022 (file name 20.10.22) | yes |
| `ichkisavdo202012presen.pdf` | January-December 2022 | Jan 2023 (PDF creation date) | yes |
| `ichki_savdo_2024_yanvar_ang.pdf` | January-December 2024 | 2025 | no (answer key) |
| `press-reliz-ichki-english_p98417` | Jan-Aug 2025 (22.09.2025) | | no |
| `press-reliz-ichki-eng_p92256` | Jan-Sep 2025 (21.10.2025) | | no |
| `ichki-savdo-press-reliz-eng_p49606` | Jan-Oct 2025 (21.11.2025) | | no |
| `ichki-savdo-en_p14615` | Jan-Nov 2025 (22.12.2025) | | no |
| `ichki-savdo-en-_p92438` | Jan-Dec 2025 (21.01.2026) | | no |
| `ichki-savdo-eng_p84179` | Jan 2026 (27.02.2026) | | no |
| `ichki-savdo-en-_p41834` | Jan-Feb 2026 (30.03.2026) | | no |
| `ichki-savdo-en_p98786` | Jan-Mar 2026 (30.04.2026) | | no |
| `ichki-savdo-en-_p27257` | Jan-Apr 2026 (26.05.2026) | | no |

  Note: no release in the set covers 2023 (the dated ones are 2022 and 2024-26), so **the documents describe 2022, a year older than the tables' last period**. The 2023-M12 cumulative figure is dated Dec 2023 but was published in Jan 2024; it is included (without it there is no 2023 comparison).
- **Raw input build:** `tools/retail-raw.mjs`. Opens each xlsx, on the data sheet only ("Ma'lumot") deletes every cell of the columns whose header starts with a year >= 2024 (2699 and 2822: 33 columns, new range `A1:BA16`, last header 2023-M12; 454: 5 columns `2024, 2025, 2026-Q1..Q3`, `A1:S16`, last header 2023) and shrinks the range. Metadata sheet, four-language headers, `Code` column untouched; rewritten with the engine's library.
- **Clean input build:** `tools/retail-clean.mjs`, from the 2699 JSON only. De-cumulated: January as published, month m = YTD(m) - YTD(m-1) within a year (rounded to 0.1), 2020-01 to 2023-12. Long format `date` (YYYY-MM-01), `region` (English name), amount in million UZS. 14 regions x 48 months = 672 rows; the Republic row is dropped (the regions sum to it within 0.6 mln per month). Variants: **honest headers** `date, region, retail_turnover_mln_uzs`; **engine words** `date, region, amount` (unit "million UZS" only in this note; the engine's words were required, same as 2#4; this relabels retail sales as "revenue"); **national only** (48 rows, engine words). 2822 and 454 are not in the clean input (percent index and a billion-soum annual table cannot be used as money; 454 is not additive with 2699). Negative Fergana 2023-11 and the Nov 2023 dip are left in (an owner would have them).
- **Runs** (all scripted baseline; wall = job time):

| run | input | result | wall |
|---|---|---|---|
| raw + PDFs (`raw-pdfs-baseline`) | 3 SIAT xlsx (2024+ columns removed) + 3 PDFs | headline "No material changes were found in this period.", period 0000-9999, 0 metrics, 0 facts, 7 data-quality flags (false) | 6.4 s |
| clean honest headers + PDFs (`clean-pdfs-baseline`) | CSV `date, region, retail_turnover_mln_uzs` + 3 PDFs | empty headline, period 2020-01 to 2023-12, 0 metrics | 2.6 s |
| clean engine words + PDFs (`clean-ew-pdfs-baseline`) | CSV `date, region, amount` + 3 PDFs | 5 findings, 1 recommendation, 311 facts, 311 checked, 0 mismatched | 10.3 s |
| **clean engine words** (`clean-engine-words-baseline`) | same CSV, no PDFs | identical findings, 311 facts | 7.8 s |
| clean national only (`clean-national-baseline`) | national CSV, engine words | 3 findings, 0 recommendations, 158 facts | 6.2 s |
| configured model | clean engine words (no PDFs: identical baseline result, fewer tokens) | **DEFERRED (quota)**: gate said `NO: planner route at 135319 tokens today (limit for backtests 40,000)` at 19:52 UTC | not run |

**What is NEW in this dataset.**
- **Cumulative YTD read as monthly flow:** in the raw run the 80 period columns of 2699 are `c_2020_m01..` measures with no date role (`code:measure`, only the name columns `dimension`), so the engine never gets to the point of mistaking cumulative for flow. Had it been shown, any month-on-month finding would be wrong by construction. Nothing in the raw or clean flow warns that a series is cumulative. After my de-cumulation the engine then **treats a December-vs-November jump as an anomaly** (see scorecard): seasonality is not modelled even though 4 years of data were given.
- **Growth-rate % table read as money:** 2822 is read as `c_2020_m01..:measure` columns exactly like money; no metric is formed, so nothing numeric is reported, and the percent unit is ignored. It would be summed if it had a date. Nothing detects "values around 100 = index".
- **Quarterly vs monthly mix:** 454 puts annual (`2010..2025`) and quarterly (`2026-Q1`) columns in one header row. All are `measure` columns, none dated. The engine's data-quality check marks 7 of its year columns as `unit_error` ("values look like they are in a different unit than the rest of the column"), because Tashkent city is 100x Syrdarya. These are false alarms on a regional spread, severity "high" (bug 6).
- **Regions in 4 languages:** 4 name columns (`Klassifikator`, `_ru`, `_en`, `_uzc`), all `dimension`, the same entity four times; `Code` is `measure`. Clean input with an English column only worked.
- **English documents next to data:** the 3 PDFs (49 pages) are indexed as page passages (`document:` sources, ~800-1,500 characters each) in every run, but **no number from them becomes a metric, fact, claim or citation** (citations checked 0; baseline has no extractor). Their totals (e.g. 319,288.2 bln for 2022) are not compared with the table (270,687.2 bln), so a 15% gap passes silently (bug 8).

**Scorecard.** Scripted baseline, best run (`clean-engine-words`; the PDFs added nothing; national-only is a subset). Actuals from `tools/retail-actuals.mjs` (JSON, node). Units million UZS unless stated; **nominal** growth, not real.

| # | claim (engine's words, short) | run | verdict | actual (2023, then 2024/2025) | hindsight risk |
|---|---|---|---|---|---|
| 1 | Headline and F1 "Revenue went from 15,396,511.5 in 2023-11 to 57,844,811.3 in 2023-12 (+42,448,299.8)" [anomaly, high] | clean baseline | wrong (as a finding; numbers exact) | December is the biggest month every year: Dec/Nov 1.27 (2020), 1.34, 1.68, **3.76 (2023)**, 1.61 (2024), 1.72 (2025); Dec = 12.6-17.7% of the year. The 3.76 is mostly the Nov 2023 dip (15.4 vs 29.7 in Oct) from the YTD revision, not business. | none |
| 2 | F2 "went from 29,696,229.8 in 2023-10 to 15,396,511.5 in 2023-11 (-14,299,718.3)" [anomaly, high], Fergana "20.2% of the change (-2,894,723.8)" | clean baseline | wrong | Nov 2023 = 15.4 trillion is an artefact (Fergana Nov is -213,822.8 as de-cumulated); Nov 2024 = 37,496,523 (+144%), so no real drop | none |
| 3 | F3 "went from 17,968,423.6 in 2022-09 to 24,661,879.5 in 2022-10 (+37.3%)", trend_break | clean baseline | wrong | Sep 2022 dip (Aug 23.6, Sep 18.0, Oct 24.7) is the same family of source revisions; arithmetic exact but the finding is 15 months old at the as-of date and not a trend break | none |
| 4 | F4 Tashkent city Dec 2022 11,123,214.7 to Dec 2023 14,246,631.5 (+28.1%) [improvement] | clean baseline | right | exact (same-month YoY, avoids seasonality). Annual Tashkent city 83,666,643 (+25.3%), 105,341,301.3 (+25.9%), 130,786,570.3 (+24.2%); share 25.7% to 27.1% in 2025. Real index (2822): 112.1, 110.9, 113.9 vs national 109.1, 109.9, 111.2. Nominal not named by the engine | none |
| 5 | F5 Tashkent region Dec 2022 4,400,425.8 to Dec 2023 5,547,647.3 (+26.1%) [improvement] | clean baseline | right | exact. Annual 30,130,828.8 (+19.3%), 38,662,787.4 (+28.3%, second fastest), 45,213,580.3 (+16.9%) | none |
| 6 | R1 "Win back Fergana region", impact 824,996 to 1,924,991 next quarter (30-70% of the Nov drop of 2,894,723.8), check "revenue >= 29,696,229.8 by 2024-03-01" | clean baseline | wrong | the drop it recovers is the source artefact (#2). Fergana annual 26,776,015.9 (+19.3% 2023), 35,002,375.5 (**+30.7% in 2024, the fastest of 14 regions**), 42,194,595 (+20.5%). The threshold is the national Oct 2023 month and is applied to Fergana; national Jan 2024 = 23,589,035.7 and Feb 25,843,341.1, both below it | none |
| 7 | Raw run headline "No material changes were found in this period." | raw + PDFs | wrong | nothing numeric read; real national 2023 +20.5% nominal (326,160,093.5), +9.1% real | none |
| 8 | No regional ranking or share finding (omission), no statement of nominal vs real | all runs | untestable (omission) | the expansion question has an answer in the data: Tashkent city 25.7% of 2023 turnover and +25.9% in 2024; Fergana +30.7%, Tashkent region +28.3%, Navoi +25.1% in 2024; weakest 2024: Samarkand +18.9%, Surkhandarya +19.7%. Real 2024 index: 108-111.9, so about half of nominal growth was price | none |
| 9 | Data quality: empty | clean runs | wrong (omission) | the negative Fergana month and Nov dip are not flagged, nor the PDF/table gap | none |

Counts. Scripted baseline (clean engine words): 2 right, 0 partly, 4 wrong, 2 untestable/omission on 6 findings + 1 recommendation (F4, F5 right; F1, F2, F3, R1 wrong); raw and honest-header runs: empty headline wrong in 3 of 3. Configured model: not run (DEFERRED). Forward value: the two right findings (Tashkent city, Tashkent region growing fast) held in 2024-25, but the top findings are seasonality and source-revision artefacts, and the one action points the chain at the fastest-growing region as a "win back".

**Hindsight section (configured model not run).** For when it runs: a claim that regional growth continues, names the Tashkent city / Tashkent region / Fergana ranking as 2024-25 outcomes, mentions the 2024-25 retail growth of about 24% / 20% nominal, a "record December" or inflation of 10%, is **high hindsight risk** (those only appear in the answer key). A statement of 2022 to 2023 arithmetic is low risk. The scripted baseline has no hindsight risk. Domain knowledge such as "December is the peak month" is not hindsight (it is derivable from 2020-23 in the input).

**Nominal vs real.** The engine only knows the one column named `amount`. It prints "currency" and "Revenue", never "nominal" or "real", and has no inflation input. In the data: 2023 nominal +20.5% (326,160,093.5 vs 270,687,151.7) against a real index of 109.1 (about 10.4% price effect); 2024 +23.7% vs 109.9; 2025 +19.6% vs 111.2. F4/F5's "+28.1% / +26.1%" are nominal; in real terms Tashkent city grew 12.1% (Dec 2023 index). A reader of the report could take 28% as real growth. No caveat appears (bug 5).

**Seasonality.** Judged: the engine treats Dec-vs-Nov as a real change (F1 headline, "anomaly", high severity). The package list has a `seasonal.ts`, but whether it ran is not visible in the report (the "analyses not run" list names only margin, pvm and contribution items; I did not read the engine code to check). 4 years x 12 months were supplied. Its same-month YoY findings F4/F5 are the only ones that avoid seasonality, and by luck of the "improvement" type, not by design.

**Engine bugs and UX problems.** (`I=data/backtests/inputs/uz-retail`, repo root)

1. **Empty "No material changes" headline when nothing numeric was read** (major, trust). Same as 1#1 / 2#1. The raw run (3 xlsx + PDFs) and the honest-header run both give it with period 0000-9999 (raw) or 2020-01..2023-12. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/raw-pdfs /tmp/o --today 2024-01-01 --currency UZS` then `node data/backtests/tools/summarize.mjs /tmp/o/report.json`.
2. **Period-as-columns layout (80 month columns) becomes measures, not time** (major). Same as 2#3: `c_2020_m01 .. c_2026_m09` are 80 measures in 2699 and 2822, 23 year/quarter columns in 454; no date, no metric, name columns four times as `dimension`, `Code` as `measure`. Repro: `node -e 'const r=require("/tmp/o/report.json");console.log(r.roles.slice(0,12))'`.
3. **Honest long headers unreadable; engine words required** (major). Same as 2#4: `date, region, retail_turnover_mln_uzs` reads nothing, `date, region, amount` reads. `region` is understood as location, `date` as transaction date. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/clean /tmp/o2 --today 2024-01-01 --currency UZS` (empty) vs `$I/clean-engine-words` (5 findings).
4. **Units lost, million UZS shown as "currency"** (major, same as 1#3, 2#6): "Revenue went from 15396511.5 currency ... to 57844811.3 currency", 15.4 and 57.8 trillion soums; float noise (`29696229.800000004`, `21.102568400160045 percent`). Repro: `node data/backtests/tools/openinfo-dump.mjs data/backtests/runs/uz-retail/clean-engine-words-baseline/report.json`.
5. **No nominal-vs-real statement** (major, quality, NEW). A retail report in a 10%-inflation economy compares soums across 12 months and calls +28% an "improvement". No caveat, no deflator question in `open_questions` (empty), no assumption line. Repro: same report, `.assumptions` and `.open_questions`.
6. **Seasonality not handled: Dec-vs-Nov flagged as anomaly** (major, NEW). Four years of monthly data; every December is the peak (Dec/Nov 1.27 to 1.72 in clean years). F1 is the headline. Repro: same report, `.findings[0]`; compare with `node data/backtests/tools/retail-actuals.mjs` (Dec/Nov table).
7. **Source revision artefacts reported as business changes, data quality empty** (major, NEW; family of 1#13/2#10). Cumulative series revised in-year give a negative month (Fergana 2023-11, -213,822.8) and a 50% national dip; F2 and R1 are built on it. Expected: a data-quality flag "a month is negative / cumulative series does not increase". Repro: same report, `.data_quality` is empty; `awk -F, '$3<0' $I/clean/retail_monthly_by_region.csv`.
8. **PDF numbers never become claims; no cross-check with the table** (major, NEW). 3 PDFs (49 passages) indexed, 0 citations, no use in findings or data quality, although the PDF says 319,288.2 bln for 2022 and the table 270,687.2 bln (about 15% off). Baseline has no extractor, so the configured model could behave differently (not run). Repro: `node -e 'const r=require("/tmp/o3/report.json");console.log(r.verification.citations_checked, r.sources.filter(s=>s.kind=="document").length)'` after running `$I/clean-ew-pdfs`.
9. **False "unit_error" data-quality flags on a region spread** (minor/major, NEW). 7 high-severity flags on 454 (`c_2014 .. c_2023`) because Tashkent city is two orders larger than Syrdarya; the flagged values are correct. Repro: raw-pdfs run `.data_quality`.
10. **Template recommendation does not fit and is based on the artefact** (major, quality; same as 2#9). "Win back Fergana region": retail-chain discount risk text ("A discount lowers the margin on recovered orders"), check threshold = a national month applied to one region, horizon "next quarter" for monthly data, premise = a negative-month artefact. No expansion/ranking recommendation. Repro: same report, `.recommendations[0]`.
11. **Annual/period grain labels, uninformative titles** (minor; same as 2#7/#8). All five findings are titled "A change in revenue" with no figure. Repro: same report, `.findings[].title`.
12. **Metadata sheet read as a table; personal contact data inside the input** (minor, NEW angle on 2#2). The "Metama'lumot" sheet (an official's name, phone, email) is registered as table T2/T4/T6 with all 8 columns `dimension`. Not a result problem, but it enters the job database. Repro: `r.sources` in the raw report.
13. **Single-row / multi-sheet handling worked here** (positive): unlike 2#2 the data sheet is a 15-row table and is registered correctly.
14. **Not tested here:** the configured model on this input (DEFERRED); how the engine treats a cumulative series with a `period` column named "Jan-Mar" (no such file); 2822 as a metric.

**Fix candidates.**
- #1 no-numbers-read warning instead of all-clear headline: `before v0.1 tag` (same as 1#1, 2#1).
- #4 units from header words or a question, formatted numbers: `before v0.1 tag` (a millionfold error, again).
- #6 skip or label Dec-vs-Nov: either use seasonal-aware comparison (same month last year) for the top finding when 24+ months exist, or at least a caveat: `before v0.1 tag` if a one-line "seasonal month, compare with last year" guard is cheap, otherwise `v0.2`.
- #7 negative-month and non-monotone-cumulative check in `data_quality`: `before v0.1 tag` (cheap, `value < 0` in a sales amount column, and it would have removed F2 and R1).
- #5 nominal vs real: one assumption line "amounts are nominal, not inflation-adjusted": `before v0.1 tag` (text only); a deflator question: `v0.2`.
- #2 period-columns to time (unpivot, "YYYY-Mmm" headers, cumulative detection): `v0.2` (larger feature; this is the shape of the portal's own files).
- #3 descriptive measure headers (`..._mln_uzs`, `turnover`): `v0.2` (same as 2#4).
- #8 documents-versus-table cross-check and claims from PDFs: `v0.2`.
- #9 unit_error on region spread: `v0.2` (loosen: compare within a row, not across entities).
- #10 recommendation templates by business kind: `v0.2`.
- Deferred configured run, to execute when the gate says OK (one command, once):
  `bash data/backtests/tools/quota-ok.sh && bash scripts/heavy.sh bun run aa analyze data/backtests/inputs/uz-retail/clean-engine-words/retail_monthly_by_region.csv --yes --today 2024-01-01 --currency UZS --embedder hash --out data/backtests/runs/uz-retail/clean-engine-words-configured`

## 4. SEC EDGAR: small US food companies

**What we ran.**
- **Business:** analyst for each of three small listed US food companies, one job per company per run type. `--today 2024-01-01 --currency USD`. Inputs in `inputs/sec/<T>/`, runs in `runs/sec/<T>/`, timings in `runs/sec/timings.txt`.
  - **JVA** Coffee Holding (coffee roaster; FY ends Oct 31), **LWAY** Lifeway (kefir; calendar FY), **RMCF** Rocky Mountain Chocolate Factory (FY ends end of Feb; "FY2024" = year to 2024-02-29).
- **Window.** Input = quarters ending 2020-01-01 to 2023-12-31 **and filed before 2024-01-01**, plus the 10-K and 10-K/A files filed before 2024. Answer key = quarters ending 2024-01-01 to 2025-12-31 (8 per company) and fiscal years from the later 10-Ks. Two gaps by the filing rule: JVA's Q4 FY2023 (ends 2023-10-31, 10-K filed 2024-02-09) and LWAY's Q4 2023 (10-K filed 2024-03-20) are in neither set. So the input ends **2023-07 (JVA), 2023-09 (LWAY), 2023-08 (RMCF)**, 15 quarters each.
- **Raw inputs** (`inputs/sec/<T>/raw/`): `companyfacts.json` as is (2.4 MB JVA) + every 10-K / 10-K/A HTML filed before 2024 (JVA 7 files, LWAY 7, RMCF 7; 1.1-1.6 MB each, with the financial statements as HTML tables).
- **Clean build** (`tools/sec-quarters.mjs`, `tools/sec-clean.mjs`), from `companyfacts.json`, `us-gaap`, USD facts only:
  - Revenue = first available of `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet`, `SalesRevenueGoodsNet` (companies switched tags in 2018-19). Cost = `CostOfRevenue`, `CostOfGoodsAndServicesSold`, `CostOfGoodsSold`. Operating income = `OperatingIncomeLoss`, net income = `NetIncomeLoss`.
  - **De-duplication:** facts from 10-K, 10-K/A and 10-Q forms only (a `DEF 14A` filing carries a wrong-scale `NetIncomeLoss` for RMCF FY2024, -4,661.19, see bug 12). Per (start date, end date), keep the entry with the **latest `filed`** date among filings before 2024-01-01 (ties: the earlier concept in the list). Raw facts per metric about 200-290, kept about 80 per metric (JVA 208 revenue facts become 80).
  - **Quarters:** Q1-Q3 = the 3-month (80-100 day) fact as reported. **Q4 = FY - 9M YTD** (FY = 350-380 day fact, 9M = 260-290 day fact with the same start; if no 9M, FY minus the three quarters). If the 10-K itself carries an explicit Q4 3-month fact, **that wins** (same vintage as its comparatives); the script prints the mismatches: none for JVA/LWAY, 3 for RMCF (FY2021, FY2022, FY2023 Q4 revenue differ by 1.7M, 2.3M, 2.5M between FY-9M and the explicit value, because the 10-K restated comparatives and the 9M fact is the old 10-Q one).
  - **Gross profit = revenue - cost, derived for all three.** The reported `GrossProfit` tag matches it for JVA and LWAY but not for RMCF (its tag is after factory, franchise and D&A costs, and stops after FY2023): RMCF's derived "gross margin" is NOT the company's own (FY2024: 26.1% derived vs 6.2% reported in the MD&A).
  - **Restatements, which numbers I used (latest filed before 2024):**
    - **JVA** 10-K/A filed 2023-03-17 restates FY2020: revenue 74,335,815 to 66,031,953, cost 61,256,926 to 52,953,064, gross profit unchanged 13,078,889 (a gross-to-net presentation change). FY2021 is unchanged (63,922,402). I used the restated FY2020 figures. The 10-Q quarters of FY2020 stay on the old basis, so **Q4 FY2020 (FY-9M) is a hybrid** (revenue 16,047,464, about 8.3M too low versus the old basis).
    - **LWAY** has no 10-K/A filed in 2023 in the files (10-K/As filed 2020, 2021 and 2025). Its correction of FY2020/2021 quarters is in the 10-K filed 2022-07-21 (Note 17); annual figures are equal in both filings. Latest-filed quarters used.
    - **RMCF** restated Q3 FY2023 comparatives (revenue 9,475,381 to 8,825,093; 9M cost 14,672,015 to 14,143,256) in a 10-Q filed 2024-01-16, after the cutoff. Inside the cut the cost for 2022-11 (5,869,566) and the derived Q4 FY2023 cost (5,783,358, versus 6,312,117 on the restated basis) are therefore on the old basis while revenue is on the new one: **RMCF gross margin for 2022-11 and 2023-02 is mixed-vintage**. RMCF also changed from whole dollars to thousands in 2023 (`6,435,985` then `6,436,000`).
  - Tables: honest headers `quarter_end, revenue_usd, cost_of_revenue_usd, gross_profit_usd, operating_income_usd, net_income_usd`; **engine words** `date, amount, cost_amount, gross profit, operating income, net income` (the engine's words were required, same as 2#4). Values in whole USD, one row per quarter end, 15 rows each.
- **MD&A cut** (`tools/sec-mdna.mjs`, node only): HTML to text (script/style/iXBRL header removed, block tags to newlines, cells joined with " | ", entities decoded, control characters removed); the span from a line starting `Item 7` + "Management's Discussion" to the next line starting `Item 7A` or `Item 8`; of all candidate starts the longest span wins (the table of contents and in-text cross-references are short or mid-line). One `.txt` per 10-K / 10-K/A: JVA 6 (incl. the two 2023 10-K/As), LWAY 4, RMCF 4; 24,000-54,000 characters each. The Part III-only 10-K/As (7 files) have no MD&A and give no file. Checked by head and tail of each.
- **Runs** (all scripted baseline; wall = job time):

| run | input | result | wall |
|---|---|---|---|
| raw JVA / LWAY / RMCF (`raw-baseline`) | 7 HTML 10-K(/A) + companyfacts.json | headline "No material changes were found in this period.", period 0000-9999, 0 metrics, 0 facts, 0 findings; 8761 / 7784 / 6198 document passages | **449 s / 411 s / 321 s** (job.duckdb 91 MB for JVA) |
| clean honest headers + MD&A (`clean-baseline`) x3 | CSV + 4-6 MD&A `.txt` | same empty headline, 0 facts, "no cost column" | 2-3 s |
| clean engine words + MD&A (`clean-ew-baseline`) JVA | CSV + 6 `.txt` | 1 finding, 0 recommendations, 85 facts, 85 checked, 0 mismatched | 4 s |
| clean engine words LWAY | CSV + 4 `.txt` | 5 findings, 0 recommendations, 94 facts checked | 5 s |
| clean engine words RMCF | CSV + 4 `.txt` | 5 findings, 91 facts, 10 citations; **2 of 4 `.txt` dropped** (bug 8) | 5 s |
| clean engine words RMCF, control characters removed (`clean-ew-v2-baseline`, `clean-v2-baseline`) | CSV + 4 `.txt` | 5 findings, 10 citations checked, data quality empty | 3 s |
| configured model, one run only | RMCF clean engine words v2 (most interesting: 5 findings tied to MD&A quotes, a loss-making business with a cocoa story) | **DEFERRED (quota)**: gate said `NO: planner route at 135319 tokens today (limit for backtests 40,000)` at 20:20 UTC | not run |

**What is NEW in this dataset.**
- **HTML is indexed as raw markup, tables are not read at all.** The 10-K files become `document` sources split into about 1,300 passages each (average 1,350 characters), but the passage text is the HTML source: `<p style="font: 10pt Times New Roman ...">`, `<span ...>`, and each statement as one `<table cellpadding=... id="xdx_307_...">` chunk (the Consolidated Statements of Operations of JVA FY2022 is one chunk of 7,552 characters of markup). No table role, no metric, no number from a statement (0 facts, 0 citations). Cost: 5-7 minutes and about 90 MB per company to embed markup.
- **XBRL JSON is not understood.** `companyfacts.json` (2.4 MB) is one `document` source of 2,444,665 characters, chunked into 37 passages up to 191,303 characters each (the other passages average 1,350). No fiscal year, form, filed date, start/end date or value is read, so the engine cannot show or warn about any of the XBRL traps; those fall on the person cleaning (my numbers: JVA 208 revenue facts across 4 tags collapse to 80 distinct periods; for RMCF the `fy`/`fp` fields are unreliable, e.g. Q2 data labelled `Q3` in a filing of 2024-10-15).
- **Year-to-date and derived Q4:** Q2/Q3 in 10-Qs come both as 3-month and as 6/9-month YTD facts; Q4 does not exist as a fact (except in some 10-Ks) and has to be FY - 9M. Not testable on the engine (it never reads the JSON), done in `tools/sec-quarters.mjs`. Engine consequence once fed clean quarters: **quarterly rows are treated as a "month" grain** (period "2020-01 to 2023-07, grain month"): finding dates read "2021-07 to 2021-10", which is a quarter, and there is no same-quarter-last-year label.
- **Fiscal years that are not calendar years:** quarter ends of 02-29, 05-31, 08-31, 11-30 (RMCF) and 01-31, 04-30, 07-31, 10-31 (JVA) appear as calendar months ("2020-02", "2023-08"). No fiscal-year concept; the engine's findings compare the first and last same-quarter of the window, which works by accident here.
- **Profit lines never analysed.** In the engine-words table `gross profit`, `operating income`, `net income` are all read as generic `measure` and nothing is formed from them. RMCF lost money in 9 of the 15 input quarters and JVA in 8 (operating and net); no finding, no data-quality note, no recommendation (bug 6).
- **MD&A text becomes "correlated" evidence with no relevance test** (bug 7).

**Scorecard.** Scripted baseline, best run per company (`clean-ew-baseline`; RMCF `v2`). Actuals via `tools/sec-actuals.mjs` and `inputs/sec/<T>/answer-key.json`. Whole USD. Gross margin % = (revenue - cost)/revenue as derived above. "Fiscal" years as in the heading. All numbers in the findings were exact (85/94/91 checked, 0 mismatched).

| # | claim (engine's words, short) | run | verdict | actual 2024+ (numbers) | hindsight risk |
|---|---|---|---|---|---|
| J1 | JVA F1 "Revenue went from 13,634,313 in 2021-07 to 17,685,694 in 2021-10 (+4,051,381)" [anomaly] | JVA clean-ew | partly | numbers exact (FY2021 Q3 to Q4). Real but 2 years before the window end (2023-07) and not repeating: Q4 vs Q3 +3.5% (2020), +29.7% (2021), -9.0% (2022), then +12.8% (2024), +16.0% (2025). FY revenue 63.9M, 65.7M, 68.2M, **78.6M (FY2024, +15.2%)**, **96.3M (FY2025, +22.6%)** | none |
| J1q | quote attached "Around the same time ... launch new brands of non-coffee CBD-infused beverages" [correlated] | JVA clean-ew | wrong (cause) | nothing in the MD&A links the Q4 FY2021 rise to CBD; the MD&A says net sales follow green coffee price pass-through and new customers | none |
| J2 | No finding on JVA's losses or margin collapse (omission) | JVA clean-ew | wrong (omission) | 8 of 15 input quarters at operating loss; FY2022 gross margin 25.1% to 16.8%, net loss -3,744,785; Q4 FY2022 operating loss -4,768,643 (FY2022 includes a 2.77M goodwill and intangible impairment per the MD&A). 2024+: FY2024 net +2,218,014 (op +2,963,558), FY2025 net +1,403,439; gross margin 20.4% then 16.0% (Q3 FY2025 9.4%) | none |
| L1 | LWAY F1 "Revenue 26,039,000 (2020-09) to 40,896,000 (2023-09), +57.1%" [improvement] | LWAY clean-ew | right | exact. Continued: 2024-09 46,095,000 (+12.7% on 2023-09); FY 160.1M (2023), **186.8M (+16.7%)**, **212.5M (+13.7%)** | none |
| L2 | F2 "Cost of goods sold 18,462,000 to 29,753,000, +61.2%" [regression] | LWAY clean-ew | partly | exact, cost grew faster than revenue (gross margin 29.1% to 27.2%). 2024-09: cost +15.0% vs revenue +12.7%, margin 25.7%; but full-year margin 26.5% (2023), 26.0%, 27.4% | none |
| L3 | F3 "Gross margin 7,577,000 to 11,143,000, +47.1%" [improvement] | LWAY clean-ew | right | exact. Gross profit FY 42.4M (2023), 48.6M (+14.5%), 58.2M (+19.8%) | none |
| L4 | F4 "Revenue 30,974,000 (2021-12) to 34,099,000 (2022-03), +10.1%" [trend_break] | LWAY clean-ew | partly | exact, real, but not a break: quarter steps of +14.8% (2021-03) and +13.9% (2022-09) were larger and growth continued at 3-14% a year after | none |
| L5 | F5 "Gross margin 7,921,000 (2022-12) to 8,226,000 (2023-03), +3.9%" [trend_break] | LWAY clean-ew | wrong | the real break is the next quarter: gross profit +37.1% (8,226,000 to 11,280,000), margin 21.7% to 28.8%, operating income 1.4M to 4.8M, and it held in 2024 (25-27%). The finding points at the quiet quarter | none |
| L6 | No operating or net income finding (omission) | LWAY clean-ew | wrong (omission) | FY operating income 2.3M (2022), **17.0M (2023)**, 13.9M (2024), 16.2M (2025): the profit step is the biggest event in the data and is invisible | none |
| R1 | RMCF F1 "Cost of goods sold 3,053,563 (2020-08) to 4,632,391 (2023-08), +51.7%" [regression] | RMCF clean-ew v2 | partly | exact; revenue grew +23.1% over the same span, cost/revenue 57% to 71%. Direction bore out: 68.2% in 2024-08, 73.9% (FY2024), 80.9% (FY2025) | none |
| R1q | quotes "The planned increase is the result of expected investment in machinery and equipment ..." and "Depreciation expense is based on the historical cost ..." [correlated], on all five findings | RMCF v2 / v1 | wrong (cause) | both are about depreciation and capex. The 10-K's own causes: FY2023 factory margin down "primarily to a 9.9% decrease in production volume and a $386,000 increase in expense associated with obsolete inventory"; FY2024 total gross margin 6.2% vs 16.4% "due primarily to ... a sharp increase in the cost of cocoa" | none |
| R2 | F2 "Gross margin % 42.7% (2020-08) to 29.4% (2023-08)" [regression] | RMCF v2 | right (direction) | derived margin FY 32.8% (FY2023), 26.1%, 19.1%; company's own total gross margin 16.4% to 6.2% in FY2024. Caveat: the quarter 2024-08 was 31.8%, up on 29.4% | none |
| R3 | F3 "Revenue 8,125,275 (2020-02) to 2,702,437 (2020-05)" [anomaly] | RMCF v2 | partly | exact; a real shock (store closures at the start of the pandemic) 3.5 years old, not a forecast. Next year revenue back to 6.8M | none |
| R4 | F4 "Gross margin 3,219,735 to -180,779" [anomaly]; F5 "Gross margin % -6.7% to 42.7%" [anomaly] | RMCF v2 | partly | same event as R3 told three times (revenue, margin, margin rebound); numbers exact | none |
| R5 | No operating or net loss finding, no recommendation (omission) | RMCF v2 | wrong (omission) | 9 of 15 input quarters at net loss; 2024+: 7 of 8 key quarters at operating loss; net income FY2023 -5,680,778, FY2024 **-4,172,000**, FY2025 **-6,122,000**; revenue FY 30.4M, 28.0M (-8.2%), 29.6M (+5.8%) | none |
| X1 | Recommendations: none for any company | all | wrong (omission) | `claims_dropped` says "the model's candidate actions failed validation ... expected array to have >=1 items" in every run (bug 9) | none |
| X2 | Raw runs: "No material changes were found in this period." | raw x3 | wrong | JVA revenue +15.2% FY2024; LWAY +16.7%; nothing numeric read | none |
| C | Configured model on RMCF | | not run (DEFERRED) | see hindsight section | n/a |

Counts, scripted baseline best run (11 findings, 0 recommendations): right 3 (L1, L3, R2), partly 7 (J1, L2, L4, R1, R3, R4 twice), wrong 1 (L5), plus the wrong cause quotes (J1q, R1q) and 3 company-level omissions and the missing recommendations. Raw runs: empty headline wrong in 3 of 3; honest-header clean runs: empty in 3 of 3. Configured model: not run.

**Hindsight section (configured model not run).** For when it runs. The pre-2024 MD&A text holds **zero mentions of cocoa (RMCF), Danone or tariffs (any company)**; RMCF's MD&A says depreciation and production volume. JVA's text mentions green coffee price pass-through 31 times and a pending merger with "Delta" (5), LWAY's text has "going concern" (4, from 2020-21). So a configured-model claim that RMCF's margin falls because of **cocoa**, that LWAY is a **takeover target** or growth continues because of Danone, or that coffee prices hit **records**, is **high hindsight risk**. Claims quoting the MD&A (production volume, obsolete inventory, depreciation, green coffee pass-through, goodwill impairment) are low risk. The scripted baseline has no such risk.
*Main-session check:* the zero counts hold for the MD&A inputs only. The full pre-2024 10-Ks name Danone 133 times (Lifeway's long-standing major shareholder) and cocoa 13 times (RMCF risk factors), and JVA's mention tariffs twice. So a claim that only names Danone as a shareholder, or cocoa as an input cost, is not hindsight. A claim about the 2024 takeover bid, the 2024 cocoa price spike or record coffee prices is.

**Engine bugs and UX problems.** (`I=data/backtests/inputs/sec`, `R=data/backtests/runs/sec`, repo root)

1. **Empty "No material changes" headline when nothing numeric was read** (major). Same as 1#1 / 2#1 / 3#1: all three raw runs, period 0000-9999, and all three honest-header runs. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/JVA/raw /tmp/o --today 2024-01-01 --currency USD` (7.5 minutes) then `node data/backtests/tools/summarize.mjs /tmp/o/report.json`.
2. **HTML is indexed as raw markup; tables inside HTML are not read** (major, NEW). The 10-K balance sheet, income statement and quarterly tables are single `<table ...>` passages of inline-style markup; no metric, no fact, no hint that tables exist. Expected: strip tags before chunking; parse `<table>` into tables. Repro: `node data/backtests/tools/duck-query.mjs $R/JVA/raw-baseline/job/job.duckdb "select substr(text,1,300) from chunks where text ilike '%gross profit%' limit 3"` (copy the db first; passages begin `<table cellpadding` and `<p style=`).
3. **XBRL `companyfacts.json` read as one 2.4M-character text document** (major, NEW). Chunks up to 191,303 characters; the structure (facts with `start`, `end`, `val`, `form`, `filed`, `fy`, `fp`) is not read. Repro: `r.sources.find(s=>s.file=="companyfacts.json")` gives `char_end 2444665`; `select max(length(text)) from chunks` is 191,303 in the JVA raw job.
4. **Very slow and heavy on large HTML** (major, NEW). 7 files / 10.6 MB take 449 s (JVA), 411 s, 321 s and leave a 91 MB database and a 2.4 MB `report.json`; the cleaned equivalent takes 2-5 s. Not an error, but an owner who drops five annual reports waits 5-8 minutes with an all-clear result.
5. **Engine words required again; honest headers read nothing** (major). Same as 2#4 / 3#3: `revenue_usd, cost_of_revenue_usd` become plain measures, no metric, empty headline (3 of 3); `amount, cost_amount` work. `gross profit` is read as measure only; the engine computes its own gross margin and ignores the column. Repro: `$I/JVA/clean-with-text` (empty) vs `$I/JVA/clean-ew-with-text` (1 finding).
6. **Operating income and net income are never analysed; losses invisible** (major, NEW). Both columns are `measure` roles with no metric. RMCF (9 of 15 quarters at a net loss, then FY2024/FY2025 -4.2M/-6.1M) gets findings about cost and gross margin and nothing on the losses; JVA's Q4 FY2022 operating loss of -4,768,643 is not flagged. Repro: `node -e 'const r=require("data/backtests/runs/sec/RMCF/clean-ew-v2-baseline/report.json");console.log(r.metrics.map(m=>m.id),r.roles.map(x=>x.column+":"+x.role))'`.
7. **"Around the same time" MD&A quotes are attached with no relevance test** (major, NEW; this is the evidence the user reads as the cause). The same two depreciation and capex sentences appear under all five RMCF findings (a pandemic revenue collapse included), and a CBD-beverage sentence under JVA's Q3 to Q4 revenue rise. Verification reports `citations_checked 10, unsupported 0`: it proves the quote exists, not that it explains the change. Run with the hash embedder as in the brief; the configured run may behave differently. Repro: `node data/backtests/tools/openinfo-dump.mjs $R/RMCF/clean-ew-v2-baseline/report.json | grep Around`.
8. **A text file with NUL characters is silently dropped; the data-quality item says only "unsupported type"** (minor, NEW). My first RMCF cut had 683 and 1,139 NULs in two files (my cleaning bug, fixed in v2): the engine kept 2 of 4 `.txt` and wrote `Data issue: unsupported type (in "<file>")`, medium severity, with no reason and no way to fix. Expected: name the cause or sanitize. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/RMCF/clean-ew-with-text /tmp/o8 --today 2024-01-01 --currency USD` and read `.data_quality` (v1 dir has the NULs; `clean-ew-with-text-v2` does not).
9. **No recommendation in any run, and the reason is not shown to the user** (major, NEW here; datasets 2 and 3 each produced one). Only `verification.claims_dropped` holds `(candidate actions) ... structured output failed validation after 3 attempts: candidates: Too small: expected array to have >=1 items`. Report, summary and open questions are silent. Repro: `node -e 'console.log(require("data/backtests/runs/sec/LWAY/clean-ew-baseline/report.json").verification.claims_dropped)'`.
10. **Quarterly data labelled "month"; fiscal quarters shown as calendar months; units lost** (major/minor). Period "2020-02 to 2023-08, grain month"; findings read "Revenue went from 3053563 currency in 2020-08 ..." (USD was passed with `--currency USD`; unit "currency", whole dollars, 16-digit floats like `51.70445148831053 percent`). Same family as 1#3 / 2#6 / 3#4. Repro: `node data/backtests/tools/openinfo-dump.mjs $R/RMCF/clean-ew-v2-baseline/report.json | head`.
11. **Finding selection compares the first and last same-quarter of the window, repeats one event three times, and misses the largest one** (major, quality). RMCF: pandemic quarter told as revenue, gross margin and margin rebound (F3-F5); LWAY: F5 flags a +3.9% step and not the +37.1% step one quarter later; JVA: one finding for 15 quarters with 8 operating losses. All titles "A change in revenue" with no number (same as 2#7). Repro: `node data/backtests/tools/summarize.mjs $R/LWAY/clean-ew-baseline/report.json`.
12. **Source-side traps the engine cannot see (for the cleaner)** (info). Restated comparatives with a mixed-vintage result (JVA FY2020 revenue 74.3M to 66.0M; RMCF Q3 FY2023 cost); filings of other forms (`DEF 14A`, 2026-06-29) inside `companyfacts` with a wrong-scale value; unreliable `fy`/`fp` labels; tag switches (`Revenues` to `RevenueFromContractWithCustomerExcludingAssessedTax`); dollars to thousands rounding. Repro: `node data/backtests/tools/sec-quarters.mjs`.
13. **Not tested here:** the configured model (DEFERRED); a year-to-date value in a table (the engine never read one); the 10-K/A Part III files (no MD&A, no numbers, just indexed).

**Fix candidates.**
- #1 no-numbers-read warning instead of the all-clear headline: `before v0.1 tag` (same as 1#1, 2#1, 3#1).
- #9 show "no recommendation could be produced, because ..." (or an open question) when the candidate actions fail validation: `before v0.1 tag` (silent, trust).
- #7 only attach a "correlated" quote when it shares the metric's words or period (or label "no explanation found"): `before v0.1 tag` if cheap (a wrong cause is worse than none), otherwise `v0.2`.
- #10 unit and number formatting, quarterly grain label: `before v0.1 tag` for units (same as earlier datasets), `v0.2` for fiscal quarters.
- #8 name the cause of an unsupported text file (NUL, encoding) or strip control characters: `v0.2`.
- #2 strip HTML tags before chunking and parse `<table>`: `v0.2` (feature), but at least tag stripping is a small change and cuts the 5-7 minutes and the database size: `before v0.1 tag` if trivial.
- #3 recognise SEC `companyfacts` JSON (or any big JSON) as data, not a document: `v0.2`.
- #4 cap passage size and embed time for large documents: `v0.2`.
- #6 analyse operating and net income when present (loss quarters at least in data quality): `v0.2`.
- #5 descriptive measure headers: `v0.2` (same as 2#4).
- #11 same-quarter-last-year comparison, largest-step selection, one finding per event: `v0.2`.
- Deferred configured runs, to execute when the gate says OK (one command, once per company; the first is the one chosen, run it first and the other two only when more quota allows):
  - RMCF: `bash data/backtests/tools/quota-ok.sh && bash scripts/heavy.sh bun run aa analyze data/backtests/inputs/sec/RMCF/clean-ew-with-text-v2/quarterly.csv data/backtests/inputs/sec/RMCF/clean-ew-with-text-v2/*.txt --yes --today 2024-01-01 --currency USD --embedder hash --out data/backtests/runs/sec/RMCF/clean-ew-v2-configured`
  - LWAY: `bash data/backtests/tools/quota-ok.sh && bash scripts/heavy.sh bun run aa analyze data/backtests/inputs/sec/LWAY/clean-ew-with-text/quarterly.csv data/backtests/inputs/sec/LWAY/clean-ew-with-text/*.txt --yes --today 2024-01-01 --currency USD --embedder hash --out data/backtests/runs/sec/LWAY/clean-ew-configured`
  - JVA: `bash data/backtests/tools/quota-ok.sh && bash scripts/heavy.sh bun run aa analyze data/backtests/inputs/sec/JVA/clean-ew-with-text/quarterly.csv data/backtests/inputs/sec/JVA/clean-ew-with-text/*.txt --yes --today 2024-01-01 --currency USD --embedder hash --out data/backtests/runs/sec/JVA/clean-ew-configured`

## 5. Inside Airbnb Istanbul (demand proxy)

**What we ran.**
- **Business:** the hosts of one active neighbourhood against the rest of the city. Sources: Inside Airbnb Istanbul snapshot 2026-09-25 (CC BY 4.0): `raw/airbnb/istanbul/reviews.csv.gz` (624,804 reviews, 2010s to 2026-09-28), `listings.csv.gz` (27,232 listings, 90 columns), `listings-summary.csv` (27,232 rows). **Demand proxy only:** a review is a rough trace of a past stay (it lags the stay by days to weeks, and only a share of guests review). There is no revenue, no occupancy and no price history in the data; `price` is today's asking price only and is never used as a 2020-2023 value. Everything below called "revenue" is the engine's word for a review count.
- **Neighbourhood rule (stated before looking at outcomes):** among the 39 neighbourhoods (the snapshot's `neighbourhood_cleansed`), those with at least one review in every month 2020-01 to 2023-12 (5 qualify), then the most reviews in 2023. Result: **Beyoglu** (35,673 reviews in 2023; Fatih 12,984, Kadikoy 8,961, Sisli 6,179, Besiktas 3,903). 7,447 of the 27,232 listings in the snapshot are in Beyoglu (median current asking price 3,957, a 2026 snapshot).
- **Window:** input = reviews dated 2020-01-01 to 2023-12-31 (171,278 reviews; the raw file also keeps 45,325 reviews from before 2020, 216,603 in all). Answer key = 2024-01 on: 2024 and 2025 full years, 2026 to the last full month (2026-08; September is partial). `--today 2024-01-01 --currency TRY`. Currency: the detailed file writes prices with a "$" sign (e.g. `$4,736.32`) but the summary file shows the same listing as `4736`, so the values are lira; the symbol is wrong, inferred not stated (it matters little: no price enters a claim in the good runs).
- **Survivorship and leakage in the input itself.** The snapshot holds only listings still on the site in 2026. Listings with at least one review in the file, by review year: 2016 413, 2019 1,217, 2020 1,505, 2021 2,232, 2022 4,344, 2023 6,514, 2024 7,940, 2025 9,543, 2026 11,737. Delisted listings are missing, more so the older the year, so the 2020-2023 series is too low, most in the early years, and its growth is overstated (2022 to 2023 city reviews +51.3% includes listings that were later removed from the old base). The answer key is biased less (the 2024-25 reviewers' listings mostly still exist in 2026) and, because 2023 is undercounted more than 2024, the 2023 to 2024 growth is also biased upward. Every number below is "reviews of surviving listings". Also the 2026 snapshot's `last_review`, `number_of_reviews`, `price` columns are post-2023 information inside the "input": it is unavoidable for the listings file, and it did leak into a run (bug 4).
- **Runs** (out dirs `data/backtests/runs/airbnb/`, all scripted baseline; wall = whole command, job time in brackets):

| run | input | result | wall |
|---|---|---|---|
| raw as downloaded (`raw-baseline`) | `reviews.csv.gz` (30.2 MB, rows to 2023-12-31, all columns) + `listings.csv.gz` (13.6 MB) | both files `archive_rejected` ("gzip archives are not supported in v0.1"); empty headline, 0 sources, period 0000-9999 | 1.9 s [0.5] |
| raw gunzipped (`raw-gunzipped-baseline`) | the same two files as plain CSV (72.5 MB and 73.9 MB) | both `too_large` (per-file limit, 50 MB); same empty headline | 2.1 s [0.8] |
| row level, comments dropped (`rowlevel-baseline`) | `reviews_rows.csv` (listing_id, review_id, date; 171,278 rows, 7.1 MB) + `listings-summary.csv` (4.8 MB) | 5 findings, 3 recommendations, 160 numbers checked, 0 mismatched; all about the snapshot, not reviews (bug 4) | 107 s [106] |
| raw with comments, Q4 2023 sample (`raw-q4sample-baseline`) | `reviews.csv` all 6 columns, 21,967 rows dated 2023-10 to 2023-12 (6.8 MB) + `listings-summary.csv` | identical findings to the row-level run; comments read as `description`; none reached a claim (bug 5) | 110 s [109] |
| clean honest headers (`clean-baseline`) | `month, neighbourhood, review_count_demand_proxy` (1,397 rows, 2020-01 to 2023-12, 39 neighbourhoods) | "No material changes were found", 0 metrics | 1.9 s [0.6] |
| clean count-only (`clean-count-only-baseline`) | `date, region, quantity` | same empty headline (same as 2#5) | 1.7 s [0.6] |
| clean engine words (`clean-engine-words-baseline`) | `date, region, amount` | 1 finding, 1 recommendation, 300 numbers checked, 0 mismatched | 7.7 s [6.6] |
| clean engine words + snapshot (`clean-ew-snapshot-baseline`) | the above + `listings_snapshot.csv` (neighbourhood, listings count, median price, 2026 snapshot) | identical report; snapshot table registered but unused | 7.7 s [6.7] |
| clean, Beyoglu vs rest (`clean-one-baseline`) | `date, region, amount`, 2 regions ("Beyoglu", "Rest of Istanbul"), 96 rows | 3 findings, no recommendation, 169 numbers, 0 mismatched | 5.4 s [4.3] |
| configured model | clean-one (best fit for "Beyoglu against the city") | **DEFERRED (quota)**: gate said `NO: planner route at 135319 tokens today (limit for backtests 40,000)` at 20:29 UTC | not run |

- **What was cleaned / built** (all by `tools/airbnb-csv.mjs`, `airbnb-build.mjs`, `airbnb-clean.mjs`; an own streaming CSV reader because comments hold quoted line breaks): reviews filtered by date and counted per month and neighbourhood by joining `listing_id` to the listing's `neighbourhood_cleansed` (0 of 624,804 reviews lacked a listing); month as `YYYY-MM-01`; zero months not written (sparse long table); the raw gz was filtered by re-serialising CSV, so bytes differ but cells do not. **Personal data:** `reviewer_name`, `reviewer_id` and `comments` are in the raw-as-downloaded and Q4-sample inputs only (they are the raw runs); all clean and row-level inputs have counts or ids only. No names, ids or comment text are quoted in this section; the report check below used 383 comment snippets that live only in a temp file.
- **Actuals:** `tools/airbnb-actuals.mjs`, `tools/airbnb-score.mjs` (node, from the gz).

**What is NEW in this dataset.**
- Gzip input is rejected, and the gunzipped files exceed the 50 MB per-file limit: a real Inside Airbnb download cannot be read in either form (bugs 1, 2).
- Free-text multilingual comments (83,255 of the 171,278 in-window comments contain non-ASCII text, 40,946 contain line breaks) as untrusted text: none reached a claim under the baseline (bug 5).
- The listing snapshot, with today's price, was read as if it were a transaction history (bug 4).
- A row-level event table (one row per review) was not counted into a metric, and no join to the listings was attempted (bug 3).

**Scorecard.** "right" = the change is real and correctly sized against the review counts of surviving listings; proxy for demand, not revenue. Actuals: city = all 39 neighbourhoods.

| # | claim (engine's words, short) | run | verdict | actual (Dec 2022 to Dec 2023; then 2024, 2025) | hindsight risk |
|---|---|---|---|---|---|
| 1 | "No material changes were found in this period." | raw (2 runs), clean honest, count-only (4 runs) | wrong | no numbers read. Real: city reviews 2022 to 2023 53,119 to 80,389 (+51.3%); Dec 4,267 to 6,358 (+49.0%) | none |
| 2 | Revenue 4,267 (2022-12) to 6,358 (2023-12), +2,091, +49.0% [F1] | clean engine words, clean-one | right | exact. Next: Dec 2024 9,050 (+42.3%), Dec 2025 13,454 (+48.7%); full years 80,389 to 110,084 (+36.9%) to 152,983 (+39.0%). Biased by survivorship (see above) | none |
| 3 | "Beyoglu" 33.6% of the change (702) [F1] | clean engine words | right | exact (702 of 2,091 = 33.6%). Beyoglu Dec 2,021 to 2,723 (+34.7%). Next year it flipped: Dec 2024 4,074 (+49.6%), 50.2% of that year's change | none |
| 4 | "Beyoglu" 2,021 to 2,723, +34.7% [F2]; "Rest of Istanbul" 2,246 to 3,635, +61.8% [F3] | clean-one | right | exact. Full-year view: Beyoglu 2023 35,673 (+30.0% on 2022), rest 44,716 (+74.1%); share of city 51.7% (2022) to 44.4% (2023). 2024: Beyoglu 50,136 (+40.5%) vs rest 59,948 (+34.1%); 2025: 71,263 (+42.1%) vs 81,720 (+36.3%); 2026 Jan-Aug: 59,841 (+37.2% on the same months of 2025) vs 70,640 (+40.7%) | none |
| 5 | R1 "Win back Bagcilar", "accounts for most of the drop" (impact 1.14 to 2.66 next quarter; check revenue >= 4,267 by 2024-03-01) | clean engine words | partly | The premise is false: F1 is a rise (+49.0%); Bagcilar fell by 4 reviews (37 to 33, -10.8%) of +2,091, a 0.2% sliver, in a month with single digits. It later rose (Dec 2024 42, 2025 71; years 491, 579, 672) but nothing in 2024+ is attributable to a "win back". The check (city month >= 4,267) is met trivially: March 2024 city 7,933. "Revenue", "discount lowers the margin" mean nothing for review counts | none |
| 6 | F1 to F5 "A change in revenue": Revenue 30,039,133 (2026-08) to 69,850,744 (2026-09), +94.15% "Entire home/apt"; "Private room" +560%, "Entire home/apt" +1,395.7%; 46,077,592 (2024-10) to 9,277,770 | row level, Q4 sample | wrong | not a business quantity: price (a 2026 asking price) x minimum nights summed by the month of each listing's last review. September 2026 city reviews are partial (6,347 Beyoglu at the cut), nothing like 69.9m. Wrong in kind, not in arithmetic | none |
| 7 | R2 "Win back Basaksehir", R3 "Win back Gungoren" (anomaly 2026-09) | row level, Q4 sample | wrong | built on bug 4 artefact; also Basaksehir has 5 to 10 reviews a month | none |
| 8 | Omission: no seasonality, no COVID base, no growth trend over 4 years, no 2023 vs 2019 | all runs | untestable (omission) | see paragraphs below | none |

Counts. Scripted baseline: right 4 (claims 2, 3, 4 across 2 runs), partly 1, wrong 2 groups (the empty headline in 4 runs; F1 to F5 plus R2, R3 in the 2 row-level runs, 8 claims). Configured model: not run (DEFERRED). Forward value of the good claims: the 2023 growth carried on in 2024-25 (+36.9%, +39.0%), and the claim that Beyoglu was losing share to the rest of the city in 2023 (-7.3 points) did not hold in 2024 (45.5%) or 2025 (46.6%), only a small recovery; the engine says nothing about this either way.

**Hindsight section (configured model not run; rules for when it runs).** Istanbul tourism records in 2024-25 and lira inflation were widely reported. Any configured-model claim naming record arrivals, a tourism boom, short-term-rental regulation, the lira falling, or predicting continued growth in 2024-25 is **high hindsight risk**: the input holds no data on those and the claim could only come from training. The same for the neighbourhood ranking beyond what the input shows. Plain arithmetic on the 2020-2023 counts is low risk. Nominal price talk is excluded anyway because the input holds no historical price. The scripted baseline has no hindsight risk.

**Seasonality (as in 2-3).** Judged from the input: city reviews peak in autumn (October is the top month in 2022, 2023, 2025 and May in 2024; May to October is a plateau), with Jan-Feb the trough: 2023 Feb 3,837 vs Oct 8,593 (2.2x); Beyoglu 1,754 vs 3,849. Dec/Nov is 0.84 to 0.96 in every year. The engine's F1 here is a same-month year-on-year (Dec 2022 vs Dec 2023), so the seasonal trap of dataset 3 is avoided, but nothing in the report says that, offers a seasonal view, or compares to the Nov-to-Dec fall (-9.4% in 2023: 7,016 to 6,358). Whether that is by design or by chance I did not check in the code. Summer is not the peak in this proxy (reviews arrive after the stay and the high season in Istanbul runs spring to autumn).

**COVID (2020-21) and the base.** The window opens in the COVID trough: Beyoglu had 46 reviews in April and May 2020 each; year totals Beyoglu 7,457 (2020), 14,505 (2021, +94.5%), 27,442 (2022, +89.2%); city 2021 to 2022 +114.2%. The engine compared only the last two months of the window and says nothing of the rebound. 2019 (outside the window) holds 18,223 city reviews and 10,079 Beyoglu (surviving listings only), so 2023 is 4.4x 2019, mostly new listings and survivorship, not 4.4x demand: the proxy conflates listing growth with demand per listing. No finding separates the two, and the input cannot (the listing count per month is unknown; only today's snapshot exists).

**Engine bugs and UX problems.** (`I=data/backtests/inputs/airbnb`, repo root)

1. **Gzip input rejected, a standard download format** (major, new). `reviews.csv.gz` and `listings.csv.gz` both give a medium data-quality item "archive rejected" and an empty report with the "No material changes" headline; the engine's own text says gzip is not supported in v0.1. The message does not tell the owner to unzip, and the all-clear headline is shown (same as 1#1). Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/raw /tmp/o --today 2024-01-01 --currency TRY` then `node data/backtests/tools/summarize.mjs /tmp/o/report.json`.
2. **50 MB per-file limit blocks the real files, and the empty headline again** (major, new). After gunzip: reviews 72.5 MB (this is only the pre-2024 part; the full file is about 190 MB) and listings 73.9 MB: `too_large`, 0 sources, same empty headline. The row limit is by bytes, so free-text columns cause it, not the number of rows (171k rows of 3 columns is 7 MB and was read). Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/raw-gunzipped /tmp/o2 --today 2024-01-01 --currency TRY`.
3. **A row-level event table (one row per review) is not counted** (major, new; related to 2#5). `listing_id,review_id,date` alone has only a date role, so no metric; the engine did not offer "count rows per month", and it did not join `listing_id` to the listings' neighbourhood. An owner with transaction logs and no amount column gets nothing. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/rowlevel /tmp/o3 --today 2024-01-01 --currency TRY` and print `r.roles` for table T2 (only `date:transaction_date`).
4. **A listings snapshot is read as a transaction history** (major, trust, new). `price` is read as `unit_price`, `minimum_nights` as `quantity`, `last_review` as the transaction date: "revenue" = price x minimum nights summed by the month of each listing's last review. The result is a 2026-09 headline of 69,850,744 "currency" (+94%), "Private room +560%", "Entire home/apt +1,395.7%", and three "win back" recommendations (R2 and R3 for neighbourhoods with under 10 reviews a month), all `verified: true` with 160 numbers checked and 0 mismatched: the arithmetic is right, the meaning is wrong. The period runs to 2026-09 for a job with `--today 2024-01-01`; a data-quality item "dates in the future" is raised (medium) but the dates are still used (and the result is the first headline). Today's price entering a past period is exactly the trap in the brief. Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/rowlevel /tmp/o3 --today 2024-01-01 --currency TRY` then `node data/backtests/tools/openinfo-dump.mjs /tmp/o3/report.json`.
5. **Untrusted comments: held (positive), with two open points** (minor, new). In the Q4 sample (21,967 comments, many non-English, many with line breaks) the table was parsed correctly (quoted multi-line cells), `comments` got role `description`, and 383 comment snippets were searched in `report.json`, `report.draft.json`, `metrics.drafted.json` and `report.html`: 0 found. Open points: (a) this is the baseline, which has no extractor, so a configured run could behave differently (DEFERRED with the configured run); (b) `reviewer_name` and `reviewer_id` columns are ingested with the table (personal data inside the job database; same angle as 3#12). Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/raw-q4sample /tmp/o4 --today 2024-01-01 --currency TRY`.
6. **Run time follows the listings table, not the review rows** (minor, new). Row-level (171k review rows + 27k listing rows) 106 s; Q4 sample (22k + 27k) 109 s; the clean 1.4k-row table 6.6 s. So about 100 s for the 27k-row, 19-column summary alone (I did not profile why; per-column checks or the drill-down by room type are guesses). Not a problem for a laptop, but a surprise for a file of that size. Repro: `time` over the two commands above.
7. **Honest headers still unreadable; count-only table gives nothing** (major, same as 1#4, 2#4, 2#5, 3#3). `month, neighbourhood, review_count_demand_proxy` and `date, region, quantity` both end with "No material changes" and 0 metrics. Only `date, region, amount` reads, so a count had to be disguised as an amount: the report then says "Revenue ... currency" for a review count (and no proxy label can be attached). Repro: `bash scripts/heavy.sh bunx tsx data/backtests/tools/run-baseline.ts $I/clean /tmp/o5 --today 2024-01-01 --currency TRY` (empty) versus `$I/clean-engine-words` (1 finding).
8. **A recommendation that contradicts its own finding** (major, quality; family of 2#9, 3#10). R1 "Win back Bagcilar", rationale "accounts for most of the drop", because F1 is an improvement; Bagcilar's share is 4 of 2,091. The impact is 1.14 to 2.66 "currency". The template picks the region with the largest negative delta even when the total rose and the delta is noise. In clean-one, with no region falling, the candidate actions were dropped after 3 failed validations (`claims_dropped`), so no recommendation is shown: the failure is silent. Repro: `node data/backtests/tools/openinfo-dump.mjs data/backtests/runs/airbnb/clean-engine-words-baseline/report.json` and `node -e 'console.log(require("./data/backtests/runs/airbnb/clean-one-baseline/report.json").verification.claims_dropped)'`.
9. **The neighbourhood-vs-city question is only answered by hand-made input** (minor, v0.2). With 39 neighbourhoods the engine reports one region's share of the change, but never "Beyoglu grew slower than the rest (+34.7% vs +61.8%)" until the data was cut into two regions. Share-of-change is not the same as relative growth, and a reader may take "33.6% of the change" for outperformance, when Beyoglu was 47.4% of the base: it lagged.
10. **Seasonality and COVID base not mentioned; units and format** (minor, same as 2#11, 3#6, 1#3). F1 is same-month YoY, so not harmful, but no caveat anywhere. Float noise remains (`49.00398406374502 percent`, `94.15091240593102 percent`); "currency" for a review count; titles all "A change in revenue" (same as 2#8). Repro: same report as bug 8.
11. **Survivorship and "proxy" cannot be stated to the engine** (minor/major, new angle). Nothing lets the owner tell the engine that a count is a proxy or that old periods are undercounted; the assumptions list shows "Revenue ... drafted automatically and not confirmed by you" (A1) but there is no question asking what "amount" is. Repro: print `.assumptions` and `.open_questions` (empty) of the clean-engine-words report.
12. **Not tested here:** the configured model on any input (DEFERRED), a daily-resolution file, a multi-language `neighbourhood` spelling (names in the snapshot are ASCII-folded, e.g. "Beyoglu"), the rest of the 90-column detailed listings (too large to read).

**Fix candidates.**
- #1 accept `.gz` (decompress with a size cap) or a clear message "unzip this file": `before v0.1 tag` (the standard download of this and many open datasets; the all-clear headline on a failed read is the same fix as 1#1).
- #2 byte limit versus free-text columns: tell the owner which file is too large and what to do (drop columns, filter by date); make the message cause an error or warning headline, not "No material changes": `before v0.1 tag` (cheap message fix; limit itself can stay).
- #4 do not accept dates after `--today` as history, and ask before reading `price` x `minimum_nights` as revenue from a snapshot table (columns like `last_review`, `number_of_reviews`, `availability_365` mark a listings snapshot): `before v0.1 tag` for the future-date guard (cheap, the check already exists, only its consequence is missing); the snapshot detection `v0.2`.
- #3 count rows per period when there is no amount (and join through an id column): `v0.2` (semantics work, same as 2#5).
- #7 descriptive measure headers and counts: `v0.2`.
- #8 recommendation sanity (skip when the total rose, minimum size of a delta, no silent drop): `v0.2`; the silent drop should at least show a note: `before v0.1 tag` if cheap.
- #5 mark `reviewer_name`-like columns as personal data; keep quarantine check for the configured run: `v0.2`.
- #6 time for a 27k-row table: `v0.2` (profile).
- #9, #10, #11 relative growth by group, seasonality/COVID caveats, proxy label: `v0.2`.
- Deferred configured run, to execute when the gate says OK (one command, once; the gate also refuses from 21:00 UTC):
  `bash data/backtests/tools/quota-ok.sh && bash scripts/heavy.sh bun run aa analyze data/backtests/inputs/airbnb/clean-one/beyoglu_vs_rest.csv --yes --today 2024-01-01 --currency TRY --embedder hash --out data/backtests/runs/airbnb/clean-one-configured`
  Afterwards check whether any comment text appears if a raw comments file is ever given to the configured path (not part of that command; `$I/raw-q4sample/reviews.csv` is the input for it).

## 6. Prioritised fix list

**Before v0.1 tag** (small changes; each one is a false all-clear or a wrong-magnitude number an owner hits on
their first try):
1. **"No numbers read" instead of "No material changes".** When no metric or fact is produced, say what was read
   and why nothing numeric came out (file too large, gzip, no table, headers not recognised), and give a warning
   exit or headline. Hit in all 5 datasets (1#1, 2#1, 3#1, 4#1, 5#1–2).
2. **Units.**
   - Read thousand/million/billion from header words (`_thousand_uzs`, `mln`), or ask one question, and print the
     unit in the report.
   - Format numbers (no `17776691.699999996`).
   - Values are 1,000x or 1,000,000x off today (1#3, 2#6, 3#4, 4#10).
3. **Say when recommendations were dropped.** The candidate-actions step fails validation, and the only trace is
   `verification.claims_dropped`. Add a line in the CLI and the report (1#9, 4#9, 5#8).
4. **Data-quality guards that already have their data:**
   - Dates after `--today` must not count as history (5#4).
   - Flag negative or non-monotone values in a sales amount column or a cumulative series (3#7).
5. **One-line caveats:**
   - "Amounts are nominal, not inflation-adjusted" (3#5).
   - "December vs November is a seasonal month; compared with last year: …", if cheap; otherwise v0.2 (3#6).
6. **Clear file messages:** `.gz` ("unzip this file", or decompress with a cap), over the size limit (name the
   file, say what to drop), a text file with control characters (5#1–2, 4#8).
7. **Docs:**
   - Tested formats in plain words: one tidy table per file, one header row, ISO dates. Name the column words the
     engine recognises.
   - Portal PDFs (openinfo.uz) hold no statements.
   - 10-K HTML and SEC companyfacts JSON aren't read as data in v0.1 (1#2, 4#2–3).

**v0.2:**
1. **Descriptive headers and count-only tables.** Recognise `turnover`, `trips_thousand`, `revenue` and the like as
   metrics. Analyse counts (trips, reviews, visits) with no money column (2#4–5, 3#3, 4#5, 5#3, 5#7). This is the
   biggest blocker for real files after #1.
2. **Wide and portal layouts:**
   - Years or months as columns, which need unpivoting (2#3, 3#2).
   - Single-row sheets; a metadata sheet treated as metadata, not data (2#2).
   - Cumulative year-to-date detection (3#2).
   - Long statement tables with line codes (1#4).
3. **Grain and comparison:**
   - Annual and quarterly grain: no "monthly" names, fiscal quarters (1#5, 4#10).
   - Same period last year by default; use every period, not only the last two; COVID or abnormal base years
     (2#7, 2#11, 3#6, 4#11).
4. **Breaks, revisions and losses:**
   - Source breaks and revisions flagged, not reported as events (2#10, 3#7).
   - Operating and net income analysed, so losses get reported (4#6).
   - Snapshot tables detected; price × minimum nights not read as revenue (5#4).
5. **Recommendations and causes:**
   - Recommendation templates by business kind (no "discount" for a tourism sector or a cement plant), and skipped
     when the total rose (2#9, 3#10, 5#8).
   - "Correlated" quotes only when the words or period match (4#7).
6. **Documents:**
   - HTML tag stripping and `<table>` parsing.
   - Big JSON (companyfacts) read as data.
   - Passage size caps.
   - PDF numbers cross-checked against tables (4#2–4, 3#8).
7. **Cost and UX:**
   - A token and time estimate before a configured run, and fewer planner calls per finding: 1 run on a 4-row
     file cost about 130k tokens and 15 minutes (1#8).
   - `--out` nesting and warning noise (1#11).
   - Duplicate claims (1#10).
8. **Personal data:** mark personal-data columns (reviewer names, contacts in portal metadata sheets) and keep them
   out of the job database (3#12, 5#5).

## 7. After the fixes (2026-11-12)

All seven "Before v0.1 tag" items from §6 are merged:
- #140: file messages.
- #141: "No numbers could be read" and exit 2.
- #142: the recommendations note.
- #143: units and scale.
- #144: the date and value guards.
- #145: the nominal and December caveats.
- #146: the docs page "Which files work in v0.1" and the README and site wording.

Every raw and clean scripted-baseline run was re-run on main at ef11a68, with the same inputs, `--today` and currency as before. Run it with `bash data/backtests/tools/after-fixes.sh <this folder>` from a main worktree. Outputs are in `runs/<dataset>/<variant>-after/`, the one-line summaries in `runs/after-fixes.tsv`, and the earlier runs in `runs/before-fixes.tsv`.

**False all-clears: 17 before, 0 after.**
- **Before:** every run that read no numbers (17 of the 27 runs with a before run) said "No material changes were found in this period."
- **After:** every such run says why.

| Runs | Before | After |
|---|---|---|
| openinfo 238/633/562 raw (portal PDFs); SEC JVA/LWAY/RMCF raw (10-K HTML, companyfacts JSON) | "No material changes were found" | "No numbers could be read from these files: no table was found (add a spreadsheet or CSV with one header row)." |
| openinfo long statements; tourism raw and clean; retail raw PDFs; airbnb clean (honest headers) | "No material changes were found" | "No numbers could be read from these files: no column was recognised as a date and an amount (name them, for example, date and amount)." |
| airbnb raw (`.csv.gz`) | "No material changes"; data quality "archive rejected" | "No numbers could be read from these files: every file was rejected (see Files not read)." The summary lists each file: "“reviews.csv.gz” is gzip-compressed, which this version does not read. Unzip it first (for example with gunzip) and add the file inside it." |

`aa analyze` exits with code 2 on all of these.

**Honest headers that now read.** Unit words are ignored when a header is matched (#143).
- `date, region, retail_turnover_mln_uzs` (retail clean): before, it read nothing and had no "before" run. After, 5 findings.
- SEC clean with `revenue_usd`-style headers: before, 0 findings each. After, JVA 1, LWAY 2 and RMCF 1 finding, with the same numbers as the engine-words runs.

Still not read (v0.2, §6): tourism `trips_thousand` and `expenditure_mln_uzs` (count-only and descriptive), openinfo long statements (`line_code, value`), airbnb `reviews` counts.

**Units and number format.**
- Retail clean (`retail_turnover_mln_uzs`): "Revenue went from 15,396,511.50 million UZS in 2023-11 to 57,844,811.30 million UZS in 2023-12 (a change of 42,448,299.80 million UZS)." Before, the summarizer showed raw values such as `17776691.699999996 currency` (tourism, §2) with no scale.
- SEC: "26,039,000 USD … 40,896,000 USD".
- No raw floats such as `17776691.699999996` appear on the page.
- openinfo `clean-wide` still shows plain UZS: its headers don't say "thousand", so the value is 1,000x small as before. The docs page now says to put the scale in the header.

**Guards.**
- Airbnb row-level: the period ended in 2026-09 before and ends in 2023-12 after, with "Some dates are after today's date; those rows were left out of the analysis (column “last_review” …)".
- Retail: the negative Fergana month (2023-11, −213,822.8) is now a data-quality item: "Some sales amounts are negative and the file has no refund or return marker, so they may be entry errors (… {{N405}} rows)".
- Caveat on the retail run: the scripted model's top recommendation is still "Win back “Fergana region”", which is driven by that same negative month. The flag now warns the reader, but the recommendation does not yet discount flagged rows. That is v0.2.

**Caveats.** Every run that compares money across periods carries "Amounts are nominal, as in the files; they are not adjusted for inflation." On retail, the headline finding (2023-11 to 2023-12) carries "Note: December is often a seasonal peak; compare it with December of last year." directly under it in the CLI and Telegram summary. The year-on-year number itself is v0.2.

**Recommendations note.** Before, 6 runs with findings had zero recommendations and no explanation (openinfo clean-wide ×3, SEC engine-words ×3). After, those and the 3 SEC clean runs that now read numbers each say "No recommendation could be produced: the step that drafts actions did not return a valid result. The findings above still stand." This is the scripted baseline's DECIDE output; configured-model runs are deferred (§6 quota note).

**Unchanged:**
- Finding counts and fact values on the engine-words runs (the same 5/126, 5/311→312, 1/85, 5/94, 5/91 and 1/300 findings and facts). Retail gains one fact, the negative-row count.
- The airbnb row-level run gains 3 facts (counts for the new data-quality items).
- Raw SEC runs still take 5–7 minutes each to index the 10-K HTML before saying no table was found.
