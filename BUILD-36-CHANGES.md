# Hourglass Build 36 — rounded hours shown by day

This package updates Build 35, preserving the static GitHub Pages source in `docs/`.

## Display behavior

- When a job has **Round this job's daily total to the nearest 15 minutes** enabled under Settings → Jobs, a day with one shift displays its **rounded net hours** in the Shift History table and in the PDF report. Its exact net hours appear underneath.
- For **two or more shifts for the same job on the same date**, the individual shifts retain exact net hours. Their combined **daily rounded total is shown only once**, preventing multiple applications of the same rounding adjustment.
- For a job without rounding, the values remain exact.
- The report summary shows total rounded/reported hours, exact hours, and adjustment. Rounding continues to be applied separately for each job and each calendar date.

**No data migration:** clock-in/out timestamps, breaks, notes, CSV exports, full backups, and payment calculations remain exact and unchanged.

## Deploy using GitHub Pages

1. Export a full backup from your current application before updating.
2. Extract this ZIP and copy its **contents** (not the ZIP file itself) to the root of your `johnshu2022/hourglass` repository.
3. From the repository root run:

   ```bash
   node scripts/validate.mjs
   node --test tests/*.test.js
   ```

4. Commit and push to `main`. GitHub Pages remains configured to publish `main` → `/docs`.

## Test locally with Node.js

```bash
npx --yes http-server docs -p 8080 -c-1
```

Open http://localhost:8080 and test Settings, Shift History, and Export PDF.

## Regression check

With rounding enabled for `LCC`:

| Date | Clock in | Clock out | Exact | Displayed |
| --- | --- | --- | --- | --- |
| Oct 31, 2026 | 11:50 AM | 4:06 PM | 4.27h | 4.25h |
| Nov 2, 2026 | 11:41 AM | 5:21 PM | 5.67h | 5.75h |
| Nov 3, 2026 | 11:19 AM | 4:47 PM | 5.47h | 5.50h |
| Nov 4, 2026 | 12:13 PM | 4:29 PM | 4.27h | 4.25h |
| **Total** | | | **19.67h** | **19.75h** |

Automated tests verify this case, multiple shifts per job/date, and long PDF pagination.
