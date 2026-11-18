// Banc d'essai de sécurité des migrations Supabase, sur PGlite (Postgres en WebAssembly : ni Docker ni projet en ligne).
// Usage, depuis supabase/tests :  npm install  puis  npm test
// 1. applique 0001..0016 sur un faux Supabase (rôles anon/authenticated/service_role et leurs privilèges par défaut),
//    joue chaque attaque (A..) et chaque parcours normal de l'app (F..) : colonne AVANT ;
// 2. applique les migrations >= 0017 sur la même base (comme en production, données comprises), rejoue tout : APRÈS.
// Le script échoue (code 2) si un parcours normal qui marchait AVANT ne marche plus APRÈS.
// Ajouter une attaque : une entrée dans `attacks` qui renvoie { hit: true } si l'attaque RÉUSSIT.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const project = process.argv[2] ?? new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const migDir = path.join(project, 'supabase', 'migrations');
const all = fs.readdirSync(migDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const base = all.filter((f) => f < '0017');
const fixes = all.filter((f) => f >= '0017');
const read = (f) => fs.readFileSync(path.join(migDir, f), 'utf8');

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(new URL('./supabase-stub.sql', import.meta.url), 'utf8'));
for (const f of base) {
  try {
    await db.exec(read(f));
  } catch (e) {
    throw new Error(`migration ${f}: ${e.message}`);
  }
}

// ------------------------------------------------------------------------------------------- outils
async function as(role, uid, sql, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
  try {
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows };
  } catch (e) {
    return { ok: false, err: e.message, rows: [] };
  } finally {
    await db.exec('reset role');
  }
}
const sys = async (sql, params = []) => {
  const r = await as('postgres', null, sql, params);
  if (!r.ok) throw new Error(`${r.err}\n  in: ${sql}`);
  return r.rows;
};
const one = async (sql, params) => (await sys(sql, params))[0];
const rnd = () => randomUUID().slice(0, 8);

// ------------------------------------------------------------------------------------------- données
const U = {};
for (const [name, verified] of [
  ['orgA', true], ['mgrA', true], ['ctrlA', true], ['orgB', true],
  ['buyer1', true], ['buyer2', true], ['buyer3', true], ['unverified', false], ['noprofile', true],
]) {
  U[name] = (await one(
    `insert into auth.users (email, email_confirmed_at) values ($1, ${verified ? 'now()' : 'null'}) returning id`,
    [`${name}@test.local`]
  )).id;
  if (name !== 'noprofile') await sys(`insert into profiles (id, username) values ($1, $2)`, [U[name], name.toLowerCase()]);
}
const colA = (await one(`insert into collectives (name, slug) values ('Collectif A', 'a') returning id`)).id;
const colB = (await one(`insert into collectives (name, slug) values ('Collectif B', 'b') returning id`)).id;
await sys(
  `insert into collective_members (collective_id, user_id, role) values
   ($1, $2, 'admin'), ($1, $3, 'manager'), ($1, $4, 'controller'), ($5, $6, 'admin')`,
  [colA, U.orgA, U.mgrA, U.ctrlA, colB, U.orgB]
);

async function makeEvent(collectiveId, { status = 'on_sale', days = 30, types = [['Normal', 20, 2000]] } = {}) {
  const name = `Ev ${rnd()}`;
  const ev = await one(
    `insert into events (collective_id, name, starts_at, status, slug)
     values ($1, $2, now() + make_interval(days => $3), $4, $5) returning id`,
    [collectiveId, name, days, status, `ev-${rnd()}`]
  );
  const tt = [];
  for (const [n, q, p] of types) {
    tt.push((await one(
      `insert into ticket_types (event_id, name, quantity, price_cents) values ($1, $2, $3, $4) returning id`,
      [ev.id, n, q, p]
    )).id);
  }
  return { id: ev.id, tt };
}

async function makeOrder(eventId, userId, items, { status = 'pending', method = 'card' } = {}) {
  let total = 0;
  for (const [, q, price] of items) total += q * price;
  const email = userId ? (await one(`select email from auth.users where id = $1`, [userId])).email : 'x@test.local';
  const o = await one(
    `insert into orders (event_id, buyer_email, payment_method, status, total_cents, currency, expires_at, user_id, paid_at)
     values ($1, $2, $3::payment_method, $4::order_status, $5, 'EUR', now() + interval '15 minutes', $6,
             case when $4::order_status = 'paid' then now() end)
     returning id, access_token`,
    [eventId, email, method, status, total, userId]
  );
  for (const [tt, q, price] of items) {
    const oi = await one(
      `insert into order_items (order_id, ticket_type_id, quantity, unit_price_cents) values ($1, $2, $3, $4) returning id`,
      [o.id, tt, q, price]
    );
    if (status === 'paid') await sys(`insert into tickets (order_item_id) select $1 from generate_series(1, $2)`, [oi.id, q]);
  }
  return { id: o.id, token: o.access_token, total };
}

async function newBuyer() {
  return (await one(`insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`, [`b${rnd()}@test.local`])).id;
}

const reserve = (uid, eventId, items, method = 'card') =>
  as('authenticated', uid, `select * from reserve_seats_multi($1, $2::jsonb, $3::payment_method)`, [
    eventId,
    JSON.stringify(items.map(([t, q]) => ({ ticket_type_id: t, quantity: q }))),
    method,
  ]);
const canExec = async (role, sig) =>
  (await one(`select has_function_privilege($1, $2, 'execute') as ok`, [role, sig])).ok;

// ------------------------------------------------------------------------------------------- attaques
// Chaque attaque renvoie true si elle RÉUSSIT (= faille présente).
const attacks = [
  ['A01', 'anon : confirm_payment avec un faux paiement -> billets gratuits', async () => {
    const ev = await makeEvent(colA);
    const o = await makeOrder(ev.id, U.buyer2, [[ev.tt[0], 2, 2000]]);
    const payload = JSON.stringify({ data: { object: { amount_total: o.total } } });
    const r = await as('anon', null, `select * from confirm_payment($1, $2, $3::jsonb)`, [`evt_${rnd()}`, o.id, payload]);
    const st = (await one(`select status from orders where id = $1`, [o.id])).status;
    return { hit: r.ok && st === 'paid', info: r.ok ? `commande ${st}` : r.err };
  }],
  ['A02', 'acheteur connecté : confirm_payment sur sa propre réservation', async () => {
    const ev = await makeEvent(colA);
    const o = await makeOrder(ev.id, U.buyer1, [[ev.tt[0], 1, 2000]]);
    const payload = JSON.stringify({ data: { object: { amount_total: o.total } } });
    const r = await as('authenticated', U.buyer1, `select * from confirm_payment($1, $2, $3::jsonb)`, [`evt_${rnd()}`, o.id, payload]);
    const st = (await one(`select status from orders where id = $1`, [o.id])).status;
    return { hit: r.ok && st === 'paid', info: r.ok ? `commande ${st}` : r.err };
  }],
  ['A03', 'anon peut exécuter les fonctions internes', async () => {
    const sigs = [
      'mark_order_refunded(uuid)', 'offer_next_waitlist_entry(uuid)', 'expire_stale_reservations()',
      'reserve_seats(uuid,integer,text,payment_method)', 'confirm_payment(text,uuid,jsonb)',
    ];
    const open = [];
    for (const s of sigs) if (await canExec('anon', `public.${s}`)) open.push(s.split('(')[0]);
    return { hit: open.length > 0, info: open.join(', ') || 'aucune' };
  }],
  ['A04', 'anon lit les notifications Stripe (payment_events)', async () => {
    await sys(`insert into payment_events (provider_event_id, payload) values ($1, '{"email":"client@x"}')`, [`evt_${rnd()}`]);
    const r = await as('anon', null, `select count(*)::int as n from payment_events`);
    return { hit: r.ok && r.rows[0].n > 0, info: r.ok ? `${r.rows[0].n} lignes` : r.err };
  }],
  ['A05', 'anon renomme un collectif', async () => {
    const r = await as('anon', null, `update collectives set name = 'PIRATÉ' where id = $1 returning id`, [colB]);
    await sys(`update collectives set name = 'Collectif B' where id = $1`, [colB]);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length} ligne(s)` : r.err };
  }],
  ['A06', 'anon supprime un collectif (et ses événements)', async () => {
    const c = (await one(`insert into collectives (name, slug) values ('Victime', $1) returning id`, [`v-${rnd()}`])).id;
    await makeEvent(c, { status: 'draft' });
    const r = await as('anon', null, `delete from collectives where id = $1 returning id`, [c]);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length} ligne(s)` : r.err };
  }],
  ['A07', 'anon crée un collectif', async () => {
    const r = await as('anon', null, `insert into collectives (name, slug) values ('Faux', $1) returning id`, [`f-${rnd()}`]);
    return { hit: r.ok, info: r.ok ? 'créé' : r.err };
  }],
  ['A08', 'anon réserve sans compte (ancienne reserve_seats)', async () => {
    const ev = await makeEvent(colA);
    const r = await as('anon', null, `select id from reserve_seats($1, 5, 'victime@x', 'card')`, [ev.tt[0]]);
    return { hit: r.ok, info: r.ok ? '5 places bloquées' : r.err };
  }],
  ['A09', 'un compte bloque 15 places en une commande (max 10)', async () => {
    const ev = await makeEvent(colA, { types: [['Normal', 100, 2000]] });
    const r = await reserve(U.buyer1, ev.id, [[ev.tt[0], 15]]);
    return { hit: r.ok, info: r.ok ? 'accepté' : r.err };
  }],
  ['A10', 'un compte enchaîne 4 réservations en attente', async () => {
    const ev = await makeEvent(colA, { types: [['Normal', 100, 2000]] });
    let n = 0;
    let last = '';
    for (let i = 0; i < 4; i++) {
      const r = await reserve(U.buyer3, ev.id, [[ev.tt[0], 3]]);
      if (r.ok) n++;
      else last = r.err;
    }
    await sys(`update orders set status = 'expired' where user_id = $1 and status = 'pending'`, [U.buyer3]);
    return { hit: n === 4, info: `${n}/4 acceptées ${last}` };
  }],
  ['A11', 'réserver pour un événement déjà passé', async () => {
    const ev = await makeEvent(colA, { days: -1 });
    const r = await reserve(U.buyer1, ev.id, [[ev.tt[0], 1]]);
    return { hit: r.ok, info: r.ok ? 'accepté' : r.err };
  }],
  ['A12', 'réserver avec un e-mail non vérifié', async () => {
    const ev = await makeEvent(colA);
    const r = await reserve(U.unverified, ev.id, [[ev.tt[0], 1]]);
    return { hit: r.ok, info: r.ok ? 'accepté' : r.err };
  }],
  ['A13', 'manager : UPDATE direct d\'une commande en « payée »', async () => {
    const ev = await makeEvent(colA);
    const o = await makeOrder(ev.id, U.buyer2, [[ev.tt[0], 1, 2000]]);
    const r = await as('authenticated', U.mgrA, `update orders set status = 'paid' where id = $1 returning id`, [o.id]);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length} ligne(s)` : r.err };
  }],
  ['A14', 'manager : annule un événement en direct, sans remboursement', async () => {
    const ev = await makeEvent(colA);
    const r = await as('authenticated', U.mgrA, `update events set status = 'cancelled' where id = $1 returning id`, [ev.id]);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length} ligne(s)` : r.err };
  }],
  ['A15', 'manager : remet en vente un événement annulé', async () => {
    const ev = await makeEvent(colA, { status: 'cancelled' });
    const r = await as('authenticated', U.mgrA, `update events set status = 'on_sale' where id = $1 returning id`, [ev.id]);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length} ligne(s)` : r.err };
  }],
  ['A16', 'manager : capacité réduite sous les places vendues', async () => {
    const ev = await makeEvent(colA, { types: [['VIP', 5, 5000]] });
    await makeOrder(ev.id, U.buyer2, [[ev.tt[0], 3, 5000]], { status: 'paid' });
    const r = await as('authenticated', U.mgrA, `update ticket_types set quantity = 1 where id = $1 returning id`, [ev.tt[0]]);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length} ligne(s)` : r.err };
  }],
  ['A17', 'contrôleur : annule un événement entier', async () => {
    const ev = await makeEvent(colA);
    const r = await as('authenticated', U.ctrlA, `select * from cancel_event($1)`, [ev.id]);
    return { hit: r.ok, info: r.ok ? 'annulé' : r.err };
  }],
  ['A18', 'contrôleur : exporte les e-mails des participants', async () => {
    const ev = await makeEvent(colA);
    await makeOrder(ev.id, U.buyer2, [[ev.tt[0], 1, 2000]], { status: 'paid' });
    const r = await as('authenticated', U.ctrlA, `select * from get_event_participants($1)`, [ev.id]);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length} e-mail(s)` : r.err };
  }],
  ['A19', 'contrôleur : rembourse une commande', async () => {
    const ev = await makeEvent(colA);
    const o = await makeOrder(ev.id, U.buyer2, [[ev.tt[0], 1, 2000]], { status: 'paid', method: 'transfer' });
    const r = await as('authenticated', U.ctrlA, `select * from refund_order($1, null)`, [o.id]);
    return { hit: r.ok, info: r.ok ? 'remboursé' : r.err };
  }],
  ['A20', 'contrôleur : marque un virement comme payé', async () => {
    const ev = await makeEvent(colA);
    const o = await makeOrder(ev.id, U.buyer2, [[ev.tt[0], 1, 2000]], { method: 'transfer' });
    const r = await as('authenticated', U.ctrlA, `select * from mark_order_paid_by_transfer($1)`, [o.id]);
    return { hit: r.ok, info: r.ok ? 'payé' : r.err };
  }],
  ['A21', 'contrôleur : lit les commandes (e-mails) en direct', async () => {
    const r = await as('authenticated', U.ctrlA, `select buyer_email from orders`);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length} commande(s)` : r.err };
  }],
  ['A22', 'organisateur B lit les commandes du collectif A', async () => {
    const r = await as('authenticated', U.orgB, `select o.id from orders o join events e on e.id = o.event_id where e.collective_id = $1`, [colA]);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length}` : r.err };
  }],
  ['A23', 'anon : liste d\'attente pour 999 999 places (bloque la file)', async () => {
    const ev = await makeEvent(colA);
    const r = await as('anon', null, `select id from join_waitlist($1, 'spam@x', 999999)`, [ev.tt[0]]);
    return { hit: r.ok, info: r.ok ? 'inscrit' : r.err };
  }],
  ['A24', 'anon : crée le profil (nom d\'utilisateur) d\'un autre compte', async () => {
    const r = await as('anon', null, `select create_profile($1, $2)`, [U.noprofile, `squat${rnd()}`]);
    if (r.ok) await sys(`delete from profiles where id = $1`, [U.noprofile]);
    return { hit: r.ok, info: r.ok ? 'profil pris' : r.err };
  }],
  ['A26', 'virement : plafond transfer_cap ignoré', async () => {
    const ev = await makeEvent(colA, { types: [['Normal', 100, 2000]] });
    await sys(`update ticket_types set transfer_cap = 2 where id = $1`, [ev.tt[0]]);
    const r = await reserve(await newBuyer(), ev.id, [[ev.tt[0], 5]], 'transfer');
    return { hit: r.ok, info: r.ok ? '5 places > plafond 2' : r.err };
  }],
  ['A27', 'panier piégé (quantité texte, doublon, type d\'un autre événement)', async () => {
    const ev = await makeEvent(colA);
    const other = await makeEvent(colA);
    const bad = [
      [{ ticket_type_id: ev.tt[0], quantity: '3' }],
      [{ ticket_type_id: ev.tt[0], quantity: 1 }, { ticket_type_id: ev.tt[0], quantity: 9 }],
      [{ ticket_type_id: other.tt[0], quantity: 1 }],
      [{ ticket_type_id: ev.tt[0], quantity: 1.5 }],
    ];
    const accepted = [];
    const errs = [];
    const b = await newBuyer();
    for (const [i, items] of bad.entries()) {
      const r = await as('authenticated', b, `select * from reserve_seats_multi($1, $2::jsonb, 'card')`, [ev.id, JSON.stringify(items)]);
      if (r.ok) accepted.push(i);
      else errs.push(r.err.split(':')[0]);
    }
    return { hit: accepted.length > 0, info: accepted.length ? `acceptés : ${accepted}` : errs.join(', ') };
  }],
  ['A25', 'anon : voit les places d\'un événement brouillon', async () => {
    const ev = await makeEvent(colA, { status: 'draft' });
    const r = await as('anon', null, `select * from get_event_ticket_availability($1)`, [ev.id]);
    return { hit: r.ok && r.rows.length > 0, info: r.ok ? `${r.rows.length} type(s)` : r.err };
  }],
];

// ------------------------------------------------------------------------------------------- parcours normaux
// Chaque contrôle renvoie true si le parcours MARCHE.
const checks = [
  ['F01', 'anon lit un événement publié, son collectif et ses types', async () => {
    const ev = await makeEvent(colA);
    const r = await as('anon', null,
      `select e.id, c.name, (select count(*)::int from ticket_types t where t.event_id = e.id) n
       from events e left join collectives c on c.id = e.collective_id where e.id = $1`, [ev.id]);
    return { ok: r.ok && r.rows[0]?.name === 'Collectif A' && r.rows[0]?.n === 1, info: r.err ?? '' };
  }],
  ['F02', 'acheteur réserve 2 + 1 places, paie (webhook), voit ses 3 billets', async () => {
    const ev = await makeEvent(colA, { types: [['Normal', 20, 2000], ['VIP', 5, 5000]] });
    const r = await reserve(U.buyer1, ev.id, [[ev.tt[0], 2], [ev.tt[1], 1]]);
    if (!r.ok) return { ok: false, info: r.err };
    const o = r.rows[0];
    if (o.total_cents !== 9000 || o.currency !== 'EUR') return { ok: false, info: `total ${o.total_cents} ${o.currency}` };
    const p = await as('authenticated', U.buyer1, `select count(*)::int n from get_my_pending_orders() where order_id = $1`, [o.id]);
    if (!p.ok || p.rows[0].n !== 2) return { ok: false, info: `pending ${p.err ?? p.rows[0].n}` };
    const payload = JSON.stringify({ data: { object: { amount_total: 9000, payment_intent: 'pi_1' } } });
    const c = await as('service_role', null, `select * from confirm_payment($1, $2, $3::jsonb)`, [`evt_${rnd()}`, o.id, payload]);
    if (!c.ok) return { ok: false, info: `confirm ${c.err}` };
    const t = await as('authenticated', U.buyer1, `select * from get_my_tickets() where order_id = $1`, [o.id]);
    globalThis.lastPaid = { ev, order: o, tickets: t.rows };
    return { ok: t.ok && t.rows.length === 3, info: t.err ?? `${t.rows.length} billets` };
  }],
  ['F03', 'contrôleur scanne : ok, puis déjà utilisé, puis code inconnu', async () => {
    const { ev, tickets } = globalThis.lastPaid;
    const q = (code) => as('authenticated', U.ctrlA, `select validate_ticket_entry($1, $2) as r`, [ev.id, code]);
    const a = await q(tickets[0].qr_code);
    const b = await q(tickets[0].qr_code);
    const c = await q(randomUUID());
    const res = [a, b, c].map((x) => (x.ok ? x.rows[0].r.result : x.err));
    return { ok: res.join() === 'ok,already_used,invalid', info: res.join(', ') };
  }],
  ['F04', 'contrôleur voit les chiffres de l\'événement', async () => {
    const r = await as('authenticated', U.ctrlA, `select get_event_stats($1) as s`, [globalThis.lastPaid.ev.id]);
    return { ok: r.ok && r.rows[0].s.totals.sold === 3, info: r.err ?? `vendus ${r.rows[0].s.totals.sold}` };
  }],
  ['F05', 'manager exporte les participants', async () => {
    const r = await as('authenticated', U.mgrA, `select * from get_event_participants($1)`, [globalThis.lastPaid.ev.id]);
    return { ok: r.ok && r.rows.length === 3, info: r.err ?? `${r.rows.length}` };
  }],
  ['F06', 'manager crée, modifie un événement et ses places, supprime un brouillon', async () => {
    const ins = await as('authenticated', U.mgrA,
      `insert into events (collective_id, name, starts_at, status, slug) values ($1, 'Nouveau', now() + interval '20 days', 'on_sale', $2) returning id`,
      [colA, `n-${rnd()}`]);
    if (!ins.ok) return { ok: false, info: `insert ${ins.err}` };
    const id = ins.rows[0].id;
    const tt = await as('authenticated', U.mgrA,
      `insert into ticket_types (event_id, name, quantity, price_cents) values ($1, 'Plein', 50, 1500) returning id`, [id]);
    if (!tt.ok) return { ok: false, info: `type ${tt.err}` };
    const up = await as('authenticated', U.mgrA, `update events set name = 'Renommé', status = 'on_sale' where id = $1 returning id`, [id]);
    const up2 = await as('authenticated', U.mgrA, `update ticket_types set quantity = 80, price_cents = 1800 where id = $1 returning id`, [tt.rows[0].id]);
    const dr = await as('authenticated', U.mgrA,
      `insert into events (collective_id, name, starts_at, status, slug) values ($1, 'Brouillon', now() + interval '20 days', 'draft', $2) returning id`,
      [colA, `d-${rnd()}`]);
    const pub = await as('authenticated', U.mgrA, `update events set status = 'on_sale' where id = $1 returning id`, [dr.rows[0]?.id]);
    const dr2 = await as('authenticated', U.mgrA,
      `insert into events (collective_id, name, starts_at, status, slug) values ($1, 'À effacer', now() + interval '20 days', 'draft', $2) returning id`,
      [colA, `e-${rnd()}`]);
    const del = await as('authenticated', U.mgrA, `delete from events where id = $1 returning id`, [dr2.rows[0]?.id]);
    const ok = [up, up2, pub, del].every((x) => x.ok && x.rows.length === 1);
    return { ok, info: [up, up2, pub, del].map((x) => (x.ok ? x.rows.length : x.err)).join(' / ') };
  }],
  ['F07', 'manager modifie un événement complet (sold_out -> on_sale)', async () => {
    const ev = await makeEvent(colA, { status: 'sold_out' });
    const r = await as('authenticated', U.mgrA, `update events set name = 'X', status = 'on_sale' where id = $1 returning id`, [ev.id]);
    return { ok: r.ok && r.rows.length === 1, info: r.err ?? '' };
  }],
  ['F08', 'admin annule un événement payé par carte puis rembourse', async () => {
    const ev = await makeEvent(colA);
    const o = await makeOrder(ev.id, U.buyer2, [[ev.tt[0], 2, 2000]], { status: 'paid' });
    await sys(`update orders set payment_intent_id = 'pi_x' where id = $1`, [o.id]);
    const c = await as('authenticated', U.orgA, `select * from cancel_event($1)`, [ev.id]);
    if (!c.ok || c.rows.length !== 1) return { ok: false, info: c.err ?? `${c.rows.length} à rembourser` };
    const r = await as('authenticated', U.orgA, `select * from refund_order($1, $2)`, [o.id, c.rows[0].refund_amount_cents]);
    const t = await one(`select count(*) filter (where t.status = 'cancelled')::int n from tickets t join order_items oi on oi.id = t.order_item_id where oi.order_id = $1`, [o.id]);
    return { ok: r.ok && t.n === 2, info: r.err ?? `billets annulés ${t.n}` };
  }],
  ['F09', 'manager marque un virement payé (billets émis)', async () => {
    const ev = await makeEvent(colA);
    const o = await makeOrder(ev.id, U.buyer2, [[ev.tt[0], 2, 2000]], { method: 'transfer' });
    const r = await as('authenticated', U.mgrA, `select status from mark_order_paid_by_transfer($1)`, [o.id]);
    const t = await one(`select count(*)::int n from tickets t join order_items oi on oi.id = t.order_item_id where oi.order_id = $1`, [o.id]);
    return { ok: r.ok && t.n === 2, info: r.err ?? `${t.n} billets` };
  }],
  ['F10', 'anon annule sa réservation par son lien (access_token)', async () => {
    const ev = await makeEvent(colA);
    const o = await makeOrder(ev.id, U.buyer2, [[ev.tt[0], 1, 2000]]);
    const r = await as('anon', null, `select * from cancel_order_by_token($1)`, [o.token]);
    return { ok: r.ok && r.rows[0]?.new_status === 'cancelled', info: r.err ?? '' };
  }],
  ['F11', 'tâche planifiée expire_stale_reservations', async () => {
    const r = await as('postgres', null, `select expire_stale_reservations() as n`);
    return { ok: r.ok, info: r.err ?? `${r.rows[0].n}` };
  }],
  ['F12', 'clé de service : confirm_payment, mark_order_refunded, offer_next_waitlist_entry', async () => {
    const sigs = ['confirm_payment(text,uuid,jsonb)', 'mark_order_refunded(uuid)', 'offer_next_waitlist_entry(uuid)'];
    const res = [];
    for (const s of sigs) res.push(await canExec('service_role', `public.${s}`));
    return { ok: res.every(Boolean), info: res.join() };
  }],
  ['F13', 'acheteur lit réglages, pages légales, son profil, ses adhésions', async () => {
    const q = [
      `select count(*)::int n from site_settings`, `select count(*)::int n from legal_pages`,
      `select count(*)::int n from profiles`, `select count(*)::int n from collective_members`,
    ];
    const res = [];
    for (const s of q) {
      const r = await as('authenticated', U.mgrA, s);
      res.push(r.ok ? r.rows[0].n : r.err);
    }
    return { ok: res[0] === 1 && res[2] === 1 && res[3] === 1, info: res.join(' / ') };
  }],
  ['F14', 'inscription : create_profile reste appelable (anon)', async () => {
    return { ok: await canExec('anon', 'public.create_profile(uuid,text)'), info: '' };
  }],
  ['F15', 'manager lit les commandes de son collectif', async () => {
    const r = await as('authenticated', U.mgrA, `select count(*)::int n from orders`);
    return { ok: r.ok && r.rows[0].n > 0, info: r.err ?? `${r.rows[0].n}` };
  }],
  ['F16', 'contrôleur lit les événements de son collectif (dont brouillons)', async () => {
    const ev = await makeEvent(colA, { status: 'draft' });
    const r = await as('authenticated', U.ctrlA, `select count(*)::int n from events where id = $1`, [ev.id]);
    return { ok: r.ok && r.rows[0].n === 1, info: r.err ?? '' };
  }],
];

// ------------------------------------------------------------------------------------------- exécution
async function runAll() {
  const a = {};
  for (const [id, , fn] of attacks) {
    try {
      a[id] = await fn();
    } catch (e) {
      a[id] = { hit: null, info: `ERREUR BANC: ${e.message.split('\n')[0]}` };
    }
  }
  // Les attaques laissent des réservations en attente : on les expire pour que les limites par compte
  // (3 en attente max) ne faussent pas les parcours normaux.
  await sys(`update orders set status = 'expired' where status = 'pending'`);
  const f = {};
  for (const [id, , fn] of checks) {
    try {
      f[id] = await fn();
    } catch (e) {
      f[id] = { ok: false, info: `ERREUR BANC: ${e.message.split('\n')[0]}` };
    }
  }
  return { a, f };
}

const before = await runAll();
for (const f of fixes) {
  try {
    await db.exec(read(f));
  } catch (e) {
    console.error(`\n!! migration ${f} : ${e.message}`);
    process.exit(1);
  }
}
const after = fixes.length ? await runAll() : null;

const tag = (hit) => (hit === null ? '??' : hit ? 'FAILLE' : 'bloqué');
const short = (s) => (s ?? '').toString().replace(/\s+/g, ' ').slice(0, 60);
console.log(`Migrations de base : ${base.length}, correctifs : ${fixes.join(', ') || 'aucun'}\n`);
console.log('ATTAQUES                                                               AVANT    APRÈS');
for (const [id, label] of attacks) {
  const b = before.a[id];
  const x = after?.a[id];
  console.log(`${id} ${label.padEnd(66).slice(0, 66)} ${tag(b.hit).padEnd(8)} ${x ? tag(x.hit).padEnd(8) : '-'}  ${short(x?.info ?? b.info)}`);
}
console.log('\nPARCOURS NORMAUX                                                       AVANT    APRÈS');
for (const [id, label] of checks) {
  const b = before.f[id];
  const x = after?.f[id];
  const t = (r) => (r.ok ? 'ok' : 'CASSÉ');
  console.log(`${id} ${label.padEnd(66).slice(0, 66)} ${t(b).padEnd(8)} ${x ? t(x).padEnd(8) : '-'}  ${short((x && !x.ok ? x.info : '') || (!b.ok ? b.info : ''))}`);
}
const regress = after ? checks.filter(([id]) => before.f[id].ok && !after.f[id].ok).map(([id]) => id) : [];
const still = after ? attacks.filter(([id]) => after.a[id].hit).map(([id]) => id) : [];
console.log(`\nRégressions : ${regress.join(', ') || 'aucune'} | Failles restantes : ${still.join(', ') || 'aucune'}`);
process.exit(regress.length ? 2 : 0);
