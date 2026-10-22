# Cloudflare preview and development across computers

GitHub is the shared source of truth. Commit and push changes from either
computer, then pull before continuing on the other computer. Files that are
only saved locally are not synced by hosting or by GitHub.

## Deployment

The `Deploy GeoFlow preview` GitHub Actions workflow validates pull requests.
Pushes to `main` deploy the web application after the Next.js build, application
tests, Cloudflare build, and Cloudflare configuration checks pass.

The target is the `geoflow-preview` Worker in Cloudflare account
`032b3907437b929309a3bb9c45964a13`. Its expected address after the first
successful deployment is:

`https://geoflow-preview.roger-d-whittaker.workers.dev/preview`

This is the interface preview. No Supabase or Stripe credentials are configured,
and billing is explicitly disabled. The Python/LibreOffice calculation worker
is not deployed by this workflow. The existing Render configuration and ordinary
`pnpm dev`, `pnpm build`, and `pnpm start` commands remain available.

Cloudflare's current Next.js integration uses vinext and the Cloudflare Vite
plugin. These provide a separate build path; their beta status makes this a
preview deployment, not evidence that authenticated production workflows or
calculation parity have been accepted.

## One-time authorization

Create a Cloudflare API token limited to the account above, with Account /
Workers Scripts / Edit and Account / Account Settings / Read. Store it as the
`CLOUDFLARE_API_TOKEN` Actions secret only in `adamhfx/geoflowlab`.
Do not put it in Git, source files, workflow YAML, logs, or chat.

GitHub Actions supplies this credential only to the deployment step. Pull
requests run checks without the Cloudflare token and cannot deploy.

This workflow does not change the existing Cloudflare GitHub App installation
or its access to other repositories. Cloudflare's built-in connection did not
advance to repository selection in this account during setup.

## Local Cloudflare checks

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test
corepack pnpm build:vinext
corepack pnpm typecheck:cloudflare
corepack pnpm start:vinext --port 4173 --host 127.0.0.1
```

Visit `http://127.0.0.1:4173/preview` to exercise the built app in the Workers
runtime. `pnpm dev:vinext` starts a separate Vite development server on 3001.
Switching build tools regenerates their `.next` route declarations; run
`pnpm build` or restart `pnpm dev` before checking Next.js types after a vinext
build. Worker runtime types are isolated in `tsconfig.cloudflare.json` so they
do not change the browser's TypeScript definitions.

## whittakergeo.com

On October 22, 2026, Cloudflare reported invalid/pending nameservers for this
domain, registered at Namecheap. Cloudflare assigned these nameservers:

- `mitchell.ns.cloudflare.com`
- `sara.ns.cloudflare.com`

Before changing nameservers, verify that the DNS records for the current
website and any email service are present in Cloudflare. After activation,
connect the intended hostname to this Worker in Cloudflare. This configuration
does not change DNS or replace the existing domain's website.

## Laptop-only material

Transfer `.env.local`, private model workbooks/manifests, and owner-only release
tools separately when full service development is needed. Keep them out of
the public repository. Local Codex chats also do not transfer through Git.

## Supabase connection

The public browser build and Worker runtime both target the existing Calculations
App Supabase project (`mkjlxkctrtqcvxucuzcs`). The workflow includes only its public
URL and publishable key. Those identifiers are intentionally safe to ship to the
browser; database Row Level Security remains responsible for user data access.

Set `SUPABASE_SERVICE_ROLE_KEY` as an encrypted secret on `geoflow-preview` in
Cloudflare. Despite the legacy environment-variable name, the JavaScript SDK and
Python storage helper accept a modern `sb_secret_` key. Never place this value in
Git, a `NEXT_PUBLIC_` variable, or build environment variables.

For local Next.js development, use the same public URL/publishable key and a server
secret in ignored `.env.local`, then restart the development server. Set local
`APP_URL` to `http://127.0.0.1:3000` for the configured development hostname.

Supabase Auth must allow these exact callback URLs:
- `https://geoflow-preview.roger-d-whittaker.workers.dev/auth/callback`
- `http://127.0.0.1:3000/auth/callback`
- `http://localhost:3000/auth/callback`

Preserve existing Render callback URLs while that deployment remains in use. Add
the custom-domain callback only when the domain connection is ready. API keys do
not apply SQL migrations, approve the private numerical model, start the separate
calculation worker, or enable billing.
