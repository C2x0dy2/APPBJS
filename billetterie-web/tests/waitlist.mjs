import assert from 'node:assert/strict';

const target = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173');
assert(
  ['http:', 'https:'].includes(target.protocol) &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) &&
    !target.username && !target.password &&
    target.pathname === '/' && !target.search && !target.hash,
  'Ce test crée des données : TEST_URL doit être une origine locale sur loopback.'
);
const base = target.origin;

async function send(path, data) {
  const response = await fetch(`${base}/api/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function request(path, data, expectedStatus = 200) {
  const { status, body } = await send(path, data);
  assert.equal(status, expectedStatus,
    `${path} : statut attendu ${expectedStatus}, reçu ${status} (${JSON.stringify(body)}).`);
  return body;
}

// Refuse to mutate any live database, even if it happens to be served locally.
const initial = await request('dashboard');
assert.equal(initial.mode, 'demo', 'Ce test est réservé à une base de démonstration.');
assert(initial.collectives.length, 'La base de démonstration doit contenir un collectif.');
const collectiveId = initial.collectives[0].id;
console.log('Garde-fous validés : serveur local et mode démonstration.');

const stamp = Date.now();
const email = label => `waitlist-${label.toLowerCase()}-${stamp}@example.invalid`;
const createdEventIds = [];
let failure;

try {
  const start = Date.now() + 14 * 86400000;
  const fixtureInput = {
    collectiveId,
    name: `Validation liste attente ${stamp}`,
    description: 'Régression des inscriptions impossibles et de la priorité de la liste.',
    location: 'Salle de test',
    timezone: 'Europe/Paris',
    startsAt: start,
    doorsAt: start - 3600000,
    cancelUntil: start - 172800000,
    status: 'on_sale',
    maxQuantity: 6,
    types: [
      { name: 'Petite salle', price: 1000, capacity: 2 },
      { name: 'Grande salle', price: 1500, capacity: 10 },
    ],
  };
  const created = await request('events', fixtureInput, 201);
  const eventId = created.id;
  createdEventIds.push(eventId);
  const publicEvent = async () => (await request(`events/${eventId}`)).events[0];
  const dashboard = () => request(`dashboard?collective=${encodeURIComponent(collectiveId)}`);
  const firstEvent = await publicEvent();
  const small = firstEvent.types.find(type => type.name === 'Petite salle');
  const large = firstEvent.types.find(type => type.name === 'Grande salle');
  assert(small && large, 'Les deux types de places du test doivent exister.');
  const signup = (typeId, label, quantity, status) => request('waitlist', {
    typeId, name: `Attente ${label}`, email: email(label), quantity,
  }, status);
  const reserve = (label, quantity) => request('reserve', {
    eventId, name: `Acheteur ${label}`, email: email(label),
    items: [{ typeId: small.id, quantity }],
  }, 201);
  const stateFor = (state, typeId) => state.events.find(event => event.id === eventId)
    .types.find(type => type.id === typeId);
  const waitersFor = state => state.waiting.filter(waiter => waiter.event_id === eventId);

  // First assertion catches the original denial of sale: this request was accepted
  // and could never be offered, because six places cannot fit in a capacity of two.
  await signup(small.id, 'impossible', 6, 400);
  let state = await dashboard();
  assert.equal(waitersFor(state).length, 0, 'Une demande impossible ne doit pas entrer dans la liste.');
  assert.equal(stateFor(state, small.id).held, 0, 'Un refus ne doit retenir aucune place.');
  assert.equal(stateFor(state, small.id).sold, 0, 'Un refus ne doit vendre aucune place.');
  assert.equal((await publicEvent()).types.find(type => type.id === small.id).available, 2,
    'La vente doit rester ouverte après une inscription impossible.');
  console.log('Demande de six places sur une capacité de deux refusée, sans bloquer le stock.');

  assert.equal(firstEvent.types.find(type => type.id === small.id).waitlist_limit, 2,
    'La limite publique doit tenir compte de la capacité du type.');
  assert.equal(firstEvent.types.find(type => type.id === large.id).waitlist_limit, 6,
    'La limite publique doit tenir compte du maximum par commande.');
  await signup(large.id, 'over-order-limit', 7, 400);
  for (const [label, quantity] of [['negative', -1], ['zero', 0], ['fractional', 1.5]]) {
    await signup(small.id, label, quantity, 400);
  }
  await signup(small.id, 'immediately-bookable', 1, 409);
  state = await dashboard();
  assert.equal(waitersFor(state).length, 0, 'Les inscriptions refusées ne doivent créer aucune ligne.');
  assert.equal(stateFor(state, small.id).held, 0);
  assert.equal(stateFor(state, large.id).held, 0);
  assert.equal(stateFor(state, large.id).sold, 0);
  assert.equal((await publicEvent()).types.find(type => type.id === large.id).available, 10);
  console.log('Quantités invalides, maximum par commande et inscription avec places libres vérifiés.');

  const held = await reserve('initial', 2);
  assert.equal((await publicEvent()).types.find(type => type.id === small.id).available, 0,
    'Les deux places doivent être réservables après les demandes refusées.');
  await signup(small.id, 'impossible-full', 6, 400);
  await signup(small.id, 'A', 2, 201);
  const duplicates = await Promise.all(Array.from({ length: 12 }, () => send('waitlist', {
    typeId: small.id, name: 'Attente B', email: email('B'), quantity: 1,
  })));
  assert(duplicates.every(result => [200, 201].includes(result.status)),
    'Les inscriptions simultanées du même e-mail doivent toutes être idempotentes.');
  assert.equal(duplicates.filter(result => result.status === 201).length, 1,
    'Une seule inscription simultanée doit créer la demande.');
  await signup(small.id, 'A', 2, 200);
  state = await dashboard();
  let waiters = waitersFor(state);
  assert.equal(waiters.length, 2, 'Une inscription répétée doit rester une seule demande.');
  assert.equal(waiters.filter(waiter => waiter.email === email('A')).length, 1);
  assert.equal(waiters.filter(waiter => waiter.email === email('B')).length, 1);
  assert(waiters.every(waiter => waiter.status === 'waiting'));
  assert.equal(stateFor(state, small.id).held, 2);
  console.log('Stock retenu, doublon séquentiel et douze inscriptions simultanées dédupliquées.');

  await request(`orders/${held.token}/cancel`, {});
  state = await dashboard();
  waiters = waitersFor(state);
  const waiterA = waiters.find(waiter => waiter.email === email('A'));
  const waiterB = waiters.find(waiter => waiter.email === email('B'));
  assert.equal(waiterA.status, 'offered', 'La première demande doit recevoir les places libérées.');
  assert.equal(waiterB.status, 'waiting', 'La seconde demande ne doit pas dépasser la première.');
  assert.equal(stateFor(state, small.id).held, 2, 'Les deux places proposées doivent être retenues.');
  assert.equal(stateFor(state, small.id).sold, 0);
  const offerA = state.orders.find(order => order.id === waiterA.order_id);
  assert(offerA, 'Une offre doit créer une réservation personnelle.');
  assert.equal(offerA.status, 'pending');
  assert.equal(offerA.quantity, 2);

  await request(`orders/${offerA.token}/cancel`, {});
  state = await dashboard();
  assert.equal(waitersFor(state).find(waiter => waiter.id === waiterA.id).status, 'expired',
    'Une offre libérée ne doit plus compter comme une demande active.');
  const next = waitersFor(state).find(waiter => waiter.id === waiterB.id);
  assert.equal(next.status, 'offered', 'La libération de la première offre doit servir la suivante.');
  assert.equal(stateFor(state, small.id).held, 1);
  assert.equal((await publicEvent()).types.find(type => type.id === small.id).available, 1,
    'Le stock restant doit revenir à la vente une fois la file servie.');
  await reserve('after-queue', 1);
  assert.equal(stateFor(await dashboard(), small.id).held, 2);
  console.log('Priorité FIFO, passage au suivant et retour du stock restant à la vente vérifiés.');

  // Separate fixture: one seat is free, but the first person needs two. Strict
  // FIFO keeps that seat for the queue; an organizer must not make its head
  // impossible by shrinking capacity below the requested quantity.
  const shrinkInput = { ...fixtureInput, name: `Validation liste attente réduction ${stamp}` };
  const shrinkCreated = await request('events', shrinkInput, 201);
  createdEventIds.push(shrinkCreated.id);
  const shrinkEvent = (await request(`events/${shrinkCreated.id}`)).events[0];
  const shrinkType = shrinkEvent.types.find(type => type.name === 'Petite salle');
  const shrinkHold = await request('reserve', {
    eventId: shrinkEvent.id, name: 'Acheteur réduction', email: email('shrink-holder'),
    items: [{ typeId: shrinkType.id, quantity: 1 }],
  }, 201);
  await request('waitlist', {
    typeId: shrinkType.id, name: 'Attente réduction A', email: email('shrink-A'), quantity: 2,
  }, 201);
  const beforeShrink = await dashboard();
  const shrinkState = beforeShrink.events.find(event => event.id === shrinkEvent.id)
    .types.find(type => type.id === shrinkType.id);
  const shrinkWaiter = beforeShrink.waiting.find(waiter => waiter.email === email('shrink-A'));
  assert.equal(shrinkState.capacity, 2);
  assert.equal(shrinkState.held, 1);
  assert.equal(shrinkState.sold, 0);
  assert.equal(shrinkState.available, 1, 'Une place doit rester physiquement libre.');
  assert.equal(shrinkWaiter.status, 'waiting');
  assert.equal(shrinkWaiter.quantity, 2);
  assert.equal(shrinkWaiter.order_id, null);
  assert.equal((await request(`events/${shrinkEvent.id}`)).events[0].types
    .find(type => type.id === shrinkType.id).available, 0,
    'Le stock libre doit rester réservé à la priorité de la liste.');
  await request('reserve', {
    eventId: shrinkEvent.id, name: 'Acheteur qui dépasse la file', email: email('shrink-bypass'),
    items: [{ typeId: shrinkType.id, quantity: 1 }],
  }, 409);

  await request(`events/${shrinkEvent.id}`, {
    ...shrinkInput,
    types: shrinkEvent.types.map(type => ({
      id: type.id, name: type.name, price: type.price,
      capacity: type.id === shrinkType.id ? 1 : 10,
    })),
  }, 409);
  const afterShrink = await dashboard();
  const keptType = afterShrink.events.find(event => event.id === shrinkEvent.id)
    .types.find(type => type.id === shrinkType.id);
  const keptWaiters = afterShrink.waiting.filter(waiter => waiter.event_id === shrinkEvent.id);
  assert.equal(keptType.capacity, 2, 'Une réduction refusée doit préserver la capacité.');
  assert.equal(keptType.held, 1, 'Une réduction refusée doit préserver la réservation existante.');
  assert.equal(keptType.sold, 0);
  assert.equal(keptType.available, 1);
  assert.equal(keptWaiters.length, 1, 'Une réduction refusée ne doit pas modifier la liste.');
  assert.equal(keptWaiters[0].id, shrinkWaiter.id);
  assert.equal(keptWaiters[0].quantity, 2);
  assert.equal(keptWaiters[0].status, 'waiting');
  assert.equal(keptWaiters[0].order_id, null);

  await request(`orders/${shrinkHold.token}/cancel`, {});
  const released = await dashboard();
  assert.equal(released.waiting.find(waiter => waiter.id === shrinkWaiter.id).status, 'offered',
    'La demande conservée doit recevoir les deux places après la libération.');
  assert.equal(released.events.find(event => event.id === shrinkEvent.id)
    .types.find(type => type.id === shrinkType.id).held, 2);
  console.log('FIFO strict avec une place libre et réduction de capacité impossible refusée sans altération.');
} catch (error) {
  failure = error;
} finally {
  for (const eventId of createdEventIds) {
    try {
      await request(`events/${eventId}/cancel`, {});
      console.log('Nettoyage : seul l’événement de ce test a été annulé.');
    } catch (cleanupError) {
      console.error('Échec du nettoyage de l’événement de test :', cleanupError.message);
      failure ||= cleanupError;
    }
  }
}

if (failure) throw failure;
console.log('Liste d’attente : tous les contrôles de régression ont réussi.');
