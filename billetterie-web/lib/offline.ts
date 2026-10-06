const DB_NAME = 'passage-scanner-v1';

export type ScanResult = {
 ok: boolean;
 id?: string;
 code?: string;
 type?: string;
 reason?: string;
 scannedAt?: number;
 sameDevice?: boolean;
 pending?: boolean;
};

export type CachedTicket = {
 id: string;
 code: string;
 status: string;
 scanned_at: number | null;
 type_name: string;
 name?: string;
 email?: string;
 device_id?: string;
};

export type ScannerManifest = {
 event: { id: string; name: string; timezone: string };
 tickets: CachedTicket[];
 publicKey: JsonWebKey;
 validFrom?: number;
 validUntil: number;
 fetchedAt: number;
 syncToken?: string;
 deviceId?: string;
 preparedAt?: number;
 syncUntil?: number;
};

export type PendingScan = {
 key: string;
 token: string;
 code: string;
 at: number;
 synced: boolean;
 ticketId: string;
 syncToken?: string;
 deviceId?: string;
 syncUntil?: number;
 result?: ScanResult;
};

function openDb(): Promise<IDBDatabase> {
 return new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
   request.result.createObjectStore('events');
   request.result.createObjectStore('scans', { keyPath: 'key' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
 });
}

export async function cacheEvent(token: string, data: ScannerManifest) {
 const db = await openDb();
 return new Promise<void>((resolve, reject) => {
  const tx = db.transaction('events', 'readwrite');
  tx.objectStore('events').put(data, token);
  tx.oncomplete = () => { db.close(); resolve(); };
  tx.onabort = () => { db.close(); reject(tx.error || new Error('La préparation n’a pas pu être enregistrée.')); };
 });
}

export async function cachedEvent(token: string): Promise<ScannerManifest | undefined> {
 const db = await openDb();
 return new Promise((resolve, reject) => {
  const tx = db.transaction('events');
  const request = tx.objectStore('events').get(token);
  tx.oncomplete = () => { db.close(); resolve(request.result); };
  tx.onabort = () => { db.close(); reject(tx.error || new Error('La liste locale ne peut pas être ouverte.')); };
 });
}

export async function pendingScans(token: string): Promise<PendingScan[]> {
 const db = await openDb();
 return new Promise((resolve, reject) => {
  const tx = db.transaction('scans');
  const request = tx.objectStore('scans').getAll();
  tx.oncomplete = () => {
   db.close();
   resolve((request.result as PendingScan[]).filter(scan => scan.token === token && !scan.synced));
  };
  tx.onabort = () => { db.close(); reject(tx.error || new Error('Le journal local ne peut pas être ouvert.')); };
 });
}

export function mergeScanResult(data: ScannerManifest, ticketId: string, result: ScanResult): ScannerManifest {
 return {
  ...data,
  tickets: data.tickets.map(ticket => {
   if (ticket.id !== ticketId) return ticket;
   if (result.ok || (result.id === ticketId && Number.isFinite(result.scannedAt))) {
    return { ...ticket, scanned_at: result.scannedAt ?? ticket.scanned_at };
   }
   if (!result.ok && /annul/i.test(result.reason || '')) return { ...ticket, status: 'cancelled' };
   return ticket;
  }),
 };
}

// Persist the server observation with its queue acknowledgement, so an expired
// manifest still has the correct count if the browser closes immediately.
export async function finishScan(key: string, result: ScanResult, expected?: PendingScan): Promise<boolean> {
 const db = await openDb();
 return new Promise((resolve, reject) => {
  const tx = db.transaction(['scans', 'events'], 'readwrite');
  const scans = tx.objectStore('scans');
  const events = tx.objectStore('events');
  const request = scans.get(key);
  let changed = false;
  request.onsuccess = () => {
   const record = request.result as PendingScan | undefined;
   if (!record || record.synced) return;
   if (expected && (record.token !== expected.token || record.code !== expected.code ||
    record.at !== expected.at || record.syncToken !== expected.syncToken || record.deviceId !== expected.deviceId)) return;
   scans.put({ ...record, synced: true, result });
   changed = true;
   const manifest = events.get(record.token);
   manifest.onsuccess = () => {
    if (manifest.result) events.put(mergeScanResult(manifest.result, record.ticketId, result), record.token);
   };
  };
  tx.oncomplete = () => { db.close(); resolve(changed); };
  tx.onabort = () => { db.close(); reject(tx.error || new Error('La synchronisation n’a pas pu être enregistrée.')); };
 });
}

export function offlineAvailability(data: ScannerManifest | null | undefined, at = Date.now()): string | null {
 if (!data) return 'Téléchargez les billets avec une connexion avant le contrôle.';
 if (!Number.isFinite(data.validFrom) || !Number.isFinite(data.validUntil)) return 'Reconnectez ce téléphone pour préparer le contrôle.';
 if (at < data.validFrom!) return 'Le contrôle n’est pas encore ouvert.';
 if (at >= data.validUntil) return 'Contrôle fermé : aucun nouveau scan n’est autorisé.';
 if (!data.syncToken || !data.deviceId || !Number.isFinite(data.preparedAt) || !Number.isFinite(data.syncUntil)) {
  return 'Cette liste ne permet pas le contrôle hors connexion. Reconnectez ce téléphone avant de scanner.';
 }
 if (at < data.preparedAt!) return 'Vérifiez l’heure de ce téléphone avant de scanner.';
 return null;
}

const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));

export async function offlineScan(token: string, code: string, data: ScannerManifest | null): Promise<ScanResult> {
 const initialError = offlineAvailability(data);
 if (initialError) throw new Error(initialError);
 const snapshot = data!;
 const [prefix, payload, signature, ...rest] = code.split('.');
 if (prefix !== 'PASS1' || !payload || !signature || rest.length) throw new Error('Code invalide.');
 let decoded: { e: string; t: string };
 try {
  const key = await crypto.subtle.importKey('jwk', snapshot.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(signature), new TextEncoder().encode(payload))) throw new Error();
  decoded = JSON.parse(new TextDecoder().decode(decode(payload)));
 } catch { throw new Error('Code invalide ou modifié.'); }
 const afterVerificationError = offlineAvailability(snapshot);
 if (afterVerificationError) throw new Error(afterVerificationError);
 if (decoded.e !== snapshot.event.id) throw new Error('Ce billet concerne un autre événement.');
 const ticket = snapshot.tickets.find(item => item.id === decoded.t && item.code === code);
 if (!ticket || ticket.status !== 'valid') throw new Error('Billet annulé ou inconnu.');
 if (ticket.scanned_at !== null && ticket.scanned_at !== undefined) {
  throw new Error('Déjà scanné à ' + new Date(ticket.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: snapshot.event.timezone }));
 }
 const db = await openDb();
 return new Promise((resolve, reject) => {
  const tx = db.transaction('scans', 'readwrite');
  const scans = tx.objectStore('scans');
  const key = token + ':' + ticket.id;
  const request = scans.get(key);
  let failure: Error | null = null;
  let record: PendingScan;
  request.onsuccess = () => {
   if (request.result) {
    failure = new Error('Déjà scanné sur ce téléphone à ' + new Date(request.result.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    tx.abort();
    return;
   }
   const at = Date.now();
   const windowError = offlineAvailability(snapshot, at);
   if (windowError) { failure = new Error(windowError); tx.abort(); return; }
   record = {
    key, token, code, at, synced: false, ticketId: ticket.id,
    syncToken: snapshot.syncToken, deviceId: snapshot.deviceId, syncUntil: snapshot.syncUntil,
   };
   scans.add(record);
  };
  tx.oncomplete = () => { db.close(); resolve({ ok: true, type: ticket.type_name, id: ticket.id, scannedAt: record.at, pending: true }); };
  tx.onabort = () => { db.close(); reject(failure || tx.error || new Error('Le scan n’a pas pu être enregistré.')); };
 });
}
