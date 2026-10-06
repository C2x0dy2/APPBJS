import { z } from 'zod';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { access,identity,initialize,maintenance,processJobs,publicEvents,reserve,getOrder,checkout,webhook,scanner,scan,cancelTicket,calendar,pdfTickets,database,stmt,rows,one,response,requireValue,HttpError,emailSchema,now,uid,randomToken,demo,runtime,auth,audit,job,origin } from '@/lib/server';
export const dynamic='force-dynamic';

async function eventAccess(request:Request,id:string){
 const event=await one('SELECT * FROM events WHERE id=?',id);requireValue(event,404,'Événement introuvable.');
 const user=await access(request,event.collective_id);return {event,user};
}
async function dashboard(request:Request,collectiveId:string){
 const initial=await access(request);
 if(!collectiveId){const allowed=initial.admin?await one('SELECT id FROM collectives ORDER BY created_at LIMIT 1'):await one('SELECT collective_id id FROM members WHERE email=? ORDER BY collective_id LIMIT 1',initial.email);if(!allowed&&initial.admin)return {collectiveId:'',events:[],collectives:[],orders:[],waiting:[],trend:[],members:[],activity:[],failures:[],user:initial,mode:demo()?'demo':'live',configured:{payment:!!runtime.STRIPE_SECRET_KEY,email:!!runtime.RESEND_API_KEY}};requireValue(allowed,404,'Aucun collectif accessible.');collectiveId=allowed.id;}
 const user=await access(request,collectiveId);await maintenance();
 const events=await rows('SELECT * FROM events WHERE collective_id=? ORDER BY starts_at',collectiveId);
 for(const e of events){
 e.types=await rows("SELECT t.*,capacity-held-sold available,(SELECT coalesce(sum(w.quantity),0) FROM waitlist w WHERE w.type_id=t.id AND w.status='waiting') waiting FROM ticket_types t WHERE event_id=?",e.id);
 e.money=await one("SELECT (SELECT coalesce(sum(p.amount),0) FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.event_id=?) gross,(SELECT coalesce(sum(refunded),0) FROM orders WHERE event_id=?) refunded",e.id,e.id);
 e.entries=(await one('SELECT count(*) n FROM tickets b JOIN orders o ON o.id=b.order_id WHERE o.event_id=? AND b.status=\'valid\' AND scanned_at IS NOT NULL',e.id)).n;
 }
 const collectives=user.admin?await rows('SELECT * FROM collectives ORDER BY created_at'):await rows('SELECT c.* FROM collectives c JOIN members m ON m.collective_id=c.id WHERE m.email=?',user.email);
 const orders=await rows("SELECT o.*,e.name event_name,(SELECT sum(quantity) FROM order_items WHERE order_id=o.id) quantity FROM orders o JOIN events e ON e.id=o.event_id WHERE e.collective_id=? ORDER BY o.created_at DESC LIMIT 200",collectiveId);
 const waiting=await rows("SELECT w.*,t.name type_name,e.name event_name,e.id event_id FROM waitlist w JOIN ticket_types t ON t.id=w.type_id JOIN events e ON e.id=t.event_id WHERE e.collective_id=? ORDER BY w.created_at,w.id",collectiveId);
 const trend=await rows("SELECT date(o.paid_at/1000,'unixepoch') day,sum(o.total) amount,(SELECT sum(i.quantity) FROM order_items i WHERE i.order_id=o.id) quantity FROM orders o JOIN events e ON e.id=o.event_id WHERE e.collective_id=? AND o.paid_at IS NOT NULL GROUP BY day ORDER BY day",collectiveId);
 const members=user.admin?await rows('SELECT * FROM members WHERE collective_id=?',collectiveId):[];
 const activity=await rows('SELECT * FROM audit WHERE collective_id=? ORDER BY created_at DESC LIMIT 40',collectiveId);
 const failures=user.admin?await rows("SELECT id,kind,attempts,error,status FROM jobs WHERE status<>'done' ORDER BY created_at LIMIT 30"):[];
 return {collectiveId,events,collectives,orders,waiting,trend,members,activity,failures,user,mode:demo()?'demo':'live',configured:{payment:!!runtime.STRIPE_SECRET_KEY,email:!!runtime.RESEND_API_KEY}};
}
const eventSchema=z.object({
 name:z.string().trim().min(2).max(120),description:z.string().max(1500).default(''),location:z.string().trim().min(2).max(200),timezone:z.string().default('Europe/Paris'),
 startsAt:z.number().int(),doorsAt:z.number().int(),cancelUntil:z.number().int(),status:z.enum(['draft','on_sale','finished','cancelled']).default('draft'),
 holdMinutes:z.number().int().min(5).max(60).default(15),maxQuantity:z.number().int().min(1).max(20).default(6),waitHours:z.number().int().min(1).max(48).default(12),urgentWaitHours:z.number().int().min(1).max(12).default(2),
 types:z.array(z.object({id:z.string().optional(),name:z.string().trim().min(1).max(80),price:z.number().int().nonnegative().max(100000),capacity:z.number().int().min(1).max(10000),earlyPrice:z.number().int().nonnegative().nullable().optional(),earlyUntil:z.number().int().nullable().optional()})).min(2).max(10)
});
async function saveEvent(request:Request,data:any,id?:string){
 const collectiveId=z.string().parse(data.collectiveId),user=await access(request,collectiveId);
 const input=eventSchema.parse(data);
 try{new Intl.DateTimeFormat('fr-FR',{timeZone:input.timezone});}catch{throw new HttpError(400,'Fuseau horaire invalide.');}
 requireValue(input.doorsAt<=input.startsAt&&input.cancelUntil<input.startsAt,400,'Les dates d’ouverture et d’annulation doivent précéder l’événement.');
 requireValue(input.types.every(t=>t.earlyPrice==null||(t.earlyPrice<=t.price&&!!t.earlyUntil&&t.earlyUntil<input.startsAt)),400,'Le tarif early et sa date limite sont invalides.');
 const eventId=id||uid(),commands:any[]=[];
 let existing:any;
 if(id){
 ({event:existing}=await eventAccess(request,id));requireValue(existing.collective_id===collectiveId,403,'Le collectif ne peut pas être modifié.');
 requireValue(existing.status!=='cancelled',409,'Un événement annulé ne peut plus être modifié.');
 requireValue(input.status!=='cancelled',400,'Utilisez l’action Annuler pour rembourser les billets.');
 const previous=await rows('SELECT * FROM ticket_types WHERE event_id=?',id);
 requireValue(previous.every(t=>input.types.some(n=>n.id===t.id)),400,'Les types de places existants doivent être conservés.');
 commands.push(stmt('UPDATE events SET name=?,description=?,location=?,timezone=?,starts_at=?,doors_at=?,cancel_until=?,status=?,hold_minutes=?,max_quantity=?,wait_hours=?,urgent_wait_hours=? WHERE id=?',input.name,input.description,input.location,input.timezone,input.startsAt,input.doorsAt,input.cancelUntil,input.status,input.holdMinutes,input.maxQuantity,input.waitHours,input.urgentWaitHours,eventId));
 }else{
 requireValue(input.status!=='cancelled',400,'Créez cet événement en brouillon.');
 commands.push(stmt('INSERT INTO events(id,collective_id,name,description,location,timezone,starts_at,doors_at,cancel_until,status,hold_minutes,max_quantity,wait_hours,urgent_wait_hours,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',eventId,collectiveId,input.name,input.description,input.location,input.timezone,input.startsAt,input.doorsAt,input.cancelUntil,input.status,input.holdMinutes,input.maxQuantity,input.waitHours,input.urgentWaitHours,now()));
 }
 for(const t of input.types){
 if(t.id&&id){const old=await one('SELECT * FROM ticket_types WHERE id=? AND event_id=?',t.id,id);requireValue(old&&t.capacity>=old.held+old.sold,409,'Le stock ne peut pas être inférieur aux places déjà attribuées.');
 commands.push(stmt('UPDATE ticket_types SET name=?,price=?,capacity=?,early_price=?,early_until=? WHERE id=? AND event_id=?',t.name,t.price,t.capacity,t.earlyPrice??null,t.earlyUntil??null,t.id,eventId));}
 else commands.push(stmt('INSERT INTO ticket_types(id,event_id,name,price,capacity,early_price,early_until) VALUES(?,?,?,?,?,?,?)',uid(),eventId,t.name,t.price,t.capacity,t.earlyPrice??null,t.earlyUntil??null));
 }
 if(existing&&(existing.starts_at!==input.startsAt||existing.location!==input.location||existing.doors_at!==input.doorsAt)){
 for(const o of await rows("SELECT id,email,token FROM orders WHERE event_id=? AND status='paid'",eventId))commands.push(job('email',{to:o.email,subject:'Informations modifiées : '+input.name,text:'La date, le lieu ou l’ouverture des portes a changé. Consultez vos billets actualisés : '+origin(request)+'/commande/'+o.token},'modified-'+eventId+'-'+now()+'-'+o.id));
 }
 await database().batch(commands);await audit(user.email,id?'edit_event':'create_event',eventId,collectiveId);await maintenance();return {id:eventId};
}
async function cancelEvent(request:Request,id:string){
 const {event,user}=await eventAccess(request,id);
 const ticketList=await rows("SELECT b.id,o.payment_id,o.demo,o.id order_id,i.unit_price FROM tickets b JOIN orders o ON o.id=b.order_id JOIN order_items i ON i.order_id=o.id AND i.type_id=b.type_id WHERE o.event_id=? AND b.status='valid'",id);
 await database().batch([
 stmt("UPDATE events SET status='cancelled' WHERE id=?",id),
 stmt("UPDATE orders SET status='cancelled' WHERE event_id=? AND status='pending'",id),
 stmt("INSERT OR IGNORE INTO jobs(id,kind,payload,status,attempts,next_at,created_at) SELECT 'event-refund-'||o.id,'refund',json_object('paymentId',o.payment_id,'amount',sum(i.unit_price),'eventId',o.event_id,'orderId',o.id,'demo',o.demo),'pending',0,?,? FROM orders o JOIN tickets b ON b.order_id=o.id JOIN order_items i ON i.order_id=o.id AND i.type_id=b.type_id WHERE o.event_id=? AND b.status='valid' GROUP BY o.id",now(),now(),id),
 stmt("UPDATE tickets SET status='cancelled',refund_amount=(SELECT i.unit_price FROM order_items i WHERE i.order_id=tickets.order_id AND i.type_id=tickets.type_id) WHERE status='valid' AND order_id IN (SELECT id FROM orders WHERE event_id=?)",id),
 stmt("INSERT OR IGNORE INTO jobs(id,kind,payload,status,attempts,next_at,created_at) SELECT 'event-cancel-'||o.id,'email',json_object('to',o.email,'subject',?,'text',?),'pending',0,?,? FROM orders o WHERE o.event_id=?",'Événement annulé : '+event.name,'L’événement est annulé. Les billets sont invalidés et les remboursements sont en cours.',now(),now(),id)
 ]);
 await audit(user.email,'cancel_event',id,event.collective_id);await maintenance();return {ok:true,tickets:ticketList.length};
}
function dayBounds(start:number,tz:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(start);
 const v=(key:string)=>parts.find(p=>p.type===key)!.value;
 const day=v('year')+'-'+v('month')+'-'+v('day');
 function localMidnight(d:string){let guess=Date.parse(d+'T00:00:00Z');for(let n=0;n<3;n++){const values=new Intl.DateTimeFormat('sv-SE',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(guess);guess+=Date.parse(d+'T00:00:00Z')-Date.parse(values.replace(' ','T')+'Z');}return guess;}
 const next=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);return [localMidnight(day),localMidnight(next)];
}
async function exportsFor(request:Request,id:string,kind:string,format:string){
 await eventAccess(request,id);
 let records:any[],columns:string[];
 if(kind==='participants'){records=await rows("SELECT o.name Nom,o.email Email,t.name Type,b.id Billet,CASE WHEN b.scanned_at IS NOT NULL THEN 'Entré' ELSE 'À venir' END Entree FROM tickets b JOIN orders o ON o.id=b.order_id JOIN ticket_types t ON t.id=b.type_id WHERE o.event_id=? AND b.status='valid' ORDER BY o.name",id);columns=['Nom','Email','Type','Billet','Entree'];}
 else if(kind==='waitlist'){records=await rows('SELECT w.name Nom,w.email Email,t.name Type,w.quantity Quantite,w.status Statut FROM waitlist w JOIN ticket_types t ON t.id=w.type_id WHERE t.event_id=? ORDER BY w.created_at,w.id',id);columns=['Nom','Email','Type','Quantite','Statut'];}
 else {records=await rows("SELECT o.id Commande,o.name Nom,o.email Email,o.status Statut,o.total/100.0 Montant,o.refunded/100.0 Rembourse,datetime(o.created_at/1000,'unixepoch') Date FROM orders o WHERE o.event_id=? ORDER BY o.created_at",id);columns=['Commande','Nom','Email','Statut','Montant','Rembourse','Date'];}
 if(format==='pdf'){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 let page=pdf.addPage([842,595]),y=555;
 const draw=(s:string,size=9)=>{if(y<35){page=pdf.addPage([842,595]);y=555;}page.drawText(s.replace(/[^\x20-\x7e\xa0-\xff]/g,' ').slice(0,145),{x:28,y,size,font});y-=19;};
 draw('Passage - '+kind+' - '+new Date().toLocaleDateString('fr-FR'),16);draw(columns.join(' | '));
 records.forEach(r=>{const content=columns.map(c=>c+': '+String(r[c]??'')).join(' | ');for(let n=0;n<content.length;n+=135)draw(content.slice(n,n+135));y-=5;});
 return new Response(await pdf.save() as any,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+kind+'.pdf"','Cache-Control':'no-store'}});
 }
 const cell=(s:any)=>'"'+String(s??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
 return new Response('\ufeff'+[columns,...records.map(r=>columns.map(c=>r[c]))].map(r=>r.map(cell).join(';')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="'+kind+'.csv"','Cache-Control':'no-store'}});
}
async function handle(request:Request,context:any){
 const params=await context.params,path=(params.path||[]) as string[],[section,id,action]=path,url=new URL(request.url),post=request.method==='POST';
 if(post){const source=request.headers.get('origin');requireValue(!source||source===url.origin,403,'Origine de requête non autorisée.');requireValue(Number(request.headers.get('content-length')||0)<262144,413,'Requête trop volumineuse.');}
 if(section==='webhook'&&post)return webhook(request);
 if(section==='meta')return response({mode:demo()?'demo':'live'});
 if(section==='auth'&&post)return auth(request,id,await request.json());
 if(section==='dashboard')return response(await dashboard(request,url.searchParams.get('collective')||''));
 if(section==='events'){
 if(!post){if(demo()){await identity(request);await initialize(request);}await maintenance();return response({events:await publicEvents(id),mode:demo()?'demo':'live'});}
 const data:any=await request.json();
 if(id&&action==='cancel')return response(await cancelEvent(request,id));
 return response(await saveEvent(request,data,id),id?200:201);
 }
 if(section==='reserve'&&post){if(demo()){await identity(request);await initialize(request);}return response(await reserve(await request.json()),201);}
 if(section==='orders'){
 if(post){
 const data:any=await request.json();
 if(action==='checkout')return response(await checkout(request,id));
 if(action==='cancel-ticket')return response(await cancelTicket(z.string().parse(data.ticketId),id,null));
 if(action==='cancel'){const o=await getOrder(id);requireValue(o.status==='pending',409,'Cette commande ne peut plus être libérée.');await stmt("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'",o.id).run();await maintenance();return response({ok:true});}
 }
 await maintenance();const order=await getOrder(id);
 if(action==='pdf'){requireValue(order.tickets.length,409,'Les billets sont disponibles après confirmation du paiement.');return new Response(await pdfTickets(order) as any,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="billets.pdf"','Cache-Control':'no-store'}});}
 if(action==='calendar')return new Response(calendar(order.event),{headers:{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="evenement.ics"'}});
 return response(order);
 }
 if(section==='waitlist'&&post){
 const data=z.object({typeId:z.string(),email:emailSchema,name:z.string().trim().min(1).max(120),quantity:z.number().int().min(1).max(20)}).parse(await request.json());
 const type=await one('SELECT t.*,e.max_quantity,e.doors_at,e.status FROM ticket_types t JOIN events e ON e.id=t.event_id WHERE t.id=?',data.typeId);
 requireValue(type&&type.status==='on_sale'&&type.doors_at>now(),409,'La liste d’attente est fermée.');
 requireValue(data.quantity<=type.max_quantity,400,'Quantité trop élevée.');
 const prior=await one("SELECT id FROM waitlist WHERE type_id=? AND email=? AND status IN ('waiting','offered')",data.typeId,data.email);if(prior)return response({ok:true});
 const wid=uid();await database().batch([stmt('INSERT INTO waitlist(id,type_id,email,name,quantity,created_at) VALUES(?,?,?,?,?,?)',wid,data.typeId,data.email,data.name,data.quantity,now()),job('email',{to:data.email,subject:'Inscription en liste d’attente',text:'Votre demande de '+data.quantity+' places a été enregistrée. Vous recevrez un lien personnel dès que ces places seront disponibles.'},'waiting-'+wid)]);
 await maintenance();return response({ok:true},201);
 }
 if(section==='scanner-links'&&post){
 const data:any=await request.json();const {event,user}=await eventAccess(request,data.eventId),token=randomToken(),[start,end]=dayBounds(event.starts_at,event.timezone);
 await stmt('INSERT INTO scanner_links(id,event_id,token,valid_from,valid_until,created_at) VALUES(?,?,?,?,?,?)',uid(),event.id,token,demo()?now()-60000:start,demo()?now()+7*86400000:end,now()).run();
 await audit(user.email,'create_scanner_link',event.id,event.collective_id);
 return response({token,url:'/controle/'+token,demo:demo(),validFrom:demo()?now():start,validUntil:demo()?now()+7*86400000:end});
 }
 if(section==='scanner'){
 const link=await scanner(request,id);
 if(!post){
 const tickets=await rows('SELECT b.*,o.name,o.email,t.name type_name FROM tickets b JOIN orders o ON o.id=b.order_id JOIN ticket_types t ON t.id=b.type_id WHERE o.event_id=?',link.event_id);
 const pub=JSON.parse((await one("SELECT value FROM settings WHERE key='sign_public'")).value);
 return response({event:{id:link.event_id,name:link.name,timezone:link.timezone},tickets,publicKey:pub,validUntil:link.valid_until,fetchedAt:now()});
 }
 const data:any=await request.json();
 if(action==='sync'){
 const input=z.object({deviceId:z.string().min(1).max(100),scans:z.array(z.object({code:z.string().max(1000),at:z.number()})).max(600)}).parse(data),results=[];
 for(const item of input.scans){try{results.push(await scan(id,item.code,input.deviceId,item.at));}catch(e){results.push({ok:false,code:item.code,reason:e instanceof Error?e.message:'Scan refusé'});}}
 return response({results});
 }
 const input=z.object({code:z.string().max(1000),deviceId:z.string().min(1).max(100)}).parse(data);return response(await scan(id,input.code,input.deviceId));
 }
 if(section==='refunds'&&post){
 const data=z.object({ticketId:z.string()}).parse(await request.json()),t=await one('SELECT o.event_id FROM tickets b JOIN orders o ON o.id=b.order_id WHERE b.id=?',data.ticketId);
 requireValue(t,404,'Billet introuvable.');const {user}=await eventAccess(request,t.event_id);return response(await cancelTicket(data.ticketId,undefined,user));
 }
 if(section==='remove-waitlist'&&post){
 const data:any=await request.json();const w=await one('SELECT w.*,t.event_id FROM waitlist w JOIN ticket_types t ON t.id=w.type_id WHERE w.id=?',data.id);requireValue(w,404,'Inscription introuvable.');
 const {user,event}=await eventAccess(request,w.event_id);
 await database().batch([stmt("UPDATE waitlist SET status='removed' WHERE id=?",w.id),...(w.order_id?[stmt("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'",w.order_id)]:[])]);
 await audit(user.email,'remove_waitlist',w.id,event.collective_id);await maintenance();return response({ok:true});
 }
 if(section==='export')return exportsFor(request,id,url.searchParams.get('kind')||'participants',url.searchParams.get('format')||'csv');
 if(section==='admin'&&post){
 const user=await access(request,undefined,true),data=await request.json();
 if(id==='collective'){
 const input=z.object({name:z.string().trim().min(2).max(120),color:z.string().regex(/^#[a-fA-F0-9]{6}$/).default('#132a3b')}).parse(data),cid=uid();
 await stmt('INSERT INTO collectives(id,name,color,created_at) VALUES(?,?,?,?)',cid,input.name,input.color,now()).run();await audit(user.email,'create_collective',cid,cid);return response({id:cid});
 }
 if(id==='member'){
 const input=z.object({collectiveId:z.string(),email:emailSchema}).parse(data);requireValue(await one('SELECT id FROM collectives WHERE id=?',input.collectiveId),404,'Collectif introuvable.');
 await database().batch([stmt("INSERT OR IGNORE INTO members(id,email,collective_id,role) VALUES(?,?,?,'organizer')",uid(),input.email,input.collectiveId),job('email',{to:input.email,subject:'Invitation à votre espace Passage',text:'Vous avez été invité à organiser les événements de votre collectif. Connectez-vous avec votre compte ChatGPT associé à cette adresse : '+origin(request)},'invite-'+input.collectiveId+'-'+input.email)]);
 await audit(user.email,'invite_member',input.email,input.collectiveId);return response({ok:true});
 }
 if(id==='account'){
 const input=z.object({collectiveId:z.string(),stripeAccount:z.string().regex(/^acct_[a-zA-Z0-9]+$/)}).parse(data);await stmt('UPDATE collectives SET stripe_account=? WHERE id=?',input.stripeAccount,input.collectiveId).run();await audit(user.email,'configure_account',input.collectiveId,input.collectiveId);return response({ok:true});
 }
 }
 if(section==='maintenance'&&post){
 const token=request.headers.get('authorization');
 if(!(runtime.JOB_SECRET&&token==='Bearer '+runtime.JOB_SECRET))await access(request,undefined,true);
 await maintenance();await processJobs(50);return response({ok:true});
 }
 throw new HttpError(404,'Cette action est introuvable.');
}
export async function GET(request:Request,context:any){try{return await handle(request,context);}catch(e){console.error('Billetterie:',e instanceof Error?e.message:e);return response({error:e instanceof HttpError?e.message:'Le service est momentanément indisponible.'},e instanceof HttpError?e.status:503);}}
export async function POST(request:Request,context:any){try{const result=await handle(request,context);await processJobs(10);return result;}catch(e){console.error('Billetterie:',e instanceof Error?e.message:e);return response({error:e instanceof HttpError?e.message:e instanceof z.ZodError?'Vérifiez les champs du formulaire.':'L’opération n’a pas abouti. Réessayez.'},e instanceof HttpError?e.status:e instanceof z.ZodError?400:503);}}
