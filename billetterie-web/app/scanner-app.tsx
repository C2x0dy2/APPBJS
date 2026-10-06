'use client';
import { useState,useEffect,useRef } from 'react';
import { ScanLine,Wifi,WifiOff,Download,Users,Check,X,Camera,RefreshCw,Ticket } from 'lucide-react';
import { api,date } from '@/lib/client';
import { cachedEvent,cacheEvent,pendingScans,offlineScan,finishScan,mergeScanResult,offlineAvailability } from '@/lib/offline';
import type { ScannerManifest,PendingScan,ScanResult } from '@/lib/offline';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
function message(error:unknown){return error instanceof Error?error.message:'La synchronisation n’a pas abouti. Le journal reste sur ce téléphone.';}
function completeResult(value:unknown,record:PendingScan):value is ScanResult{
 if(!value||typeof value!=='object')return false;
 const result=value as ScanResult;
 if(typeof result.ok!=='boolean'||(result.id!==undefined&&result.id!==record.ticketId)||(result.code!==undefined&&result.code!==record.code))return false;
 if(result.scannedAt!==undefined&&!Number.isFinite(result.scannedAt))return false;
 return result.ok?result.id===record.ticketId&&Number.isFinite(result.scannedAt):typeof result.reason==='string'&&result.reason.length>0;
}
type SyncOutcome={remaining:number;processed:number;warnings:string[]};
export default function Scanner({token}:{token:string}){
 const [data,setData]=useState<ScannerManifest|null>(null),[online,setOnline]=useState(true),[pending,setPending]=useState<PendingScan[]>([]),[error,setError]=useState(''),[queueMessage,setQueueMessage]=useState(''),[result,setResult]=useState<ScanResult|null>(null),[search,setSearch]=useState(''),[manual,setManual]=useState(''),[camera,setCamera]=useState(false),[busy,setBusy]=useState(false),[syncing,setSyncing]=useState(false),[clock,setClock]=useState(()=>Date.now());
 const cameraRef=useRef<import('html5-qrcode').Html5Qrcode|null>(null),locked=useRef(false),dataRef=useRef<ScannerManifest|null>(null),deviceRef=useRef(''),scanRef=useRef<(code:string)=>void>(()=>{}),activeTokenRef=useRef<string|null>(null);
 const syncTaskRef=useRef<{token:string;promise:Promise<SyncOutcome>}|null>(null),scanTaskRef=useRef<Promise<void>|null>(null);
 const queue=pending.length;
 function showManifest(next:ScannerManifest){if(activeTokenRef.current===token){dataRef.current=next;setData(next);}}
 async function localState(){
  const [next,scans]=await Promise.all([cachedEvent(token),pendingScans(token)]);
  if(activeTokenRef.current===token){if(next)showManifest(next);setPending(scans);}
  return scans;
 }
 async function prepare(){
  const current=dataRef.current,time=Date.now();
  // Cached expired lists remain visible for upload; never renew their scan access.
  if(current&&(time>=current.validUntil||(Number.isFinite(current.validFrom)&&time<current.validFrom!)))return;
  const next:ScannerManifest=await api('scanner/'+token+'/prepare',{
   deviceId:deviceRef.current,
   ...(current?.syncToken&&current.deviceId===deviceRef.current?{syncToken:current.syncToken}:{}),
  });
  await cacheEvent(token,next);showManifest(next);
 }
 function sync():Promise<SyncOutcome>{
  if(syncTaskRef.current?.token===token)return syncTaskRef.current.promise;
  const previousScan=scanTaskRef.current;
  const promise=(async()=>{
   if(activeTokenRef.current===token)setSyncing(true);
   let processed=0;
   const warnings:string[]=[];
   try{
    if(previousScan)await previousScan;
    const scans=await pendingScans(token);
    if(activeTokenRef.current===token)setPending(scans);
    const groups=new Map<string,{deviceId:string;syncToken:string;scans:PendingScan[]}>();
    let legacy=0,expired=0;
    for(const record of scans){
     if(!record.syncToken||!record.deviceId||!Number.isFinite(record.syncUntil)){legacy++;continue;}
     if((record.syncUntil??0)<=Date.now()){expired++;continue;}
     const key=JSON.stringify([record.deviceId,record.syncToken]);
     const group=groups.get(key)||{deviceId:record.deviceId,syncToken:record.syncToken,scans:[]};
     group.scans.push(record);groups.set(key,group);
    }
    if(legacy)warnings.push(legacy+' scan(s) proviennent d’une ancienne préparation et ne peuvent pas être envoyés automatiquement. Le journal est conservé ; faites vérifier ces entrées par l’organisateur.');
    if(expired)warnings.push('Le délai d’envoi est dépassé pour '+expired+' scan(s). Le journal est conservé ; faites vérifier ces entrées par l’organisateur.');
    if(navigator.onLine){
     for(const group of groups.values()){
      for(let offset=0;offset<group.scans.length;offset+=600){
       const batch=group.scans.slice(offset,offset+600);
       try{
        const response=await api('scanner/'+token+'/sync',{deviceId:group.deviceId,syncToken:group.syncToken,scans:batch.map(record=>({code:record.code,at:record.at}))});
        const results:unknown[]=response?.results;
        if(!Array.isArray(results)||results.length!==batch.length||!results.every((value,index)=>completeResult(value,batch[index]))){
         throw new Error('La réponse de synchronisation est incomplète. Les scans restent dans le journal pour une nouvelle tentative.');
        }
        for(let index=0;index<batch.length;index++){
         const observed=results[index] as ScanResult;
         if(await finishScan(batch[index].key,observed,batch[index])){
          processed++;
          if(!observed.ok&&!observed.sameDevice)toast.error('Conflit de synchronisation : '+observed.reason);
         }
        }
       }catch(error){warnings.push(message(error));break;}
      }
      if(!navigator.onLine)break;
     }
     await localState();
     try{await prepare();}catch(error){warnings.push(message(error));}
    }
    const remaining=(await localState()).length;
    if(activeTokenRef.current===token){setQueueMessage([...new Set(warnings)].join(' '));if(!warnings.length)setError('');}
    return {remaining,processed,warnings};
   }finally{if(activeTokenRef.current===token)setSyncing(false);}
  })();
  syncTaskRef.current={token,promise};
  void promise.finally(()=>{if(syncTaskRef.current?.promise===promise)syncTaskRef.current=null;}).catch(()=>{});
  return promise;
 }
 useEffect(()=>{
  activeTokenRef.current=token;dataRef.current=null;
  try{deviceRef.current=localStorage.getItem('passage-scanner-device')||crypto.randomUUID();localStorage.setItem('passage-scanner-device',deviceRef.current);}catch{deviceRef.current=crypto.randomUUID();}
  localState().then(()=>{
   if(activeTokenRef.current===token){setResult(null);setQueueMessage('');setError('');setOnline(navigator.onLine);setClock(Date.now());}
   return sync();
  }).catch(error=>{if(activeTokenRef.current===token)setError(message(error));});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/scanner-sw.js').then(async()=>{
   await import('html5-qrcode');const registration=await navigator.serviceWorker.ready;
   const urls=[location.href,...performance.getEntriesByType('resource').map(entry=>entry.name)];
   registration.active?.postMessage({type:'PREPARE',urls});
  }).catch(()=>toast.error('Le chargement de la page hors connexion n’a pas pu être préparé.'));
  const onConnect=()=>{setOnline(true);sync().catch(error=>setError(message(error)));},onDisconnect=()=>setOnline(false);
  window.addEventListener('online',onConnect);window.addEventListener('offline',onDisconnect);
  const timer=setInterval(()=>{if(navigator.onLine)sync().catch(error=>setError(message(error)));},15000);
  const clockTimer=setInterval(()=>setClock(Date.now()),1000);
  return ()=>{
   if(activeTokenRef.current===token)activeTokenRef.current=null;
   clearInterval(timer);clearInterval(clockTimer);window.removeEventListener('online',onConnect);window.removeEventListener('offline',onDisconnect);
   const scanner=cameraRef.current;cameraRef.current=null;if(scanner)scanner.stop().catch(()=>{});
  };
 },[token]);
 async function read(code:string){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');
  const previousSync=syncTaskRef.current?.token===token?syncTaskRef.current.promise:null;
  const task=(async()=>{
   try{
    if(previousSync)await previousSync;
    const windowError=offlineAvailability(dataRef.current);if(windowError)throw new Error(windowError);
    const scans=await pendingScans(token),existing=scans.find(record=>record.code===code);
    if(existing)throw new Error('Déjà scanné sur ce téléphone à '+new Date(existing.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}));
    let observed:ScanResult;
    if(navigator.onLine){
     try{observed=await api('scanner/'+token,{code,deviceId:deviceRef.current});}
     catch(error){if(error instanceof Error&&'status' in error)throw error;observed=await offlineScan(token,code,dataRef.current);}
    }else observed=await offlineScan(token,code,dataRef.current);
    if(!observed.pending&&observed.id&&dataRef.current){
     const next=mergeScanResult(dataRef.current,observed.id,observed);await cacheEvent(token,next);showManifest(next);
    }
    setResult(observed);
    if(observed.ok&&navigator.vibrate)navigator.vibrate(100);else if(navigator.vibrate)navigator.vibrate([80,80,80]);
    await localState();
   }catch(error){setResult({ok:false,reason:message(error)});}finally{setBusy(false);setTimeout(()=>{locked.current=false;},1800);}
  })();
  scanTaskRef.current=task;
  try{await task;}finally{if(scanTaskRef.current===task)scanTaskRef.current=null;}
 }
 useEffect(()=>{scanRef.current=read;});
 async function stopCamera(){
  const scanner=cameraRef.current;cameraRef.current=null;setCamera(false);
  if(scanner)try{await scanner.stop();}catch{}
 }
 async function startCamera(){
  setError('');
  try{
   const windowError=offlineAvailability(dataRef.current);if(windowError)throw new Error(windowError);
   const {Html5Qrcode}=await import('html5-qrcode');
   const afterLoadError=offlineAvailability(dataRef.current);if(afterLoadError)throw new Error(afterLoadError);
   const scanner=new Html5Qrcode('qr-reader');cameraRef.current=scanner;setCamera(true);
   await scanner.start({facingMode:'environment'},{fps:8,qrbox:{width:240,height:240}},code=>scanRef.current(code),()=>{});
   if(activeTokenRef.current!==token||offlineAvailability(dataRef.current)){await stopCamera();}
  }catch{await stopCamera();setError(offlineAvailability(dataRef.current)||'Caméra indisponible. Autorisez son accès ou utilisez la recherche manuelle.');}
 }
 const controlsOpen=!offlineAvailability(data,clock),closed=!!data&&clock>=data.validUntil;
 useEffect(()=>{if(!controlsOpen&&cameraRef.current)void stopCamera();},[controlsOpen]);
 const queuedIds=new Set(pending.map(record=>record.ticketId));
 const entered=data?.tickets.filter(ticket=>ticket.status==='valid'&&(ticket.scanned_at!==null&&ticket.scanned_at!==undefined||queuedIds.has(ticket.id))).length||0,total=data?.tickets.filter(ticket=>ticket.status==='valid').length||0;
 const matches=search.trim().length>1?data?.tickets.filter(ticket=>((ticket.name||'')+' '+(ticket.email||'')+' '+ticket.id).toLowerCase().includes(search.toLowerCase())).slice(0,25):[];
 const syncUntil=Math.max(data?.syncUntil||0,...pending.map(record=>record.syncUntil||0));
 return <div className="scanner-app"><header className="scanner-header"><span className="brand"><span className="brand-mark"><Ticket size={22}/></span>passage</span><span className={'network-status '+(online?'online':'offline')}>{online?<Wifi size={17}/>:<WifiOff size={17}/>} {online?'Connecté':'Hors connexion'}</span></header><main className="scanner-main"><p className="eyebrow">CONTRÔLE À L’ENTRÉE</p><h1>{data?.event.name||'Préparer le contrôle'}</h1><div className="scanner-count"><strong>{entered}</strong><span>/ {total} entrées{queue>0?' · '+queue+' à synchroniser':''}</span><button className="icon-button" aria-label="Actualiser et synchroniser" disabled={busy||syncing||!online} onClick={()=>sync().then(outcome=>{if(outcome.warnings.length||outcome.remaining)toast.warning('Certains scans restent à synchroniser. Consultez le message affiché.');else toast.success('Billets synchronisés.');}).catch(error=>setError(message(error)))}><RefreshCw size={20}/></button></div>{error&&<p className="form-error" role="alert">{error}</p>}{queueMessage&&<p className="form-error" role="alert">{queueMessage}</p>}{data&&<>
 {closed&&<div className="info-note" role="status"><ScanLine size={22}/><p><strong>Contrôle fermé.</strong> Aucun nouveau scan n’est autorisé.{syncUntil>clock?<> Les scans enregistrés avant la fermeture peuvent encore être envoyés jusqu’au {date(syncUntil,data.event.timezone,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}.</>:<> Le délai d’envoi est terminé. Les scans non envoyés restent enregistrés sur ce téléphone.</>}</p></div>}
 {!closed&&!controlsOpen&&<p className="form-error" role="status">{offlineAvailability(data,clock)}</p>}
 <div className="offline-info"><Download size={18}/><span>{total} billets préparés sur ce téléphone · {date(data.fetchedAt,'Europe/Paris',{hour:'2-digit',minute:'2-digit'})}</span></div>
 <div className={'scan-result '+(result?result.ok?'accepted':'rejected':'ready')} role="status" aria-live="assertive">{result?result.ok?<><Check size={46}/><h2>Entrée validée</h2><strong>{result.type}</strong><p>{result.pending?'Enregistrée sur ce téléphone · synchronisation en attente':'Billet vérifié'}</p></>:<><X size={46}/><h2>Entrée refusée</h2><p>{result.reason}</p></>:<><ScanLine size={44}/><h2>Prêt à scanner</h2><p>Présentez le QR code devant la caméra.</p></>}</div>
 <div id="qr-reader" className={camera?'camera-reader':'camera-reader hidden-reader'}/>
 <button className="button primary full-width" disabled={busy||syncing||!controlsOpen} onClick={camera?stopCamera:startCamera}><Camera size={19}/>{camera?'Arrêter la caméra':'Ouvrir la caméra'}</button>
 <details className="manual-scan"><summary>Scanner un code copié</summary><form onSubmit={e=>{e.preventDefault();read(manual.trim());}}><textarea value={manual} disabled={syncing||!controlsOpen} onChange={e=>setManual(e.target.value)} placeholder="PASS1.…" aria-label="Code du billet" rows={2}/><button className="button secondary" disabled={busy||syncing||!controlsOpen||!manual}>Vérifier</button></form></details>
 <section className="manual-search"><h2><Users size={20}/>Recherche manuelle</h2><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom, e-mail ou numéro de billet" aria-label="Rechercher un participant"/>{matches?.map(t=><div className="scanner-person" key={t.id}><div><strong>{t.name}</strong><small>{t.email} · {t.type_name}</small><small>{t.status==='cancelled'?'Annulé':t.scanned_at!==null&&t.scanned_at!==undefined?'Déjà entré':'Billet '+t.id.slice(0,8).toUpperCase()}</small></div><button className="button secondary" disabled={busy||syncing||!controlsOpen||t.status!=='valid'} onClick={()=>read(t.code)}>Valider</button></div>)}{search.length>1&&!matches?.length&&<p>Aucun participant trouvé.</p>}</section>
 <p className="scanner-limitation">Sans réseau, utilisez un seul téléphone pour contrôler l’entrée : les téléphones ne partagent leurs scans qu’après synchronisation. Les annulations récentes seront prises en compte au retour du réseau.</p>
 </>}{!data&&!error&&<p>Téléchargement de la liste des billets…</p>}</main><Toaster position="top-center" richColors/></div>;
}
