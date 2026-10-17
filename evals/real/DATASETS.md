# Public datasets: licences, credits and checksums

The real-data tier downloads these files at run time (`bun run eval:real:fetch`). They are never committed. The results we publish (`evals/RESULTS.md`, the README, the docs site) contain numbers derived from them, so each is credited here and wherever those numbers appear.

## Online Retail II

- **Credit:** Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D. Creator: Daqing Chen.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- **Licence evidence**, from the publisher's page https://archive.ics.uci.edu/dataset/502/online+retail+ii (read 2026-10-16): "This dataset is licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) license."
- **Download:** https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip
  - archive, 45,622,418 bytes: SHA-256 `572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb`
  - `online_retail_II.xlsx` in it: SHA-256 `bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980`
- **Changes made (CC BY 4.0 asks us to say):** we keep every invoice whose number is divisible by 10 (cancellations "C…" included) from both sheets and write them as one CSV with ISO dates. `online_retail_II.sample10.csv`, 105,797 lines: SHA-256 `6d8dff8c0bff0e9a2b158b792b0bbc5940f4f81a597da3af3583f1ebaada7858`

## Electronic card transactions, September 2026 (Stats NZ)

- **Credit:** This work is based on Stats NZ's data (Electronic card transactions: September 2026), which are licensed by Stats NZ for reuse under the Creative Commons Attribution 4.0 International licence.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- **Licence evidence**, from the publisher's copyright page https://www.stats.govt.nz/about-us/copyright/ (read 2026-10-16): "Crown copyright ©. All material Stats NZ produces is protected by Crown copyright. Unless otherwise specified, content we produce is licensed under the Creative Commons Attribution 4.0 International licence." The page asks adapted works to carry the statement used as the credit above. The release page: https://www.stats.govt.nz/information-releases/electronic-card-transactions-september-2026/
- **Download:** https://www.stats.govt.nz/assets/Uploads/Electronic-card-transactions/Electronic-card-transactions-September-2026/Download-data/electronic-card-transactions-september-2026.zip (each release has its own URL, so the file doesn't change under it)
  - archive, 158,264 bytes: SHA-256 `a89b02ba61b127baf3894bb333961710e4b4d6486dfcdc012d18c0655aa970c2`
  - `electronic-card-transactions-september-2026-csv-tables.csv` in it: SHA-256 `60481c7f33519db445819b740e0468df72ee5c4bcb360ee213402b7a02adcee9`
- **Changes made:** we keep the rows of series ECTM.S1GA1 to ECTM.S1GA8 (monthly, actual values by industry group) with the file's lines unchanged. `nz-card-spend-by-industry.csv`, 2,568 lines: SHA-256 `63ff45be4c783950ae58d263f021a6c5b5dcd424c0b8b84732d978199d42ed9f`

## Considered and not used

- **UCI Hierarchical Sales Data (id 611).** UCI lists it as CC BY 4.0, but its original publisher, Mendeley Data (doi:10.17632/njdkntcpc9.1), licenses it CC BY-NC 3.0, and the UCI download link returned 404. A non-commercial licence doesn't fit an Apache-2.0 project.
- **UCI Online Retail (id 352).** CC BY 4.0, but it is the 2010–2011 half of Online Retail II, so it adds nothing.
- **Montgomery County "Warehouse and Retail Sales"** and **Iowa Liquor Sales.** The catalogue pages state no licence.
