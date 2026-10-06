import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:5173';
async function call(path,data){const r=await fetch(base+'/api/'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};}
const start=Date.now()+30*86400000;
const created=await call('events',{collectiveId:'c1',name:'Test de charge '+Date.now(),description:'500 acheteurs pour 100 places',location:'Salle de test',startsAt:start,doorsAt:start-3600000,cancelUntil:start-172800000,status:'on_sale',types:[{name:'Fosse',price:1000,capacity:100},{name:'Balcon',price:2000,capacity:1}]});
assert.equal(created.status,201);
const event=(await call('events/'+created.data.id)).data.events[0],type=event.types.find(t=>t.name==='Fosse');
const begun=Date.now();
const results=await Promise.all(Array.from({length:500},(_,n)=>call('reserve',{eventId:event.id,name:'Acheteur '+n,email:'load'+n+'@example.invalid',items:[{typeId:type.id,quantity:1}]})));
const accepted=results.filter(r=>r.status===201);
assert.equal(accepted.length,100);
assert.equal(results.filter(r=>r.status===409).length,400);
for(let i=0;i<accepted.length;i+=10){const paid=await Promise.all(accepted.slice(i,i+10).map(r=>call('orders/'+r.data.token+'/checkout',{})));assert(paid.every(r=>r.status===200));}
const dash=(await call('dashboard?collective=c1')).data,actual=dash.events.find(e=>e.id===event.id);
assert.equal(actual.types.find(t=>t.id===type.id).sold,100);
assert.equal(actual.types.find(t=>t.id===type.id).held,0);
let tickets=0;for(const r of accepted){const order=(await call('orders/'+r.data.token)).data;tickets+=order.tickets.length;}
assert.equal(tickets,100);
console.log('500 réservations HTTP concurrentes : 100 acceptées, 400 refusées, exactement 100 billets émis. Durée : '+((Date.now()-begun)/1000).toFixed(1)+' s.');
await call('events/'+event.id+'/cancel',{});
