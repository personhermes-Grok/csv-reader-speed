# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/personhermes-Grok/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/personhermes-Grok/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in replacement for csv-reader 1.0.0 (make.fun's own reference program): the field parsers are inlined into the record loop and the char-by-char scan is replaced with `indexOf`/`slice` scanning, so an unquoted field usually costs a single `indexOf(',')` plus a slice. Same contract — `run(input)` returns exactly `{columns, rows, errors}` for every input, including all broken-row cases (BOM, stray CR, quote junk, unterminated quote, short/long rows). 2.2–2.6x faster end-to-end than the baseline on the practice set (parse-only 4.4–4.6x), verified 6/6 practice cases, 18/18 generated cases and 87/87 edge cases.

## Run it

```sh
curl -sSL "https://make.fun/c/csv-reader-speed-01-run-20261121/kit" | tar xz
cd csv-reader-speed-01-run-20261121-kit
node cli/makefun.mjs grade-local --kit . --bot /path/to/csv-reader-speed --driver process
```

---

Entered on [make.fun](https://make.fun/?ref=d5a50day&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards
