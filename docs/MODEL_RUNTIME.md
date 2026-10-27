# Model runtime and local review

The active model is `2.1.0-candidate.1`, based on the client’s `261026__EconMod Webpage GovRev Lock.xlsx`. It retains 195 operational inputs across six sections and a 20-year schedule, adds 28 explicitly mapped interim feedback values, and adopts the source’s 15% default discount rate and reorganized output columns. The original source workbook is never modified. Existing saved calculations remain pinned to their original version. One locked, unlabeled, unused grey/red cell with a broken validation reference is excluded. The private mapping records that exception.

The public interface contains only input definitions, examples, guide text, validation, output view names, and the labels/units of the allowed interim feedback values. Calculation responses add their scalar values and number formats; source cells and formulas remain private. Source workbooks, runtime templates, cell mappings, presentation source ranges, preparation tools, checksums, and numerical review records remain in ignored owner-only folders. They must be supplied separately on another computer. Git does not synchronize them or `.env.local`.

Current release state (2026-10-26): the user explicitly approved and activated `2.1.0-candidate.1`, with fresh Excel recalculation still unverified. The approval, exact immutable runtime identity, and validation evidence are recorded privately. The hosted 2.1 baseline and saved run matched the validated local reference, including all 28 interim values. Its 2,231 exported output values and number formats matched the stored result; the XLSX retained two tabs, three charts, A1 positioning, borders, and frozen annual headings. The new baseline uses a 15% discount rate and investor NPV of approximately $120.06M. Existing 2.0 projects and runs keep their pinned versions. GitHub application deployments do not independently change model approval or activation.

## Calculator workspace

Choosing **New calculation** in **Calculators** opens a dedicated full-width workspace. The library sidebar gives way to a compact toolbar with save actions, horizontal input sections, and a wider form beside live results. **Run history** is a collapsed disclosure below the editor. The back button returns to the calculator library (or Saved Calculations for an existing saved project); browser Back, direct links, and session drafts retain the existing route and recovery behavior. Smaller screens stack inputs and results.

## Try the candidate locally

The local review deliberately runs without changing the database's model approval. It uses a private engine bound to `127.0.0.1`, a matching-origin development route, and an explicit banner. It is unavailable in production builds even if review flags are present. Edits remain in the browser's session draft and do not create saved runs.

Required private files:

```text
models/state-rent/2.1.0-candidate.1.json
private/models/state-rent/2.1.0-candidate.1.xlsx
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

The first explicit **Calculate results** action warms Calc and takes longer. Editing never automatically evaluates the workbook. The last successful outputs and section feedback remain visible with an **Inputs changed** warning until **Update results** is clicked. Invalid edits show their validation errors while preserving the previous snapshot. Edits during an active request cancel that request, and late responses cannot be presented as current. Every requested evaluation rewrites the complete allowlisted input set, including blanks, before calculating. Temporary busy failures receive bounded retries. The process disables workbook macros and external updates and rejects formula errors on any sheet.

Try a gas-price change, switch reservoir fluid and select its units, select one facilities year, and open an information circle. The dashboard includes eight summary values and three charts. Detailed output cells and accessible chart tables are available. Each chart has an **Expand** button for a larger modal view with the same current values; **← return**, Escape, or an outside click closes it and restores focus. Year columns use a compact width. On desktop, the compact header and independent input/results panes fit the available viewport. The panes use slim olive scrollbars; browser scrollbars and forced-color accessibility preferences retain their native appearance. Section changes preserve the page and results position without reloading the model. On smaller screens the calculator keeps its stacked layout. Guide dialogs support **← return**, outside click, and Escape, restore focus, and respect reduced-motion preferences. A fluid change clears incompatible units without converting the numeric quantity.

## Numerical evidence and limitations

A fresh LibreOffice calculation exposed an incompatibility in eight nested LET expressions: internal errors were being concealed by existing IFERROR formulas. The owner-only preparation tool builds a separate, cache-cleared runtime with equivalent inline expressions for those eight cells. No business assumptions or original source cells are changed.

The prepared runtime's fresh results match the source file's saved Excel values across both allowlisted output ranges (relative tolerance 1e-8, absolute tolerance 1e-5), with no formula errors anywhere in the workbook. Increasing the default gas price by 10% changed 444 numeric output cells; restoring all defaults reproduced the baseline exactly. Warm evaluations measured approximately 0.3–0.5 seconds on the development PC, excluding initial startup. Warm and saved-export result values also agree in the tested scenario.

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

A workbook formula error is different from a hosting failure. The engine continues to reject formula errors across the whole workbook, including hidden dependencies; it never publishes a plausible-looking partial result. The frontend recognizes only the engine's exact `RESULT_INVALID` code and returns HTTP 422 with input-review guidance. It does not suggest retrying an unchanged scenario. Editing inputs clears the old error for that input snapshot; the user clicks **Update results** to calculate the revised scenario. Previous successful outputs remain visibly marked as stale until the requested calculation succeeds. Unknown engine errors retain their generic service-failure handling, and provider bodies, formulas and paths remain private.

Production checks on 2026-10-22 passed the default, gas-price multipliers 1.1 and 0.9, discount 0.1, and capex multiplier 2. The doubled-capex scenario returned a negative investor NPV successfully. A gas-price multiplier of zero produced `RESULT_INVALID` and reproduced the previously misleading generic outage message. This feedback fix does not change workbook formulas or make every input combination mathematically defined. The exact inputs behind the user's intermittent report were not captured in request logs.


Live input diagnostics compare a failed HTTP 422 request against the last successful input snapshot for that calculator in the current editor session. A single change is named with its old and new values. Multiple changes are presented as candidates, explicitly noting that their interaction may be responsible. The app does not infer formula dependencies or claim that a field is inherently invalid. Without a successful snapshot, or when no inputs differ, it explains that an input cannot be isolated.

Each candidate links to its section and exact control, including schedule year, with an amber highlight and an accessible description. Restoring the last working inputs stages the verified snapshot in the editor; the user then clicks **Update results** when ready; it does not save or submit a run. Edits clear the highlight. Successful snapshots are held in memory, isolated by account/calculation, model version and evaluation endpoint, and updated only by a current, successful request. Reloading starts a new comparison history. No additional engine evaluations, provider permissions or hosting plan changes are required.


### Explanation and export presentation, 2026-10-23

A failed direct IRR/XIRR formula now emits only the allowlisted `IRR_UNDEFINED` reason. The client explains the cash-flow limitation and, for the approved v2 zero gas-price multiplier case, explains that 0 removes gas revenue and distinguishes the base multiplier 1 from a proportional change. Intentional scenarios without a defined IRR are directed to model review; users are not told to change genuine assumptions merely to obtain a result. Unknown mathematical causes remain explicitly unconfirmed. No formula text or private addresses cross the diagnostic boundary, and formula-error rejection is unchanged. See Microsoft’s [IRR requirements](https://support.microsoft.com/en-us/excel/functions/irr-function?nochrome=true).

Fresh XLSX exports retain the two output tabs and three charts, but compact the visible output grid to A1. Hidden source rows/columns and leading empty space are excluded, values and number formats are preserved, and the exporter adds borders, wrapped headers, banded rows, and frozen annual headings/year column. Chart anchors and numeric helper references are remapped to the new output coordinates. Existing stored files keep their original formatting; a new run creates the updated workbook. Numerical results and the approved model remain unchanged.

Detailed output tables now include a sticky top horizontal scrollbar synchronized with the bottom scrollbar. Resize observation keeps its range aligned with the table, and vertical wheel movement still reaches the enclosing results pane or page.


### Client workbook and manual workflow, 2026-10-26

Drilling and completion cost curves now run horizontally by reference depth or lateral length. Facilities are separate gas/oil matrices with capacity tiers as columns and cost components as rows. All existing controls, semantic field mappings, validation and field guide notes remain available; input IDs remain version-scoped. Each matrix has a bounded scroll region with frozen headings and a frozen description column. Wheel gestures reach the surrounding pane at the inner region’s boundary. The development schedule uses the same frozen-heading behavior.

The candidate’s yellow calculated UI values appear in **Calculated feedback** under the applicable input section: reservoir (8), schedule (2), drilling/completions (5), facilities (10 including the inactive branch), and fiscal controls (3). The source has no yellow interim values for opex. Blank inactive gas/oil facility feedback is omitted from the display. This is a separate, read-only allowlist from the two OUTPUT views; no formulas or arbitrary UI ranges are exposed. Feedback and the dashboard share one explicit evaluation and one input snapshot.

The annual table has a frozen Year column and column headings. **Columns** can show just one source category (such as Capex); **Table** switches between annual cash flow and production blocks while preserving distinct legacy field/type-well labels. **View all output cells** keeps the complete allowlisted raw view available. Top and bottom horizontal scrollbars remain synchronized. These controls do not discard or change the exported values.

**Calculate results / Update results** refresh the in-memory feedback/dashboard only. **Save** saves inputs, and **Save & run** creates an immutable saved result with a downloadable XLSX. The XLSX retains both OUTPUT tabs, borders, frozen annual headings, values/number formats, and three dashboard charts. No CSV switch was made. Older stored files remain immutable.

The exact 2.1 candidate passed a fresh LibreOffice baseline against the source’s saved Excel caches across both output views, all eight summary values, three chart series groups, and all 28 interim values (relative tolerance 1e-8, absolute tolerance 1e-5). Gas-price 0.9, capex 1.1, PSA, oil CTR/PSA, reset, and the original approved v2 baseline were exercised. Oil feedback replaces the inactive gas feedback after recalculation. The source checksum remained unchanged. This is saved-cache compatibility evidence, not parity with a freshly recalculated Excel reference. The model owner accepted this limitation when approving the 2.1 release.

### Model updates across services

Supabase's `calculators.current_version` selects the active release separately for each calculator. New projects use that release. Every live or saved evaluation carries an explicit calculator/version pair; Render reloads that approved immutable record, downloads its private template, and verifies its checksum. Its warm document cache includes calculator, version, template digest, and mapped inputs. Every requested evaluation rewrites the full allowlisted input set. A model release does not require an engine redeploy when the existing manifest/runtime contract is supported.

Older saved editors show **Model update available**. Review lists compatible values that will carry over, fields requiring review, and changes to model defaults. **Create updated copy** makes a separate saved calculation on the current approved release, preserving the original calculation and all historical runs/exports. Current unsaved edits are included where compatible. For example, upgrading a 2.0 scenario retains its entered 19% discount rate while identifying the new model's 15% default. No values are converted between units or silently matched solely by their spreadsheet position.

Superseded unsaved drafts offer **Update draft** without creating a database record. Focus/visibility checks refresh the available release metadata, not the calculation. Reloading restores the draft's original version and values before offering an update. Creating a new project on a superseded release is rejected with a review-update message; existing saved projects continue to save and run on their pinned version. Updating a model or copying inputs never starts a calculation automatically.

For each future calculator release, prepare a new immutable version and private runtime, validate its mapped inputs/outputs and representative scenarios, record owner release approval and remaining numerical limitations, then activate that version. The same version/checksum resolution and update offer apply to every calculator ID. Never overwrite a previously approved version's manifest or template. Source workbooks and server credentials remain outside Git.
