'use client';
import { useState,useEffect,useRef } from 'react';
import { ScanLine,Wifi,WifiOff,Download,Users,Check,X,Camera,RefreshCw,Ticket } from 'lucide-react';
import { api,date } from '@/lib/client';
import { cachedEvent,cacheEvent,pendingScans,offlineScan,finishScan } from '@/lib/offline';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
export default function Scanner({token}:any){
 const [data,setData]=useState<any>(null),[online,setOnline]=useState(true),[queue,setQueue]=useState(0),[error,setError]=useState(''),[result,setResult]=useState<any>(null),[search,setSearch]=useState(''),[manual,setManual]=useState(''),[camera,setCamera]=useState(false),[busy,setBusy]=useState(false);
 const cameraRef=useRef<any>(null),locked=useRef(false),dataRef=useRef<any>(null),deviceRef=useRef(''),scanRef=useRef<(code:string)=>void>(()=>{});
 async function refresh(){const next=await api('scanner/'+token);await cacheEvent(token,next);setData(next);dataRef.current=next;setError('');return next;}
 async function sync(){
 if(!navigator.onLine)return;
 const scans=await pendingScans(token);setQueue(scans.length);
 if(scans.length){const r=await api('scanner/'+token+'/sync',{deviceId:deviceRef.current,scans:scans.map(s=>({code:s.code,at:s.at}))});for(let i=0;i<scans.length;i++){await finishScan(scans[i].key,r.results[i]);if(!r.results[i].ok&&!r.results[i].sameDevice)toast.error('Conflit de synchronisation : '+r.results[i].reason);}setQueue(0);}
 await refresh();
 }
 useEffect(()=>{
 setOnline(navigator.onLine);
 try{deviceRef.current=localStorage.getItem('passage-scanner-device')||crypto.randomUUID();localStorage.setItem('passage-scanner-device',deviceRef.current);}catch{deviceRef.current=crypto.randomUUID();}
 cachedEvent(token).then(c=>{if(c&&c.validUntil>Date.now()){setData(c);dataRef.current=c;}return sync();}).catch(e=>setError(navigator.onLine?e.message:'Téléchargez les billets avec une connexion avant le contrôle.'));
 pendingScans(token).then(s=>setQueue(s.length));
 if('serviceWorker'in navigator)navigator.serviceWorker.register('/scanner-sw.js').then(async()=>{await import('html5-qrcode');const registration=await navigator.serviceWorker.ready;const urls=[location.href,...performance.getEntriesByType('resource').map((e:any)=>e.name)];registration.active?.postMessage({type:'PREPARE',urls});}).catch(()=>toast.error('Le chargement de la page hors connexion n’a pas pu être préparé.'));
 const onConnect=()=>{setOnline(true);sync().catch(e=>setError(e.message));},onDisconnect=()=>setOnline(false);
 window.addEventListener('online',onConnect);window.addEventListener('offline',onDisconnect);
 const timer=setInterval(()=>{if(navigator.onLine)sync().catch(()=>{});},15000);
 return ()=>{clearInterval(timer);window.removeEventListener('online',onConnect);window.removeEventListener('offline',onDisconnect);if(cameraRef.current)cameraRef.current.stop().catch(()=>{});};
 },[token]);
 async function read(code:string){
 if(locked.current)return;locked.current=true;setBusy(true);setError('');
 try{
 let r:any;const pending=await pendingScans(token);const existing=pending.find(s=>s.code===code);if(existing)throw new Error('Déjà scanné sur ce téléphone à '+new Date(existing.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}));
 if(navigator.onLine){try{r=await api('scanner/'+token,{code,deviceId:deviceRef.current});refresh().catch(()=>{});}catch(e:any){if(e.status)throw e;r=await offlineScan(token,code,dataRef.current);}}
 else r=await offlineScan(token,code,dataRef.current);
 setResult(r);if(r.ok&&navigator.vibrate)navigator.vibrate(100);else if(navigator.vibrate)navigator.vibrate([80,80,80]);
 setQueue((await pendingScans(token)).length);
 }catch(e:any){setResult({ok:false,reason:e.message});}finally{setBusy(false);setTimeout(()=>{locked.current=false;},1800);}
 }
 scanRef.current=read;
 async function startCamera(){
 setError('');
 try{const {Html5Qrcode}=await import('html5-qrcode');const scanner=new Html5Qrcode('qr-reader');cameraRef.current=scanner;setCamera(true);await scanner.start({facingMode:'environment'},{fps:8,qrbox:{width:240,height:240}},code=>scanRef.current(code),()=>{});}
 catch(e){setCamera(false);setError('Caméra indisponible. Autorisez son accès ou utilisez la recherche manuelle.');}
 }
 const entered=(data?.tickets.filter((t:any)=>t.status==='valid'&&t.scanned_at).length||0)+queue,total=data?.tickets.filter((t:any)=>t.status==='valid').length||0;
 const matches=search.trim().length>1?data?.tickets.filter((t:any)=>(t.name+' '+t.email+' '+t.id).toLowerCase().includes(search.toLowerCase())).slice(0,25):[];
 return <div className="scanner-app"><header className="scanner-header"><span className="brand"><span className="brand-mark"><Ticket size={22}/></span>passage</span><span className={'network-status '+(online?'online':'offline')}>{online?<Wifi size={17}/>:<WifiOff size={17}/>} {online?'Connecté':'Hors connexion'}</span></header><main className="scanner-main"><p className="eyebrow">CONTRÔLE À L’ENTRÉE</p><h1>{data?.event.name||'Préparer le contrôle'}</h1><div className="scanner-count"><strong>{entered}</strong><span>/ {total} entrées{queue>0?' · '+queue+' à synchroniser':''}</span><button className="icon-button" aria-label="Actualiser et synchroniser" disabled={busy||!online} onClick={()=>sync().then(()=>toast.success('Billets synchronisés.')).catch(e=>setError(e.message))}><RefreshCw size={20}/></button></div>{error&&<p className="form-error" role="alert">{error}</p>}{data&&<>
 <div className="offline-info"><Download size={18}/><span>{total} billets préparés sur ce téléphone · {date(data.fetchedAt,'Europe/Paris',{hour:'2-digit',minute:'2-digit'})}</span></div>
 <div className={'scan-result '+(result?result.ok?'accepted':'rejected':'ready')} role="status" aria-live="assertive">{result?result.ok?<><Check size={46}/><h2>Entrée validée</h2><strong>{result.type}</strong><p>{result.pending?'Enregistrée sur ce téléphone · synchronisation en attente':'Billet vérifié'}</p></>:<><X size={46}/><h2>Entrée refusée</h2><p>{result.reason}</p></>:<><ScanLine size={44}/><h2>Prêt à scanner</h2><p>Présentez le QR code devant la caméra.</p></>}</div>
 <div id="qr-reader" className={camera?'camera-reader':'camera-reader hidden-reader'}/>
 <button className="button primary full-width" disabled={busy} onClick={camera?async()=>{await cameraRef.current.stop();setCamera(false);}:startCamera}><Camera size={19}/>{camera?'Arrêter la caméra':'Ouvrir la caméra'}</button>
 <details className="manual-scan"><summary>Scanner un code copié</summary><form onSubmit={e=>{e.preventDefault();read(manual.trim());}}><textarea value={manual} onChange={e=>setManual(e.target.value)} placeholder="PASS1.…" aria-label="Code du billet" rows={2}/><button className="button secondary" disabled={busy||!manual}>Vérifier</button></form></details>
 <section className="manual-search"><h2><Users size={20}/>Recherche manuelle</h2><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom, e-mail ou numéro de billet" aria-label="Rechercher un participant"/>{matches?.map((t:any)=><div className="scanner-person" key={t.id}><div><strong>{t.name}</strong><small>{t.email} · {t.type_name}</small><small>{t.status==='cancelled'?'Annulé':t.scanned_at?'Déjà entré':'Billet '+t.id.slice(0,8).toUpperCase()}</small></div><button className="button secondary" disabled={busy||t.status!=='valid'} onClick={()=>read(t.code)}>Valider</button></div>)}{search.length>1&&!matches?.length&&<p>Aucun participant trouvé.</p>}</section>
 <p className="scanner-limitation">Sans réseau, utilisez un seul téléphone pour contrôler l’entrée : les téléphones ne partagent leurs scans qu’après synchronisation. Les annulations récentes seront prises en compte au retour du réseau.</p>
 </>}{!data&&!error&&<p>Téléchargement de la liste des billets…</p>}</main><Toaster position="top-center" richColors/></div>;
}
