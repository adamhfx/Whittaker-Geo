# Model runtime and local review

The 2.0.0-candidate.1 Resource-to-Value model has 195 operational inputs across six sections and a 20-year schedule. Its source is the owner's `261018__EconMod GovRevLock.xlsx`; the original file is never modified. One locked, unlabeled, unused grey/red cell with a broken validation reference is excluded. The private mapping records that exception.

The public interface contains only input definitions, examples, guide text, validation, and output view names. Source workbooks, runtime templates, cell mappings, presentation source ranges, preparation tools, checksums, and numerical review records remain in ignored owner-only folders. They must be supplied separately on another computer. Git does not synchronize them or `.env.local`.

Current release state (2026-10-22): version `2.0.0-candidate.1` is approved and active for new calculations. The user explicitly approved release with fresh Excel recalculation still unverified; the approval and exact runtime identity are recorded privately. The hosted baseline matched the local baseline, a gas-price change updated outputs/charts, and reset restored the baseline. Existing saved calculations and runs keep their pinned versions. GitHub application deployments do not independently change model approval or activation.

## Calculator workspace

Choosing **New calculation** in **Calculators** opens a dedicated full-width workspace. The library sidebar gives way to a compact toolbar with save actions, horizontal input sections, and a wider form beside live results. **Run history** is a collapsed disclosure below the editor. The back button returns to the calculator library (or Saved Calculations for an existing saved project); browser Back, direct links, and session drafts retain the existing route and recovery behavior. Smaller screens stack inputs and results.

## Try the candidate locally

The local review deliberately runs without changing the database's model approval. It uses a private engine bound to `127.0.0.1`, a matching-origin development route, and an explicit banner. It is unavailable in production builds even if review flags are present. Edits remain in the browser's session draft and do not create saved runs.

Required private files:

```text
models/state-rent/2.0.0-candidate.1.json
private/models/state-rent/2.0.0-candidate.1.xlsx
```

Install `worker/requirements.txt` into `.venv`. Use LibreOffice 26.8.1 and a Python runtime with its matching UNO bridge. The prepared Windows installation on this PC is under `private/tooling/LibreOffice/program/`. Configure these ignored `.env.local` entries:

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

The frontend's `POST /api/calculators/[id]/evaluate` requires a signed-in user, matching origin, an approved immutable model version, editing access through a subscription, complimentary entitlement, or administrator role, and valid inputs. It forwards only validated input values and server-derived identity. The calculation engine rechecks approval, downloads the template from private Supabase storage, verifies its checksum, and enforces a per-user rate limit and bounded concurrency. Responses contain only allowed output values, summary values, and chart series. No live edit inserts a calculation, run, or export.

Cloudflare's server-side `CALC_ENGINE_URL` is configured as `https://whittaker-geo-live-calculations.onrender.com`; `CALC_ENGINE_SECRET` is stored as a Cloudflare secret and must match the Render engine's value. The engine uses a public HTTPS endpoint authenticated by that shared secret; it is not on a private Render network. The user chose the Free plan, which has passed hosted v2 baseline, changed-input, and reset checks. The first hosted evaluation took about 36 seconds; warm evaluations took about 5–6 seconds. The calculator shows a working spinner, explains longer waits after inactivity, and retries bounded timeout/busy responses. The saved-run worker `whittaker-geo-saved-calculations` is deferred; no paid upgrade was applied. Saved runs and new exports now execute on demand through the same Free service with `SAVED_RUNS_ENABLED=true`; keep the results page open, or reopen an interrupted run to resume it. See the request-driven lease and publication flow in `DEPLOYMENT.md`. A `/health` response alone confirms process health only.

The Docker image pins TDF LibreOffice 26.8.1 and uses its bundled Python 3.13.15 at `/opt/libreoffice26.8/program/python` for the matching UNO bridge. The image build runs a synthetic import, recalculation, reset, and output smoke test. Passing that build-time test is not a substitute for validating the deployed Render image and request path.

The user authorized v2 release after reviewing the numerical evidence and fresh Excel limitation. Its separate approval and activation are recorded in Supabase and the private deployment evidence. Keep both local-review flags false in hosted environments. No newly recalculated Excel parity claim is established by the saved-cache comparisons or this release approval.

The saved-run implementation uses the existing queue and retains each project's original version. The request-driven HTTP path shares that durable queue and publishes through a short fenced lease; the separate background worker remains deferred. Candidate exports are newly constructed values-only workbooks with exactly the two allowed visible output sheets and three charts backed by numeric values on a visible sheet. They contain no source formulas, hidden model sheets, or external workbook links.

## User Guide presentation

`lib/model-guide.json` contains display-only notes derived from the source workbook's User Guide. Production public metadata and the generated preview use the same version-scoped mapping. Broad reservoir topics belong to the section guide: they are not copied onto 23 unrelated field buttons. The other 172 input notes identify their specific field, year or capacity tier and retain the applicable entry, model-use and review guidance. Fields without a dedicated note omit the info button. The approved numerical manifest, model checksum, input defaults and calculation rules are unchanged.

Section guides render as native expandable topics, with one topic open at a time, labelled entry guidance, model-use explanations and a highlighted review note. Long semicolon-separated entry requirements become readable lists. Short field notes retain the same labelled structure without an accordion. The content is unchanged; the existing return, Escape, outside-click, focus-restoration and reduced-motion behavior remains in place.

The annual-results table is an inner horizontal scrolling view. Its vertical overscroll behavior must remain `auto` so wheel movement can reach the containing results pane (or the document on saved-result pages). Containing both axes blocks the wheel over a table that has no vertical scroll range. The outer desktop panes continue containing vertical movement at their own boundaries to preserve independent scrolling.


### Input-dependent undefined results

A workbook formula error is different from a hosting failure. The engine continues to reject formula errors across the whole workbook, including hidden dependencies; it never publishes a plausible-looking partial result. The frontend recognizes only the engine's exact `RESULT_INVALID` code and returns HTTP 422 with input-review guidance. It does not suggest retrying an unchanged scenario. Editing inputs automatically starts a fresh calculation and restores the dashboard when the model can calculate again. Unknown engine errors retain their generic service-failure handling, and provider bodies, formulas and paths remain private.

Production checks on 2026-10-22 passed the default, gas-price multipliers 1.1 and 0.9, discount 0.1, and capex multiplier 2. The doubled-capex scenario returned a negative investor NPV successfully. A gas-price multiplier of zero produced `RESULT_INVALID` and reproduced the previously misleading generic outage message. This feedback fix does not change workbook formulas or make every input combination mathematically defined. The exact inputs behind the user's intermittent report were not captured in request logs.


Live input diagnostics compare a failed HTTP 422 request against the last successful input snapshot for that calculator in the current editor session. A single change is named with its old and new values. Multiple changes are presented as candidates, explicitly noting that their interaction may be responsible. The app does not infer formula dependencies or claim that a field is inherently invalid. Without a successful snapshot, or when no inputs differ, it explains that an input cannot be isolated.

Each candidate links to its section and exact control, including schedule year, with an amber highlight and an accessible description. Restoring the last working inputs stages the verified snapshot in the editor and recalculates; it does not save or submit a run. Edits clear the highlight. Successful snapshots are held in memory, isolated by account/calculation, model version and evaluation endpoint, and updated only by a current, successful request. Reloading starts a new comparison history. No additional engine evaluations, provider permissions or hosting plan changes are required.


### Explanation and export presentation, 2026-10-23

A failed direct IRR/XIRR formula now emits only the allowlisted `IRR_UNDEFINED` reason. The client explains the cash-flow limitation and, for the approved v2 zero gas-price multiplier case, explains that 0 removes gas revenue and distinguishes the base multiplier 1 from a proportional change. Intentional scenarios without a defined IRR are directed to model review; users are not told to change genuine assumptions merely to obtain a result. Unknown mathematical causes remain explicitly unconfirmed. No formula text or private addresses cross the diagnostic boundary, and formula-error rejection is unchanged. See Microsoft’s [IRR requirements](https://support.microsoft.com/en-us/excel/functions/irr-function?nochrome=true).

Fresh XLSX exports retain the two output tabs and three charts, but compact the visible output grid to A1. Hidden source rows/columns and leading empty space are excluded, values and number formats are preserved, and the exporter adds borders, wrapped headers, banded rows, and frozen annual headings/year column. Chart anchors and numeric helper references are remapped to the new output coordinates. Existing stored files keep their original formatting; a new run creates the updated workbook. Numerical results and the approved model remain unchanged.

Detailed output tables now include a sticky top horizontal scrollbar synchronized with the bottom scrollbar. Resize observation keeps its range aligned with the table, and vertical wheel movement still reaches the enclosing results pane or page.
