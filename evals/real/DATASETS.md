# Public datasets: licences, credits and checksums

The real-data tier downloads these files at run time (`bun run eval:real:fetch`). They are never committed. The results we publish (`evals/RESULTS.md`, the README, the docs site) contain numbers derived from them, so each is credited here and wherever those numbers appear.

## Online Retail II

- **Credit:** Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D. Creator: Daqing Chen.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- **Licence evidence**, from the publisher's page https://archive.ics.uci.edu/dataset/502/online+retail+ii (read 2026-10-16): "This dataset is licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) license." The fetch re-reads this sentence on that page before every download.
- **Download:** https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip
  - archive, 45,622,418 bytes: SHA-256 `572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb`
  - `online_retail_II.xlsx` in it: SHA-256 `bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980`
- **Changes made (CC BY 4.0 asks us to say):** we keep every invoice whose number is divisible by 10 (cancellations "C…" included) from both sheets and write them as one CSV with ISO dates. `online_retail_II.sample10.csv`, 105,797 lines: SHA-256 `6d8dff8c0bff0e9a2b158b792b0bbc5940f4f81a597da3af3583f1ebaada7858`

## Electronic card transactions, September 2026 (Stats NZ)

- **Credit:** This work is based on Stats NZ's data (Electronic card transactions: September 2026), which are licensed by Stats NZ for reuse under the Creative Commons Attribution 4.0 International licence.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- **Licence evidence**, from the publisher's copyright page https://www.stats.govt.nz/about-us/copyright/ (read 2026-10-16): "Crown copyright ©. All material Stats NZ produces is protected by Crown copyright. Unless otherwise specified, content we produce is licensed under the Creative Commons Attribution 4.0 International licence." The page asks adapted works to carry the statement used as the credit above. The fetch re-reads the "Unless otherwise specified…" sentence on the copyright page before every download. The release page: https://www.stats.govt.nz/information-releases/electronic-card-transactions-september-2026/
- **Download:** https://www.stats.govt.nz/assets/Uploads/Electronic-card-transactions/Electronic-card-transactions-September-2026/Download-data/electronic-card-transactions-september-2026.zip (each release has its own URL, so the file doesn't change under it)
  - archive, 158,264 bytes: SHA-256 `a89b02ba61b127baf3894bb333961710e4b4d6486dfcdc012d18c0655aa970c2`
  - `electronic-card-transactions-september-2026-csv-tables.csv` in it: SHA-256 `60481c7f33519db445819b740e0468df72ee5c4bcb360ee213402b7a02adcee9`
- **Changes made:** we keep the rows of series ECTM.S1GA1 to ECTM.S1GA8 (monthly, actual values by industry group) with the file's lines unchanged. `nz-card-spend-by-industry.csv`, 2,568 lines: SHA-256 `63ff45be4c783950ae58d263f021a6c5b5dcd424c0b8b84732d978199d42ed9f`

## Hotel booking demand datasets (Data in Brief, 2019)

- **Credit:** Antonio, N., de Almeida, A., & Nunes, L. (2019). Hotel booking demand datasets. *Data in Brief*, 22, 41–49. https://doi.org/10.1016/j.dib.2018.11.126. The data is the article's supplementary material.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- **Licence evidence**, from the article (read 2026-10-22): "This is an open access article under the CC BY license (http://creativecommons.org/licenses/by/4.0/)." ScienceDirect's article page answers 403 to scripts, so the text is read from the article's full text in Europe PMC (PMC6297060, https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6297060/fullTextXML), the open archive the article is deposited in. The publisher's own Crossref record for the DOI lists the same licence for the published version (`http://creativecommons.org/licenses/by/4.0/`, content-version "vor"). **The fetch re-reads this sentence before every download** and stops (`LICENCE_CHANGED`) if it is gone.
- **Download:** the supplement from the publisher's own file host (Elsevier's ars.els-cdn.com, the link the article gives), not the Kaggle or TidyTuesday copies: https://ars.els-cdn.com/content/image/1-s2.0-S2352340918315191-mmc2.zip
  - archive, 1,361,767 bytes: SHA-256 `6db57d635b9edec05f1cf9616ba6473e864909e4fc34819fa21cff58d518ee6a`
  - `H1.csv` (the resort hotel, 40,060 bookings) in it: SHA-256 `6f38fda13794fd6cf6547d2432ffb79666200000eb45fd09e4b97fe49519a6ab`
  - `H2.csv` (the city hotel, 79,330 bookings) in it: SHA-256 `5107090ffdc5585a9e18299801e9d85c3b459c235542882183a502a73ef63c4d`
  - The article's other supplements are the same data as R files (mmc3.zip) and a data dictionary (mmc1.pdf); they are not used.
- **Changes made:** both files in one CSV, the resort hotel's lines first, each line unchanged behind two added fields: `Hotel` ("Resort Hotel" for H1, "City Hotel" for H2) and `ArrivalDate` (ISO, from ArrivalDateYear, ArrivalDateMonth and ArrivalDateDayOfMonth). `hotel-bookings.csv`, 119,390 bookings: SHA-256 `3b22c26428ec81ad9432ec81f063c3623921ea0865066b5412535a39d143773b`

## Warehouse and Retail Sales, 2017–2020 (Montgomery County, Maryland)

- **Credit:** Source: Montgomery County, MD. Warehouse and Retail Sales, https://data.montgomerycountymd.gov/d/v76h-r7br (dataset id `v76h-r7br`; the Department of Liquor Control's sales and movement data by item and supplier).
- **Licence:** Public Domain, as the dataset's Socrata metadata states it.
- **Licence evidence**, from the dataset's metadata https://data.montgomerycountymd.gov/api/views/v76h-r7br.json (read 2026-10-23): `"licenseId" : "PUBLIC_DOMAIN"`, `"license" : { "name" : "Public Domain" }`, `"attribution" : "Montgomery County, MD"`. The same record shows no restriction beyond that. The human page is rendered by script and states no licence in its HTML, which is why the earlier M13e look at the catalogue pages found none; the metadata is the publisher's own statement and the Socrata catalogue API (https://api.us.socrata.com/api/catalog/v1, same dataset) agrees. **The fetch re-reads `"license" : { "name" : "Public Domain" }` in the metadata before every download** and stops (`LICENCE_CHANGED`) if it is gone.
- **Download:** the publisher's Socrata CSV export, limited to the closed calendar years 2017–2020 and put in a total order, because the dataset grows every month (rows for June to August 2026 were appended after a gap since September 2020) and a whole-file checksum would break on each update: `https://data.montgomerycountymd.gov/resource/v76h-r7br.csv?$where=calendar_year<=2020&$order=calendar_year,cal_month_num,supplier,item_code,item_description,item_type,rtl_sales,rtl_transfers,whs_sales&$limit=1000000` (the manifest has it percent-encoded)
  - download, 30,773,087 bytes, 307,645 data rows: SHA-256 `b1f5450e132cb4981f27f213da943815e4d6157d036a4ca75669c7e634288851` (two downloads, minutes apart, gave the same bytes)
  - It is a plain CSV, not an archive (`download.raw` in the manifest), and the engine reads it as it is.
- **Changes made:** none. `montgomery-warehouse-sales.csv`: SHA-256 `b1f5450e132cb4981f27f213da943815e4d6157d036a4ca75669c7e634288851` (the download itself).
- **What is in it:** `calendar_year`, `cal_month_num`, `supplier`, `item_code`, `item_description`, `item_type`, `rtl_sales`, `rtl_transfers`, `whs_sales`. There is no date column, no price and no cost column. Months present: 2017-06 to 2017-12, 2018-01 to 2018-02, 2019-01 to 2019-11, and 2020 months 1, 3, 7 and 9.
- **If the host blocks us (DEFERRED, like EIA-861M):** the fetch would fail with `DOWNLOAD_FAILED` on this dataset only. To run the rest of the tier meanwhile, move `answers/montgomery-warehouse-sales.yaml` out of the answers folder. The command to run once it is reachable: `bun run eval:real:fetch && bash scripts/heavy.sh bun run eval:real`. On the machine that built it (2026-10-23) the host answered, so nothing is deferred.

## Pending

A dataset chosen for the tier whose file has not been pinned yet. `bun run eval:real:fetch` re-reads its licence and probes its page on every run, prints `DEFERRED` while it is unreachable (that doesn't fail the run), and asks for it to be pinned once it is reachable. Nothing of it is scored until then.

### EIA-861M, monthly electricity sales to ultimate customers (U.S. Energy Information Administration)

- **Credit:** Source: U.S. Energy Information Administration, Form EIA-861M (formerly EIA-826), Monthly Electric Power Industry Report. https://www.eia.gov/electricity/data/eia861m/
- **Licence:** public domain (a U.S. government work). Evidence, from https://www.eia.gov/about/copyrights_reuse.php (read 2026-10-19 for docs/plans/analyst-grade.md §4.1a): "U.S. government publications are in the public domain and are not subject to copyright protection." The fetch re-reads it before any download.
- **Status: DEFERRED.** www.eia.gov, eia.gov and api.eia.gov did not answer from the machine the tier was built on (TCP connect timeout, 2026-10-22; every other host in this file did). It was not worked around: no mirror or archive copy is used.
- **Pinning it** (the run that reaches EIA): EIA revises preliminary months, so pin a dated file whose months are all final (from the page's archive), not the rolling current file; record its URL, size and SHA-256 here; write the derivation against the layout it really has (multi-row Excel headers, adjustment lines) into one long CSV (`eia-861m-sales.csv`, one line per year × month × state × sector with revenue, sales, customers and price); then complete `answers/pending/eia-861m.yaml` and the golden draft (`evals/golden/eia-861m/draft.yaml`) from SQL on that file, move the answer file up to `answers/`, split the golden items into golden.yaml and heldout.yaml, and have them reviewed (docs/plans/m14.md "Golden-set review").

## Considered and not used

- **UCI Hierarchical Sales Data (id 611).** UCI lists it as CC BY 4.0, but its original publisher, Mendeley Data (doi:10.17632/njdkntcpc9.1), licenses it CC BY-NC 3.0, and the UCI download link returned 404. A non-commercial licence doesn't fit an Apache-2.0 project.
- **UCI Online Retail (id 352).** CC BY 4.0, but it is the 2010–2011 half of Online Retail II, so it adds nothing.
- **Iowa Liquor Sales.** The catalogue pages state no licence. (Montgomery County's Warehouse and Retail Sales looked the same in M13e, but its Socrata metadata does state Public Domain; it is pinned above.)
- **A real dataset with a cost column (M15 PR 2's time-boxed search, 2026-10-23).** None passed; see docs/plans/m15.md, "Cost-column search".
