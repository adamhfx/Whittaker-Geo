# Model runtime and local review

The 2.0.0-candidate.1 Resource-to-Value model has 195 operational inputs across six sections and a 20-year schedule. Its source is the owner's `261018__EconMod GovRevLock.xlsx`; the original file is never modified. One locked, unlabeled, unused grey/red cell with a broken validation reference is excluded. The private mapping records that exception.

The public interface contains only input definitions, examples, guide text, validation, and output view names. Source workbooks, runtime templates, cell mappings, presentation source ranges, preparation tools, checksums, and numerical review records remain in ignored owner-only folders. They must be supplied separately on another computer. Git does not synchronize them or `.env.local`.

## Calculator workspace

Choosing **New calculation** in **Calculators** opens a dedicated full-width workspace. The library sidebar gives way to a compact toolbar with save actions, horizontal input sections, and a wider form beside live results. **Run history** is a collapsed disclosure below the editor. The back button returns to the calculator library (or Saved Calculations for an existing saved project); browser Back, direct links, and session drafts retain the existing route and recovery behavior. Smaller screens stack inputs and results.

## Try the candidate locally

The local review deliberately runs without changing the database's model approval. It uses a private engine bound to `127.0.0.1`, a matching-origin development route, and an explicit banner. It is unavailable in production builds even if review flags are present. Edits remain in the browser's session draft and do not create saved runs.

Required private files:

```text
models/state-rent/2.0.0-candidate.1.json
private/models/state-rent/2.0.0-candidate.1.xlsx
```

Install `worker/requirements.txt` into `.venv`. Use LibreOffice 26.8.1 and a Python runtime with its UNO bridge. The prepared Windows installation on this PC is under `private/tooling/LibreOffice/program/`. Configure these ignored `.env.local` entries:

```text
CALC_ENGINE_URL=http://127.0.0.1:8765
CALC_ENGINE_SECRET=<a random shared secret of at least 32 characters>
SOFFICE_BIN=<absolute path to soffice.com or soffice>
UNO_PYTHON_BIN=<absolute path to Python with UNO>
LOCAL_MODEL_REVIEW=true
NEXT_PUBLIC_LOCAL_MODEL_REVIEW=true
```

The two engine secret values must match because the Next server forwards requests to the private engine. Do not use a `NEXT_PUBLIC_` variable for that secret. The startup helper reads only its named local-review settings; it does not execute the environment file.

Run in one PowerShell terminal from the repository root:

```powershell
.\scripts\start-model-review.ps1
```

Keep it running, then run `pnpm dev` in a second terminal. Open:

```text
http://127.0.0.1:3000/preview/calculations/new?calculator=state-rent&mode=example
```

The first calculation warms Calc and takes longer. Subsequent valid edits are debounced for 450 ms and recalculate in the same isolated process. Every evaluation rewrites the complete allowlisted input set, including blanks, before calculating. An invalid or newer edit hides the previous results immediately. Temporary busy failures receive bounded retries. The process disables workbook macros and external updates and rejects formula errors on any sheet.

Try a gas-price change, switch reservoir fluid and select its units, select one facilities year, and open an information circle. The dashboard includes eight summary values and three charts. Detailed output cells and accessible chart tables are available. Each chart has an **Expand** button for a larger modal view with the same current values; **← return**, Escape, or an outside click closes it and restores focus. Year columns use a compact width. On desktop, the compact header and independent input/results panes fit the available viewport. The panes use slim olive scrollbars; browser scrollbars and forced-color accessibility preferences retain their native appearance. Section changes preserve the page and results position without reloading the model. On smaller screens the calculator keeps its stacked layout. Guide dialogs support **← return**, outside click, and Escape, restore focus, and respect reduced-motion preferences. A fluid change clears incompatible units without converting the numeric quantity.

## Numerical evidence and limitations

A fresh LibreOffice calculation exposed an incompatibility in eight nested LET expressions: internal errors were being concealed by existing IFERROR formulas. The owner-only preparation tool builds a separate, cache-cleared runtime with equivalent inline expressions for those eight cells. No business assumptions or original source cells are changed.

The prepared runtime's fresh results match the source file's saved Excel values across both allowlisted output ranges (relative tolerance 1e-8, absolute tolerance 1e-5), with no formula errors anywhere in the workbook. Increasing the default gas price by 10% changed 444 numeric output cells; restoring all defaults reproduced the baseline exactly. Warm evaluations measured approximately 0.3–0.5 seconds on the development PC, excluding debounce and initial startup. Warm and saved-export result values also agree in the tested scenario.

These checks establish local compatibility with the source's saved caches. They do not establish owner-approved parity against a newly recalculated Excel workbook. The model owner must approve representative baseline and changed-input scenarios before release. The earlier model's outstanding 12% calculation / 15% label decision remains a separate legacy release issue.

The UI preserves the source's government NPV10 label. The source's IRR ratio value has a currency cell format; the dashboard presents it as **IRR (ratio)** with three decimal places without changing its value. Chart sources have implicit point indices, so the app uses point numbers rather than inventing calendar-year labels.

## Production connection

The frontend's `POST /api/calculators/[id]/evaluate` requires a signed-in user, matching origin, an approved immutable model version, a paid entitlement, and valid inputs. It forwards only validated input values and server-derived identity. The separate private service rechecks approval, downloads the template from private Supabase storage, verifies its checksum, and enforces a per-user rate limit and bounded concurrency. Responses contain only allowed output values, summary values, and chart series. No live edit inserts a calculation, run, or export.

The blueprint includes an optional `whittaker-geo-live-calculations` HTTP service, separate from the existing immutable-run worker. Set its server-only `CALC_ENGINE_SECRET`, Supabase URL and service key; use concurrency one for the warm process. Configure the frontend's `CALC_ENGINE_URL` with that service's HTTPS origin and the same secret. A `/health` response verifies that the service is running; it does not prove a model is approved or warmed. The pinned Docker image and Linux UNO bridge still require staging build and runtime verification.

Before customer release: validate the Docker service in staging, register the exact private candidate with `approved=false`, obtain the owner's numerical approval, approve that immutable version through the existing release process, and configure the frontend connection. Keep both local-review flags false in hosted environments. This task does not provision hosting or publish the candidate.

Saved runs continue through the existing queue and retain their original version. Candidate exports are newly constructed values-only workbooks with exactly the two allowed visible output sheets and three charts backed by numeric values on a visible sheet. They contain no source formulas, hidden model sheets, or external workbook links.
