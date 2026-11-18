import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  createCodexSpellingEngine, analyzeCodexText, normalizeCodexWord,
  replaceCodexSpellingIssue, codexWordStorageKey, readCodexWordList, saveCodexWordList,
} from "../../lib/domain/codexSpelling.js";

const engine = createCodexSpellingEngine([
  "this", "the", "weird", "word", "works", "work", "and", "writing", "a",
  "character", "human", "draft", "the", "lore", "new", "version", "hello",
  "world", "still", "does", "what", "going", "on", "with", "testing",
  "correctly", "or", "how", "a", "strange", "place", "name", "text",
]);
const component = readFileSync(new URL("../../features/codex/CodexProofreader.jsx",import.meta.url),"utf8");
const css = readFileSync(new URL("../../features/codex/CodexProofreader.module.css",import.meta.url),"utf8");
const app = readFileSync(new URL("../../components/FrostfallRealms.jsx",import.meta.url),"utf8");
const globalCss = readFileSync(new URL("../../app/themes.css",import.meta.url),"utf8");

test("P13A: local corrections prefer Sagnverk-style common typos and support transpositions", () => {
  assert.equal(engine.correct("weird"), true);
  assert.equal(engine.correct("WIERD"), false);
  assert.equal(engine.correct("don't"),true);
  assert.equal(engine.correct("I'm"),true);
  assert.equal(engine.correct("long-lived",new Set(["long","lived"])),true);
  assert.equal(engine.suggest("wierd")[0], "weird");
  assert.equal(engine.suggest("teh")[0], "the");
  assert.equal(engine.suggest("adn")[0], "and");
  assert.equal(engine.suggest("Wierd")[0], "Weird");
  assert.equal(normalizeCodexWord("“Daltos’"), "daltos");
});
test("P13A: fantasy names, unknown mixed-case words, and approved vocabulary are conservative", () => {
  const input = "teh wierd Daltos Varix and Xalorien";
  const issues = analyzeCodexText(input, engine);
  assert.deepEqual(issues.map(x => x.word), ["teh", "wierd"]);
  const checkedNames = analyzeCodexText(input, engine, { checkNames: true, approved: new Set(["daltos", "varix"]) });
  assert.deepEqual(checkedNames.map(x => x.word), ["teh", "wierd", "Xalorien"]);
  const approved = analyzeCodexText("chairondis teh",engine,{approved:new Set(["chairondis"])});
  assert.deepEqual(approved.map(x => x.word),["teh"]);
});
test("P13A: correction modifies only the verified text node, never HTML strings or siblings", () => {
  const node = { nodeType:3, data:"The wierd world",replaceData(index,length,replacement) {
    this.data=this.data.slice(0,index)+replacement+this.data.slice(index+length);
  } };
  const root={contains(other){return other===node;}};
  const issue={node,word:"wierd",start:4,end:9};
  assert.equal(replaceCodexSpellingIssue(root,issue,"weird"),true);
  assert.equal(node.data,"The weird world");
  assert.equal(replaceCodexSpellingIssue(root,issue,"world"),false);
  assert.equal(replaceCodexSpellingIssue(root,{...issue,start:2,end:7},"wrong"),false);
  assert.equal(replaceCodexSpellingIssue(root,{...issue,node:{...node}},"wrong"),false);
  assert.equal(replaceCodexSpellingIssue(root,issue,"<script>"),false);
});
test("P13A: personal vocabulary keys isolate account/world and survive broken local storage", () => {
  const k1=codexWordStorageKey("user-a","world-a"), k2=codexWordStorageKey("user-b","world-a"), k3=codexWordStorageKey("user-a","world-b");
  assert.ok(k1 && k1!==k2 && k1!==k3);
  assert.equal(codexWordStorageKey(null,"world"),null);
  const map=new Map();
  const store={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
  assert.equal(saveCodexWordList(store,k1,new Set(["Xalorien","Daltos"])),true);
  assert.deepEqual([...readCodexWordList(store,k1)],["xalorien","daltos"]);
  assert.deepEqual([...readCodexWordList(store,k2)],[]);
  map.set(k3,"broken JSON");
  assert.equal(readCodexWordList(store,k3).size,0);
  assert.equal(saveCodexWordList({setItem(){throw new Error("blocked");}},k1,new Set(["safe"])),false);
});
test("P13A: the application owns review controls, replaces only DOM text, and uses P11 save input path", () => {
  const ast=ts.createSourceFile("CodexProofreader.jsx",component,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(ast.parseDiagnostics.length,0,ast.parseDiagnostics.map(x=>x.messageText).join("; "));
  assert.match(component,/onEditorChange\?\.\(\)/);
  assert.match(component,/replaceCodexSpellingIssue/);
  assert.match(component,/Add to world words/);
  assert.match(component,/Ignore here/);
  assert.match(component,/Spelling review/);
  assert.doesNotMatch(component,/dangerouslySetInnerHTML|\.innerHTML\s*=|fetch\(|supabase/);
  assert.match(app,/<CodexProofreader/);
  assert.match(app,/onEditorChange=\{handleArticleBodyInput\}/);
  assert.match(app,/spellCheck=\{false\}/);
  assert.match(app,/codexDraftStorageKey/);
  assert.match(app,/const attemptSave/);
});
test("P13A: visual highlights, contrast tokens, and mobile layout are present", () => {
  assert.match(globalCss,/::highlight\(fr-codex-spelling\)/);
  for(const token of ["var(--text)","var(--textMuted)","var(--accent)","var(--cardBg)","var(--border)"]) assert.ok(css.includes(token));
  assert.match(css,/@media\(max-width:650px\)/);
  assert.match(component,/aria-expanded=\{panelOpen\}/);
  assert.match(component,/role="alert"/);
});

test("P13A: underlined words open accessible in-app correction popovers", () => {
  assert.match(component,/aria-label=\{"Spelling suggestions for " \+ popover\.issue\.word\}/);
  assert.match(component,/doc\.caretRangeFromPoint/);
  assert.match(component,/doc\.caretPositionFromPoint/);
  assert.match(component,/setPopover\(\{ issue: match/);
  assert.match(component,/onClick=\{\(\) => apply\(popover\.issue, suggestion\)\}/);
  assert.match(component,/setPopover\(null\)/);
  assert.match(css,/\.popover \{/);
  assert.match(css,/position:fixed/);
});
