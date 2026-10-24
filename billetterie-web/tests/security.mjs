import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:5173';
async function post(path,data={},headers={}){return fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});}

// En-têtes de sécurité sur les pages HTML dynamiques.
const page=await fetch(base+'/');
assert.equal(page.status,200);
assert.match(page.headers.get('content-security-policy')||'',/default-src 'self'/);
assert.equal(page.headers.get('referrer-policy'),'no-referrer');
assert.equal(page.headers.get('x-content-type-options'),'nosniff');
assert.equal(page.headers.get('x-frame-options'),'DENY');

// Un POST inter-origine reste refusé.
assert.equal((await post('reserve',{}, {Origin:'https://evil.invalid'})).status,403);

// Les exports n'acceptent que des valeurs connues et ne peuvent pas injecter d'en-tête.
assert.equal((await fetch(base+'/api/export/e1?kind=evil&format=csv')).status,400);
const csv=await fetch(base+'/api/export/e1?kind=participants&format=csv');
assert.equal(csv.status,200);
assert.equal(csv.headers.get('content-disposition'),'attachment; filename="passage-participants.csv"');
assert.equal(csv.headers.get('x-content-type-options'),'nosniff');

// La limitation de débit sur la liste d'attente finit par répondre 429.
let limited=false;
for(let n=0;n<40;n++){const r=await post('waitlist',{typeId:'missing',email:'rate'+n+'@example.invalid',name:'Test',quantity:1});if(r.status===429){limited=true;break;}}
assert(limited,'La limitation de débit de la liste d’attente doit se déclencher.');

// Un lien scanneur est révocable et une session de synchronisation est liée à son appareil.
const created=await post('scanner-links',{eventId:'e1'});
assert.equal(created.status,200);
const link=await created.json();
assert(link.token&&link.id);
assert.equal((await fetch(base+'/api/scanner/'+link.token)).status,200);
const prepared=await post('scanner/'+link.token+'/prepare',{deviceId:'device-a'});
assert.equal(prepared.status,200);
const syncToken=(await prepared.json()).syncToken;
assert.match(syncToken,/^[A-Za-z0-9_-]{43}$/);
assert.equal((await post('scanner/'+link.token+'/sync',{deviceId:'device-b',syncToken,scans:[]})).status,403);
assert.equal((await post('scanner-links/'+link.id+'/revoke',{})).status,200);
assert.equal((await fetch(base+'/api/scanner/'+link.token)).status,403);
assert.equal((await post('scanner/'+link.token+'/prepare',{deviceId:'device-a'})).status,403);

// La déconnexion répond proprement (aucune session active en démo).
assert.equal((await post('auth/logout',{})).status,200);

console.log('Sécurité : en-têtes, CSRF, exports, limitation de débit, révocation scanneur, session liée à l’appareil, déconnexion vérifiés.');
