/**
 * Deterministic regression of the real server functions and SQL migrations.
 * A D1-shaped adapter runs SQLite transactions in memory. Controlled scheduling
 * hooks suspend SELECT snapshots or queued write batches, so the relevant
 * interleavings are guaranteed without request timing. No development database
 * or network is used.
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
const bundlePath = resolve(runtimeDirectory, `cancellation-race-${randomUUID()}.mjs`);
// This override is only for checking the regression against an old source copy.
const serverPath = resolve(root, process.env.CANCELLATION_TEST_SOURCE || 'lib/server.ts');
const envKey = `__cancellationRace_${randomUUID().replaceAll('-', '')}`;
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');

function deferred() {
  let resolvePromise;
  const promise = new Promise(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 5000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
    const snapshot = row ? { ...row } : null;
    await this.adapter.afterRead(this.sql, this.parameters);
    return column ? snapshot?.[column] ?? null : snapshot;
  }
  async all() {
    return {
      success: true,
      results: sqlite.prepare(this.sql).all(...this.parameters).map(row => ({ ...row })),
    };
  }
  execute() {
    const result = sqlite.prepare(this.sql).run(...this.parameters);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async run() { return this.execute(); }
}

class MemoryD1 {
  hook = null;
  batchHook = null;
  prepare(sql) { return new D1Statement(this, sql); }
  async batch(statements) {
    const hook = this.batchHook;
    if (hook && statements.some(statement => hook.matches(statement))) {
      this.batchHook = null;
      hook.reached.resolve();
      await hook.release.promise;
    }
    // Just like D1 batch, every write succeeds or the entire batch rolls back.
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
  async afterRead(sql, parameters) {
    const hook = this.hook;
    if (!hook || !hook.matches(sql, parameters)) return;
    this.hook = null;
    hook.reached.resolve();
    await hook.release.promise;
  }
  pauseTicketRead(prefix, ticketId) {
    assert.equal(this.hook, null, 'Only one controlled read can be suspended at once.');
    const reached = deferred(), release = deferred();
    this.hook = {
      reached,
      release,
      matches: (sql, parameters) => sql.startsWith(prefix) && parameters[0] === ticketId,
    };
    return { reached: reached.promise, release: release.resolve };
  }
  pauseCancellationWrite(ticketId) {
    assert.equal(this.batchHook, null, 'Only one controlled batch can be suspended at once.');
    const reached = deferred(), release = deferred();
    this.batchHook = {
      reached,
      release,
      matches: statement => statement.sql.startsWith("UPDATE tickets SET status='cancelled'") && statement.parameters[1] === ticketId,
    };
    return { reached: reached.promise, release: release.resolve };
  }
}

const database = new MemoryD1();
const runtime = { DB: database, DEMO_MODE: 'true', APP_URL: 'http://127.0.0.1:5173' };
globalThis[envKey] = runtime;

async function settle(operation) {
  try { return { value: await operation }; } catch (error) { return { error }; }
}

function ticketState(fixture) {
  return {
    ticket: { ...sqlite.prepare('SELECT status,scanned_at,refund_amount FROM tickets WHERE id=?').get(fixture.ticketId) },
    stock: { ...sqlite.prepare('SELECT capacity,sold,held FROM ticket_types WHERE id=?').get(fixture.typeId) },
    refunds: sqlite.prepare("SELECT count(*) total FROM jobs WHERE kind='refund' AND id=?").get('refund-' + fixture.ticketId).total,
  };
}

async function createFixture(server) {
  const suffix = randomUUID();
  const fixture = {
    eventId: 'event-' + suffix,
    typeId: 'type-' + suffix,
    orderId: 'order-' + suffix,
    ticketId: 'ticket-' + suffix,
    token: randomUUID(),
    scannerToken: randomUUID(),
    paymentId: 'demo-' + suffix,
    price: 2200,
  };
  const timestamp = Date.now(), start = timestamp + 7 * 86400000;
  sqlite.prepare("INSERT INTO events(id,collective_id,name,location,starts_at,doors_at,cancel_until,status,created_at) VALUES(?,'test-collective','Test course annulation / scan','Salle de test',?,?,?,'on_sale',?)")
    .run(fixture.eventId, start, start - 3600000, start - 2 * 86400000, timestamp);
  sqlite.prepare("INSERT INTO ticket_types(id,event_id,name,price,capacity) VALUES(?,?,'Fosse',?,1)")
    .run(fixture.typeId, fixture.eventId, fixture.price);
  sqlite.prepare("INSERT INTO orders(id,event_id,email,name,token,total,expires_at,created_at,demo) VALUES(?,?,'race@example.invalid','Test annulation',?,?,?,?,1)")
    .run(fixture.orderId, fixture.eventId, fixture.token, fixture.price, timestamp + 900000, timestamp);
  sqlite.prepare('INSERT INTO order_items(id,order_id,type_id,quantity,unit_price) VALUES(?,?,?,1,?)')
    .run(randomUUID(), fixture.orderId, fixture.typeId, fixture.price);
  sqlite.prepare("INSERT INTO payments(id,order_id,amount,status,created_at) VALUES(?,?,?,'paid',?)")
    .run(fixture.paymentId, fixture.orderId, fixture.price, timestamp);
  sqlite.prepare("UPDATE orders SET status='paid',payment_id=?,paid_at=? WHERE id=?")
    .run(fixture.paymentId, timestamp, fixture.orderId);
  fixture.code = await server.signTicket(fixture.eventId, fixture.ticketId);
  sqlite.prepare('INSERT INTO tickets(id,order_id,type_id,code) VALUES(?,?,?,?)')
    .run(fixture.ticketId, fixture.orderId, fixture.typeId, fixture.code);
  sqlite.prepare('INSERT INTO scanner_links(id,event_id,token,valid_from,valid_until,created_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), fixture.eventId, fixture.scannerToken, timestamp - 60000, timestamp + 3600000, timestamp);
  return fixture;
}

async function scanWins(server) {
  const fixture = await createFixture(server);
  const gate = database.pauseTicketRead('SELECT b.*,o.token', fixture.ticketId);
  const cancellation = settle(server.cancelTicket(fixture.ticketId, fixture.token, undefined));
  try {
    await withTimeout(gate.reached, 'The cancellation did not reach its pre-read.');
    const scan = await server.scan(fixture.scannerToken, fixture.code, 'scanner-wins');
    assert.equal(scan.ok, true, 'The scan must finish while cancellation holds a stale snapshot.');
  } finally {
    gate.release();
  }
  const outcome = await cancellation;
  const state = ticketState(fixture);
  assert.equal(outcome.error?.status, 409,
    'A buyer cannot cancel a ticket scanned after the pre-read: ' + JSON.stringify(state));
  assert.match(outcome.error.message, /utilisé|scanné/i);
  assert.equal(state.ticket.status, 'valid');
  assert.equal(typeof state.ticket.scanned_at, 'number');
  assert.equal(state.ticket.refund_amount, 0);
  assert.equal(state.refunds, 0, 'A rejected cancellation must not enqueue a refund.');
  assert.equal(state.stock.sold, 1, 'The used seat must remain sold.');
  assert.equal(state.stock.held, 0);
  await server.processJobs();
  assert.equal(sqlite.prepare('SELECT refunded FROM orders WHERE id=?').get(fixture.orderId).refunded, 0);
}

async function cancellationWins(server) {
  const fixture = await createFixture(server);
  const gate = database.pauseTicketRead('SELECT b.*,t.name type_name', fixture.ticketId);
  const scanning = settle(server.scan(fixture.scannerToken, fixture.code, 'cancellation-wins'));
  try {
    await withTimeout(gate.reached, 'The scan did not reach its pre-read.');
    const cancellation = await server.cancelTicket(fixture.ticketId, fixture.token, undefined);
    assert.equal(cancellation.ok, true);
  } finally {
    gate.release();
  }
  const outcome = await scanning;
  const state = ticketState(fixture);
  assert.equal(outcome.error?.status, 409,
    'A stale scanner read must report the cancellation, not a duplicate scan: ' + JSON.stringify(outcome.value));
  assert.match(outcome.error.message, /annulé/i);
  assert.equal(state.ticket.status, 'cancelled');
  assert.equal(state.ticket.scanned_at, null);
  assert.equal(state.ticket.refund_amount, fixture.price);
  assert.equal(state.refunds, 1);
  assert.equal(state.stock.sold, 0, 'Exactly one seat must be released.');
  assert.equal(state.stock.held, 0);
  await server.processJobs();
  await server.processJobs();
  assert.equal(sqlite.prepare('SELECT refunded FROM orders WHERE id=?').get(fixture.orderId).refunded, fixture.price,
    'Processing jobs twice must refund the cancelled seat only once.');
  assert.equal(sqlite.prepare("SELECT status FROM jobs WHERE id=? AND kind='refund'").get('refund-' + fixture.ticketId).status, 'done');
}

async function deadlinePassesBeforeWrite(server) {
  const fixture = await createFixture(server);
  const deadline = Date.now() + 1000;
  sqlite.prepare('UPDATE events SET cancel_until=? WHERE id=?').run(deadline, fixture.eventId);
  const gate = database.pauseCancellationWrite(fixture.ticketId);
  const cancellation = settle(server.cancelTicket(fixture.ticketId, fixture.token, undefined));
  try {
    await withTimeout(gate.reached, 'The cancellation did not reach its write batch.');
    assert(Date.now() < deadline, 'The pre-read must approve cancellation before the deadline.');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now()) + 25));
  } finally {
    gate.release();
  }
  const outcome = await cancellation;
  const state = ticketState(fixture);
  assert.equal(outcome.error?.status, 409,
    'A cancellation queued before the cutoff must be refused when its SQL write occurs after it: ' + JSON.stringify(state));
  assert.match(outcome.error.message, /délai|dépassé/i);
  assert.equal(state.ticket.status, 'valid');
  assert.equal(state.ticket.scanned_at, null);
  assert.equal(state.ticket.refund_amount, 0);
  assert.equal(state.refunds, 0);
  assert.equal(state.stock.sold, 1);
  assert.equal(state.stock.held, 0);
}

try {
  for (const file of (await readdir(resolve(root, 'drizzle'))).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(await readFile(resolve(root, 'drizzle', file), 'utf8'));
  }
  sqlite.prepare("INSERT INTO collectives(id,name,color,created_at) VALUES('test-collective','Test','#132a3b',?)").run(Date.now());
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const putSetting = sqlite.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
  putSetting.run('sign_private', JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey)));
  putSetting.run('sign_public', JSON.stringify(await crypto.subtle.exportKey('jwk', keys.publicKey)));
  putSetting.run('initialized', 'true');
  await mkdir(runtimeDirectory, { recursive: true });
  await build({
    entryPoints: [serverPath],
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
          contents: `export const env = globalThis[${JSON.stringify(envKey)}];`,
          loader: 'js',
        }));
      },
    }],
  });
  const server = await import(pathToFileURL(bundlePath).href);
  const failures = [];
  for (const [name, run] of [
    ['Scan gagné : annulation refusée, aucun remboursement ni place libérée', scanWins],
    ['Annulation gagnée : scan refusé comme annulé, une place et un remboursement', cancellationWins],
    ['Délai dépassé avant écriture : annulation refusée sans remboursement', deadlinePassesBeforeWrite],
  ]) {
    try {
      await run(server);
      console.log('OK — ' + name);
    } catch (error) {
      failures.push(error);
      console.error('ÉCHEC — ' + name + '\n' + error.message);
    }
  }
  assert.equal(failures.length, 0, `${failures.length} régression(s) annulation / scan.`);
  console.log('Courses annulation / scan vérifiées sur les fonctions serveur réelles et SQLite en mémoire.');
} finally {
  delete globalThis[envKey];
  sqlite.close();
  // Only remove this test's random bundle, inside the workspace runtime folder.
  assert.equal(dirname(bundlePath), runtimeDirectory);
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
