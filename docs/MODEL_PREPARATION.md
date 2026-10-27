# Administrator workbook preparation

## Intended workflow

An existing calculator administrator uploads an XLSX under Settings → Calculator workbooks. The application prepares a separate private candidate, checks its input/output mapping and runtime compatibility, compares a fresh baseline with the workbook's saved Excel values, exercises representative input changes and reset, and checks a newly generated Excel export. The administrator reviews the actual candidate inputs, results, differences and limitations, then explicitly chooses **Approve and go live**. The active model and all historical calculations remain unchanged until that action succeeds.

Direct implementation reuses the existing administration screen, private Supabase storage, immutable model records, and request-driven Free Render service. A separate paid background worker or external AI processor is unnecessary. Browser-driven steps have durable progress and fenced leases so leaving the page pauses work and reopening resumes it without creating another model. Model preparation shares the existing single engine slot with customer calculations.

## Preparation contract

- Start from the calculator's approved base manifest and verified runtime; retain its field meanings, validation and dependency metadata.
- Keep the submitted workbook immutable. Prepare a deterministic, cache-cleared runtime copy. Apply only supported formula compatibility transformations and report their count.
- Carry input mappings only when workbook structure supports them. Present changed or ambiguous mappings for administrator review; formulas cannot become editable inputs. Output selection remains limited to configured visible OUTPUT sheets/ranges and scalar interim values.
- Rebase version-scoped input IDs and every dependency/rule reference together. Read candidate defaults from the submitted source. Keep private formulas and template coordinates out of customer metadata.
- Missing Excel caches, mismatched numerical comparisons, invalid outputs, unresolved mappings, or unsupported formulas prevent release. Automated scenario checks establish runtime behavior, not independently recalculated Excel scenario parity.
- Record exact source/runtime checksums, base version, mapping revision, completed checks, baseline/results/export, approval identity and accepted limitations. Approval must atomically check that the reviewed preparation is still current and that the calculator's active base version has not changed.

## Acceptance

The current October 26 source completes the process on the existing Free engine without activating a new release automatically. The administrator can inspect real calculated results and the output workbook before approval. Unauthorized callers cannot upload, process, inspect, preview or approve candidates. Failed, incomplete, mismatched and stale candidates cannot be activated. Repeated processing/approval requests do not duplicate or overwrite model versions. Existing saved calculations, runs, credentials and approved model payloads remain intact.

## Implementation boundaries

- A private `model_preparations` row accompanies a source submission. Its mapping revision, phase, fenced lease, candidate manifest/artifact identity, reports, baseline result, and export pointer survive browser reloads. Original `model_uploads` rows remain source provenance.
- Cloudflare administrator routes claim one step, invoke the existing authenticated Render service, and read progress. Render checks the administrator and lease, shares the existing capacity lock, and publishes through a fenced server-only database function. It never accepts arbitrary storage URLs or manifest paths from the browser.
- Steps are analyze/prepare, baseline comparison, each representative scenario, then reset/export/immutable registration. The candidate remains unapproved. Registration reuses `scripts/register_model.py` (copied into the engine image); existing customer execution still loads only approved records.
- Analyze compares editable styles and nearby fixed labels/years to the approved base, rebases input IDs/dependencies/rules, reads the new defaults, and refreshes published chart series from the source OUTPUT charts. Mapping controls cover existing input cells, new simple inputs in an Additional inputs section, explicit exclusions, published output ranges, interim cells, and guide edits/review. Unknown dependencies or unsupported chart/formula types remain blocking.
- The mapping payload uses `fieldCells` keyed by base field ID, `addedFields`, `ignoredCells`, `outputRanges` keyed by view ID, `feedbackCells` keyed by feedback ID, `help` keyed by base field/group ID, and `guideReviewed`. Test-case changes use worksheet cell addresses rather than revision-specific IDs. New/ambiguous inputs are never silently guessed or published.
- Read-only candidate review exposes safe metadata, baseline outputs/charts/feedback, saved-Excel comparison details, input/default changes, scenario summaries and the checked XLSX. A protected candidate-evaluation route permits additional administrator input trials without approving the template or creating customer runs.
- Approval is one database transaction: verify administrator membership, ready state, reviewed report fingerprint/revision, exact immutable candidate/template checksums, required passing checks, acknowledgement of numerical limitations, and unchanged active base; then approve the model and activate it. Record actor/time/notes. A lost-response retry returns the already-approved outcome.
- Adam's existing complimentary editing entitlement is not an administrator role. Verify current memberships before live browser acceptance; do not silently widen privileges. Keep production 2.1 active until the human administrator approves a prepared candidate.

## Supported updates and operator steps

1. Recalculate and save the complete example in desktop Excel, including its cached results. Keep the configured visible UI/OUTPUT sheet names and clearly marked editable cells. Close the workbook before uploading.
2. Open Settings → Calculator workbooks, select the calculator and **Upload & prepare**. Keep the page open while bounded steps use the existing free engine. Return to upload history and resume if interrupted.
3. Resolve any mapping/guide changes. Existing cell mappings, labels/units/bounds, simple additional inputs, summary cells, interim feedback, output ranges, and input/section help notes are editable in the review. Applying changes creates another private revision and reruns checks.
4. Review baseline differences, runtime scenarios, input/default changes, dashboard and detailed outputs. Try extra inputs and download the checked Excel workbook.
5. Accept the recorded numerical limitations and choose **Approve and go live**. Release updates the authoritative Supabase current-version pointer; both the live and saved-run engines load that exact approved immutable version. No engine redeployment is needed for supported workbook revisions.

This is preparation for revisions of an already configured calculator, not arbitrary-workbook interpretation. A new calculator needs its initial input meanings, control/dependency rules and output contract set up once. Renamed output sheets, changed field types/dependencies, unsupported formulas/chart types, explicit nonsequential chart category mappings, or ambiguous new business meanings can require developer mapping/compatibility work. These cases block release rather than guessing.

Automated preparation does not produce independent fresh Excel scenario references. The review records saved-cache baseline parity and changed-input runtime checks separately. Numerical approval remains the administrator's decision.
