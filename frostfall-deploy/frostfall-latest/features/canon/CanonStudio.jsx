'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  BookMarked, BookOpenCheck, Check, ChevronDown, ClipboardCheck, FilePlus2,
  FileText, GitBranch, GitCompareArrows, Info, Link2, Loader2, LockKeyhole, Download,
  Plus, RefreshCcw, Search, ShieldAlert, ShieldCheck, Sparkles, ScrollText,
  X, CircleHelp, AlertTriangle, ArrowRight, Pencil, Save,
} from 'lucide-react';
import { evaluateCanonAssertions } from '@/lib/domain/truth/v2/canonEngine';
import { buildClaim, PREDICATES, previewTypedDateCandidates, validateSource,
  DISPOSITIONS, decisionForFinding } from '@/lib/domain/truth/v2/canonWorkflow';
import { loadCanonWorld, saveCanonAssertion, saveCanonSource, saveFindingDecision,
  clearFindingDecision, createCanonBranch } from '@/lib/domain/truth/v2/canonRepository';
import { ensureContrast, readableOn } from '@/lib/ui/contrast';
import { makeCanonBackup } from '@/lib/domain/truth/v2/canonBackup';
import styles from './CanonStudio.module.css';

const initialClaim = () => ({subjectId:'',predicate:'participated_in',objectId:'',from:'',until:'',status:'draft',exclusive:false,sourceIds:[],notes:''});
const initialSource = () => ({title:'',kind:'author_note',articleId:'',excerpt:'',citation:''});
const STATUS_LABELS={canon:'Canonical',draft:'Draft',disputed:'Disputed',superseded:'Superseded',alternate:'Alternate'};
const DISPOSITION_LABELS={open:'Needs review',acknowledged:'Acknowledged',intentional:'Intentional lore',dismissed:'Dismissed'};
const LENSES=[['review','Review queue',ClipboardCheck],['claims','Fact ledger',ScrollText],['sources','Evidence library',FileText],['branches','Canon branches',GitBranch]];
function yearLabel(year) { return year == null ? 'Undated' : `Year ${Number(year).toLocaleString()}`; }
function period(a) {return a.from == null ? 'No date' : a.until == null || a.until === a.from ? yearLabel(a.from) : `${yearLabel(a.from)}–${Number(a.until).toLocaleString()}`;}
const branchMatches=(a,b)=>a.branchId===b;
const messageForError=(e)=>String(e?.message || 'Operation failed.');

export function CanonStudio({ activeWorld, articles = [], theme, navigate, entryFocus=null, canEdit = true }) {
  const worldId=activeWorld?.id || activeWorld?.name || '';
  const [data,setData]=useState({branches:[],sources:[],assertions:[],decisions:[],mode:'local'});
  const [loaded,setLoaded]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [activeBranchId,setActiveBranchId]=useState('');
  const [lens,setLens]=useState('review');
  const [query,setQuery]=useState('');
  const [modal,setModal]=useState(null); // claim | source | branch | disposition
  const [claimForm,setClaimForm]=useState(initialClaim);
  const [sourceForm,setSourceForm]=useState(initialSource);
  const [branchName,setBranchName]=useState('');
  const [decisionForm,setDecisionForm]=useState({finding:null,disposition:'acknowledged',rationale:''});
  const [statusFilter,setStatusFilter]=useState('all');
  const [focusedSubjectId,setFocusedSubjectId]=useState('');

  useEffect(()=>{
    let active=true;
    setLoading(true);setLoaded(false);setError('');setMessage('');setActiveBranchId('');setModal(null);
    loadCanonWorld(worldId).then((value)=>{
      if(!active)return;
      setData(value);setActiveBranchId(value.branches.find((b)=>b.slug==='main')?.id || value.branches[0]?.id || '');
      setLoading(false);setLoaded(true);
    }).catch((e)=>{if(active){setError(messageForError(e));setLoading(false);}});
    return ()=>{active=false;};
  },[worldId]);

  useEffect(()=>{
    if (!loaded || !entryFocus?.id) return;
    setFocusedSubjectId(entryFocus.id);setLens('claims');setQuery('');
    if (entryFocus.mode === 'new' && canEdit) {
      setClaimForm({...initialClaim(),subjectId:entryFocus.id});setModal('claim');
    }
  },[loaded,entryFocus?.id,entryFocus?.nonce,canEdit]);

  function exportSnapshot(){
    try {
      const dataText=makeCanonBackup(worldId,data);
      const blob=new Blob([dataText],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');anchor.href=url;
      anchor.download=`frostfall-${String(worldId).replace(/[^a-z0-9_-]+/gi,'-')}-canon-backup.json`;
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),2000);
      setMessage('Canon backup exported to your device.');
    } catch(e){failAction(e);}
  }

  const branch=data.branches.find((b)=>b.id===activeBranchId);
  // Resolve the present-day slug via stable Supabase UUID: renaming an article
  // must not sever its established canon claims.
  const claims=useMemo(()=>data.assertions.filter((a)=>branchMatches(a,activeBranchId)).map((a)=>({
    ...a,
    subjectId: articles.find((article)=>article._uuid && article._uuid===a.subjectUuid)?.id || a.subjectId,
    objectId: articles.find((article)=>article._uuid && article._uuid===a.objectUuid)?.id || a.objectId,
  })),[data.assertions,activeBranchId,articles]);
  const evaluation=useMemo(()=>evaluateCanonAssertions(claims),[claims]);
  const reviewed=useMemo(()=>evaluation.findings.map((f)=>({...f,...decisionForFinding(f,data.decisions,claims,activeBranchId)})),[evaluation,claims,data.decisions,activeBranchId]);
  const pending=reviewed.filter((f)=>f.disposition==='open');
  const candidates=useMemo(()=>previewTypedDateCandidates(articles,claims),[articles,claims]);
  const named=(id)=>articles.find((a)=>a.id===id)?.title || id;
  const sourceNamed=(id)=>data.sources.find((s)=>s.id===id)?.title || 'Unknown source';
  const accent=ensureContrast(theme.accent,[theme.surface,theme.inputBg],5);
  const accessibleStatus={error:ensureContrast('#e07050',[theme.surface,theme.inputBg],4.5),warning:ensureContrast('#e2a551',[theme.surface,theme.inputBg],4.5),info:ensureContrast('#67afd5',[theme.surface,theme.inputBg],4.5),success:ensureContrast('#6fbf94',[theme.surface,theme.inputBg],4.5)};

  function failAction(e){setError(messageForError(e));setMessage('');}
  async function runSave(action){
    if(busy) return;
    setBusy(true);setError('');setMessage('');
    try {await action();setModal(null);}catch(e){failAction(e);}finally{setBusy(false);}
  }
  function openNewClaim(candidate=null){
    setClaimForm(candidate?{...initialClaim(),...candidate}:initialClaim());setModal('claim');setError('');
  }
  function openEditClaim(a){setClaimForm({...a,from:a.from??'',until:a.until??'',sourceIds:a.sourceIds||[]});setModal('claim');setError('');}
  async function saveClaim(e){
    e.preventDefault();
    await runSave(async()=>{
      const claim=buildClaim(claimForm,{worldId,branchId:activeBranchId,articles,sources:data.sources});
      const saved=await saveCanonAssertion(worldId,claim);
      setData((prev)=>({...prev,assertions:prev.assertions.some((a)=>a.id===saved.id)
        ? prev.assertions.map((a)=>a.id===saved.id?saved:a) : [saved,...prev.assertions]}));
      setMessage(saved.status==='canon'?'Canonical fact saved and checked.':'Fact saved for author review.');setLens('claims');
    });
  }
  async function saveSource(e){
    e.preventDefault();
    await runSave(async()=>{
      const source=validateSource(sourceForm,articles,{requireSavedArticle:data.mode==='cloud'});
      const saved=await saveCanonSource(worldId,source);
      setData((prev)=>({...prev,sources:[saved,...prev.sources.filter((s)=>s.id!==saved.id)]}));
      setMessage('Evidence source saved.');setLens('sources');
    });
  }
  async function saveBranch(e){
    e.preventDefault();
    await runSave(async()=>{
      const created=await createCanonBranch(worldId,{name:branchName});
      setData((prev)=>({...prev,branches:[...prev.branches,created]}));
      setActiveBranchId(created.id);setLens('claims');setBranchName('');setMessage('New canon branch created. Its facts are isolated from main canon.');
    });
  }
  async function saveReview(e){
    e.preventDefault();
    await runSave(async()=>{
      const f=decisionForm.finding;
      if(!f)throw new Error('Select an integrity finding.');
      if(!DISPOSITIONS.includes(decisionForm.disposition))throw new Error('Choose a valid review outcome.');
      if(decisionForm.rationale.length>4000)throw new Error('Review note is too long.');
      const saved=await saveFindingDecision(worldId,{branchId:activeBranchId,findingKey:f.id,
        signature:f.signature,disposition:decisionForm.disposition,rationale:decisionForm.rationale});
      setData((prev)=>({...prev,decisions:[...prev.decisions.filter((d)=>!(d.findingKey===saved.findingKey&&d.branchId===saved.branchId)),saved]}));
      setMessage('Finding review recorded. Facts were not modified.');setLens('review');
    });
  }
  async function reopen(f){
    await runSave(async()=>{
      await clearFindingDecision(worldId,activeBranchId,f.id);
      setData((prev)=>({...prev,decisions:prev.decisions.filter((d)=>!(d.findingKey===f.id&&d.branchId===activeBranchId))}));
      setMessage('Finding reopened.');
    });
  }
  const filteredClaims=claims.filter((a)=>{
    if(focusedSubjectId && a.subjectId!==focusedSubjectId) return false;
    if(statusFilter!=='all' && statusFilter!==a.status) return false;
    return !query.trim() || [named(a.subjectId),named(a.objectId||''),a.predicate,a.notes].join(' ').toLowerCase().includes(query.toLowerCase());
  });
  const filteredFindings=reviewed.filter((f)=>!query.trim()||[f.code,f.message,...f.assertionIds.map((id)=>named(claims.find((a)=>a.id===id)?.subjectId || ''))].join(' ').toLowerCase().includes(query.toLowerCase()));

  if(!worldId)return <div className={styles.empty}>Choose a world to open Canon Studio.</div>;
  return <section className={styles.root} style={{'--canon-border':ensureContrast(theme.border,[theme.surface,theme.inputBg],3),'--canon-muted':theme.textMuted,'--canon-text':theme.text,'--canon-surface':theme.surface,'--canon-input':theme.inputBg,'--canon-accent':accent,'--canon-button-bg':theme.accent,'--canon-button-text':readableOn(theme.accent),'--canon-error':accessibleStatus.error,'--canon-warning':accessibleStatus.warning,'--canon-info':accessibleStatus.info,'--canon-success':accessibleStatus.success}}>
    <header className={styles.header}>
      <div className={styles.headerTitle}>
        <div className={styles.brandIcon}><BookOpenCheck size={27}/></div>
        <div><div className={styles.eyebrow}>FROSTFALL REALMS / {activeWorld?.name}</div>
          <h1>Canon Studio <span className={styles.version}>TRUTH ENGINE 2.0</span></h1>
          <p>Shape your world's history with explicit facts, evidence, branches, and explainable reviews.</p>
        </div>
      </div>
      <div className={styles.headerActions}>
        <button type="button" className={styles.actionSecondary} onClick={exportSnapshot} disabled={!loaded}><Download size={15}/> Export canon</button>
        <label className={styles.branchPicker} htmlFor="ff-canon-branch"><GitBranch size={15}/>
          <select id="ff-canon-branch" value={activeBranchId} disabled={loading} onChange={(e)=>{setActiveBranchId(e.target.value);setModal(null);}} aria-label="Canon branch">
            {data.branches.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select><ChevronDown size={14}/>
        </label>
        {canEdit&&<button type="button" className={styles.actionSecondary} onClick={()=>{setBranchName('');setModal('branch');}} disabled={loading}><GitBranch size={15}/> New branch</button>}
        {canEdit&&<button type="button" className={styles.actionPrimary} onClick={()=>openNewClaim()} disabled={loading||!branch}><Plus size={16}/> Add fact</button>}
      </div>
    </header>

    {data.mode==='local'&&!loading&&<div className={styles.modeNotice}><Info size={18}/><span><strong>Local-only workspace.</strong> No Supabase connection is configured. Claims are saved to this browser; export them before clearing browser storage. This is not a cloud backup.</span></div>}
    {!canEdit&&!loading&&<div className={styles.modeNotice}><LockKeyhole size={17}/> You have read-only access to this world's canon. Only an owner or editor may change facts or reviews.</div>}
    {!!message&&<div role="status" className={styles.successNotice}><Check size={17}/>{message}<button type="button" onClick={()=>setMessage('')} aria-label="Dismiss notification"><X size={16}/></button></div>}
    {!!error&&<div role="alert" className={styles.errorNotice}><AlertTriangle size={18}/><span>{error}{!loaded&&data.mode==='local'?' Apply the P2 canon migration to staging if using Supabase.':''}</span><button type="button" onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    {loading?<div className={styles.loading}><Loader2 size={24} className={styles.spin}/> Loading your world's canon records…</div>:(!loaded?<div className={styles.empty}><ShieldAlert size={36}/><h2>Canon database is not ready</h2><p>Check your staging migration, world permissions and connection. This screen will not silently replace cloud records with browser data.</p><button className={styles.actionSecondary} onClick={()=>window.location.reload()}><RefreshCcw size={16}/> Retry</button></div>:<>
      <div className={styles.statGrid}>
        <div className={styles.stat}><div className={styles.statLabel}><ScrollText size={16}/> Explicit assertions</div><strong>{claims.length}</strong><span>In {branch?.name||'selected branch'}</span></div>
        <div className={styles.stat}><div className={styles.statLabel}><ShieldCheck size={16}/> Established canon</div><strong>{evaluation.canonical}</strong><span>Author-approved statements</span></div>
        <div className={styles.stat}><div className={styles.statLabel}><ShieldAlert size={16}/> Needs review</div><strong>{pending.length}</strong><span>Outstanding integrity findings</span></div>
        <div className={styles.stat}><div className={styles.statLabel}><BookMarked size={16}/> Cited sources</div><strong>{data.sources.length}</strong><span>Evidence and author notes</span></div>
      </div>
      {focusedSubjectId&&<div role="status" className={styles.modeNotice}>
        <BookMarked size={17}/> Showing facts for <strong>{articles.find((a)=>a.id===focusedSubjectId)?.title || focusedSubjectId}</strong>.
        <button type="button" className={styles.textAction} onClick={()=>setFocusedSubjectId('')}>Show all world facts</button>
      </div>}
      <div className={styles.toolbar}>
        <div role="tablist" aria-label="Canon Studio views" className={styles.tabs}>
          {LENSES.map(([id,label,Icon])=><button key={id} role="tab" aria-selected={lens===id} className={lens===id?styles.tabActive:styles.tab} onClick={()=>setLens(id)}><Icon size={16}/>{label}{id==='review'&&pending.length>0&&<span className={styles.count}>{pending.length}</span>}</button>)}
        </div>
        <label className={styles.search}><Search size={16}/><input aria-label="Search the current canon view" placeholder="Search facts or findings…" value={query} onChange={(e)=>setQuery(e.target.value)}/></label>
      </div>
      {lens==='review'&&<div className={styles.content}>
        <div className={styles.sectionTitle}><div><h2>Integrity review queue</h2><p>Only explicit canonical claims are evaluated. References and memories never imply physical participation.</p></div></div>
        {filteredFindings.length===0?<div className={styles.empty}><ShieldCheck size={34}/><h3>No matching canon conflicts</h3><p>{claims.length===0?'Add or draft facts to begin building your verifiable history.':'Your active canon facts have no outstanding findings matching this search.'}</p></div>:<div className={styles.cards}>
          {filteredFindings.map((f)=><article className={styles.finding} key={f.id}>
            <div className={styles.findingHead}><span className={`${styles.severity} ${f.severity==='error'?styles.severityError:f.severity==='warning'?styles.severityWarning:styles.severityInfo}`}>
              {f.severity==='error'?<ShieldAlert size={15}/>:<CircleHelp size={15}/>} {f.severity.toUpperCase()} · {f.code.replaceAll('_',' ')}</span>
              <span className={styles.disposition}>{f.stale?'Changed since last review':DISPOSITION_LABELS[f.disposition]}</span>
            </div>
            <h3>{f.message}</h3><p className={styles.findingMeta}>Facts: {f.assertionIds.map((id)=>{
              const a=claims.find((v)=>v.id===id);return a?`${named(a.subjectId)} · ${a.predicate} (${period(a)})`:id;
            }).join(' / ')}</p>
            <p className={styles.findingMeta}>Evidence: {f.sourceIds.length?f.sourceIds.map(sourceNamed).join(', '):'No sources attached'}</p>
            {f.rationale&&<p className={styles.rationale}>Author note: {f.rationale}</p>}
            <div className={styles.rowActions}>
              {canEdit&&<button className={styles.textAction} onClick={()=>{setDecisionForm({finding:f,disposition:f.disposition==='open'?'acknowledged':f.disposition,rationale:f.rationale});setModal('disposition');}}><ClipboardCheck size={15}/>{f.disposition==='open'?'Review finding':'Edit review'}</button>}
              {canEdit&&f.disposition!=='open'&&<button className={styles.textAction} disabled={busy} onClick={()=>reopen(f)}><RefreshCcw size={15}/> Reopen</button>}
            </div>
          </article>)}
        </div>}
      </div>}
      {lens==='claims'&&<div className={styles.content}>
        <div className={styles.sectionTitle}><div><h2>Structured fact ledger</h2><p>Every fact belongs to one world and branch. Drafts, disputed accounts, and alternate histories are not silently promoted to canon.</p></div>
          <select className={styles.miniSelect} aria-label="Filter assertions by status" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="all">All statuses</option>{Object.keys(STATUS_LABELS).map((s)=><option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select>
        </div>
        {filteredClaims.length===0?<div className={styles.empty}><ScrollText size={34}/><h3>No recorded facts</h3><p>Create a fact manually, or start from a character's explicit birth or death year below.</p></div>:<div className={styles.claimRows}>{filteredClaims.map((a)=><article className={styles.claim} key={a.id}>
          <div className={styles.claimGlyph}><GitCompareArrows size={19}/></div><div className={styles.claimMain}><div><strong>{named(a.subjectId)}</strong> <span className={styles.predicate}>{a.predicate.replaceAll('_',' ')}</span> {a.objectId&&<strong>{named(a.objectId)}</strong>}</div>
          <div className={styles.claimMeta}>{period(a)} <span>·</span> {a.sourceIds.length} evidence source{a.sourceIds.length===1?'':'s'} {a.exclusive&&<><span>·</span> Exclusive</>}</div>{a.notes&&<p>{a.notes}</p>}</div>
          <div className={styles.claimRight}><span className={a.status==='canon'?styles.statusCanon:styles.statusDraft}>{STATUS_LABELS[a.status]||a.status}</span>{canEdit&&<button className={styles.iconButton} aria-label={`Edit ${named(a.subjectId)} assertion`} onClick={()=>openEditClaim(a)}><Pencil size={16}/></button>}</div>
        </article>)}</div>}
        {candidates.length>0&&<div className={styles.candidateBox}><div className={styles.sectionTitle}><div><h3><Sparkles size={17}/> Suggested from typed codex dates</h3><p>These are previews of existing structured fields, not new facts. Click one to open an editable draft.</p></div></div>
          <div className={styles.candidates}>{candidates.slice(0,25).map((c)=><button key={`${c.subjectId}-${c.predicate}-${c.from}`} disabled={!canEdit} onClick={()=>openNewClaim(c)}><span>{c.title} · {c.predicate} · {yearLabel(c.from)}</span><ArrowRight size={16}/></button>)}</div>
        </div>}
      </div>}
      {lens==='sources'&&<div className={styles.content}><div className={styles.sectionTitle}><div><h2>Evidence library</h2><p>Attach author notes, codex passages, citations, and imported source material to claims.</p></div>{canEdit&&<button className={styles.actionPrimary} onClick={()=>{setSourceForm(initialSource());setModal('source');}}><FilePlus2 size={16}/> Add source</button>}</div>
        {!data.sources.length?<div className={styles.empty}><FileText size={34}/><h3>No evidence sources yet</h3><p>Start with an author note or a passage from a codex entry. Sources are stored per world.</p></div>:<div className={styles.sourceGrid}>{data.sources.filter((s)=>!query.trim()||[s.title,s.excerpt,s.citation].join(' ').toLowerCase().includes(query.toLowerCase())).map((s)=><article key={s.id} className={styles.sourceCard}><div className={styles.sourceType}><FileText size={15}/>{s.kind.replace('_',' ')}</div><h3>{s.title}</h3>{s.excerpt&&<p>{s.excerpt.length>280?s.excerpt.slice(0,280)+'…':s.excerpt}</p>}{s.citation&&<div className={styles.claimMeta}>Citation: {s.citation}</div>}{s.articleId&&<button className={styles.textAction} onClick={()=>{const a=articles.find((a)=>a._uuid===s.articleId||a.id===s.articleId);if(a)navigate(a.id);}}><Link2 size={15}/> Open linked codex entry</button>}</article>)}</div>}
      </div>}
      {lens==='branches'&&<div className={styles.content}><div className={styles.sectionTitle}><div><h2>World histories & branches</h2><p>Create alternate timelines without overwriting main canon or making cross-branch conflicts.</p></div>{canEdit&&<button className={styles.actionPrimary} onClick={()=>{setBranchName('');setModal('branch');}}><Plus size={16}/> Add branch</button>}</div>
        <div className={styles.sourceGrid}>{data.branches.map((b)=><button type="button" key={b.id} className={b.id===activeBranchId?styles.branchActive:styles.branchCard} onClick={()=>{setActiveBranchId(b.id);setLens('claims');}}><GitBranch size={23}/><strong>{b.name}</strong><span>{data.assertions.filter((a)=>a.branchId===b.id).length} facts · {b.slug==='main'?'Primary history':'Alternate history'}</span>{b.id===activeBranchId&&<span className={styles.branchSelected}><Check size={14}/> Selected</span>}</button>)}</div>
      </div>}
    </>)}

    {modal&&<div className={styles.modalBackdrop} onMouseDown={(e)=>{if(e.target===e.currentTarget&&!busy)setModal(null);}}>
      <div role="dialog" aria-modal="true" aria-label={modal==='claim'?'Record a canon fact':modal==='source'?'Add a source':modal==='branch'?'Create a branch':'Review a finding'} className={styles.modal}>
        <div className={styles.modalHead}><div><div className={styles.eyebrow}>FROSTFALL / {branch?.name||'CANON'}</div><h2>{modal==='claim'?(claimForm.id?'Edit assertion':'Record a new fact'):modal==='source'?'Add evidence source':modal==='branch'?'Create a canon branch':'Review integrity finding'}</h2></div><button className={styles.iconButton} onClick={()=>{if(!busy){setModal(null);setError('');}}} aria-label="Close dialog"><X size={20}/></button></div>
        {!!error&&<div role="alert" className={styles.errorNotice}><AlertTriangle size={17}/>{error}</div>}
        {modal==='claim'&&<form className={styles.form} onSubmit={saveClaim}>
          <div className={styles.formGrid}><label>Codex subject <select required value={claimForm.subjectId} onChange={(e)=>setClaimForm({...claimForm,subjectId:e.target.value})}><option value="">Choose entry…</option>{articles.map((a)=><option key={a.id} value={a.id}>{a.title} · {a.category}</option>)}</select></label>
            <label>Relationship <select required value={claimForm.predicate} onChange={(e)=>setClaimForm({...claimForm,predicate:e.target.value,objectId:''})}>{PREDICATES.map((p)=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
            {PREDICATES.find((p)=>p.value===claimForm.predicate)?.object&&<label>Related codex entry <select required value={claimForm.objectId} onChange={(e)=>setClaimForm({...claimForm,objectId:e.target.value})}><option value="">Choose entry…</option>{articles.filter((a)=>a.id!==claimForm.subjectId).map((a)=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>}
            <label>Start year <input type="number" step="any" value={claimForm.from} onChange={(e)=>setClaimForm({...claimForm,from:e.target.value})} placeholder="e.g. 130"/></label>
            <label>End year (optional) <input type="number" step="any" value={claimForm.until} onChange={(e)=>setClaimForm({...claimForm,until:e.target.value})} placeholder="Same as start"/></label>
            <label>Canon status <select value={claimForm.status} onChange={(e)=>setClaimForm({...claimForm,status:e.target.value})}>{Object.entries(STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          <p className={styles.helpText}>{PREDICATES.find((p)=>p.value===claimForm.predicate)?.description}</p>
          {['rules','member_of','located_in'].includes(claimForm.predicate)&&<label className={styles.checkLine}><input type="checkbox" checked={!!claimForm.exclusive} onChange={(e)=>setClaimForm({...claimForm,exclusive:e.target.checked})}/> This role is mutually exclusive for the stated interval</label>}
          <fieldset className={styles.sourceSelect}><legend>Evidence sources (recommended)</legend>{!data.sources.length?<p>No sources recorded. Save this as draft or add evidence through the Evidence Library.</p>:<div>{data.sources.map((s)=><label key={s.id}><input type="checkbox" checked={claimForm.sourceIds?.includes(s.id)||false} onChange={(e)=>setClaimForm((prev)=>({...prev,sourceIds:e.target.checked?[...(prev.sourceIds||[]),s.id]:(prev.sourceIds||[]).filter((id)=>id!==s.id)}))}/>{s.title}</label>)}</div>}</fieldset>
          <label>Author explanation / exceptions <textarea rows={3} value={claimForm.notes} onChange={(e)=>setClaimForm({...claimForm,notes:e.target.value})} placeholder="Why this fact is established, or why a contradiction is intentional…"/></label>
          <p className={styles.helpText}><Info size={14}/> Only Canonical claims affect the integrity evaluator. Drafts and disputed accounts remain visible but are not treated as definitive.</p>
          <div className={styles.modalFooter}><button type="button" className={styles.actionSecondary} onClick={()=>setModal(null)}>Cancel</button><button disabled={busy} type="submit" className={styles.actionPrimary}><Save size={16}/>{busy?'Saving…':'Save assertion'}</button></div>
        </form>}
        {modal==='source'&&<form className={styles.form} onSubmit={saveSource}><label>Source title <input required maxLength={200} value={sourceForm.title} onChange={(e)=>setSourceForm({...sourceForm,title:e.target.value})} placeholder="e.g. Chronicle of the Northern Court"/></label>
          <div className={styles.formGrid}><label>Source type <select value={sourceForm.kind} onChange={(e)=>setSourceForm({...sourceForm,kind:e.target.value})}>{['author_note','codex','document','import'].map((k)=><option key={k} value={k}>{k.replace('_',' ')}</option>)}</select></label>
          <label>Linked article (optional) <select value={sourceForm.articleId} onChange={(e)=>setSourceForm({...sourceForm,articleId:e.target.value})}><option value="">No linked article</option>{articles.filter((a)=>data.mode==='local'||a._uuid).map((a)=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label></div>
          <label>Supporting excerpt <textarea rows={4} maxLength={12000} value={sourceForm.excerpt} onChange={(e)=>setSourceForm({...sourceForm,excerpt:e.target.value})} placeholder="The exact passage or your supporting note…"/></label>
          <label>Citation / location <input maxLength={2000} value={sourceForm.citation} onChange={(e)=>setSourceForm({...sourceForm,citation:e.target.value})} placeholder="Volume I, chapter 7; manuscript notes, etc."/></label>
          <div className={styles.modalFooter}><button type="button" className={styles.actionSecondary} onClick={()=>setModal(null)}>Cancel</button><button disabled={busy} type="submit" className={styles.actionPrimary}><Save size={16}/> {busy?'Saving…':'Save source'}</button></div>
        </form>}
        {modal==='branch'&&<form className={styles.form} onSubmit={saveBranch}><p className={styles.helpText}>Branches keep their own assertions. They cannot overwrite the history of another branch.</p><label>Branch name <input required minLength={2} maxLength={120} value={branchName} onChange={(e)=>setBranchName(e.target.value)} placeholder="e.g. The Sundering — alternate history"/></label><div className={styles.modalFooter}><button type="button" className={styles.actionSecondary} onClick={()=>setModal(null)}>Cancel</button><button disabled={busy} type="submit" className={styles.actionPrimary}><GitBranch size={16}/>{busy?'Creating…':'Create branch'}</button></div></form>}
        {modal==='disposition'&&<form className={styles.form} onSubmit={saveReview}><p className={styles.helpText}>{decisionForm.finding?.message}</p><label>Review decision <select value={decisionForm.disposition} onChange={(e)=>setDecisionForm({...decisionForm,disposition:e.target.value})}>{DISPOSITIONS.map((d)=><option key={d} value={d}>{DISPOSITION_LABELS[d]}</option>)}</select></label><label>Rationale <textarea rows={4} maxLength={4000} value={decisionForm.rationale} onChange={(e)=>setDecisionForm({...decisionForm,rationale:e.target.value})} placeholder="Record why this contradiction is accepted or dismissed…"/></label><p className={styles.helpText}><ShieldCheck size={14}/> Recording a review never rewrites or erases a canonical fact. A review becomes stale if the underlying facts change.</p><div className={styles.modalFooter}><button type="button" className={styles.actionSecondary} onClick={()=>setModal(null)}>Cancel</button><button disabled={busy} type="submit" className={styles.actionPrimary}><ClipboardCheck size={16}/>{busy?'Saving…':'Record review'}</button></div></form>}
      </div>
    </div>}
  </section>;
}
