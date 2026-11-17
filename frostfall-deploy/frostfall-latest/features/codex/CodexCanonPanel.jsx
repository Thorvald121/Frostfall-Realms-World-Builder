'use client';
import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, GitBranch, ShieldCheck, FileText, Plus, AlertCircle, ArrowRight, Link2 } from 'lucide-react';
import { loadCanonWorld } from '@/lib/domain/truth/v2/canonRepository';
import { ensureContrast, readableOn } from '@/lib/ui/contrast';
import styles from './CodexCanonPanel.module.css';

const statuses={canon:'Canonical',draft:'Draft',disputed:'Disputed',superseded:'Superseded',alternate:'Alternate'};
const readableValue=(value)=>{
  if(value==null)return '';
  if(typeof value==='string')return value;
  if(typeof value==='number')return String(value);
  try{return JSON.stringify(value);}catch{return '[Value]';}
};

/** Read-only, evidence-backed summary inside a Codex entry. Nothing is auto-promoted. */
export function CodexCanonPanel({worldId,article,theme,onOpenCanon,canEdit=true}) {
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{
    let active=true;
    setData(null);setError('');
    if(!worldId)return;
    loadCanonWorld(worldId).then((d)=>{if(active)setData(d);}).catch((e)=>{if(active)setError(e.message||'Unable to load canon.');});
    return()=>{active=false;};
  },[worldId,article?._uuid,article?.id]);
  const view=useMemo(()=>{
    if(!data)return {claims:[],sources:[],branch:null};
    const branch=data.branches.find((b)=>b.slug==='main') || data.branches[0];
    const claims=data.assertions.filter((c)=>{
      const linked = article?._uuid ? c.subjectUuid===article._uuid : c.subjectId===article?.id;
      return linked && c.branchId===branch?.id;
    });
    const usedIds=new Set(claims.flatMap((c)=>c.sourceIds||[]));
    return {branch,claims,sources:data.sources.filter((s)=>usedIds.has(s.id))};
  },[data,article?._uuid,article?.id]);
  const accent=ensureContrast(theme.accent,[theme.surface,theme.inputBg],4.5);
  const show=expanded?view.claims:view.claims.slice(0,4);
  return <section className={styles.root} aria-label="Canon facts for this entry"
    style={{'--codex-card':theme.surface,'--codex-text':theme.text,'--codex-muted':theme.textMuted,
      '--codex-border':ensureContrast(theme.border,[theme.surface],3),'--codex-accent':accent,
      '--codex-button':theme.accent,'--codex-button-text':readableOn(theme.accent)}}>
    <header className={styles.header}>
      <div className={styles.heading}><BookOpenCheck size={19}/><div><h2>Verified canon</h2><p>Structured facts and their sources for this entry</p></div></div>
      <div className={styles.actions}>
        <button type="button" onClick={()=>onOpenCanon(article,'inspect')}><GitBranch size={15}/> Open canon <ArrowRight size={14}/></button>
        {canEdit&&<button type="button" className={styles.primary} onClick={()=>onOpenCanon(article,'new')}><Plus size={15}/> Draft fact</button>}
      </div>
    </header>
    {error&&<div role="alert" className={styles.error}><AlertCircle size={16}/>{error}<button onClick={()=>onOpenCanon(article,'inspect')}>Open Canon Studio</button></div>}
    {!data&&!error&&<p className={styles.empty}>Loading established facts…</p>}
    {data&&<>
      <div className={styles.summary}><span><ShieldCheck size={15}/> {view.claims.filter((c)=>c.status==='canon').length} canonical</span><span>{view.claims.filter((c)=>c.status==='draft').length} drafts</span><span><FileText size={15}/>{view.sources.length} evidence sources</span><span>{view.branch?.name||'Main canon'}</span></div>
      {!view.claims.length?<p className={styles.empty}>No structured facts have been recorded for this entry. Existing prose remains untouched; add a draft assertion to begin verifying its lore.</p>
      :<div className={styles.factGrid}>{show.map((claim)=><div key={claim.id} className={styles.fact}>
        <div className={styles.factTop}><span className={styles.predicate}>{claim.predicate?.replaceAll('_',' ')}</span><span className={styles.status}>{statuses[claim.status]||'Unclassified'}</span></div>
        <p className={styles.value}>{claim.objectId||readableValue(claim.value)||claim.notes||'Recorded assertion'}</p>
        {claim.from!=null&&<small>Year {claim.from}{claim.until!=null && claim.until!==claim.from?` – ${claim.until}`:''}</small>}
        <div className={styles.provenance}><Link2 size={13}/>{claim.sourceIds?.length||0} linked source(s){!claim.sourceIds?.length?' · source needed':''}</div>
      </div>)}</div>}
      {view.claims.length>4&&<button type="button" className={styles.more} onClick={()=>setExpanded(!expanded)}>{expanded?'Show fewer facts':`Show all ${view.claims.length} facts`}</button>}
      {view.sources.length>0&&<div className={styles.evidence}><strong>Source evidence</strong>{view.sources.slice(0,4).map((source)=><p key={source.id}><FileText size={13}/><b>{source.title}</b>{source.citation&&<span> · {source.citation}</span>}{source.excerpt&&<span> — {source.excerpt.slice(0,140)}{source.excerpt.length>140?'…':''}</span>}</p>)}</div>}
    </>}
  </section>;
}
