# Build 37.1 — PDF export cleanup

The exported PDF no longer includes shift notes (such as "Recorded with Quick Clock")
or photo-attachment indicators (such as "Image attached to the browser record.").

The change is limited to PDF presentation. Notes, photos, and image metadata remain in
stored shift records and full backups; Shift History details, Quick Clock, CSV exports,
and payment calculations are unchanged. All three per-job rounding modes continue to work.

The PDF export script URL in `docs/entry.html` is cache-busted to `v=37.1` to ensure
GitHub Pages browsers pick up the revised exporter.

## Validate

```sh
node scripts/validate.mjs
node --test tests/*.test.js
```

GitHub Pages should publish from `main` -> `/docs`. Extract the ZIP and copy
its *contents* to the repository root; then commit and push to `origin main`.
