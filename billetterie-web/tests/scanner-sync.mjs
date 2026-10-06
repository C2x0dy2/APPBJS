/**
 * Security and concurrency tests of the real scanner services and HTTP routes.
 * SQLite uses every actual migration, in memory. Only the Worker environment
 * and scheduling at selected writes are replaced; no network or demo DB is used.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDirectory = resolve(root, '.sites-runtime');
const bundlePath = resolve(runtimeDirectory, `scanner-sync-${randomUUID()}.mjs`);
const envKey = `__scannerSync_${randomUUID().replaceAll('-', '')}`;
const realNow = Date.now.bind(Date);
let clock = null;
Date.now = () => clock ?? realNow();
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');

function deferred() {
  let resolvePromise;
  const promise = new Promise(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function withTimeout(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}

class D1Statement {
  constructor(adapter, sql, parameters = []) {
    this.adapter = adapter;
    this.sql = sql;
    this.parameters = parameters;
  }
  bind(...parameters) { return new D1Statement(this.adapter, this.sql, parameters); }
  async first(column) {
    const row = sqlite.prepare(this.sql).get(...this.parameters);
    const result = row ? { ...row } : null;
    return column ? result?.[column] ?? null : result;
  }
  async all() {
    return { success: true, results: sqlite.prepare(this.sql).all(...this.parameters).map(row => ({ ...row })) };
  }
  execute() {
    const result = sqlite.prepare(this.sql).run(...this.parameters);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async run() {
    await this.adapter.beforeWrite(this);
    return this.execute();
  }
}

class MemoryD1 {
  writeHook = null;
  prepare(sql) { return new D1Statement(this, sql); }
  async batch(statements) {
    for (const statement of statements) await this.beforeWrite(statement);
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.execute());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  async beforeWrite(statement) {
    const hook = this.writeHook;
    if (!hook || !hook.matches(statement)) return;
    this.writeHook = null;
    hook.reached.resolve();
    await hook.release.promise;
  }
  pauseWrite(matches) {
    assert.equal(this.writeHook, null, 'Only one controlled write can be suspended at once.');
    const reached = deferred(), release = deferred();
    this.writeHook = { matches, reached, release };
    return { reached: reached.promise, release: release.resolve };
  }
}

const database = new MemoryD1();
globalThis[envKey] = { DB: database, DEMO_MODE: 'true', APP_URL: 'http://127.0.0.1:5173' };
const request = () => new Request('http://127.0.0.1:5173/api/scanner');

async function settle(operation) {
  try { return { value: await operation }; } catch (error) { return { error }; }
}

async function rejectHttp(operation, status, message) {
  await assert.rejects(operation, error => error.status === status && (!message || message.test(error.message)));
}

function entered(fixture) {
  return sqlite.prepare('SELECT count(*) total FROM tickets b JOIN orders o ON o.id=b.order_id WHERE o.event_id=? AND b.scanned_at IS NOT NULL').get(fixture.eventId).total;
}

async function addTicket(server, fixture) {
  const orderId = randomUUID(), ticketId = randomUUID(), token = randomUUID(), paymentId = 'demo-' + randomUUID();
  const timestamp = realNow();
  sqlite.prepare("INSERT INTO orders(id,event_id,email,name,token,total,expires_at,created_at,demo) VALUES(?,?,'sync@example.invalid','Test synchronisation',?,2200,?,?,1)")
    .run(orderId, fixture.eventId, token, timestamp + 900000, timestamp);
  sqlite.prepare('INSERT INTO order_items(id,order_id,type_id,quantity,unit_price) VALUES(?,?,?,1,2200)')
    .run(randomUUID(), orderId, fixture.typeId);
  sqlite.prepare("INSERT INTO payments(id,order_id,amount,status,created_at) VALUES(?,?,2200,'paid',?)").run(paymentId, orderId, timestamp);
  sqlite.prepare("UPDATE orders SET status='paid',payment_id=?,paid_at=? WHERE id=?").run(paymentId, timestamp, orderId);
  const code = await server.signTicket(fixture.eventId, ticketId);
  sqlite.prepare('INSERT INTO tickets(id,order_id,type_id,code) VALUES(?,?,?,?)').run(ticketId, orderId, fixture.typeId, code);
  return { id: ticketId, code, token };
}

function addLink(fixture) {
  const id = randomUUID(), token = randomUUID(), timestamp = realNow();
  sqlite.prepare('INSERT INTO scanner_links(id,event_id,token,valid_from,valid_until,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, fixture.eventId, token, timestamp - 3600000, timestamp + 3600000, timestamp);
  return { id, token };
}

async function fixture(server) {
  const eventId = randomUUID(), typeId = randomUUID(), timestamp = realNow(), start = timestamp + 7 * 86400000;
  sqlite.prepare("INSERT INTO events(id,collective_id,name,location,starts_at,doors_at,cancel_until,status,created_at) VALUES(?,'sync-collective','Contrôle hors ligne','Salle de test',?,?,?,'on_sale',?)")
    .run(eventId, start, start - 3600000, start - 2 * 86400000, timestamp);
  sqlite.prepare("INSERT INTO ticket_types(id,event_id,name,price,capacity) VALUES(?,?,'Fosse',2200,100)").run(typeId, eventId);
  const result = { eventId, typeId, deviceId: 'device-' + randomUUID() };
  result.link = addLink(result);
  result.ticket = await addTicket(server, result);
  return result;
}

async function prepare(server, item, deviceId = item.deviceId, syncToken) {
  return server.prepareScanner(request(), item.link.token, deviceId, syncToken);
}

function sessionRow(item, deviceId = item.deviceId) {
  const row = sqlite.prepare('SELECT * FROM scanner_sessions WHERE link_id=? AND device_id=? ORDER BY rowid DESC LIMIT 1').get(item.link.id, deviceId);
  return row ? { ...row } : null;
}

/** Seed the state of an unchanged link and preparation issued the previous day. */
function historicalPreparation(item, prepared, syncUntil = realNow() + 3600000) {
  const validUntil = syncUntil - 86400000, preparedAt = validUntil - 300000, validFrom = preparedAt - 3600000;
  const stored = sessionRow(item), shift = preparedAt - stored.prepared_at;
  const downloadTimes = Object.fromEntries(Object.entries(JSON.parse(stored.ticket_ids)).map(([id, at]) => [id, at + shift]));
  sqlite.prepare('UPDATE scanner_links SET valid_from=?,valid_until=? WHERE id=?').run(validFrom, validUntil, item.link.id);
  sqlite.prepare('UPDATE scanner_sessions SET prepared_at=?,valid_from=?,valid_until=?,sync_until=?,ticket_ids=? WHERE link_id=? AND device_id=?')
    .run(preparedAt, validFrom, validUntil, syncUntil, JSON.stringify(downloadTimes), item.link.id, item.deviceId);
  return { ...prepared, preparedAt, validFrom, validUntil, syncUntil };
}

async function api(routes, path, data, expectedStatus, options = {}) {
  const method = data === undefined ? 'GET' : 'POST';
  const response = await routes[method](new Request('http://127.0.0.1:5173/api/' + path, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
    body: method === 'POST' ? (options.rawBody ?? JSON.stringify(data)) : undefined,
  }), { params: Promise.resolve({ path: path.split('/') }) });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
  return body;
}

async function preparedCredential({ server, routes }) {
  const item = await fixture(server);
  const prepared = await api(routes, `scanner/${item.link.token}/prepare`, { deviceId: item.deviceId }, 200);
  assert.equal(prepared.event.id, item.eventId);
  assert.equal(prepared.deviceId, item.deviceId);
  assert.match(prepared.syncToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(prepared.syncUntil, prepared.validUntil + 86400000);
  assert(prepared.preparedAt >= prepared.validFrom && prepared.preparedAt < prepared.validUntil);
  assert.deepEqual(prepared.tickets.map(ticket => ticket.id), [item.ticket.id]);
  assert.equal(prepared.publicKey.kty, 'EC');
  const before = sessionRow(item);
  assert.notEqual(before.token_hash, prepared.syncToken);
  assert(!JSON.stringify(before).includes(prepared.syncToken), 'The plain synchronization credential must never be stored in D1.');
  const again = await prepare(server, item, item.deviceId, prepared.syncToken);
  assert.equal(again.syncToken, prepared.syncToken);
  assert.equal(again.preparedAt, prepared.preparedAt);
  assert.deepEqual(sessionRow(item), before, 'Refreshing status must not broaden or mutate the existing session.');
  const manifest = await api(routes, `scanner/${item.link.token}`, undefined, 200);
  assert.equal(manifest.syncToken, undefined, 'A manifest GET must not mint a synchronization credential.');
}

async function syncAfterLinkExpiry({ server, routes }) {
  const item = await fixture(server);
  const prepared = historicalPreparation(item, await prepare(server, item));
  const result = await api(routes, `scanner/${item.link.token}/sync`, {
    deviceId: item.deviceId, syncToken: prepared.syncToken,
    scans: [{ code: item.ticket.code, at: prepared.preparedAt + 1 }],
  }, 200);
  assert.equal(result.results[0].ok, true);
  assert.equal(entered(item), 1);
  assert.equal(sqlite.prepare('SELECT scanned_at FROM tickets WHERE id=?').get(item.ticket.id).scanned_at, prepared.preparedAt + 1);
  await rejectHttp(() => server.scanner(request(), item.link.token), 403);
  await rejectHttp(() => prepare(server, item, item.deviceId, prepared.syncToken), 403);
  await rejectHttp(() => server.scan(item.link.token, item.ticket.code, item.deviceId), 403);
  await api(routes, `scanner/${item.link.token}`, undefined, 403);
  await api(routes, `scanner/${item.link.token}/prepare`, { deviceId: item.deviceId }, 403);
  await api(routes, `scanner/${item.link.token}`, { deviceId: item.deviceId, code: item.ticket.code, at: prepared.preparedAt }, 403);
}

async function credentialScope({ server }) {
  const item = await fixture(server), prepared = await prepare(server, item);
  const scans = [{ code: item.ticket.code, at: prepared.preparedAt }];
  await rejectHttp(() => server.syncScanner(item.link.token, item.deviceId, undefined, scans), 403);
  await rejectHttp(() => server.syncScanner(item.link.token, item.deviceId, 'A'.repeat(43), scans), 403);
  await rejectHttp(() => server.syncScanner(item.link.token, item.deviceId + '-other', prepared.syncToken, scans), 403);
  const anotherLink = addLink(item);
  await rejectHttp(() => server.syncScanner(anotherLink.token, item.deviceId, prepared.syncToken, scans), 403);
  const otherEvent = await fixture(server);
  await rejectHttp(() => server.syncScanner(otherEvent.link.token, item.deviceId, prepared.syncToken, scans), 403);
  assert.equal(entered(item), 0);
}

async function timestamps({ server }) {
  const item = await fixture(server), prepared = await prepare(server, item);
  const times = [prepared.preparedAt - 1, prepared.validFrom - 1, prepared.validUntil, realNow() + 10000, prepared.preparedAt + 0.5, undefined, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1];
  const result = await server.syncScanner(item.link.token, item.deviceId, prepared.syncToken, times.map(at => ({ code: item.ticket.code, at })));
  assert.equal(result.results.length, times.length);
  for (const rejection of result.results) {
    assert.equal(rejection.ok, false);
    assert.match(rejection.reason, /heure|période/i);
  }
  assert.equal(entered(item), 0);
}

async function ticketScope({ server }) {
  const item = await fixture(server), prepared = await prepare(server, item);
  const addedLater = await addTicket(server, item);
  const otherEvent = await fixture(server);
  const signedUnknown = await server.signTicket(item.eventId, randomUUID());
  const parts = item.ticket.code.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await server.cancelTicket(item.ticket.id, item.ticket.token, undefined);
  const result = await server.syncScanner(item.link.token, item.deviceId, prepared.syncToken, [
    { code: addedLater.code, at: prepared.preparedAt },
    { code: otherEvent.ticket.code, at: prepared.preparedAt },
    { code: signedUnknown, at: prepared.preparedAt },
    { code: parts.join('.'), at: prepared.preparedAt },
    { code: item.ticket.code, at: prepared.preparedAt },
  ]);
  const reasons = [/préparation/i, /autre événement/i, /préparation|inconnu/i, /invalide|modifié|signature/i, /annulé/i];
  assert.equal(result.results.length, reasons.length);
  result.results.forEach((rejection, index) => {
    assert.equal(rejection.ok, false);
    assert.match(rejection.reason, reasons[index]);
  });
  assert.equal(entered(item), 0);
  assert.equal(entered(otherEvent), 0);
}

async function idempotency({ server }) {
  const item = await fixture(server), prepared = await prepare(server, item);
  const scan = { code: item.ticket.code, at: prepared.preparedAt };
  const first = await server.syncScanner(item.link.token, item.deviceId, prepared.syncToken, [scan, scan]);
  assert.equal(first.results[0].ok, true);
  assert.equal(first.results[1].ok, false);
  assert.equal(first.results[1].sameDevice, true);
  const again = await server.syncScanner(item.link.token, item.deviceId, prepared.syncToken, [scan]);
  assert.equal(again.results[0].sameDevice, true);
  assert.equal(again.results[0].scannedAt, prepared.preparedAt);
  assert.equal(entered(item), 1);
}

async function twoDevices({ server }) {
  const item = await fixture(server);
  const first = await prepare(server, item), otherDevice = item.deviceId + '-other';
  const second = await prepare(server, item, otherDevice);
  assert.notEqual(first.syncToken, second.syncToken);
  const results = await Promise.all([
    server.syncScanner(item.link.token, item.deviceId, first.syncToken, [{ code: item.ticket.code, at: first.preparedAt }]),
    server.syncScanner(item.link.token, otherDevice, second.syncToken, [{ code: item.ticket.code, at: second.preparedAt }]),
  ]);
  const responses = results.map(result => result.results[0]);
  assert.equal(responses.filter(result => result.ok).length, 1, 'Exactly one device can consume the ticket.');
  const duplicate = responses.find(result => !result.ok);
  assert.equal(duplicate.sameDevice, false);
  assert.match(duplicate.reason, /déjà scanné/i);
  assert.equal(entered(item), 1);
}

async function rotation({ server }) {
  const item = await fixture(server), first = await prepare(server, item);
  const initial = sessionRow(item);
  const added = await addTicket(server, item);
  const beforeRefresh = await server.syncScanner(item.link.token, item.deviceId, first.syncToken, [{ code: added.code, at: first.preparedAt }]);
  assert.equal(beforeRefresh.results[0].ok, false);
  assert.match(beforeRefresh.results[0].reason, /préparation/i);
  // Ensure the new ticket's first download is later than the original batch.
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = await prepare(server, item, item.deviceId, first.syncToken);
  assert.equal(second.syncToken, first.syncToken, 'Refreshing new tickets must reuse the device credential.');
  assert.equal(second.preparedAt, first.preparedAt);
  const current = sessionRow(item);
  assert.deepEqual({ ...current, ticket_ids: initial.ticket_ids }, initial, 'Only first-download entries may be appended to an existing session.');
  const originalTimes = JSON.parse(initial.ticket_ids), downloadTimes = JSON.parse(current.ticket_ids);
  assert.equal(downloadTimes[item.ticket.id], originalTimes[item.ticket.id]);
  assert(Number.isSafeInteger(downloadTimes[added.id]));
  assert(downloadTimes[added.id] > first.preparedAt);
  const rejected = await server.syncScanner(item.link.token, item.deviceId, first.syncToken, [{ code: added.code, at: downloadTimes[added.id] - 1 }]);
  assert.equal(rejected.results[0].ok, false);
  assert.match(rejected.results[0].reason, /heure|période|préparation/i);
  const oldTicket = await server.syncScanner(item.link.token, item.deviceId, first.syncToken, [{ code: item.ticket.code, at: first.preparedAt }]);
  const newTicket = await server.syncScanner(item.link.token, item.deviceId, second.syncToken, [{ code: added.code, at: downloadTimes[added.id] }]);
  assert.equal(oldTicket.results[0].ok, true);
  assert.equal(newTicket.results[0].ok, true);
  assert.equal(entered(item), 2);
}

async function manyRefreshes({ server }) {
  const item = await fixture(server), prepared = await prepare(server, item);
  const initial = sessionRow(item), firstDownload = JSON.parse(initial.ticket_ids)[item.ticket.id];
  for (let index = 0; index < 66; index++) {
    const added = await addTicket(server, item);
    const refreshed = await prepare(server, item, item.deviceId, prepared.syncToken);
    assert.equal(refreshed.syncToken, prepared.syncToken);
    assert.equal(refreshed.preparedAt, prepared.preparedAt);
    const current = sessionRow(item), downloads = JSON.parse(current.ticket_ids);
    assert.equal(current.id, initial.id);
    assert.equal(downloads[item.ticket.id], firstDownload);
    assert(Number.isSafeInteger(downloads[added.id]));
    assert.equal(Object.keys(downloads).length, index + 2);
  }
  assert.equal(sqlite.prepare('SELECT count(*) total FROM scanner_sessions WHERE link_id=?').get(item.link.id).total, 1,
    'Ordinary new-ticket refreshes must not exhaust the 64-session cap.');
}

async function expiryAndRevocation({ server }) {
  const expired = await fixture(server), expiredPreparation = await prepare(server, expired);
  clock = expiredPreparation.syncUntil;
  await rejectHttp(() => server.syncScanner(expired.link.token, expired.deviceId, expiredPreparation.syncToken, []), 403);
  clock = null;
  const changed = await fixture(server), changedPreparation = await prepare(server, changed);
  sqlite.prepare('UPDATE scanner_links SET valid_until=valid_until+1000 WHERE id=?').run(changed.link.id);
  await rejectHttp(() => server.syncScanner(changed.link.token, changed.deviceId, changedPreparation.syncToken, []), 403);
  const deleted = await fixture(server), deletedPreparation = await prepare(server, deleted);
  sqlite.prepare('DELETE FROM scanner_links WHERE id=?').run(deleted.link.id);
  await rejectHttp(() => server.syncScanner(deleted.link.token, deleted.deviceId, deletedPreparation.syncToken, []), 403);
  assert.equal(entered(expired) + entered(changed) + entered(deleted), 0);
}

async function queuedSyncRevocation({ server }) {
  const item = await fixture(server), prepared = await prepare(server, item);
  const gate = database.pauseWrite(statement => statement.sql.startsWith('UPDATE tickets SET scanned_at=') && statement.parameters[2] === item.ticket.id);
  const pending = settle(server.syncScanner(item.link.token, item.deviceId, prepared.syncToken, [{ code: item.ticket.code, at: prepared.preparedAt }]));
  try {
    await withTimeout(gate.reached, 'The sync did not reach its conditional scan write.');
    sqlite.prepare('DELETE FROM scanner_links WHERE id=?').run(item.link.id);
  } finally { gate.release(); }
  const result = await pending;
  assert.equal(result.error?.status, 403, 'Revocation must be checked by the scan write, after its preliminary authorization.');
  assert.equal(entered(item), 0);
}

async function queuedSyncExpiry({ server }) {
  const item = await fixture(server), active = await prepare(server, item);
  const deadline = realNow() + 1000;
  const prepared = historicalPreparation(item, active, deadline);
  const gate = database.pauseWrite(statement => statement.sql.startsWith('UPDATE tickets SET scanned_at=') && statement.parameters[2] === item.ticket.id);
  const pending = settle(server.syncScanner(item.link.token, item.deviceId, prepared.syncToken, [{ code: item.ticket.code, at: prepared.preparedAt }]));
  try {
    await withTimeout(gate.reached, 'The sync did not reach its conditional scan write.');
    assert(realNow() < deadline);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - realNow()) + 25));
  } finally { gate.release(); }
  const result = await pending;
  assert.equal(result.error?.status, 403, 'A queued scan must not be written after its synchronization grace expires.');
  assert.equal(entered(item), 0);
}

async function queuedPreparationExpiry({ server }) {
  const item = await fixture(server), deadline = realNow() + 1000;
  sqlite.prepare('UPDATE scanner_links SET valid_until=? WHERE id=?').run(deadline, item.link.id);
  const gate = database.pauseWrite(statement => statement.sql.startsWith('INSERT INTO scanner_sessions') && statement.parameters[1] === item.link.id);
  const pending = settle(prepare(server, item));
  try {
    await withTimeout(gate.reached, 'The preparation did not reach its authorization write.');
    assert(realNow() < deadline);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - realNow()) + 25));
  } finally { gate.release(); }
  const result = await pending;
  assert.equal(result.error?.status, 403, 'Preparation cannot be authorized after link expiry.');
  assert.equal(sessionRow(item), null);
}

async function concurrentPreparationLimit({ server }) {
  const item = await fixture(server);
  const results = await Promise.allSettled(Array.from({ length: 80 }, (_, index) => prepare(server, item, 'parallel-' + index)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 64);
  const denied = results.filter(result => result.status === 'rejected');
  assert.equal(denied.length, 16);
  denied.forEach(result => assert.equal(result.reason.status, 429));
  assert.equal(sqlite.prepare('SELECT count(*) total FROM scanner_sessions WHERE link_id=?').get(item.link.id).total, 64);
}

async function routeValidation({ server, routes }) {
  const item = await fixture(server), prepared = await prepare(server, item);
  const path = `scanner/${item.link.token}/sync`;
  const data = { deviceId: item.deviceId, syncToken: prepared.syncToken, scans: [{ code: item.ticket.code, at: prepared.preparedAt }] };
  await api(routes, path, { deviceId: item.deviceId, scans: data.scans }, 400);
  await api(routes, path, { ...data, syncToken: 'bad-token' }, 400);
  await api(routes, path, { ...data, deviceId: '' }, 400);
  await api(routes, path, { ...data, deviceId: 'x'.repeat(101) }, 400);
  await api(routes, path, { ...data, scans: [{ code: item.ticket.code, at: prepared.preparedAt + 0.5 }] }, 400);
  await api(routes, path, { ...data, scans: [{ code: item.ticket.code, at: -1 }] }, 400);
  await api(routes, path, { ...data, scans: [{ code: item.ticket.code }] }, 400);
  await api(routes, path, { ...data, scans: Array.from({ length: 601 }, () => data.scans[0]) }, 400);
  await api(routes, path, data, 400, { rawBody: '{broken JSON' });
  await api(routes, path, data, 413, { rawBody: JSON.stringify({ ...data, padding: 'x'.repeat(262144) }) });
  await api(routes, path, data, 403, { headers: { Origin: 'https://another-origin.invalid' } });
  assert.equal(entered(item), 0, 'Malformed or foreign-origin requests must not consume tickets.');
  const before = realNow();
  await api(routes, `scanner/${item.link.token}`, { code: item.ticket.code, deviceId: item.deviceId, at: 0 }, 200);
  assert(sqlite.prepare('SELECT scanned_at FROM tickets WHERE id=?').get(item.ticket.id).scanned_at >= before,
    'The live route must ignore caller-supplied timestamps.');
  assert.equal(entered(item), 1);
}

try {
  for (const file of (await readdir(resolve(root, 'drizzle'))).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(await readFile(resolve(root, 'drizzle', file), 'utf8'));
  }
  assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scanner_sessions'").get(), 'The scanner session migration must exist.');
  sqlite.prepare("INSERT INTO collectives(id,name,color,created_at) VALUES('sync-collective','Test','#132a3b',?)").run(realNow());
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const putSetting = sqlite.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
  putSetting.run('sign_private', JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey)));
  putSetting.run('sign_public', JSON.stringify(await crypto.subtle.exportKey('jwk', keys.publicKey)));
  putSetting.run('initialized', 'true');
  await mkdir(runtimeDirectory, { recursive: true });
  await build({
    stdin: {
      contents: "export * as server from './lib/server.ts'; export * as routes from './app/api/[...path]/route.ts';",
      resolveDir: root,
      sourcefile: 'scanner-sync-entry.mjs',
      loader: 'js',
    },
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    tsconfig: resolve(root, 'tsconfig.json'),
    define: { 'import.meta.env.DEV': 'true' },
    plugins: [{
      name: 'memory-d1-environment',
      setup(plugin) {
        plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'environment', namespace: 'test-env' }));
        plugin.onLoad({ filter: /.*/, namespace: 'test-env' }, () => ({
          contents: `export const env = globalThis[${JSON.stringify(envKey)}];`, loader: 'js',
        }));
        plugin.onResolve({ filter: /^@\/lib\/server$/ }, () => ({ path: resolve(root, 'lib/server.ts') }));
      },
    }],
  });
  const modules = await import(pathToFileURL(bundlePath).href);
  const failures = [];
  for (const [name, test] of [
    ['Préparation et réutilisation immuable, secret haché en base', preparedCredential],
    ['Synchronisation le lendemain ; préparation et scans directs expirés refusés', syncAfterLinkExpiry],
    ['Autorisation limitée au téléphone, au lien et à son événement', credentialScope],
    ['Dates absentes, antidatées, futures et hors période refusées', timestamps],
    ['Billets non préparés, autre événement, QR modifié et annulation refusés', ticketScope],
    ['Rejeu sur le même téléphone : une seule entrée', idempotency],
    ['Deux téléphones simultanés : un seul gagnant', twoDevices],
    ['Nouveaux billets : secret conservé, horodatage de première préparation respecté', rotation],
    ['66 actualisations avec nouveaux billets : une seule session', manyRefreshes],
    ['Expiration, changement de période et suppression du lien révoquent le secret', expiryAndRevocation],
    ['Révocation après vérification : écriture du scan refusée', queuedSyncRevocation],
    ['Fin de grâce après vérification : écriture du scan refusée', queuedSyncExpiry],
    ['Expiration du lien après vérification : préparation refusée', queuedPreparationExpiry],
    ['80 préparations simultanées : plafond atomique de 64', concurrentPreparationLimit],
    ['API : validation, limites de taille, origine et date du scan direct', routeValidation],
  ]) {
    try {
      await test(modules);
      console.log('OK — ' + name);
    } catch (error) {
      failures.push(error);
      console.error('ÉCHEC — ' + name + '\n' + error.message);
    } finally {
      clock = null;
    }
  }
  assert.equal(failures.length, 0, `${failures.length} régression(s) de synchronisation scanneur.`);
  console.log('15 scénarios de sécurité et concurrence scanneur vérifiés sur serveur et routes réels, sans réseau.');
} finally {
  Date.now = realNow;
  delete globalThis[envKey];
  sqlite.close();
  assert.equal(dirname(bundlePath), runtimeDirectory);
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
