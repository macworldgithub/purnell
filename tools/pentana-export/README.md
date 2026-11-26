# Pentana browser CSV exporter

Uses Playwright against a dedicated Chrome profile and the visible eraPower UI.
No login credentials are stored in the scripts. Sign in and complete MFA in the
Chrome window opened by `npm start`. Keep that window open during extraction.

```powershell
npm start
# In another terminal, after sign-in:
node export-pentana.mjs --only open_repair_orders,workshop_status,status_codes
node export-pentana.mjs --only appointments --from 01/10/2026 --to 31/12/2027
```

`--out <directory>` chooses the output folder. Each report run writes its own
manifest with row counts, source filters, failures, and file hashes. Use a new
folder for each report run so its manifest does not replace an earlier run.

The linked-record scrapers use an existing `open_repair_orders.csv` in their
output directory as the index. They preserve IDs and record source timestamps:

```powershell
node scrape-records.mjs --out exports/run-2026-10-26
node scrape-vehicle-serials.mjs
node scrape-repair-report.mjs
node scrape-job-narratives.mjs
node scrape-history.mjs
node scrape-followups.mjs
```

The linked-record scripts write checkpoints and can resume by rerunning the
same command. `--limit 1` checks one record before starting a larger batch.
The additional scripts above use the dated run directory configured in their
source. Run them sequentially: they share the signed-in browser tab. The older
`scrape-repair-details.mjs` direct-lookup prototype is superseded by
`scrape-repair-report.mjs`, which follows the source report's RO links.
An observed lookup error is recorded in the checkpoint. A script being present
does not establish that its export has completed: check its CSV and checkpoint.

Only lookup and report controls are used. Customer maintenance records are read
without saving edits. Missing-record creation prompts are declined. Protected
record edit prompts are cancelled. Access-denied screens are not bypassed.

These exports are dated snapshots. Linked customers and vehicles cover the
source report's records, not the full dealership directories. Available report
fields and account permissions determine coverage. Serial numbers retain the
source label; do not assume every serial number is a validated VIN. Advisor
selector entries do not establish staff roles or live telephone availability.

Customer CSVs contain private information. Output files and the Chrome profile
are excluded from Git by the tool directory's `.gitignore`.

Verification: `npm test` validates CSV parsing and preservation of identifiers,
phone numbers, quotes and multiline notes. Report exports compare their CSV row
counts with the UI report totals before promoting a `.partial` file to `.csv`.

`node package-export.mjs` validates linked-record coverage and writes the final
CSV bundle directory with hashes, counts and `data_coverage.csv`. Parts access
was denied for the signed-in account during the 26 October run. The package
records this exclusion and does not represent a complete dealership database.

The history, follow-up, job-narrative and repair-report scripts accept an optional
output directory as their first argument. `scrape-vehicle-context.mjs` accepts
the output directory and input vehicle CSV as its first two arguments. Reused
checkpoint records retain their original extraction timestamps.

`node package-scope.mjs` checks November linked vehicle history/context,
customer follow-up query coverage and job narrative coverage, then packages
dated CSV snapshots with `scope_coverage.csv`. It deliberately marks scope
completion false while required access/configuration/integration data is missing.

The current scheduler runs `tools/run-erapower-sync.mjs` from the project root.
Each trigger refreshes live reports in `exports/poll-<timestamp>`. Deep customer,
vehicle and history work uses `exports/scheduled-<cycle timestamp>` and resumes
the same unfinished cycle from `logs/erapower-sync/active-cycle.json`. Completed
stages are reused only when their file hashes and record coverage still match.
Validated stages publish to purpose-specific `erapower_current_*` MongoDB collections.
Existing identifiers are updated in place; previous changed contents are kept in
`erapower_record_history`. Older snapshots cannot replace newer imported data.
This import does not change the voice agent's legacy database/model mappings.

The default UI time budget is 150 minutes, below the Windows task's 175-minute
limit. A budget stop preserves checkpoints, publishes validated partial data and
continues at the next three-hour trigger. Set `ERAPOWER_SYNC_BUDGET_MINUTES` in
the ignored sync environment file to a value from 1 to 155 if needed. The PC must
be awake and the Windows user signed in for this interactive task.

`logs/erapower-sync/progress.json` contains the current stage and heartbeat;
per-invocation `.log` files stream as workers run. `history.ndjson` records starts,
publications and final outcomes. `latest.json` distinguishes retry, saved progress
and completed runs with source limitations. Locked records and denied parts
access remain documented limitations; no lock or account restriction is bypassed.
The browser workflow only reads eraPower. CSVs and MongoDB are the write targets.

Every trigger also refreshes the Service / All advisors capacity calendar in
`exports/capacity-<invocation timestamp>` and upserts 21 dated rows into
`Purnell_Pentana_VoiceAgent.erapower_current_daily_booking_capacity`. Dates are
stable identities, so a changed count updates that date rather than creating a
duplicate. These are daily totals, not exact times or job-specific eligibility.

The voice tool `queryAppointmentSlots` reads that collection through
`AppointmentAvailabilityService`, using `ERAPOWER_DATA_MONGO_URI`, then
`PURNELL_COPY_TARGET_URI`, then the ignored local sync configuration. Hosted
deployments must set an environment variable; credentials are not shipped.
It offers future dates only when both appointment capacity and unsold hours
remain, reports when checked, and rejects snapshots older than four hours.
Unavailable or stale data produces no mock fallback. Booking creation remains
disabled, and the separate legacy customer/booking mappings are unchanged.

From the project root, run scheduler regression checks with
`node --test tools/erapower-scheduler.test.mjs tools/erapower-sync-records.test.mjs tools/pentana-export/csv.test.mjs`.

To verify a completed refresh, load the local sync environment and run
`node --import=dotenv/config tools/verify-erapower-refresh.mjs --input=<directory> dotenv_config_path=.env.erapower-sync`
from the project root. It checks file hashes, linked-record coverage, stable
identities and the corresponding MongoDB contents. `verification.json` contains
counts and missing-data categories without copying private customer details.
Then run `powershell.exe -NoProfile -File tools/package-erapower-refresh.ps1 -InputDirectory <directory>`
to create a ZIP with the CSVs, manifests and explicit coverage limitations.
