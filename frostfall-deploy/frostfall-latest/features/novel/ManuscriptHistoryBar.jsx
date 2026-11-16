'use client';
import {useCallback,useState} from 'react';
import {Download,History,Cloud,CloudOff,RefreshCcw,AlertTriangle,Check,FileClock} from 'lucide-react';
import {fetchManuscriptRevision,listManuscriptRevisions} from '@/lib/domain/manuscripts/manuscriptRepository';
import {SaveRecoveryButton} from '@/components/ui/SaveRecoveryButton';
import {ensureContrast,readableOn} from '@/lib/ui/contrast';
import styles from './ManuscriptHistoryBar.module.css';

const labels={saved:'Cloud saved',saving:'Cloud saving…',browser:'Browser backup only',recovery:'Recovery requires a choice',conflict:'Cloud version conflict',error:'Save requires attention',loading:'Loading manuscripts…',idle:'Not yet synced'};
export function ManuscriptHistoryBar({worldId,worldName,manuscripts,theme,syncStatus,canEdit,onRestore}){
  const [open,setOpen]=useState(false);
  const [revisions,setRevisions]=useState([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const accent=ensureContrast(theme.accent,[theme.surface,theme.inputBg],4.5);
  const pull=useCallback(async()=>{setBusy(true);setError('');try{setRevisions(await listManuscriptRevisions(worldId));}catch(e){setError(e.message||'Could not load versions.');}finally{setBusy(false);}},[worldId]);
  const openVersions=()=>{if(!open)pull();setOpen(!open);};
  const restore=async(revision)=>{
    if(!canEdit)return;
    if(!window.confirm(`Restore revision ${revision} as a new manuscript save? Your current draft should be exported first. No history will be deleted.`))return;
    setBusy(true);setError('');
    try{const snapshot=await fetchManuscriptRevision(worldId,revision);onRestore(snapshot.manuscripts);setOpen(false);}
    catch(e){setError(e.message||'Unable to restore.');}
    finally{setBusy(false);}
  };
  return <section className={styles.wrapper} style={{'--ms-surface':theme.surface,'--ms-border':ensureContrast(theme.border,[theme.surface],3),'--ms-text':theme.text,'--ms-muted':theme.textMuted,'--ms-accent':accent,'--ms-primary':theme.accent,'--ms-primary-text':readableOn(theme.accent)}} aria-label="Manuscript save and history">
    <div className={styles.row}>
      <span className={styles.status} role="status" aria-live="polite">{syncStatus==='saved'?<Check size={16}/>:syncStatus==='browser'?<CloudOff size={16}/>:<Cloud size={16}/>} {labels[syncStatus]||labels.idle}</span>
      <span className={styles.note}>Cloud snapshots are revision-checked; browser recovery is kept locally.</span>
      <div className={styles.actions}>
        <SaveRecoveryButton fileName={`frostfall-${String(worldId).replace(/[^a-z0-9_-]/gi,'-')}-manuscript-export.json`}
          getContent={()=>JSON.stringify({format:'frostfall-manuscript-recovery',version:3,worldId,worldName,savedAt:new Date().toISOString(),manuscripts})}
          style={{border:'1px solid var(--ms-border)',borderRadius:8,padding:'8px 10px',color:'var(--ms-text)',background:'var(--ms-surface)',cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontSize:12}}><Download size={15}/> Export</SaveRecoveryButton>
        <button type="button" onClick={openVersions} className={styles.button} aria-expanded={open}><History size={15}/> Versions</button>
      </div>
    </div>
    {open&&<div className={styles.history}>
      <div className={styles.historyTitle}><FileClock size={16}/><strong>Cloud revision history</strong><button className={styles.button} onClick={pull} disabled={busy}><RefreshCcw size={14}/> Refresh</button></div>
      {busy&&<p>Loading…</p>}
      {error&&<p role="alert" className={styles.error}><AlertTriangle size={15}/>{error}</p>}
      {!busy&&!error&&!revisions.length&&<p>No cloud revision history yet. Local-only worlds use browser backups and the Export button.</p>}
      {!busy&&revisions.map((r)=><div className={styles.historyRow} key={r.revision}>
        <span>Revision {r.revision}</span><time>{new Date(r.saved_at).toLocaleString()}</time>
        {canEdit&&<button className={styles.button} onClick={()=>restore(r.revision)} disabled={busy}>Restore as new revision</button>}
      </div>)}
    </div>}
  </section>;
}
