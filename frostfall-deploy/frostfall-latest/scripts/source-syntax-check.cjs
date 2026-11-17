// Optional developer smoke checker. Uses installed/global TypeScript and PostCSS
// in this release environment; this is not a substitute for `next build`.
const fs=require('node:fs'),path=require('node:path');
let ts,postcss;
try { ts=require('typescript'); postcss=require('postcss'); }
catch { console.error('Install development dependencies (including TypeScript and PostCSS) before running syntax checks.'); process.exit(2); }
const root=path.resolve(__dirname,'..');let parsed=0,css=0,imports=0,errors=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules','.next'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(js|jsx|mjs|cjs)$/.test(p)){
  const src=fs.readFileSync(p,'utf8');const sf=ts.createSourceFile(p,src,ts.ScriptTarget.Latest,true,e.name.endsWith('jsx')?ts.ScriptKind.JSX:ts.ScriptKind.JS);parsed++;for(const d of sf.parseDiagnostics)errors.push(`${p}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`);
  for(const m of src.matchAll(/(?:from\s*|import\s*)["']((?:\.{1,2}\/|@\/)[^"']+)["']/g)){
   imports++;const spec=m[1];const q=spec.startsWith('@/')?path.join(root,spec.slice(2)):path.resolve(path.dirname(p),spec);
   if(![q,q+'.js',q+'.jsx',q+'.mjs',q+'.json',q+'.css',q+'.module.css',path.join(q,'index.js')].some(fs.existsSync))errors.push(`${p}: missing ${spec}`);
  }
 }else if(e.name.endsWith('.css')){css++;try{postcss.parse(fs.readFileSync(p,'utf8'),{from:p});}catch(err){errors.push(`${p}: ${err.message}`)}}}}
walk(root);console.log(`FROSTFALL SOURCE SYNTAX: ${parsed} JS/JSX, ${css} CSS, ${imports} local imports, ${errors.length} errors`);errors.forEach(x=>console.error(x));if(errors.length)process.exit(1);
