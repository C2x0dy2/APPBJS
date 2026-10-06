const DB_NAME='passage-scanner-v1';
function openDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{r.result.createObjectStore('events');r.result.createObjectStore('scans',{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function cacheEvent(token:string,data:any){const db=await openDb();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('events','readwrite');tx.objectStore('events').put(data,token);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);});}
export async function cachedEvent(token:string){const db=await openDb();return new Promise<any>((resolve,reject)=>{const tx=db.transaction('events'),r=tx.objectStore('events').get(token);r.onsuccess=()=>{db.close();resolve(r.result);};r.onerror=()=>reject(r.error);});}
export async function pendingScans(token:string){const db=await openDb();return new Promise<any[]>((resolve,reject)=>{const r=db.transaction('scans').objectStore('scans').getAll();r.onsuccess=()=>{db.close();resolve(r.result.filter((s:any)=>s.token===token&&!s.synced));};r.onerror=()=>reject(r.error);});}
export async function finishScan(key:string,result:any){const db=await openDb();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('scans','readwrite'),s=tx.objectStore('scans'),r=s.get(key);r.onsuccess=()=>{if(r.result)s.put({...r.result,synced:true,result});};tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);});}
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function offlineScan(token:string,code:string,data:any){
 if(!data||data.validUntil<=Date.now())throw new Error('La liste téléchargée a expiré. Reconnectez ce téléphone.');
 const [prefix,payload,sig,...rest]=code.split('.');
 if(prefix!=='PASS1'||!payload||!sig||rest.length)throw new Error('Code invalide.');
 let decoded:any;
 try{const key=await crypto.subtle.importKey('jwk',data.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decode(sig),new TextEncoder().encode(payload)))throw 0;decoded=JSON.parse(new TextDecoder().decode(decode(payload)));}catch{throw new Error('Code invalide ou modifié.');}
 if(decoded.e!==data.event.id)throw new Error('Ce billet concerne un autre événement.');
 const ticket=data.tickets.find((t:any)=>t.id===decoded.t&&t.code===code);
 if(!ticket||ticket.status!=='valid')throw new Error('Billet annulé ou inconnu.');
 if(ticket.scanned_at)throw new Error('Déjà scanné à '+new Date(ticket.scanned_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:data.event.timezone}));
 const db=await openDb(),at=Date.now(),record={key:token+':'+ticket.id,token,code,at,synced:false,ticketId:ticket.id};
 return new Promise<any>((resolve,reject)=>{const tx=db.transaction('scans','readwrite'),store=tx.objectStore('scans'),r=store.get(record.key);
 r.onsuccess=()=>{if(r.result){tx.abort();reject(new Error('Déjà scanné sur ce téléphone à '+new Date(r.result.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})));}else store.add(record);};
 tx.oncomplete=()=>{db.close();resolve({ok:true,type:ticket.type_name,id:ticket.id,scannedAt:at,pending:true});};tx.onerror=()=>reject(tx.error);});
}
