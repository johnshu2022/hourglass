# Build 37 — Three per-job rounding methods

Hourglass is still a static GitHub Pages app served from `docs/`. It does not upload your data.

## Settings

Each job now has a **Time rounding method** dropdown:

- `Off`: exact reporting durations.
- `Daily`: round once per job/date, then sum the rounded dates.
- `Reporting period`: sum exact durations across the chosen date range for each job, then round once per job.

Old `roundDailyToQuarterHour: true` settings (including earlier backup files) migrate to `Daily` by default. The new `roundingMode` is the authoritative setting when present. Stored shifts are not rewritten, and export/restore is compatible with existing full backups.

## Where the method applies

- Dashboard: Today, workweek, and month metrics each round the data in their own range. The seven-day bar chart retains exact daily values for period-rounded jobs.
- Shift History: monthly reported total uses each job's mode. A by-job summary shows exact and reported totals and the rounding adjustment. Daily rows remain exact when a job uses period rounding.
- Export PDF: each export uses its selected inclusive start/end dates and job filter. Its summary shows per-job mode, exact minutes, reported minutes, and adjustment; daily entries for period-rounded jobs remain exact.
- Payments and CSV exports: always use recorded exact shift minutes. Neither wages nor clock times nor breaks are rounded.

## Regression example — LCC, November 5–11, 2026

Recorded times sum to **19h 13m** (19.22 decimal hours):

| Method | Reported | Adjustment |
| --- | --- | --- |
| Off | 19h 13m (19.22h) | 0 min |
| Daily | 19h 00m (19.00h) | −13 min |
| Reporting period | 19h 15m (19.25h) | +2 min |

With period rounding, the report still shows each actual day's exact duration. A +2-minute period adjustment reconciles the combined total.

## Testing and deploy

From the extracted repository root:

```sh
node scripts/validate.mjs
node --test tests/*.test.js
npx --yes http-server docs -p 8080 -c-1
```

Open `http://localhost:8080`, select a job's rounding method in Settings, and check Shift History and Export PDF. Export a full backup before deployment. Extract the ZIP contents into the root of the Git repository `johnshu2022/hourglass`; push to `main`. GitHub Pages should publish `main` → `/docs`.
