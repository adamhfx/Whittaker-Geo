import test from "node:test";
import assert from "node:assert/strict";
import { helpHeading, organizeHelp } from "../lib/help-content";

test("help headings use sentence case without lowercasing technical identifiers", () => {
  assert.equal(helpHeading("Reservoir & Production Design — User Guide"), "Reservoir & production design — user guide");
  assert.equal(helpHeading("Primary Fluid & Reservoir Parameters"), "Primary fluid & reservoir parameters");
  assert.equal(helpHeading("Oil / Gas / Water Production Multiplier"), "Oil / gas / water production multiplier");
  assert.equal(helpHeading("TVD, PIIP, EUR, NPV and IRR in USD MM"), "TVD, PIIP, EUR, NPV and IRR in USD MM");
  assert.equal(helpHeading("Type-well Play ID A–G"), "Type-well play ID A–G");
  assert.equal(helpHeading("Annual Qi in m³/day and mD"), "Annual Qi in m³/day and mD");
  assert.equal(helpHeading("Gas in Mcf, Mscf and MMcf"), "Gas in Mcf, Mscf and MMcf");
  assert.equal(helpHeading("m³ Gas Volume"), "m³ gas volume");
});

test("sentence-case presentation leaves source guidance and numbered values intact", () => {
  const body = "Fiscal Model Terms\nSelect PSA or CTR.\n\nWhat to enter: USD MM; 0.15 represents 15%.\n\nReview: Confirm the NPV basis.";
  const topics = organizeHelp(body);
  assert.equal(helpHeading(topics[0].title!), "Fiscal model terms");
  assert.equal(topics[0].title, "Fiscal Model Terms");
  assert.deepEqual(topics[0].introduction, ["Select PSA or CTR."]);
  assert.deepEqual(topics[0].entries, ["USD MM; 0.15 represents 15%."]);
  assert.deepEqual(topics[0].review, ["Confirm the NPV basis."]);
});
