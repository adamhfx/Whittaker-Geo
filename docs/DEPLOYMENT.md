# Whittaker Geo deployment

The production frontend is the Cloudflare Worker serving `https://whittakergeo.com`. Render hosts the HTTPS calculation engine for explicitly requested transient calculations. The optional saved-run Python worker is deferred under the current Free setup. The legacy Node Render web service remains in the blueprint as a reference; it is not the production frontend. Git deployment and private model release are separate processes: pushing code does not upload a workbook, approve a model, or activate a version. See [Cloudflare setup](CLOUDFLARE.md) for the current hosting state.

## Temporary sign-in entry

The root URL temporarily redirects to `/signin` while the homepage is unfinished.
Existing auth-error and selected-plan query parameters are preserved. Signed-in
users continue to their workspace through the existing sign-in flow. The sign-in
screen no longer links back to the hidden homepage; preview navigation links to
sign-in. The homepage source remains available for the later launch.

## Local setup

Requirements are Node 22 or newer and pnpm 11.19.0. Local development may use the installed Node 24.19.0. The worker image installs Python dependencies from `worker/requirements.txt` and bundles LibreOffice 26.8.1 with its matching TDF Python 3.13.15 and UNO bridge; the image build runs a synthetic runtime smoke check.

```text
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Copy `.env.example` to `.env.local` and fill in the values described below. Never commit `.env.local`, service-role keys, Stripe secrets, database URLs, or OAuth client secrets.

## Environment variables

The browser can receive only variables prefixed with `NEXT_PUBLIC_`. These are identifiers, not credentials:

| Variable                        | Owner             | Purpose                                                                                                                                                   |
| ------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser           | Supabase project URL.                                                                                                                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser           | Supabase publishable/anon key.                                                                                                                            |
| `APP_URL`                       | Server            | Canonical public origin used for auth redirects, checkout return URLs, and origin checks.                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server only       | Service-role database/storage operations. Never expose to the browser.                                                                                    |
| `SUPABASE_URL`                  | Server/worker     | Supabase URL for trusted server and worker calls, including candidate registration.                                                                       |
| `DATABASE_URL`                  | Worker/migrations | Direct Postgres connection used by saved-run processing and migration scripts. Candidate registration uses Supabase REST and does not require this value. |
| `STRIPE_SECRET_KEY`             | Server only       | Stripe API access.                                                                                                                                        |
| `STRIPE_WEBHOOK_SECRET`         | Server only       | Signature verification for `/api/billing/webhook`.                                                                                                        |
| `STRIPE_MONTHLY_PRICE_ID`       | Server            | Stripe price for the monthly CAD plan.                                                                                                                    |
| `STRIPE_ANNUAL_PRICE_ID`        | Server            | Stripe price for the annual CAD plan.                                                                                                                     |
| `SAVED_RUNS_ENABLED`            | Server            | Set `true` only after a background worker is running and queue/export acceptance passes; defaults to disabled. |
| `BILLING_ENABLED`               | Server            | Keep `false` until live prices, webhook handling, and launch approval are complete.                                                                       |
| `CALC_ENGINE_URL`               | Server            | HTTPS origin of the live engine; requests use the server-only shared secret and never come directly from the browser.                                     |
| `CALC_ENGINE_SECRET`            | Server/engine     | Shared engine authentication secret, at least 32 bytes; server-only.                                                                                      |
| `UNO_PYTHON_BIN`                | Worker image      | Matching TDF Python 3.13.15 runtime bundled at `/opt/libreoffice26.8/program/python`.                                                                     |
| `SOFFICE_BIN`                   | Worker            | LibreOffice executable; default `soffice`.                                                                                                                |

Do not put `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, Stripe secrets, or worker credentials in any `NEXT_PUBLIC_` variable.

## Supabase

Create a Supabase project, enable Google OAuth and email magic links, and add these redirect URLs in Supabase Auth:

```text
http://localhost:3000/auth/callback
https://<your-app-domain>/auth/callback
```

Configure the Google provider with its OAuth client in the Supabase dashboard. Configure email delivery before relying on magic links in production.

Apply migrations from the repository root with the project migration runner. This uses `DATABASE_URL` and maintains the immutable checksum ledger; the project does not include Supabase CLI configuration:

```text
python scripts/migrate.py
```

The migrations create immutable calculator versions, user-owned calculations/runs, worker jobs, subscriptions, billing event guards, checkout leases, and the private storage buckets used for templates and exports. The production database must use the committed migrations in order; do not edit an approved calculator version in place.

## Registering a model version

Source workbooks, prepared runtime templates, manifests, preparation scripts, and numerical records are owner-only files excluded from Git. The latest candidate is `state-rent@2.1.0-candidate.1`; older saved runs retain their original model version. See [model runtime and review](MODEL_RUNTIME.md) for the private runtime requirements, compatibility evidence, and local review setup. Do not use the legacy preparation script to regenerate the new model.

As of 2026-10-26, `2.1.0-candidate.1` is approved and active for new calculations. The user explicitly approved release with the fresh Excel recalculation limitation recorded privately. Existing saved calculations and runs remain pinned to their original versions. Registration and activation remain separate actions: the registration script verifies the runtime SHA-256, uploads the private template, and inserts a new immutable candidate with `approved=false` without changing the current pointer. For the next client workbook, follow the [release workflow](MODEL_RUNTIME.md#when-the-client-supplies-another-spreadsheet):

```text
python scripts/register_model.py \
  --manifest models/state-rent/2.1.0-candidate.1.json \
  --template private/models/state-rent/2.1.0-candidate.1.xlsx
```

It requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, but not `DATABASE_URL`. It confirms the calculator already exists, then verifies the entire manifest, template path, checksum, and stored object on an idempotent rerun. Registration never approves or activates a version. The database, frontend API, and worker reject customer execution of an unapproved version.

Generate the allowlisted public preview separately:

```text
node scripts/generate-preview-manifest.mjs --manifest models/state-rent/2.1.0-candidate.1.json
```

The new artifact contains 195 operational input definitions, guide notes, display choices and validation only. It excludes formulas, private mappings and presentation source ranges, hashes, paths, repairs, and review records.

## Render

The checked-in `render.yaml` describes:

- `geoflow-lab-web`: the legacy Node 22 Render web service (`pnpm build`, `pnpm start`, `/api/health`). The production frontend is Cloudflare.
- `whittaker-geo-saved-calculations`: the Docker background worker from `worker/Dockerfile`, running `python -m worker.jobs` for saved immutable runs. It requires `DATABASE_URL` and Supabase access.
- `whittaker-geo-live-calculations`: the Docker HTTP engine from the same image, running `python -m worker.live`, health check `/health`, concurrency one. Cloudflare's server-side `CALC_ENGINE_URL` points to `https://whittaker-geo-live-calculations.onrender.com`; the Cloudflare secret and Render `CALC_ENGINE_SECRET` must match. The service uses public HTTPS plus shared-secret authentication; it is not a private Render network connection.

As of 2026-10-22, the user chose Render's Free live engine and deferred the saved-run worker. No paid plans were applied. The Linux image's synthetic import/calculation/reset smoke passed. Hosted v2 baseline, gas-price change, and reset returned two output views, eight summary values, and three charts; the baseline matched local results within the documented numerical tolerances. Initial startup took about 36 seconds; warm requests took about 5–6 seconds on the Free instance. Free idle shutdowns can add startup delay. The interface displays a calculating spinner and a longer-wait explanation, and the API supplies bounded retry guidance for timeout/busy responses.

The later free saved-run implementation uses the existing HTTP engine instead of provisioning the separate background worker. `SAVED_RUNS_ENABLED=true` enables **Save & run** after migration 004 and the engine export endpoint are deployed. Keep `BILLING_ENABLED=false`; hosting is separate from customer subscription billing.

### Saved runs and Excel exports on Free

The existing `submit_run` transaction records an immutable input revision and idempotent job. While its results page is open, the browser posts to `/api/runs/[id]/process`. Cloudflare checks ownership and the request origin, claims only that run through a server-only function, and calls the authenticated `/export` endpoint on the same Render service. Live edits and exports share the engine's single calculation slot. Busy/startup responses requeue the existing job with backoff instead of creating another run.

The engine rechecks model approval and checksum, recalculates the saved inputs, and constructs a new XLSX from the validated output values and source geometry. It returns the same dashboard values plus the values-only file; Cloudflare stores the file in private Supabase storage and publishes the result under a fenced lease. Downloads still use an ownership-checked, short-lived signed URL. No database credential or additional service is added to Render.

Migration `004_requested_runs.sql` grants its claim/publication functions only to `service_role`. Claims expire after 180 seconds, reject duplicate active requests, and allow at most two interrupted execution attempts. A stale token cannot publish over a recovered run. Confirmed busy responses do not spend a crash retry. A lost publication reply is resolved by reading the stored run; the route never deletes a file that a committed result might reference.

Keep the results page open until completion. Closing the page can interrupt request-driven execution; reopening the saved run resumes it after any active lease expires. This is not an always-on background queue, and Free idle startup and usage limits still apply. The separate worker remains optional for future unattended processing.

The local export comparison checked all 2,399 nonblank baseline values, two visible output sheets and three charts. The deployed Free `/export` endpoint returned the same shape and a checked XLSX in 11.3 seconds, including 3.73 seconds of engine evaluation. ZIP inspection rejects cell formulas, hidden/private model sheets, external links, macros and embedded objects. Fresh Excel recalculation parity remains unverified as recorded in the v2 approval.

### Production browser acceptance, 2026-10-22

The signed-in production browser completed the v2 evaluation path through Cloudflare and the Free Render engine. A gas-price multiplier change from 1 to 1.1 changed the investor NPV from $85.36M to $99.86M; restoring 1 reproduced the baseline. Warm evaluations displayed 4.18–4.49 seconds. The initial idle-service request recovered through bounded busy/timeout retries while the working indicator remained visible.

The live dashboard displayed eight summary values and three charts. The cash-flow chart expanded to a large modal, and its return button closed the modal and restored focus. Detailed Annual Results rendered an 80px Year column. Section navigation kept the document scroll position at zero. A named input example was saved and its name and restored multiplier persisted after reload; no queued run or export was submitted.

The Cloudflare deployment for commit `3561634` passed. The engine workflow's deploy-hook job returned HTTP 200 for `beb7aad`, and Render confirmed that commit Live on the Free plan. Final app tests passed 48 cases, deployment-helper tests passed 8 cases, and Linux CI passed 36 worker tests plus the synthetic UNO image smoke. Private workbook paths and server credentials remain excluded from Git.

Workers outbound engine requests use `redirect: "manual"` and explicitly reject 3xx responses. Workers does not implement the Fetch `error` redirect mode; using it prevented the request from reaching Render. Keep the no-follow behavior to avoid forwarding the engine credential to a redirect destination. See [Cloudflare Request redirect behavior](https://developers.cloudflare.com/workers/runtime-apis/request/).

### Render deploys after engine CI

The calculation-engine GitHub Actions workflow tests the worker contracts and builds the Docker image, including its synthetic UNO smoke test. After those steps pass, it can trigger the saved worker and live engine to deploy the exact tested `GITHUB_SHA`. This deploy step runs only for `main`; a manual workflow run from another branch will not deploy.

Render documents that services connected through a public Git repository URL require manual deploys, even if the dashboard's automatic-deploy setting appears enabled. The workflow uses each service's secret deploy-hook URL, supplied as a GitHub Actions repository secret:

- `RENDER_LIVE_DEPLOY_HOOK`
- `RENDER_SAVED_DEPLOY_HOOK`

As of 2026-10-22, `RENDER_LIVE_DEPLOY_HOOK` is configured for the Free live engine with explicit user approval. `RENDER_SAVED_DEPLOY_HOOK` remains unset because the saved-run worker is deferred. Missing hooks are reported as skipped. When configured, the workflow accepts only `https://api.render.com/deploy/srv-...` hook URLs with a single `key` parameter, posts the tested commit through Render's `ref` parameter, and fails if Render does not return HTTP 200 or 202. It does not print hook URLs or response bodies. Keep the hooks only in GitHub Secrets and regenerate a hook if its URL is exposed.

Render's documentation states that deploying a specific commit through a deploy hook disables that service's automatic deploys. Leave deployment to this tested workflow after the hooks are configured; a later change to the service's deploy behavior should be deliberate. See [Render deploy behavior](https://render.com/docs/deploys) and [Render deploy hooks](https://render.com/docs/deploy-hooks).

## Stripe

Create two recurring Stripe Prices in CAD: monthly CAD $49.99 and annual CAD $499.99. Put only their Price IDs in `STRIPE_MONTHLY_PRICE_ID` and `STRIPE_ANNUAL_PRICE_ID`. Configure the webhook endpoint:

```text
https://<your-app-domain>/api/billing/webhook
```

The server keeps checkout idempotent through the database checkout lease and applies subscription state from verified webhook events. Leave checkout disabled when Stripe is not configured.

## Approval checklist

Deployment is not a model approval. Before setting a version `approved=true` or enabling billing, record these checks:

- [ ] Numerical review of the exact candidate and representative changed-input scenarios is signed off by the model owner. The legacy 12/15 checkpoint remains separate.
- [ ] The candidate worker output has been reviewed against the source workbook.
- [ ] No approved Excel parity claim has been made; Excel parity remains unapproved until explicitly validated.
- [ ] The candidate's 20-year schedule, source NPV labels, payout logic, compatibility preparation, and dependencies have been reviewed. Legacy versions retain their original schedule.
- [ ] The exact source/runtime SHA-256 values and immutable version row are recorded.
- [ ] Worker queue processing, retries, leases, and immutable run behavior have been exercised against the deployment database.
- [ ] Google OAuth and email magic-link redirects work on the final HTTPS origin.
- [ ] Stripe test checkout and signed webhook delivery have been verified before live prices are used.
- [ ] `BILLING_ENABLED` is changed to `true` only after the above checks and live Price IDs are configured.

The deployed live engine has passed real v2 baseline, changed-input, and reset checks in addition to the synthetic Linux image smoke. The separate background worker remains deferred; saved runs and exports use the request-driven Free path described above. Fresh Excel recalculation remains unverified; the user accepted release with that limitation. The original source workbook remains preserved at its owner workstation path; release preparation reads that source and writes the separate private runtime candidate.

## Official references

- [Next.js environment variables](https://nextjs.org/docs/pages/guides/environment-variables)
- [Render web services](https://render.com/docs/web-services)
- [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase passwordless email](https://supabase.com/docs/guides/auth/passwordless-login/auth-magic-link)
- [Stripe Checkout quickstart](https://docs.stripe.com/payments/checkout/quickstarts)
- [Stripe Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions)


As of 2026-10-26, the model owner approved and activated the October 26 model `2.1.0-candidate.1`, with 28 interim feedback mappings and the source’s 15% default discount rate. Local numerical/cache comparisons and gas/oil fiscal branch checks passed; fresh Excel parity remains unverified and that limitation was explicitly accepted. The hosted live baseline, immutable saved run, and downloaded XLSX matched the validated reference. The Free Render engine and Cloudflare frontend resolved the new model from Supabase without changing existing saved project versions. Model approval/activation remains separate from application deployment.

The model-update offer is generic to each calculator's active version. A saved project is upgraded by creating a new copy after input review, while its original version and run history remain intact. Superseded unsaved drafts can be explicitly updated in the browser. Metadata refresh does not trigger workbook evaluation. All evaluation/export requests continue to use the exact version recorded with their inputs and verify that version's runtime checksum. See MODEL_RUNTIME.md for the release process and update behavior.
