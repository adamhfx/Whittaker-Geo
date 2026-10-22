# Whittaker Geo

Subscription calculator service with a Next.js interface, Supabase accounts and private storage, Stripe billing, and an isolated Python/LibreOffice calculation worker.

The current model candidate is Resource-to-Value Economic Model 2.0. It maps 195 editable inputs in six sections with a 20-year development schedule, workbook choice controls, User Guide help dialogs, and two values-only output views. Live edits use a private warm calculation process and do not create saved runs. Earlier saved calculations remain pinned to their original model version. The interface also supports example or blank starting points, saved projects, duplication, immutable run history, and values-only Excel exports. Subscriptions are CAD $49.99 monthly or CAD $499.99 annually, covering all calculator types. Expired accounts retain viewing and download access.

## Start locally

Use Node 22.12 or newer and pnpm 11.19.0. Copy `.env.example` to `.env.local`, configure Supabase, then run:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. `/preview` normally shows the mapped form without signing in or calculating. A development-only local owner review mode can evaluate a private candidate on loopback; see [model runtime and review](docs/MODEL_RUNTIME.md).

```sh
pnpm typecheck
pnpm test
python -m pytest worker/tests -q
```

The worker requires the dependencies in `worker/requirements.txt`. Its Docker image pins LibreOffice 26.8.1. The Render blueprint defines the web and background-worker services; see [deployment instructions](docs/DEPLOYMENT.md).

For the Cloudflare production interface and GitHub deployment
workflow, see [Cloudflare setup](docs/CLOUDFLARE.md). GitHub carries committed
changes between computers; local environment settings and private models stay
outside the repository.

## Private model boundary

Source workbooks, runtime workbooks, private manifests, numerical review records, and model preparation scripts are kept outside this public repository. The worker downloads an approved version from private Supabase storage using server-only credentials. Public preview data contains input definitions and example values, never model formulas. Customer exports are newly constructed workbooks with two visible result sheets and numeric chart data.

The owner workspace includes private release preparation tools. The public registration script accepts explicit `--manifest` and `--template` paths when releasing a model from that workspace. A managed release must include an immutable workbook checksum, mapping, defaults, output definitions and approved validation fixtures.

## Release status

The production interface is hosted at `https://whittakergeo.com` with the v2 Resource-to-Value model approved and active for new calculations. The user approved release with fresh Excel recalculation still unverified. The live engine runs on Render's Free plan; no paid upgrades were applied. New saved runs and Excel exports are deferred with `SAVED_RUNS_ENABLED=false`. Users with editing access can save inputs and view live results with charts. Checkout remains disabled.

Fresh LibreOffice recalculation and input changes are tested locally and on the hosted Linux engine; fresh Excel parity remains unverified. The new candidate uses a private compatibility runtime for eight nested LET expressions; the source workbook is unchanged. Details and release boundaries are in [model runtime and review](docs/MODEL_RUNTIME.md). The outstanding 12% calculation / 15% label decision has not been silently changed. Google OAuth and the Render live Docker engine are connected. Production email delivery, Stripe acceptance, and the optional hosted saved-run worker remain separate launch work.

No private credentials belong in Git or in `NEXT_PUBLIC_` variables. Use Render's secret settings for server and worker credentials.
