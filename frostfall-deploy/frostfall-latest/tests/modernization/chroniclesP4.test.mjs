import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChronicleEvents, filterChronicleEvents, eraForEvent, chronicleRange,
  layoutChronicleLanes, chronicleTicks, chronicleConnections, exportChroniclesCSV,
} from '../../lib/domain/chronicles.js';

const article = (id,category,start,end,more={}) => ({id,title:id,summary:`About ${id}`,category,
  tags:['frost'],updatedAt:'2026-11-01T00:00:00Z',temporal:{active_start:start,active_end:end},...more});
const seed = [
  article('Awakening','event',0,0),
  article('Deep Winter','event',-1200,-1100),
  article('War of Crowns','event',1240,1270),
  article('Queen Elaris','character',1200,1298),
  article('No Date','location',null,null),
];
const era = [
  {id:'ancient',start:-2000,end:0,label:'Before'},
  {id:'new',start:0,end:1300,label:'First Age'},
  {id:'other',start:1300,end:2000,label:'Second Age'},
];
const events = buildChronicleEvents(seed);

test('year 0 is valid; negative years and undated entries are preserved',()=>{
 assert.equal(events.find(e=>e.id==='Awakening').start,0);
 assert.equal(events.find(e=>e.id==='Deep Winter').start,-1200);
 assert.equal(events.find(e=>e.id==='No Date').dated,false);
 assert.equal(events.find(e=>e.id==='No Date').kind,'undated');
});
test('no event year is inferred from a free-text mention',()=>{
 const named=buildChronicleEvents([article('scribe','character',null,null,{body:'They remembered @war_1700'})]);
 assert.equal(named[0].dated,false);
});
test('explicit numeric-string years from imported structured dates are accepted',()=>{
 const parsed=buildChronicleEvents([{id:'x',category:'character',title:'A',fields:{birth_year:'0',death_year:'-10'},temporal:{}}]);
 assert.equal(parsed[0].start,0);assert.equal(parsed[0].end,-10);assert.equal(parsed[0].valid,false);
 assert.equal(buildChronicleEvents([{id:'y',category:'event',temporal:{active_start:'Year 99'}}])[0].dated,false);
});
test('time-span intervals are distinct from point events',()=>{
 assert.equal(events.find(e=>e.id==='Deep Winter').kind,'span');
 assert.equal(events.find(e=>e.id==='Awakening').kind,'point');
});
test('filters default to dated entries and sort by ascending years',()=>{
 const result=filterChronicleEvents(events,{},era);
 assert.deepEqual(result.map(e=>e.id),['Deep Winter','Awakening','Queen Elaris','War of Crowns']);
});
test('undated entries must be opted in or explicitly requested',()=>{
 assert.ok(filterChronicleEvents(events,{includeUndated:true},era).some(e=>e.id==='No Date'));
 assert.deepEqual(filterChronicleEvents(events,{kind:'undated'},era).map(e=>e.id),['No Date']);
 assert.deepEqual(filterChronicleEvents(events,{era:'ancient',includeUndated:true},era).map(e=>e.id),['Deep Winter']);
});
test('era ranges use temporal overlap, not only starting year',()=>{
 const spanning=buildChronicleEvents([article('Reign','character',-100,100)]);
 assert.deepEqual(eraForEvent(spanning[0],era).map(x=>x.id),['ancient','new']);
 assert.deepEqual(filterChronicleEvents(spanning,{era:'new'},era).map(x=>x.id),['Reign']);
});
test('year window includes overlapping ranges and excludes irrelevant ones',()=>{
 const result=filterChronicleEvents(events,{from:1250,to:1270},era);
 assert.deepEqual(result.map(e=>e.id),['Queen Elaris','War of Crowns']);
});
test('sorting supports latest date, alphabetic title and recent update',()=>{
 assert.equal(filterChronicleEvents(events,{sort:'date_desc'},era)[0].id,'War of Crowns');
 assert.equal(filterChronicleEvents(events,{sort:'title_asc'},era)[0].id,'Awakening');
 assert.equal(filterChronicleEvents(events,{sort:'title_desc'},era)[0].id,'War of Crowns');
 assert.equal(filterChronicleEvents(events,{sort:'duration_desc'},era)[0].id,'Deep Winter');
});
test('keyword search matches tags, summary and body',()=>{
 assert.equal(filterChronicleEvents(events,{search:'FROST'},era).length,4);
 assert.deepEqual(filterChronicleEvents(events,{search:'crowns'},era).map(e=>e.id),['War of Crowns']);
});
test('invalid year order is retained for author correction, not silently reversed',()=>{
 const broken=buildChronicleEvents([article('error','event',99,55)]);
 assert.equal(broken[0].valid,false);
 assert.equal(broken[0].start,99);
 assert.equal(broken[0].end,55);
});
test('collisions create separate tracks; years remain sorted independent of selected sort',()=>{
 const group=layoutChronicleLanes(events,['event','character'],y=>y+1500,148);
 assert.ok(group.length===2);
 assert.ok(group[0].height>=62);
 assert.ok(group[0].entries.some(e=>e.id==='War of Crowns'));
 const overlapped=layoutChronicleLanes(buildChronicleEvents([article('a','event',2,4),article('b','event',3,3)]),['event'],y=>y*2,148);
 assert.equal(overlapped[0].rows,2);
});
test('canvas tick generation is bounded and supports negative years',()=>{
 const ticks=chronicleTicks(-1250,1800,0.4);
 assert.ok(ticks.length>1 && ticks.length<=150);
 assert.ok(ticks.some(x=>x<0) && ticks.some(x=>x>0));
});
test('empty chronologies use stable fallback range',()=>{
 assert.deepEqual(chronicleRange([]),{min:-100,max:100,span:200});
 assert.ok(chronicleRange(events).min < -1200);
});
test('references are resolved only by ID; mentions do not create attendance facts',()=>{
 const links=chronicleConnections({id:'scribe',body:'Remembered @[Old Queen](Queen Elaris) and @[Deep Winter](Deep Winter); @missing'},seed);
 assert.deepEqual(links.map(x=>x.id),['Deep Winter','Queen Elaris']);
});
test('CSV export is valid, quotes text, protects formulas, but retains signed numeric years',()=>{
 const dangerous=buildChronicleEvents([article('=SUM(A1:A9)','event',-1200,-1100,{summary:'"A dangerous" claim'})]);
 const csv=exportChroniclesCSV(dangerous);
 assert.ok(csv.includes('"\'=SUM(A1:A9)"'));
 assert.ok(csv.includes('"-1200"'));
 assert.ok(csv.includes('""A dangerous""'));
 assert.ok(csv.endsWith('\r\n'));
});
test('P4 source view maintains accessible event inspector and no duplicate outer scroll',async()=>{
 const fs=await import('node:fs/promises');
 const tsx=await fs.readFile(new URL('../../features/timeline/TimelineView.jsx',import.meta.url),'utf8');
 const css=await fs.readFile(new URL('../../features/timeline/Chronicles.module.css',import.meta.url),'utf8');
 assert.match(tsx,/role="dialog" aria-modal="true"/);
 assert.match(tsx,/Event index/);
 assert.match(tsx,/ZoomIn/);
 assert.match(tsx,/openId\(e\.id\)/);
 assert.match(tsx,/Export filtered CSV/);
 assert.match(css,/overflow-x:auto;overflow-y:hidden/);
 assert.doesNotMatch(css,/overflow-y:auto/);
});

test('Chronicles category colors and era text stay readable in all nine themes',async()=>{
 const {THEMES}=await import('../../lib/themes.js');
 const {ensureContrast,contrastRatio}=await import('../../lib/ui/contrast.js');
 const {CATEGORIES}=await import('../../lib/domain/categories.js');
 assert.equal(Object.keys(THEMES).length,9);
 for (const [name,t] of Object.entries(THEMES)){
  for (const c of Object.values(CATEGORIES)){
   const fg=ensureContrast(c.color,[t.surface,t.inputBg],4.5);
   assert.ok(contrastRatio(fg,t.surface)>=4.49,`${name} ${c.label} surface`);
   assert.ok(contrastRatio(fg,t.inputBg)>=4.49,`${name} ${c.label} input`);
  }
 }
});
