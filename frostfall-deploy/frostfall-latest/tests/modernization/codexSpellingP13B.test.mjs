import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  createCodexSpellingEngine, analyzeCodexText,
  replaceCodexSpellingIssue
} from "../../lib/domain/codexSpelling.js";

const root = new URL("../../", import.meta.url);
const dictionary = JSON.parse(readFileSync(new URL("lib/domain/codexEnglishWords.json", root), "utf8"));
const frequency = JSON.parse(readFileSync(new URL("lib/domain/codexEnglishFrequency.json", root), "utf8"));
const app = readFileSync(new URL("features/codex/CodexProofreader.jsx", root), "utf8");
const stylesheet = readFileSync(new URL("features/codex/CodexProofreader.module.css", root), "utf8");
const engine = createCodexSpellingEngine(dictionary.words, frequency.words);

test("P13B: full licensed offline lexicon covers ordinary prose and inflections", () => {
  assert.ok(engine.size > 100000, "expanded word forms must be comprehensive");
  assert.equal(frequency.words[0], "the");
  for (const word of [
    "what", "with", "does", "which", "working", "correctly", "character",
    "story", "stories", "testing", "world", "hello", "draft", "written", "writing",
    "couldn't", "don't", "long-lived", "running"
  ]) assert.equal(engine.correct(word), true, word);
  assert.equal(engine.correct("itworking"), false);
});

test("P13B: user screenshot sample stops flagging correct common words", () => {
  const sample = "Does the text still work well? hidoiid What is going on wth this testing? Is itworking correctly or what? teh wierd castle";
  const issues = analyzeCodexText(sample, engine);
  const flagged = issues.map(item => item.word.toLowerCase());
  for (const known of ["what", "with", "does", "testing", "is", "it", "correctly", "castle"]) {
    assert.ok(!flagged.includes(known), known + " is an ordinary correctly spelled word");
  }
  for (const typo of ["hidoiid", "wth", "itworking", "teh", "wierd"]) {
    assert.ok(flagged.includes(typo), typo + " must be detected");
  }
});

test("P13B: practical correction candidates outrank obscure near matches", () => {
  assert.equal(engine.suggest("teh")[0], "the");
  assert.equal(engine.suggest("wierd")[0], "weird");
  assert.equal(engine.suggest("wth")[0], "with");
  assert.equal(engine.suggest("wirking")[0], "working");
  assert.equal(engine.suggest("itworking")[0], "it working");
  assert.equal(engine.suggest("wht")[0], "what");
});

test("P13B: popup survives editor focus loss until its correction click runs", () => {
  const ast = ts.createSourceFile("CodexProofreader.jsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(ast.parseDiagnostics.length, 0, ast.parseDiagnostics.map(d=>d.messageText).join("; "));
  assert.match(app, /editor\.addEventListener\("focusout", schedule\)/);
  assert.doesNotMatch(app, /const schedule = \(\) => \{\s*setPopover\(null\)/);
  assert.doesNotMatch(app, /addEventListener\("scroll", onScroll, true\)/);
  assert.match(app, /onMouseDown=\{event => event\.preventDefault\(\)\} onClick=\{\(\) => apply\(popover\.issue, suggestion\)\}/);
  assert.match(app, /onMouseDown=\{event => event\.preventDefault\(\)\} onClick=\{\(\) => apply\(issue, suggestion\)\}/);
  assert.match(app, /Undo last correction/);
  assert.match(app, /setPanelOpen\(true\);\s*setNotice\("The text changed before the correction was applied/);
  assert.match(stylesheet, /\.undoRow \{/);
});

test("P13B: verified correction then undo preserves exact text and rejects stale writes", () => {
  const node = {nodeType:3, data:"A <not markup> wierd castle",replaceData(start,count,value){
    this.data=this.data.slice(0,start)+value+this.data.slice(start+count);
  }};
  const root = {contains(item){return item===node;}};
  const start=node.data.indexOf("wierd");
  const correction={node,start,end:start+5,word:"wierd"};
  assert.equal(replaceCodexSpellingIssue(root,correction,"weird"),true);
  assert.equal(node.data,"A <not markup> weird castle");
  assert.equal(replaceCodexSpellingIssue(root,{node,start,end:start+5,word:"weird"},"wierd"),true);
  assert.equal(node.data,"A <not markup> wierd castle");
  const stale={node,start,end:start+5,word:"weird"};
  assert.equal(replaceCodexSpellingIssue(root,stale,"castle"),false);
});

test("P13B: all source word data remains client-lazy and never sends lore to an API", () => {
  const spelling = readFileSync(new URL("lib/domain/codexSpelling.js",root),"utf8");
  assert.match(spelling,/Promise\.all\(\[import\("\.\/codexEnglishWords\.json"\), import\("\.\/codexEnglishFrequency\.json"\)\]\)/);
  assert.doesNotMatch(spelling,/fetch\(|supabase|localStorage\.setItem/);
  assert.doesNotMatch(app,/fetch\(|supabase/);
});
