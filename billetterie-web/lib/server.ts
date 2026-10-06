import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

export const now=()=>Date.now(), uid=()=>crypto.randomUUID();
export const runtime=env as unknown as Record<string,any>;
export const demo=()=>runtime.DEMO_MODE!=='false'&&!runtime.STRIPE_SECRET_KEY;
export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
export function requireValue(value:any,status:number,message:string):asserts value {if(!value)throw new HttpError(status,message);}
export function database():D1Database {requireValue(runtime.DB,503,'Le stockage est indisponible. Réessayez dans un instant.');return runtime.DB;}
export const stmt=(sql:string,...params:any[])=>database().prepare(sql).bind(...params);
export async function rows(sql:string,...params:any[]):Promise<any[]>{return (await stmt(sql,...params).all()).results||[];}
export async function one(sql:string,...params:any[]):Promise<any>{return stmt(sql,...params).first();}
export const emailSchema=z.string().trim().email().max(200).transform(v=>v.toLowerCase());
export function response(data:any,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
function base64(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
const b64url=(bytes:Uint8Array)=>base64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const unb64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export const randomToken=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
async function hash(s:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));}
export const origin=(request?:Request)=>runtime.APP_URL||(request&&import.meta.env.DEV?new URL(request.url).origin:'https://billetterie-collectifs-dioulo.bold-llama-1352.chatgpt.site');
export async function audit(actor:string,action:string,subject:string,collectiveId:string|null,detail:any={}){await stmt('INSERT INTO audit(id,collective_id,actor,action,subject,detail,created_at) VALUES(?,?,?,?,?,?,?)',uid(),collectiveId,actor,action,subject,JSON.stringify(detail),now()).run();}
export function job(kind:string,payload:any,id=uid(),changedOnly=false){return stmt("INSERT OR IGNORE INTO jobs(id,kind,payload,status,attempts,next_at,created_at) "+(changedOnly?"SELECT ?,?,?,'pending',0,?,? WHERE changes()=1":"VALUES(?,?,?,'pending',0,?,?)"),id,kind,JSON.stringify(payload),now(),now());}
export async function initialize(request:Request){
 if(await one("SELECT value FROM settings WHERE key='initialized'"))return;
 requireValue(demo()||(runtime.ADMIN_EMAIL&&request.headers.get('oai-authenticated-user-email')?.toLowerCase()===runtime.ADMIN_EMAIL.toLowerCase()),503,'L’administrateur doit initialiser la billetterie.');
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 await database().batch([
 stmt("INSERT OR IGNORE INTO settings(key,value) VALUES('sign_private',?)",JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey))),
 stmt("INSERT OR IGNORE INTO settings(key,value) VALUES('sign_public',?)",JSON.stringify(await crypto.subtle.exportKey('jwk',pair.publicKey)))]);
 if(!demo()){await stmt("INSERT OR IGNORE INTO settings(key,value) VALUES('initialized','true')").run();return;}
 await database().batch([stmt("INSERT OR IGNORE INTO collectives(id,name,color,created_at) VALUES('c1','Collectif Onde','#132a3b',?)",now()),
 stmt("INSERT OR IGNORE INTO collectives(id,name,color,created_at) VALUES('c2','Les Échappées','#6d4baa',?)",now()),
 stmt("INSERT OR IGNORE INTO collectives(id,name,color,created_at) VALUES('c3','Atelier Commun','#b8512b',?)",now())]);
 const examples=[['e1','c1','Nuit des ondes','Concert · Live & DJ sets','La Marbrerie, Montreuil','2027-04-17T20:00:00+02:00',240,60,2200,3000],['e2','c1','Les sessions du dimanche','Concert · Scène acoustique','Le Sample, Bagnolet','2027-04-25T17:00:00+02:00',100,20,1600,2400],['e3','c1','Au bord du son','Concert · Électronique','La Station, Paris','2027-05-15T21:00:00+02:00',400,100,2400,3800],['e4','c2','La grande échappée','Spectacle · Danse & performance','Théâtre des Roches, Montreuil','2027-04-10T19:00:00+02:00',120,40,2000,2800],['e5','c3','Les ateliers ouverts','Rencontre · Création collective','La Halle, Paris','2027-04-03T14:00:00+02:00',60,20,1200,1800]];
 for(const [id,c,name,desc,loc,date,capacity,balcony,p1,p2] of examples as any[]){
 const start=Date.parse(date);
 await database().batch([stmt("INSERT OR IGNORE INTO events(id,collective_id,name,description,location,timezone,starts_at,doors_at,cancel_until,status,created_at) VALUES(?,?,?,?,?,'Europe/Paris',?,?,?,'on_sale',?)",id,c,name,desc,loc,start,start-3600000,start-172800000,now()),
 stmt("INSERT OR IGNORE INTO ticket_types(id,event_id,name,price,capacity,early_price,early_until) VALUES(?,?,'Fosse',?,?,?,?)",id+'-t1',id,p1,capacity,p1-400,start-14*86400000),
 stmt("INSERT OR IGNORE INTO ticket_types(id,event_id,name,price,capacity) VALUES(?,?,'Balcon',?,?)",id+'-t2',id,p2,balcony)]);
 }
 await stmt("INSERT OR IGNORE INTO settings(key,value) VALUES('initialized','true')").run();
}
export async function identity(request:Request){
 const email=request.headers.get('oai-authenticated-user-email')?.toLowerCase();
 if(import.meta.env.DEV&&demo()&&['localhost','127.0.0.1'].includes(new URL(request.url).hostname))return 'local@demo.test';
 requireValue(email,401,'Connectez-vous pour accéder à votre espace.');return email;
}
export async function access(request:Request,collectiveId?:string,adminOnly=false){
 const email=await identity(request);await initialize(request);
 if(demo())return {email,admin:true,demo:true};
 const admin=!!runtime.ADMIN_EMAIL&&email===runtime.ADMIN_EMAIL.toLowerCase();
 const memberships=await rows('SELECT * FROM members WHERE email=?',email);
 requireValue(admin||memberships.length,403,'Vous ne faites pas partie de ce collectif.');
 const token=/passage_session=([^;]+)/.exec(request.headers.get('cookie')||'')?.[1];
 const session=token&&await one('SELECT * FROM sessions WHERE token=? AND email=? AND expires_at>?',token,email,now());
 requireValue(session,428,'Confirmez votre connexion avec le code reçu par e-mail.');
 requireValue(!adminOnly||admin,403,'Cette action est réservée à l’administrateur.');
 requireValue(!collectiveId||admin||memberships.some(m=>m.collective_id===collectiveId&&m.role==='organizer'),403,'Ce collectif est inaccessible.');
 return {email,admin,demo:false};
}
export async function auth(request:Request,action:string,data:any){
 const email=await identity(request);
 requireValue(!demo(),400,'La démonstration ne nécessite pas de code.');
 requireValue(email===(runtime.ADMIN_EMAIL||'').toLowerCase()||await one('SELECT id FROM members WHERE email=?',email),403,'Vous ne faites pas partie de cet espace.');
 if(action==='request'){
 requireValue(runtime.RESEND_API_KEY&&runtime.MAIL_FROM,503,'L’envoi des codes de connexion n’est pas encore configuré.');
 const recent=await one('SELECT count(*) n FROM challenges WHERE email=? AND expires_at>?',email,now()+9*60000);
 requireValue(recent.n<3,429,'Attendez une minute avant de demander un nouveau code.');
 const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0'),id=uid();
 await stmt('INSERT INTO challenges(id,email,code_hash,expires_at) VALUES(?,?,?,?)',id,email,await hash(id+code),now()+600000).run();
 await sendEmail({to:email,subject:'Votre code de connexion Passage',text:'Votre code : '+code+'. Valable 10 minutes. Ne le communiquez à personne.'},'otp-'+id);
 return response({id});
 }
 const id=z.string().uuid().parse(data.id),code=z.string().regex(/^\d{6}$/).parse(data.code);
 const c=await one('SELECT * FROM challenges WHERE id=? AND email=?',id,email);
 requireValue(c&&c.expires_at>now()&&!c.used&&c.attempts<5,400,'Ce code a expiré. Demandez-en un nouveau.');
 await stmt('UPDATE challenges SET attempts=attempts+1 WHERE id=?',id).run();
 requireValue(c.code_hash===await hash(id+code),400,'Code incorrect.');
 const claim=await stmt('UPDATE challenges SET used=1 WHERE id=? AND used=0 AND attempts<=5',id).run();
 requireValue(claim.meta.changes,400,'Ce code a déjà été utilisé.');
 const token=randomToken();await stmt('INSERT INTO sessions(token,email,expires_at) VALUES(?,?,?)',token,email,now()+8*3600000).run();
 const res=response({ok:true});
 res.headers.set('Set-Cookie','passage_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800'+(import.meta.env.DEV?'':'; Secure'));return res;
}
export async function signTicket(eventId:string,ticketId:string){
 const payload=b64url(new TextEncoder().encode(JSON.stringify({e:eventId,t:ticketId})));
 const key=JSON.parse((await one("SELECT value FROM settings WHERE key='sign_private'")).value);
 const privateKey=await crypto.subtle.importKey('jwk',key,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,new TextEncoder().encode(payload));
 return 'PASS1.'+payload+'.'+b64url(new Uint8Array(sig));
}
export async function verifyTicket(code:string){
 try{
 const [prefix,payload,sig,...extra]=code.split('.');
 requireValue(prefix==='PASS1'&&payload&&sig&&!extra.length,400,'Code invalide.');
 const pub=JSON.parse((await one("SELECT value FROM settings WHERE key='sign_public'")).value);
 const key=await crypto.subtle.importKey('jwk',pub,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 requireValue(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unb64(sig),new TextEncoder().encode(payload)),400,'Signature invalide.');
 return JSON.parse(new TextDecoder().decode(unb64(payload)));
 }catch{throw new HttpError(400,'Code invalide ou modifié.');}
}
export async function publicEvents(id?:string){
 const events=await rows("SELECT e.*,c.name collective_name,c.color FROM events e JOIN collectives c ON c.id=e.collective_id WHERE e.status<>'draft'"+(id?' AND e.id=?':'')+' ORDER BY e.starts_at',...(id?[id]:[]));
 for(const e of events)e.types=await rows("SELECT t.id,t.event_id,t.name,t.price,t.early_price,t.early_until,min(t.capacity,?) waitlist_limit,CASE WHEN EXISTS(SELECT 1 FROM waitlist w WHERE w.type_id=t.id AND w.status='waiting') THEN 0 ELSE t.capacity-t.held-t.sold END available FROM ticket_types t WHERE event_id=?",e.max_quantity,e.id);
 return events;
}
export async function maintenance(){
 const expired=await rows("SELECT id,email,token,event_id,checkout_id FROM orders WHERE status='pending' AND expires_at<=?",now());
 for(const o of expired)await database().batch([stmt("UPDATE orders SET status='expired' WHERE id=? AND status='pending' AND expires_at<=?",o.id,now()),job('email',{to:o.email,subject:'Votre réservation a expiré',text:'Les places non payées ont été libérées. Vous pouvez consulter la billetterie pour réserver à nouveau.'},'expired-'+o.id),...(o.checkout_id?[job('expire_checkout',{checkoutId:o.checkout_id,eventId:o.event_id},'expire-checkout-'+o.id)]:[])]);
 await stmt("UPDATE waitlist SET status='expired' WHERE status='offered' AND order_id IN (SELECT id FROM orders WHERE status IN ('expired','cancelled'))").run();
 const active=await rows("SELECT t.*,e.starts_at,e.doors_at,e.wait_hours,e.urgent_wait_hours FROM ticket_types t JOIN events e ON e.id=t.event_id WHERE e.status='on_sale' AND e.doors_at>?",now());
 for(const t of active)for(let n=0;n<20;n++){
 const head=await one("SELECT * FROM waitlist WHERE type_id=? AND status='waiting' ORDER BY created_at,id LIMIT 1",t.id);if(!head)break;
 const stock=await one('SELECT capacity-held-sold available FROM ticket_types WHERE id=?',t.id);if(stock.available<head.quantity)break;
 const o={id:uid(),token:randomToken(),expires:now()+(t.starts_at-now()<=172800000?t.urgent_wait_hours:t.wait_hours)*3600000};
 const price=t.early_until>now()&&t.early_price!==null?t.early_price:t.price;
 try{await database().batch([
 stmt("INSERT INTO orders(id,event_id,email,name,token,total,expires_at,created_at,demo) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM waitlist WHERE id=? AND status='waiting')",o.id,t.event_id,head.email,head.name,o.token,price*head.quantity,o.expires,now(),demo()?1:0,head.id),
 stmt("UPDATE waitlist SET status='offered',order_id=? WHERE id=? AND status='waiting'",o.id,head.id),
 stmt("INSERT INTO order_items(id,order_id,type_id,quantity,unit_price) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)",uid(),o.id,t.id,head.quantity,price,o.id),
 job('email',{to:head.email,subject:'Des places sont disponibles : '+t.name,text:'Vos '+head.quantity+' places vous sont réservées jusqu’au '+new Date(o.expires).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})+'. Retrouvez votre réservation : '+origin()+'/commande/'+o.token},'offer-'+head.id)]);
 }catch(e){if(String(e).includes('STOCK'))break;throw e;}
 }
 await stmt("UPDATE waitlist SET status='closed' WHERE status='waiting' AND type_id IN (SELECT t.id FROM ticket_types t JOIN events e ON e.id=t.event_id WHERE e.doors_at<=? OR e.status='cancelled')",now()).run();
 const reminders=await rows("SELECT o.id,o.email,o.token,e.name FROM orders o JOIN events e ON e.id=o.event_id WHERE o.status='paid' AND e.starts_at>? AND e.starts_at<=? AND e.status<>'cancelled'",now(),now()+86400000);
 if(reminders.length)await database().batch(reminders.map(o=>job('email',{to:o.email,subject:'À demain : '+o.name,text:'Retrouvez vos billets : '+origin()+'/commande/'+o.token},'reminder-'+o.id)));
}
export async function reserve(data:any){
 const input=z.object({eventId:z.string(),email:emailSchema,name:z.string().trim().min(1).max(120),items:z.array(z.object({typeId:z.string(),quantity:z.number().int().positive().max(20)})).min(1).max(10)}).parse(data);
 await maintenance();
 const event=await one('SELECT * FROM events WHERE id=?',input.eventId);
 requireValue(event&&event.status==='on_sale'&&event.doors_at>now(),409,'La réservation est fermée pour cet événement.');
 const qty=input.items.reduce((s,i)=>s+i.quantity,0);requireValue(qty<=event.max_quantity,400,'Maximum '+event.max_quantity+' places par commande.');
 requireValue(new Set(input.items.map(i=>i.typeId)).size===input.items.length,400,'Type de place présent deux fois.');
 const o={id:uid(),token:randomToken(),expires:now()+event.hold_minutes*60000,total:0},parts=[];
 for(const i of input.items){
 const type=await one('SELECT * FROM ticket_types WHERE id=? AND event_id=?',i.typeId,event.id);requireValue(type,404,'Type de place introuvable.');
 requireValue(!await one("SELECT id FROM waitlist WHERE type_id=? AND status='waiting' LIMIT 1",i.typeId),409,'Les places sont proposées en priorité à la liste d’attente.');
 const price=type.early_until>now()&&type.early_price!==null?type.early_price:type.price;o.total+=price*i.quantity;
 parts.push(stmt('INSERT INTO order_items(id,order_id,type_id,quantity,unit_price) VALUES(?,?,?,?,?)',uid(),o.id,type.id,i.quantity,price));
 }
 try{await database().batch([stmt("INSERT INTO orders(id,event_id,email,name,token,total,expires_at,created_at,demo) VALUES(?,?,?,?,?,?,?,?,?)",o.id,event.id,input.email,input.name,o.token,o.total,o.expires,now(),demo()?1:0),...parts]);}
 catch(e){if(String(e).includes('STOCK'))throw new HttpError(409,'Ces places viennent d’être réservées. Choisissez une autre quantité.');throw e;}return o;
}
export async function getOrder(token:string){
 const o=await one('SELECT * FROM orders WHERE token=?',token);requireValue(o,404,'Lien de commande invalide.');
 const event=(await publicEvents(o.event_id))[0];
 const items=await rows('SELECT i.*,t.name type_name FROM order_items i JOIN ticket_types t ON t.id=i.type_id WHERE order_id=?',o.id);
 const tickets=await rows('SELECT b.*,t.name type_name FROM tickets b JOIN ticket_types t ON t.id=b.type_id WHERE order_id=?',o.id);
 for(const t of tickets)t.qr=await QRCode.toDataURL(t.code,{width:280,margin:2,errorCorrectionLevel:'M'});
 return {...o,event,items,tickets};
}
async function stripe(path:string,params:URLSearchParams,account:string,idempotency:string){
 requireValue(runtime.STRIPE_SECRET_KEY,503,'Les paiements par carte ne sont pas encore activés.');
 const res=await fetch('https://api.stripe.com/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+runtime.STRIPE_SECRET_KEY,'Stripe-Account':account,'Idempotency-Key':idempotency,'Content-Type':'application/x-www-form-urlencoded'},body:params});
 const result:any=await res.json();requireValue(res.ok,502,result.error?.message||'Le prestataire de paiement est indisponible.');return result;
}
export async function accountFor(eventId:string){const c=await one('SELECT c.* FROM collectives c JOIN events e ON e.collective_id=c.id WHERE e.id=?',eventId);requireValue(c?.stripe_account,503,'Le compte d’encaissement de ce collectif reste à configurer.');return c.stripe_account;}
export async function checkout(request:Request,token:string){
 const o=await getOrder(token);requireValue(o.status==='pending'&&o.expires_at>now(),409,'La réservation a expiré.');
 if(o.total===0){await completePayment(o.id,'free-'+o.id,0);return {free:true};}
 if(demo()){await identity(request);await completePayment(o.id,'demo-'+o.id,o.total);return {demo:true};}
 const account=await accountFor(o.event_id);
 const params=new URLSearchParams({mode:'payment','payment_method_types[0]':'card',customer_email:o.email,client_reference_id:o.id,'metadata[order_id]':o.id,success_url:origin(request)+'/commande/'+token+'?retour=1',cancel_url:origin(request)+'/commande/'+token,locale:'fr'});
 for(let i=0;i<o.items.length;i++){const line=o.items[i];params.set('line_items['+i+'][price_data][currency]','eur');params.set('line_items['+i+'][price_data][unit_amount]',String(line.unit_price));params.set('line_items['+i+'][price_data][product_data][name]',o.event.name+' · '+line.type_name);params.set('line_items['+i+'][quantity]',String(line.quantity));}
 const session=await stripe('checkout/sessions',params,account,'checkout-'+o.id);await stmt('UPDATE orders SET checkout_id=? WHERE id=?',session.id,o.id).run();return {url:session.url};
}
export async function completePayment(orderId:string,paymentId:string,amount:number){
 await maintenance();
 const o=await one('SELECT * FROM orders WHERE id=?',orderId);requireValue(o,404,'Commande inconnue.');
 requireValue(Number.isInteger(amount)&&amount===o.total,400,'Le montant du paiement ne correspond pas à la commande.');
 if(await one('SELECT id FROM payments WHERE id=?',paymentId))return {duplicate:true};
 if(o.payment_id&&o.payment_id!==paymentId){await database().batch([stmt("INSERT OR IGNORE INTO payments(id,order_id,amount,status,created_at) VALUES(?,?,?,'refund_pending',?)",paymentId,o.id,amount,now()),job('refund',{paymentId,amount,eventId:o.event_id,orderId:o.id,late:true},'late-'+paymentId)]);return {refundPending:true};}
 const event=await one('SELECT * FROM events WHERE id=?',o.event_id),parts:any[]=[];
 for(const line of await rows('SELECT * FROM order_items WHERE order_id=?',o.id))for(let n=0;n<line.quantity;n++){const id=uid();parts.push(stmt("INSERT INTO tickets(id,order_id,type_id,code) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND status='paid')",id,o.id,line.type_id,await signTicket(o.event_id,id),o.id));}
 try{
 requireValue(event.status!=='cancelled'&&!['cancelled','refunded'].includes(o.status),409,'Commande annulée.');
 await database().batch([stmt("INSERT INTO payments(id,order_id,amount,status,created_at) VALUES(?,?,?,'paid',?)",paymentId,o.id,amount,now()),stmt("UPDATE orders SET status='paid',payment_id=?,paid_at=? WHERE id=? AND status IN ('pending','expired')",paymentId,now(),o.id),...parts,stmt("UPDATE waitlist SET status='fulfilled' WHERE order_id=?",o.id),job('confirmation',{orderId:o.id},'confirmation-'+o.id)]);
 return {paid:true};
 }catch(e){
 if(await one('SELECT id FROM payments WHERE id=?',paymentId))return {duplicate:true};
 if(!String(e).includes('STOCK')&&!String(e).includes('PAYMENT_DUPLICATE')&&!(e instanceof HttpError))throw e;
 await database().batch([stmt("INSERT OR IGNORE INTO payments(id,order_id,amount,status,created_at) VALUES(?,?,?,'refund_pending',?)",paymentId,o.id,amount,now()),job('refund',{paymentId,amount,eventId:o.event_id,orderId:o.id,late:true},'late-'+paymentId)]);return {refundPending:true};
 }
}
export async function webhook(request:Request){
 requireValue(runtime.STRIPE_WEBHOOK_SECRET,503,'Notifications de paiement non configurées.');
 const raw=await request.text();requireValue(raw.length<262144,413,'Notification trop volumineuse.');
 const header=request.headers.get('stripe-signature')||'',timestamp=header.split(',').find(p=>p.startsWith('t='))?.slice(2),signatures=header.split(',').filter(p=>p.startsWith('v1=')).map(p=>p.slice(3));
 requireValue(timestamp&&Math.abs(now()/1000-Number(timestamp))<=300,400,'Notification expirée.');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(runtime.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);let valid=false;
 for(const hex of signatures){if(!/^[a-f0-9]{64}$/.test(hex))continue;const bytes=Uint8Array.from(hex.match(/../g)!,h=>parseInt(h,16));if(await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+raw)))valid=true;}
 requireValue(valid,400,'Signature de paiement invalide.');
 const notification=JSON.parse(raw),session=notification.data?.object;
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(notification.type)&&session.payment_status==='paid'){
 const order=await one('SELECT * FROM orders WHERE id=?',session.client_reference_id);requireValue(order,404,'Commande inconnue.');
 requireValue(session.currency==='eur'&&notification.account===await accountFor(order.event_id)&&order.checkout_id===session.id&&!order.demo,400,'Notification incohérente.');
 await completePayment(order.id,session.payment_intent,session.amount_total);
 }return response({received:true});
}
export async function cancelTicket(ticketId:string,token:string|undefined,actor:any){
 const ticket=await one('SELECT b.*,o.token,o.event_id,o.payment_id,o.demo,o.email,o.id order_id,i.unit_price,e.cancel_until,e.collective_id FROM tickets b JOIN orders o ON o.id=b.order_id JOIN events e ON e.id=o.event_id JOIN order_items i ON i.order_id=o.id AND i.type_id=b.type_id WHERE b.id=?',ticketId);requireValue(ticket,404,'Billet introuvable.');
 if(token){requireValue(ticket.token===token,403,'Lien invalide.');requireValue(now()<ticket.cancel_until,409,'Le délai d’annulation est dépassé.');requireValue(!ticket.scanned_at,409,'Un billet déjà utilisé ne peut plus être annulé.');}else requireValue(actor,403,'Accès refusé.');
 const amount=ticket.unit_price;
 const out=await database().batch([stmt("UPDATE tickets SET status='cancelled',refund_amount=? WHERE id=? AND status='valid'",amount,ticketId),job('refund',{paymentId:ticket.payment_id,amount,eventId:ticket.event_id,orderId:ticket.order_id,ticketId,demo:ticket.demo},'refund-'+ticketId,true)]);
 if(out[0].meta.changes)await audit(actor?.email||ticket.email,'cancel_ticket',ticketId,ticket.collective_id,{amount});await maintenance();return {ok:true};
}
export async function scanner(request:Request,token:string){
 const link=await one('SELECT s.*,e.name,e.timezone,e.starts_at FROM scanner_links s JOIN events e ON e.id=s.event_id WHERE token=?',token);
 requireValue(link&&link.valid_from<=now()&&link.valid_until>now(),403,'Ce lien de contrôle est invalide ou hors de sa période de validité.');return link;
}
export async function scan(token:string,code:string,deviceId:string,at?:number){
 const link=await scanner(new Request(origin()),token),parsed=await verifyTicket(code);requireValue(parsed.e===link.event_id,409,'Ce billet concerne un autre événement.');
 const ticket=await one('SELECT b.*,t.name type_name FROM tickets b JOIN ticket_types t ON t.id=b.type_id WHERE b.id=? AND b.code=?',parsed.t,code);requireValue(ticket&&ticket.status==='valid',409,'Ce billet est annulé ou inconnu.');
 const scannedAt=at&&Number.isFinite(at)?Math.max(link.valid_from,Math.min(now(),at)):now();
 const result=await stmt("UPDATE tickets SET scanned_at=?,device_id=? WHERE id=? AND status='valid' AND scanned_at IS NULL",scannedAt,deviceId,ticket.id).run();
 if(!result.meta.changes){const existing=await one('SELECT scanned_at,device_id FROM tickets WHERE id=?',ticket.id);return {ok:false,reason:'Déjà scanné à '+new Date(existing.scanned_at).toLocaleTimeString('fr-FR',{timeZone:link.timezone,hour:'2-digit',minute:'2-digit'}),scannedAt:existing.scanned_at,id:ticket.id,sameDevice:existing.device_id===deviceId};}
 return {ok:true,type:ticket.type_name,id:ticket.id,scannedAt};
}
export async function pdfTickets(order:any){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const safe=(s:any)=>String(s||'').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7e\xa0-\xff]/g,'');
 for(const ticket of order.tickets){
 const page=pdf.addPage([420,595]);page.drawRectangle({x:0,y:505,width:420,height:90,color:rgb(.075,.165,.23)});
 page.drawText('PASSAGE',{x:28,y:552,size:16,font:bold,color:rgb(.89,.96,.47)});page.drawText(safe(order.event.name).slice(0,36),{x:28,y:518,size:20,font:bold,color:rgb(1,1,1)});
 const lines=[new Date(order.event.starts_at).toLocaleString('fr-FR',{timeZone:order.event.timezone}),order.event.location,ticket.type_name,'Billet '+ticket.id.slice(0,8).toUpperCase(),ticket.status==='cancelled'?'BILLET ANNULE':order.demo?'DEMONSTRATION - SANS VALEUR':'Une seule entree'];
 lines.forEach((line,i)=>page.drawText(safe(line),{x:28,y:465-i*24,size:12,font}));
 const png=await pdf.embedPng(await QRCode.toDataURL(ticket.code,{width:300,margin:2}));page.drawImage(png,{x:90,y:95,width:240,height:240});page.drawText('Conservez ce billet hors connexion.',{x:28,y:45,size:11,font});
 }return pdf.save();
}
export function calendar(event:any){
 const esc=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'),date=(n:number)=>new Date(n).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Passage//Billetterie//FR','BEGIN:VEVENT','UID:'+event.id+'@passage','DTSTAMP:'+date(now()),'DTSTART:'+date(event.starts_at),'DTEND:'+date(event.starts_at+3*3600000),'SUMMARY:'+esc(event.name),'LOCATION:'+esc(event.location),'END:VEVENT','END:VCALENDAR',''].join('\r\n');
}
async function sendEmail(payload:any,id:string){
 if(demo())return;requireValue(runtime.RESEND_API_KEY&&runtime.MAIL_FROM,503,'L’envoi des e-mails n’est pas configuré.');
 const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+runtime.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:runtime.MAIL_FROM,...payload})});requireValue(res.ok,502,'Échec de l’envoi du message.');
}
export async function processJobs(limit=20){
 const pending=await rows("SELECT * FROM jobs WHERE (status='pending' AND next_at<=?) OR (status='processing' AND next_at<=?) ORDER BY CASE WHEN kind='refund' THEN 0 ELSE 1 END,created_at LIMIT ?",now(),now(),limit);
 for(const task of pending){
 const claim=await stmt("UPDATE jobs SET status='processing',next_at=? WHERE id=? AND ((status='pending' AND next_at<=?) OR (status='processing' AND next_at<=?))",now()+300000,task.id,now(),now()).run();if(!claim.meta.changes)continue;
 try{
 const p=JSON.parse(task.payload);
 if(task.kind==='email')await sendEmail(p,task.id);
 if(task.kind==='confirmation'){
 if(demo()){await stmt("UPDATE jobs SET status='done',error=NULL WHERE id=?",task.id).run();continue;}
 const o=await one('SELECT token FROM orders WHERE id=?',p.orderId),order=await getOrder(o.token);
 await sendEmail({to:order.email,subject:'Vos billets : '+order.event.name,text:'Votre commande est confirmée. Retrouvez vos billets ou annulez une place depuis votre lien personnel : '+origin()+'/commande/'+order.token,attachments:[{filename:'billets.pdf',content:base64(await pdfTickets(order))},{filename:'evenement.ics',content:base64(new TextEncoder().encode(calendar(order.event)))}]},task.id);
 }
 if(task.kind==='expire_checkout'&&!demo())await stripe('checkout/sessions/'+p.checkoutId+'/expire',new URLSearchParams(),await accountFor(p.eventId),task.id);
 if(task.kind==='refund'){
 const order=await one('SELECT * FROM orders WHERE id=?',p.orderId);
 if(p.amount>0&&!p.demo&&!order.demo){const r=await stripe('refunds',new URLSearchParams({payment_intent:p.paymentId,amount:String(p.amount)}),await accountFor(p.eventId),task.id);requireValue(r.status==='succeeded',502,'Remboursement en attente chez le prestataire.');}
 await database().batch([stmt('UPDATE orders SET refunded=refunded+? WHERE id=?',p.amount,p.orderId),stmt("UPDATE payments SET status='refunded' WHERE id=? AND status='refund_pending'",p.paymentId),stmt("UPDATE jobs SET status='done',error=NULL WHERE id=?",task.id)]);
 await stmt("UPDATE orders SET status='refunded' WHERE id=? AND status='paid' AND NOT EXISTS(SELECT 1 FROM tickets WHERE order_id=? AND status='valid')",p.orderId,p.orderId).run();
 await database().batch([job('email',{to:order.email,subject:p.late?'Paiement reçu après expiration — remboursement':'Annulation et remboursement',text:p.late?'Les places n’étaient plus disponibles lors du paiement. Votre paiement a été remboursé.':'Votre billet a été annulé. Le remboursement de '+(p.amount/100).toFixed(2)+' € a été effectué.'},task.id+'-email')]);continue;
 }
 await stmt("UPDATE jobs SET status='done',error=NULL WHERE id=?",task.id).run();
 }catch(error){await stmt("UPDATE jobs SET status='pending',attempts=attempts+1,next_at=?,error=? WHERE id=?",now()+Math.min(3600000,30000*2**Math.min(task.attempts,7)),String(error).slice(0,300),task.id).run();}
 }
}
