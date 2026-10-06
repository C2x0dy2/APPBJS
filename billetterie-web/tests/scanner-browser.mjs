/**
 * Real Chromium/IndexedDB/service-worker regression, without browser dependencies.
 * The browser manifest's deadline is shortened through CDP; the server session
 * stays real and live. Server-side expired-link authorization is covered by the
 * separate in-memory scanner regression, not by this UI clock simulation.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173');
assert(target.protocol === 'http:' && target.hostname === '127.0.0.1' &&
  target.pathname === '/' && !target.search && !target.hash && !target.username && !target.password,
  'Ce test navigateur est réservé à une origine HTTP sur 127.0.0.1.');
const base = target.origin;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = join(root, '.sites-runtime');
const profileName = `scanner-browser-${randomUUID()}`;
const profile = join(runtimeRoot, profileName);
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));

async function request(path, data, expectedStatus = 200) {
  const response = await fetch(`${base}/api/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    // The production worker has no development-only loopback identity fallback.
    // This fixture identity is used only on the guarded local demo destination.
    headers: {
      'oai-authenticated-user-email': 'scanner-browser@example.invalid',
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, `${path} : ${response.status}, attendu ${expectedStatus}.`);
  return body;
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    socket.addEventListener('message', message => {
      const payload = JSON.parse(message.data);
      if (payload.id) {
        const pending = this.pending.get(payload.id);
        if (!pending) return;
        this.pending.delete(payload.id);
        clearTimeout(pending.timer);
        if (payload.error) pending.reject(new Error(`${pending.method}: ${payload.error.message}`));
        else pending.resolve(payload.result);
      } else {
        this.handlers.get(payload.method)?.(payload.params);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Connexion CDP fermée pendant ${pending.method}.`));
      }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveSocket, rejectSocket) => {
      const timer = setTimeout(() => rejectSocket(new Error('Connexion CDP trop lente.')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolveSocket(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); rejectSocket(new Error('Connexion CDP impossible.')); }, { once: true });
    });
    return new CDP(socket);
  }
  on(method, handler) { this.handlers.set(method, handler); }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCommand(new Error(`Commande CDP trop lente : ${method}.`));
      }, 20000);
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePort, rejectPort) => {
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', resolvePort);
  });
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function browserExecutable() {
  const windowsPaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const otherPaths = process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  const paths = process.env.SCANNER_BROWSER_PATH ? [process.env.SCANNER_BROWSER_PATH]
    : process.platform === 'win32' ? windowsPaths : otherPaths;
  for (const path of paths) {
    try { await access(path); return path; } catch { /* Try the next existing local browser. */ }
  }
  throw new Error('Aucun navigateur Chromium local. Définissez SCANNER_BROWSER_PATH ; aucun téléchargement automatique.');
}

const initial = await request('dashboard');
assert.equal(initial.mode, 'demo', 'Ce test est réservé à une base de démonstration.');
assert(initial.collectives.length, 'Un collectif de démonstration doit exister.');
const executable = await browserExecutable();
console.log('Garde-fous validés : 127.0.0.1, démonstration et navigateur local existant.');

let eventId;
let browser;
let browserExited;
let cdp;
let profileCreated = false;
let failure;
let interceptionError;
let browserExpiry;
let prepared;
let clockExpired = false;
let failSync = false;
let failedSyncs = 0;
let expiredPrepareAttempts = 0;
let browserOffline = false;
let navigating = false;
const syncRequests = [];
const syncResponses = [];

try {
  const stamp = Date.now();
  const start = Date.now() + 14 * 86400000;
  const created = await request('events', {
    collectiveId: initial.collectives[0].id,
    name: `Validation scanner navigateur ${stamp}`,
    description: 'Essai local du cache navigateur et de la reprise des scans.',
    location: 'Salle de test', timezone: 'Europe/Paris',
    startsAt: start, doorsAt: start - 3600000, cancelUntil: start - 172800000,
    status: 'on_sale', types: [
      { name: 'Entrée', price: 1000, capacity: 2 },
      { name: 'Balcon', price: 1500, capacity: 1 },
    ],
  }, 201);
  eventId = created.id;
  const event = (await request(`events/${eventId}`)).events[0];
  const type = event.types.find(item => item.name === 'Entrée');
  const reservation = await request('reserve', {
    eventId, name: 'Acheteur navigateur', email: `scanner-browser-${stamp}@example.invalid`,
    items: [{ typeId: type.id, quantity: 1 }],
  }, 201);
  await request(`orders/${reservation.token}/checkout`, {});
  const ticket = (await request(`orders/${reservation.token}`)).tickets[0];
  assert(ticket, 'Un billet de démonstration doit être émis.');
  const scanner = await request('scanner-links', { eventId });
  const scannerPath = `/api/scanner/${scanner.token}`;
  const pageUrl = `${base}/controle/${scanner.token}`;

  await mkdir(runtimeRoot, { recursive: true });
  const canonicalRoot = await realpath(root);
  const canonicalRuntime = await realpath(runtimeRoot);
  assert.equal(relative(canonicalRoot, canonicalRuntime), '.sites-runtime', 'Le profil doit rester dans ce projet.');
  await mkdir(profile);
  profileCreated = true;
  const port = await freePort();
  browser = spawn(executable, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    '--disable-sync', '--disable-extensions', '--disable-gpu', '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, 'about:blank',
  ], { cwd: root, windowsHide: true, stdio: 'ignore' });
  let launchError;
  browser.once('error', error => { launchError = error; });
  browserExited = new Promise(resolveExit => browser.once('exit', resolveExit));
  let page;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (launchError) throw launchError;
    if (browser.exitCode !== null) throw new Error('Le navigateur a quitté avant de fournir CDP.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
      page = (await response.json()).find(item => item.type === 'page');
      if (page) break;
    } catch { /* The isolated browser is still starting. */ }
    await pause(100);
  }
  assert(page, 'Le navigateur isolé doit fournir un onglet CDP.');
  cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Page.bringToFront');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  cdp.on('Fetch.requestPaused', params => {
    (async () => {
      const url = new URL(params.request.url);
      if (url.origin !== base) {
        await cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' });
        return;
      }
      const isPrepare = url.pathname === `${scannerPath}/prepare`;
      const isSync = url.pathname === `${scannerPath}/sync`;
      if (params.responseStatusCode !== undefined) {
        // Lose the acknowledgement after the real server has processed the
        // request. The next attempt must reconcile an already accepted scan.
        if (isSync && failSync) {
          failedSyncs++;
          await cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'ConnectionReset' });
          return;
        }
        if (isSync && params.responseStatusCode === 200) {
          const response = await cdp.send('Fetch.getResponseBody', { requestId: params.requestId });
          const body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;
          syncResponses.push(JSON.parse(body));
          await cdp.send('Fetch.fulfillRequest', {
            requestId: params.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }],
            body: Buffer.from(body).toString('base64'),
          });
          return;
        }
        if (isPrepare && params.responseStatusCode === 200) {
          const response = await cdp.send('Fetch.getResponseBody', { requestId: params.requestId });
          const body = JSON.parse(response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body);
          // Leave enough time for a cold browser to prepare the worker shell;
          // expiry is subsequently forced by the UI clock, without a long wait.
          browserExpiry ||= Date.now() + 60000;
          prepared = { ...body, validUntil: browserExpiry, syncUntil: browserExpiry + 86400000 };
          assert(prepared.syncToken && prepared.deviceId && Number.isSafeInteger(prepared.preparedAt),
            'La préparation doit contenir les nouveaux justificatifs de synchronisation.');
          await cdp.send('Fetch.fulfillRequest', {
            requestId: params.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }],
            body: Buffer.from(JSON.stringify(prepared)).toString('base64'),
          });
        } else await cdp.send('Fetch.continueRequest', { requestId: params.requestId });
        return;
      }
      if (isPrepare && clockExpired) {
        expiredPrepareAttempts++;
        await cdp.send('Fetch.fulfillRequest', {
          requestId: params.requestId, responseCode: 403,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ error: 'La période de contrôle est terminée.' })).toString('base64'),
        });
        return;
      }
      if (isSync) {
        if (params.request.postData) syncRequests.push(JSON.parse(params.request.postData));
      }
      await cdp.send('Fetch.continueRequest', { requestId: params.requestId, interceptResponse: isPrepare || isSync });
    })().catch(error => {
      // Chromium invalidates paused API requests when navigation or going
      // offline cancels them. Do not turn that cancellation into a fake app bug.
      if (/Invalid\s*InterceptionId/i.test(error.message) && (browserOffline || navigating)) return;
      interceptionError = error;
    });
  });
  // Leave document/assets/service-worker loading untouched. Only scanner API
  // traffic needs deadline simulation and the deliberate synchronization error.
  await cdp.send('Fetch.enable', { patterns: [
    { urlPattern: `${base}${scannerPath}`, requestStage: 'Request' },
    { urlPattern: `${base}${scannerPath}/*`, requestStage: 'Request' },
  ] });

  async function until(check, label, timeout = 20000) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
      if (interceptionError) throw interceptionError;
      try { if (await check()) return; } catch (error) { lastError = error; }
      await pause(100);
    }
    throw new Error(`${label}${lastError ? ` : ${lastError.message}` : ''}`);
  }
  async function browserState() {
    return cdp.evaluate(`(async()=>{
      if(!(await indexedDB.databases()).some(database=>database.name==='passage-scanner-v1'))return null;
      return new Promise((resolve,reject)=>{
      const request=indexedDB.open('passage-scanner-v1',1);
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('events')||!db.objectStoreNames.contains('scans')){db.close();resolve(null);return;}
        const transaction=db.transaction(['events','scans']);
        const event=transaction.objectStore('events').get(${JSON.stringify(scanner.token)});
        const scans=transaction.objectStore('scans').getAll();
        transaction.oncomplete=()=>{db.close();resolve({cache:event.result,scans:scans.result.filter(scan=>scan.token===${JSON.stringify(scanner.token)})});};
        transaction.onerror=()=>reject(transaction.error);
      };
      });
    })()`);
  }
  const pending = state => state?.scans.filter(scan => !scan.synced) || [];
  navigating = true;
  await cdp.send('Page.navigate', { url: pageUrl });
  await until(async () => (await browserState())?.cache?.syncToken &&
    await cdp.evaluate('Boolean(document.querySelector("details.manual-scan textarea"))'), 'La page doit préparer les billets.');
  await until(() => cdp.evaluate(`(async()=>{
    if(!navigator.serviceWorker.controller)return false;
    await document.fonts.ready;
    const resources=performance.getEntriesByType('resource').map(entry=>new URL(entry.name))
      .filter(url=>url.origin===location.origin&&/\\.(js|css|woff2?)$/.test(url.pathname))
      .map(url=>url.href);
    if(!resources.some(url=>new URL(url).pathname.endsWith('.js')))return false;
    const stores=await Promise.all((await caches.keys()).map(name=>caches.open(name)));
    for(const url of new Set([location.href,...resources])){
      if(!(await Promise.all(stores.map(store=>store.match(url)))).some(Boolean))return false;
    }
    return true;
  })()`), 'Le service worker doit finir de préparer la page et toutes ses ressources hors connexion.');
  navigating = false;
  console.log('Page et préparation réelle disponibles dans le service worker et IndexedDB.');

  const network = async offline => {
    browserOffline = offline;
    await cdp.send('Network.emulateNetworkConditions', {
      offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
  };
  await until(() => cdp.evaluate('Boolean(document.querySelector("details.manual-scan textarea") && !document.querySelector("details.manual-scan textarea").disabled)'),
    'La préparation initiale doit terminer avant la saisie du billet.');
  await network(true);
  await until(() => cdp.evaluate('navigator.onLine === false'), 'Le navigateur doit être hors connexion.');
  await until(() => cdp.evaluate('!document.querySelector("details.manual-scan textarea").disabled'),
    'La saisie hors connexion doit être disponible après la préparation.');
  await cdp.evaluate('document.querySelector("details.manual-scan").open=true; document.querySelector("details.manual-scan textarea").focus();');
  assert.equal(await cdp.evaluate('document.activeElement === document.querySelector("details.manual-scan textarea")'), true,
    'Le vrai champ du billet doit recevoir le focus avant la saisie CDP.');
  await cdp.send('Input.insertText', { text: ticket.code });
  assert.equal(await cdp.evaluate('document.querySelector("details.manual-scan textarea").value'), ticket.code,
    'La saisie CDP doit réellement remplir le champ du billet.');
  await until(() => cdp.evaluate('!document.querySelector("details.manual-scan button").disabled'), 'La saisie du code doit activer sa validation.');
  await cdp.evaluate('document.querySelector("details.manual-scan button").click();');
  await until(async () => pending(await browserState()).length === 1, 'Le scan hors ligne doit créer un enregistrement local.');
  let state = await browserState();
  const queued = pending(state)[0];
  assert.equal(queued.ticketId, ticket.id);
  assert.equal(queued.syncToken, prepared.syncToken, 'Le scan doit conserver son propre justificatif.');
  assert.equal(queued.deviceId, prepared.deviceId);
  assert.equal(queued.syncUntil, prepared.syncUntil);
  assert(queued.at >= prepared.preparedAt && queued.at < prepared.validUntil);
  assert.equal((await request(`orders/${reservation.token}`)).tickets[0].scanned_at, null,
    'Le serveur ne doit pas avoir déjà reçu le scan hors ligne.');
  console.log('Scan hors connexion enregistré avec ses justificatifs ; serveur encore inchangé.');

  clockExpired = true;
  const clockPatch = `Date.now=()=>${browserExpiry + 1000};`;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: clockPatch });
  await cdp.evaluate(clockPatch);
  navigating = true;
  await cdp.send('Page.reload', { ignoreCache: true });
  await until(() => cdp.evaluate('Boolean(document.querySelector(".scanner-main"))'), 'La page doit se recharger réellement hors connexion.');
  await until(() => cdp.evaluate('document.body.innerText.includes("Contrôle fermé")'), 'La page expirée doit afficher la fermeture.');
  navigating = false;
  state = await browserState();
  assert.equal(pending(state).length, 1, 'Le rechargement après expiration doit conserver le scan à synchroniser.');
  assert.equal(pending(state)[0].syncToken, queued.syncToken);
  const controlsClosed = () => cdp.evaluate(`Boolean(
    document.querySelector('details.manual-scan textarea')?.disabled &&
    [...document.querySelectorAll('button')].find(button=>/caméra/i.test(button.innerText))?.disabled
  )`);
  assert.equal(await controlsClosed(), true, 'La fermeture doit désactiver les nouvelles entrées.');
  console.log('Rechargement réel hors connexion après échéance : journal conservé et nouvelles entrées fermées.');

  failSync = true;
  await network(false);
  await until(() => failedSyncs > 0, 'Le retour du réseau doit perdre une réponse après traitement serveur.');
  await until(() => cdp.evaluate('Boolean(document.querySelector(".form-error"))'), 'La perte de la réponse doit être visible.');
  assert.equal(pending(await browserState()).length, 1, 'Une réponse perdue ne doit pas effacer le scan local.');
  const acceptedBeforeAcknowledgement = (await request(`orders/${reservation.token}`)).tickets[0];
  assert.equal(acceptedBeforeAcknowledgement.scanned_at, queued.at,
    'Le scan doit déjà être accepté par le serveur avant la perte volontaire de sa réponse.');
  assert.equal(acceptedBeforeAcknowledgement.device_id, queued.deviceId);
  console.log('Réponse perdue après traitement serveur : scan accepté et journal conservé pour réconciliation.');

  failSync = false;
  await until(() => cdp.evaluate(`!document.querySelector('button[aria-label="Actualiser et synchroniser"]').disabled`), 'La reprise manuelle doit être disponible.');
  await cdp.evaluate(`document.querySelector('button[aria-label="Actualiser et synchroniser"]').click();`);
  await until(async () => pending(await browserState()).length === 0, 'La reprise réussie doit vider la file des scans en attente.');
  await until(() => cdp.evaluate('document.querySelector(".scanner-count strong")?.innerText === "1"'), 'Le compteur doit afficher une entrée après synchronisation.');
  assert.equal(await controlsClosed(), true, 'La synchronisation ne doit pas rouvrir le contrôle.');
  const finalTicket = (await request(`orders/${reservation.token}`)).tickets[0];
  assert.equal(finalTicket.scanned_at, queued.at);
  assert.equal(finalTicket.device_id, queued.deviceId);
  assert(syncRequests.some(body => body.syncToken === queued.syncToken && body.deviceId === queued.deviceId),
    'La requête de synchronisation doit utiliser les justificatifs du scan préparé.');
  assert(syncResponses.some(body => body.results?.some(result =>
    result.ok === false && result.sameDevice === true && result.id === ticket.id && result.scannedAt === queued.at)),
    'La reprise doit reconnaître le scan déjà accepté sur ce téléphone, sans créer une seconde entrée.');
  assert.equal(expiredPrepareAttempts, 0, 'Une page fermée ne doit pas demander une nouvelle préparation.');
  console.log('Reprise idempotente après réponse perdue : même entrée reconnue, file vide, compteur exact et contrôle fermé.');
} catch (error) {
  failure = error;
  if (cdp) {
    try {
      const detail = await cdp.evaluate('document.querySelector(".scanner-main")?.innerText || document.body.innerText');
      console.error('État de la page de test :', String(detail || '').slice(0, 700));
      const inputState = await cdp.evaluate(`(()=>{
        const field=document.querySelector('details.manual-scan textarea');
        return {online:navigator.onLine,now:Date.now(),fieldPresent:!!field,
          fieldDisabled:field?.disabled,valueLength:field?.value.length,
          fieldFocused:!!field&&document.activeElement===field,
          detailsOpen:document.querySelector('details.manual-scan')?.open,
          verifyDisabled:document.querySelector('details.manual-scan button')?.disabled,
          focusedTag:document.activeElement?.tagName};
      })()`);
      console.error('Diagnostic de saisie du navigateur :', JSON.stringify(inputState));
    } catch { /* Keep the original assertion if navigation disconnected CDP. */ }
  }
} finally {
  if (cdp) await cdp.send('Browser.close').catch(() => {});
  if (browser) {
    await Promise.race([browserExited, pause(3000)]);
    if (browser.exitCode === null) browser.kill(); // Only the child started by this script.
    await Promise.race([browserExited, pause(1000)]);
  }
  if (profileCreated) {
    try {
      const canonicalRuntime = await realpath(runtimeRoot);
      const canonicalProfile = await realpath(profile);
      assert.equal(relative(canonicalRuntime, canonicalProfile), profileName,
        'Le nettoyage doit viser seulement le profil temporaire créé par ce test.');
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (cleanupError) {
      console.error('Le profil temporaire du navigateur n’a pas pu être nettoyé.');
      failure ||= cleanupError;
    }
  }
  if (eventId) {
    try { await request(`events/${eventId}/cancel`, {}); }
    catch (cleanupError) { console.error('L’événement créé par ce test n’a pas pu être annulé.'); failure ||= cleanupError; }
  }
}

if (failure) throw failure;
console.log('Scanner navigateur : cache, journal hors ligne, fermeture et reprise validés dans Chromium.');
