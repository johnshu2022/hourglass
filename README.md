# Hourglass

A responsive, browser-based work-hours tracker built with HTML, CSS, and JavaScript. It records shifts and breaks, calculates net hours for the day, week, and month, displays a seven-day chart, and imports or exports time-card data as CSV or PDF.

This package is Hourglass build 37. The `docs` directory is the single website source used by both GitHub Pages and the Podman container. GitHub Pages publishes it directly from the `main` branch without a repository-managed deployment workflow or Jekyll build.

## GitHub Pages

1. Extract the deployment ZIP first: GitHub does not automatically unzip uploaded archives.
2. Put the extracted files (including `docs/`, `scripts/`, and `.nojekyll`) at the root of your GitHub repository. Review the changes before committing.
3. Commit and push the files to the `main` branch.
4. Open the repository's **Settings**, then **Pages**.
5. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
6. Select the `main` branch and `/docs` folder, then choose **Save**.

The package includes `.nojekyll` at both the repository root and the publishing-source root. GitHub Pages will publish changes after they are committed and pushed to `main`. GitHub still performs its internal Pages deployment, but this repository contains no custom deployment workflow, action dependency, deployment token, or repository secret.

For later changes, edit files inside `docs`, run the included validator locally, and then commit them. The validator checks JavaScript syntax, HTML IDs, local assets, relative paths, browser security policies, and accidental sensitive files.

Run the same validation locally with:

```bash
node scripts/validate.mjs
```

Because there is no repository-managed validation workflow, GitHub will not run the validator for you. Run it before every push and consider protecting `main` from accidental force-pushes or deletion with a repository ruleset.

CSV imports require `Date`, `Clock In`, and `Clock Out` headers. `Job`, `Break Minutes`, and `Notes` are optional. Dates may use `YYYY-MM-DD` or U.S. `MM/DD/YYYY`; times may use 24-hour time or `AM`/`PM`. Duplicate shifts are skipped.

Use the prominent **Import hours from a CSV file** panel on the Time entries page. A downloadable template is included in the app.

Use **Export PDF** in Shift History to select an inclusive starting and ending date plus either all jobs or one specific job. The generated report lists each matching shift with its job, clock times, breaks, decimal net hours, notes, and image-attachment status. PDF generation happens entirely in the browser.

Data is stored in the browser's local storage. Export a CSV backup regularly; clearing browser data removes saved shifts.

Use **Full backup and restore** in Settings to download one versioned JSON backup containing every local user and their shifts, jobs, wages, payment history, active clock, no-work days, photos, and image metadata. Restore validates the entire file before replacing current Hourglass data. Earlier version-1 and version-2 backups remain supported. Backup files may contain sensitive personal information and should be stored securely.

Hourglass supports up to 20 local user profiles. Use the user switcher in the header to change profiles or **New user** to create one. The dashboard heading greets the active named user, while the initial **My profile** user keeps the default heading. Every profile has separate shifts, no-work days, active clock state, images, jobs, wage settings, and exports. Existing Hourglass data is automatically assigned to the initial **My profile** user. These are device-local profiles rather than password-protected accounts, so anyone using the same unlocked browser can switch between them.


## Per-job rounding (Build 37)

In **Settings → Jobs**, select **Off**, **Daily**, or **Reporting period** independently for each job:

- **Off:** Show exact net minutes with no rounding.
- **Daily:** Combine all shifts for a job on each calendar date, round that date once to the nearest 15 minutes, then add those rounded days.
- **Reporting period:** Combine exact net minutes for a job across the *selected reporting date range*, round that job's range once to the nearest 15 minutes. Each daily entry remains exact. The selected range differs by report: a PDF uses its inclusive export dates, Shift History uses its month filter, and dashboard today/week/month cards use their own date ranges.

Rounding ties occur at 8 minutes (0–7 minutes round down, 8–14 round up). For multiple jobs, each job's chosen method applies independently; `Unassigned` remains exact. When a job uses **Reporting period**, the sum of its exact daily rows can differ from its displayed rounded reporting total. The report explicitly includes the period adjustment to reconcile them. Daily chart bars show exact values for period-mode jobs; period cards round the selected span.

Existing jobs with the Build 35/36 **daily rounding** checkbox enabled are automatically interpreted as **Daily**; others stay **Off**. Backups maintain the original clock times, breaks, notes, and shifts; importing old backup settings remains supported. CSV exports and expected gross payment calculations continue to use exact durations, not rounded reporting totals.

Try the project locally with `npx --yes http-server docs -p 8080 -c-1`. Run the checks using `node scripts/validate.mjs` and `node --test tests/*.test.js`.

## Security

- The container uses a version-pinned, unprivileged Nginx image and runs as a non-root user.
- The Compose configuration works with Podman Compose or Docker Compose. It makes the container filesystem read-only, drops all Linux capabilities, prevents privilege escalation, limits processes, and provides only a small temporary filesystem.
- Nginx serves restrictive Content Security Policy, anti-framing, MIME-sniffing, referrer, browser-permission, cross-origin, HSTS, and no-store headers. Only static GET/HEAD requests are accepted.
- Every HTML page also contains a browser-enforced Content Security Policy and no-referrer policy for GitHub Pages, where custom Nginx headers are unavailable.
- Browser-stored shifts and settings are normalized and length-limited before use. Images must be supported base64 image data and CSV imports are limited to 2 MB and 5,000 shifts.
- CSV exports neutralize cells that spreadsheet software could interpret as formulas.

Hourglass does not transmit time-card data to a server. Anyone with access to the same unlocked browser profile may still be able to view its local data, so use a protected device account and export backups to a secure location. When exposing the container outside your local network, place it behind an HTTPS reverse proxy and keep the pinned Nginx image version updated.

Shift History and the dashboard's recent activity display the newest shifts first. Shifts on the same date are ordered by clock-in time, from latest to earliest. The dashboard's seven-day chart can show all jobs, one selected job, or unassigned shifts. Shift History displays clock times in 12-hour AM/PM format and net time as decimal hours. For example, 8 hours and 30 minutes appears as `8.50`.

Break totals entered either as timed breaks or as total unpaid break minutes are shown in Shift History and deducted from net hours.

The Settings page stores job profiles, a separate hourly wage and workweek start day for each job, a fallback wage and workweek for unassigned shifts, currency, and the default job. Workweeks can start on any day from Sunday through Saturday. Job wages estimate gross pay for shifts that are not linked to a payment.

Select a job when entering a shift manually or before using Quick Clock. Shift History, expanded details, CSV imports, and CSV exports all retain the job. Older records remain available as `Unassigned`.

The dashboard Quick Clock shows the current timestamp. Clocking in stores today's start time and changes the action to **Clock out**; clocking out creates a shift in Shift History. Quick Clock is intentionally limited to the current calendar day.

Use **No Work Today** to mark the current date as a non-working day without creating a zero-hour shift. This disables clock-in for the day and clears any uncommitted Quick Clock image. The status can be reversed with **Undo no work**. No-work days are retained as separate records and appear chronologically in Shift History with `0.00` hours, an **All jobs** scope, expandable details, and a delete action. They do not affect worked-hour or payment totals.

Quick Clock requires a photo from a computer or phone before clock-in. The browser reads available file and embedded EXIF details (such as capture time, camera, dimensions, and embedded GPS), shows a short summary next to the preview, and keeps that metadata with the completed shift. Click the preview or **View larger** to open the image in a full-screen viewer. The browser resizes the image before saving it locally; the image and metadata are never uploaded to a server.

While clocked in, Quick Clock can start and end breaks. Expand any Shift History record with **Details** to see its saved image, clock-in and clock-out timestamps, every timed break, total break duration, net hours, and notes.

Hourglass does not store a separate paid/unpaid flag on shifts. The **Payments** page is the source of truth: it links shifts from one job and pay period to a paycheck record containing its payment date, reported gross, net received, method, reference, and notes. The dashboard treats every unlinked shift as awaiting payment. Hourglass compares the selected shifts' expected gross wages with the paycheck's reported gross amount. Linked shifts are protected from conflicting edits; deleting a payment makes them available for another payment. Payment history is isolated by user profile and included in full backups.

## Run with Podman Compose

```bash
podman compose build --pull
podman compose up -d
```

Open <http://localhost:8080>.

Stop the app with:

```bash
podman compose down
```

## Run with Podman only

```bash
podman build --pull -t hourglass .
podman run --name hourglass -p 8080:8080 --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 100 -d hourglass
```

The same `compose.yaml` and `Dockerfile` also work with Docker by replacing `podman` with `docker` in these commands.

## Build 35 — optional per-job daily quarter-hour rounding

In **Settings → Jobs**, enable **Round this job’s daily total to the nearest 15 minutes** for individual jobs. It is off by default for existing and newly created jobs. All net shifts with the same local work date and exact job name are combined **before** rounding. 0–7 extra minutes rounds down; 8–14 rounds up. Multiple jobs and dates are never merged for rounding.

The Dashboard Today/Week/Month totals and its seven-day chart use reported (rounded-where-enabled) minutes. Time entries shows an exact shift history plus a monthly reported total, the unrounded original, and a per-day/job breakdown. PDF reports show the daily rounded net for single-shift days, along with a smaller exact value. Multiple shifts for the same job/date remain individually exact, with a separate rounded daily total shown once. Shift History follows the same display rule. CSV exports always stay exact.

**Important:** Rounding affects reporting only, not pay. Awaiting-payment hours, pay estimates, payment reconciliation, and stored original shifts remain exact. This prevents dividing a single day's rounding adjustment inconsistently across different paychecks. Per-job settings persist in existing local profile settings and round-trip in full backups. Rounding enabled for a job does not change previously recorded times and can be disabled without any data loss.

Run `node scripts/validate.mjs` and `node --test tests/*.test.js` before committing. Publish `main` → `/docs` in GitHub Pages as before.

## Build 36 — daily rounded values in reports

In Shift History and PDF reports, days with a single shift display that day’s **rounded net hours** as the primary value and show its exact recorded hours underneath. For days with multiple shifts at the same job, each individual shift retains its exact net time and the rounded daily total is shown **once per date/job** to avoid double-counting. Report summaries show the sum of the individual displayed daily totals, the original exact sum, and the rounding adjustment.

Clock-in and clock-out times, unpaid breaks, CSV exports, full backups, and payment estimates are **unchanged**. In Settings → Jobs, the per-job rounding checkbox still controls whether the daily total is rounded. All changes are compatible with GitHub Pages (`main` → `/docs`).
