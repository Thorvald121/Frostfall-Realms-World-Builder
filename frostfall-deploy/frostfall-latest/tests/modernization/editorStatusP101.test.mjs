import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { codexFooterLabel, showManuscriptFooter } from "../../lib/domain/editorSaveStatus.js";

const app = readFileSync("components/FrostfallRealms.jsx", "utf8");
const editor = readFileSync("features/codex/CodexEditorWorkspace.jsx", "utf8");

test("an open Codex draft is never described as saved despite a saved library", () => {
  assert.equal(codexFooterLabel("saved", true), "CODEX DRAFT · UNSAVED");
  assert.equal(codexFooterLabel("saving", true), "CODEX DRAFT · UNSAVED");
  assert.match(editor, /Unsaved Codex draft/);
});
test("genuine Codex storage errors are not obscured by editor status", () => {
  assert.match(codexFooterLabel("error", true), /SYNC FAILED/);
  assert.match(codexFooterLabel("error", false), /SYNC FAILED/);
  assert.match(codexFooterLabel("saving", false), /SYNCING/);
  assert.match(codexFooterLabel("saved", false), /LIBRARY · SAVED/);
});
test("empty manuscript libraries do not advertise a cloud save", () => {
  assert.equal(showManuscriptFooter("saved", 0), false);
  assert.equal(showManuscriptFooter("saved", 1), true);
  assert.equal(showManuscriptFooter("saving", 0), true);
  assert.equal(showManuscriptFooter("error", 0), true);
  assert.equal(showManuscriptFooter("conflict", 0), true);
  assert.equal(showManuscriptFooter("saved", 0, "storage failure"), true);
  assert.equal(showManuscriptFooter(undefined, 1), false);
});
test("sidebar distinguishes manuscripts and Codex and guards the open draft", () => {
  assert.match(app, /Manuscript library:/);
  assert.match(app, /showManuscriptFooter\(novelSaveStatus, manuscripts.length, novelSaveError\)/);
  assert.match(app, /codexFooterLabel\(saveStatus, view === "create"\)/);
  assert.doesNotMatch(app, /Writing: \{\(\{saved:'Cloud saved'/);
});
test("manual-save copy avoids implying a public publication", () => {
  assert.match(editor, /Manuscript cloud status is separate/);
  assert.match(editor, /This new Codex entry is not saved yet/);
  assert.doesNotMatch(editor, /Nothing is published until you save this entry/);
});
