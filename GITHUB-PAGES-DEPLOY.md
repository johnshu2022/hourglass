# Deploy Hourglass Build 37 to GitHub Pages

This archive is arranged for the **root of the Git repository** `johnshu2022/hourglass`.
After extraction, `docs/index.html` must be at the repository path `docs/index.html`
(not `hourglass-main/docs/index.html`).

GitHub does **not** automatically extract ZIP files uploaded to a repository.
Extract the archive locally and commit its contents.

## For an existing local clone

1. Export a **Full backup** inside Hourglass before making changes.
2. Check your working tree and update it:

   ```sh
   cd ~/hourglass-app               # change to your actual clone path
   git status --short
   git remote -v                  # must point to johnshu2022/hourglass.git
   git pull --ff-only origin main
   ```

   If the status output contains uncommitted changes, preserve them before proceeding.

3. Extract this archive to a separate folder, then copy its contents into the
   clone, including hidden `.nojekyll` files. From the folder containing the ZIP:

   ```sh
   mkdir -p hourglass-build37-deploy
   unzip hourglass-build37-github-pages-deployment.zip -d hourglass-build37-deploy
   cp -a hourglass-build37-deploy/. ~/hourglass-app/
   ```

   Adjust `~/hourglass-app` to the path of your clone.

4. Validate and review:

   ```sh
   cd ~/hourglass-app
   node scripts/validate.mjs
   node --test tests/*.test.js
   git status --short
   git diff --check
   ```

5. Commit and push when satisfied:

   ```sh
   git add -A
   git commit -m "Deploy Hourglass Build 37 per-job rounding modes"
   git push origin main
   ```

## GitHub Pages settings

In the repository, open **Settings → Pages → Build and deployment**:

- **Source:** Deploy from a branch
- **Branch:** `main`
- **Folder:** `/docs`

Your site is expected at: https://johnshu2022.github.io/hourglass/

## Preview locally

From the extracted archive or repository root:

```sh
npx --yes http-server docs -p 8080 -c-1
```

Browse http://localhost:8080 and test Settings, Shift History, and PDF Export.

## Notes

- The source files are static HTML, CSS, and JavaScript; no Node.js server
  or production build system is needed for GitHub Pages.
- The included `Dockerfile`, `compose.yaml`, and `nginx.conf` are optional
  container configurations and are not used by GitHub Pages.
- Existing browser-local data is not included in this archive; export a
  Full backup before deploying and retain it securely.
- Rounding changes reported totals using Off/Daily/Reporting-period per-job settings.
  Original shifts, backups, CSV exports, and payment calculations stay exact.
- Reports using reporting-period rounding can differ from the sum of the exact daily rows;
  the per-job adjustment reconciles the difference.
