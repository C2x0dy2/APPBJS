const CACHE='passage-scanner-shell-v1';
self.addEventListener('message',event=>{if(event.data?.type!=='PREPARE')return;event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const value of event.data.urls||[]){const url=new URL(value,self.location.origin);if(url.origin!==self.location.origin||(!url.pathname.startsWith('/controle/')&&!/\.(js|css|woff2?)$/.test(url.pathname))||url.pathname.startsWith('/api/'))continue;try{const r=await fetch(url.href,{credentials:'same-origin'});if(r.ok)await cache.put(url.href,r);}catch{}}})());});
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 const scanner=url.pathname.startsWith('/controle/');
 const asset=/\.(js|css|woff2?)$/.test(url.pathname)&&!url.pathname.includes('/api/');
 if(!scanner&&!asset)return;
 event.respondWith((async()=>{
 const cache=await caches.open(CACHE);
 try{const result=await fetch(event.request);if(result.ok)await cache.put(event.request,result.clone());return result;}
 catch{const cached=await cache.match(event.request);if(cached)return cached;return new Response('Reconnexion nécessaire pour préparer le contrôle.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
 })());
});
