# Setting up the server-side periodic resync (cron-resync)

This replaces the old design where every open browser tab ran its own
10-minute resync timer. Now there's exactly **one** alarm clock, running on
the server, on a fixed schedule — whether 0 people or 40 people have the app
open makes no difference.

Because your Vercel project is on the **Hobby** plan, and Hobby only allows
Vercel's own built-in cron to run once per day, we use a free external
scheduler to call the endpoint every 20 minutes instead. Nothing about your
app's code changes based on this choice — only *what* rings the alarm.

Follow these steps in order. None of them require touching code.

---

## Step 1 — Grant your Google service account access to Firestore

You already have a Google service account (its email and private key are
already in your Vercel env vars as `GOOGLE_SERVICE_ACCOUNT_EMAIL` and
`GOOGLE_PRIVATE_KEY` — that's the one used for Google Sheets). It currently
can only touch your spreadsheet. The cron job needs it to also be able to
*read* your Firestore bookings, so it can figure out what should be in the
sheet without a browser having to hand it that data.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → make
   sure you're in the same project as your Firebase project.
2. Go to **IAM & Admin → IAM**.
3. Find the row with your service account's email (the same one in
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`).
4. Click the pencil (edit) icon on that row → **Add another role**.
5. Search for and select **"Cloud Datastore User"** (this role covers
   Firestore in Native mode too, even though the name says Datastore).
6. Save.

That's it — no new credential to generate, no new key to manage. Same
service account, one more permission.

---

## Step 2 — Add two new environment variables in Vercel

Go to your Vercel project → **Settings → Environment Variables** and add:

| Name | Value | Notes |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Same value as your `VITE_FIREBASE_PROJECT_ID` | Not a secret — it's already visible in your app's public config. Just copy it without the `VITE_` prefix. |
| `CRON_RESYNC_SECRET` | A long random string you make up | This is a secret **you** create — think of it like a password only your scheduler and your server know. A password generator or something like `openssl rand -hex 32` works fine. |

Make sure these are set for the **Production** environment (and Preview too,
if you want to test on preview deployments).

Redeploy after adding these (Vercel usually prompts you to, or you can
trigger a redeploy manually from the dashboard).

---

## Step 3 — Set up the external scheduler

Any service that can send an HTTP request on a schedule works. The simplest
free option:

### Option A — cron-job.org (easiest, no code)

1. Go to [cron-job.org](https://cron-job.org) and create a free account.
2. Create a new cron job:
   - **URL:** `https://YOUR-APP.vercel.app/api/cron-resync`
   - **Schedule:** every 20 minutes
   - **Request method:** GET (or POST — either works, the endpoint doesn't
     care)
   - **Custom header:** add a header named `Authorization` with the value
     `Bearer YOUR_CRON_RESYNC_SECRET` (use the exact same secret you put in
     Vercel in Step 2)
3. Save and enable it.

### Option B — GitHub Actions (if you already have this repo on GitHub)

Add a file at `.github/workflows/cron-resync.yml`:

```yaml
name: Cron Resync
on:
  schedule:
    - cron: '*/20 * * * *'
  workflow_dispatch: {}   # lets you manually trigger it from the Actions tab too
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger resync
        run: |
          curl -sf -X POST "https://YOUR-APP.vercel.app/api/cron-resync" \
            -H "Authorization: Bearer ${{ secrets.CRON_RESYNC_SECRET }}"
```

Then add `CRON_RESYNC_SECRET` as a GitHub Actions repo secret (**Settings →
Secrets and variables → Actions**) with the same value as in Vercel.

Either option is fine — cron-job.org is simpler to set up, GitHub Actions is
nice if you don't want a third-party account.

---

## Step 4 — Verify it's actually working

1. Open your Google Sheet and your Firestore console (Firebase console →
   Firestore Database) side by side.
2. Wait for the next scheduled run (or trigger it manually — cron-job.org has
   a "run now" button, or `curl` the URL yourself with the header from Step
   3).
3. In Firestore, look for a document at `_syncMeta/syncStatus`. After a
   successful run, it should show a recent `lastSyncAt` timestamp and an
   `ok: true` field.
4. In your app, the "Sheets last synced X min ago" banner should update to
   reflect that run.
5. If something's wrong, check the `warnings` and `failedTabs` fields on that
   same `_syncMeta/syncStatus` document — the cron job writes exactly what
   went wrong there, and the same message will show up as a dismissible
   banner in the app under "[Scheduled sync] ...".

---

## What changed under the hood (for reference)

- `src/sheetsSync.ts` — the old `startPeriodicReSync()` function (a
  `window.setInterval` that ran in every open browser) is gone.
- `api/cron-resync.ts` — new endpoint. Reads Firestore directly (via the same
  service account, now with the added Firestore role), computes the exact
  same totals the app itself would (reusing `getBookingClientTotal` /
  `getBookingBreakdownNettTotal` from `src/utils.ts` — no duplicated math),
  runs the full resync, and writes its results to `_syncMeta/syncStatus`.
- `api/_lib/sheetsCore.ts` — the actual tab-syncing/reconcile logic, shared
  between `api/sheets-append.ts` (instant sync) and `api/cron-resync.ts`
  (periodic resync), so there's only one copy of that logic to ever fix.
- An overlap lock (`_syncMeta/cronLock` in Firestore) makes sure only one
  resync ever runs at a time, even if the scheduler double-fires or a run
  takes unusually long.
- `src/App.tsx` now listens to `_syncMeta/syncStatus` via `onSnapshot` to
  keep showing "last synced" + warnings in the UI, since the browser isn't
  the one doing the syncing anymore.

## If you ever upgrade to Vercel Pro

You could switch to Vercel's own native cron instead of the external
scheduler, by adding this to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron-resync", "schedule": "*/20 * * * *" }
  ]
}
```

On Pro, Vercel automatically sends an `Authorization: Bearer $CRON_SECRET`
header using an env var it manages for you called `CRON_SECRET` (different
from your own `CRON_RESYNC_SECRET`). If you go this route, you'd want to
also accept Vercel's own `CRON_SECRET` in `api/cron-resync.ts`, or just keep
using your own `CRON_RESYNC_SECRET` and stick with the external scheduler —
either works fine, this isn't required.
