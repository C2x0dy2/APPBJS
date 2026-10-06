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
  return { status: response.status, body: await response.json() };
}

async function request(path, data, expectedStatus = 200) {
  const result = await send(path, data);
  assert.equal(result.status, expectedStatus,
    `${path} : statut attendu ${expectedStatus}, reçu ${result.status} (${JSON.stringify(result.body)}).`);
  return result.body;
}

// No fixture is created until both the destination and the database mode are checked.
const initial = await request('dashboard');
assert.equal(initial.mode, 'demo', 'Ce test est réservé à une base de démonstration.');
assert(initial.collectives.length, 'La base de démonstration doit contenir un collectif.');
const collectiveId = initial.collectives[0].id;
console.log('Garde-fous validés : serveur local et mode démonstration.');

const stamp = Date.now();
const email = label => `cancellation-${label}-${stamp}@example.invalid`;
const createdEventIds = [];
const unitPrice = 1000;
let failure;

try {
  const startsAt = Date.now() + 14 * 86400000;
  const fixtureInput = {
    collectiveId,
    name: `Validation annulation ${stamp}`,
    description: 'Régression des courses entre annulation acheteur et contrôle des billets.',
    location: 'Salle de test',
    timezone: 'Europe/Paris',
    startsAt,
    doorsAt: startsAt - 3600000,
    cancelUntil: startsAt - 172800000,
    status: 'on_sale',
    maxQuantity: 20,
    types: [
      { name: 'Entrée', price: unitPrice, capacity: 20 },
      { name: 'Balcon', price: 1500, capacity: 1 },
    ],
  };
  const created = await request('events', fixtureInput, 201);
  createdEventIds.push(created.id);
  const event = (await request(`events/${created.id}`)).events[0];
  const type = event.types.find(item => item.name === 'Entrée');
  assert(type, 'Le type de place du test doit exister.');
  const reservation = await request('reserve', {
    eventId: event.id, name: 'Acheteur annulation', email: email('buyer'),
    items: [{ typeId: type.id, quantity: 13 }],
  }, 201);
  await request(`orders/${reservation.token}/checkout`, {});
  let order = await request(`orders/${reservation.token}`);
  assert.equal(order.status, 'paid');
  assert.equal(order.tickets.length, 13);
  assert.equal(order.refunded, 0);
  const [scanOnly, cancelOnly, repeated, ...racingTickets] = order.tickets;
  assert.equal(racingTickets.length, 10);
  const scanner = await request('scanner-links', { eventId: event.id });
  const cancelPath = `orders/${reservation.token}/cancel-ticket`;
  const scanPath = `scanner/${scanner.token}`;
  const cancel = ticket => send(cancelPath, { ticketId: ticket.id });
  const scan = ticket => send(scanPath, { code: ticket.code, deviceId: `cancellation-${ticket.id}` });
  const ticketState = (currentOrder, id) => currentOrder.tickets.find(ticket => ticket.id === id);

  const unrelated = await request('reserve', {
    eventId: event.id, name: 'Autre acheteur', email: email('other'),
    items: [{ typeId: type.id, quantity: 1 }],
  }, 201);
  const bypassFlags = {
    force: true,
    actor: { email: 'admin@example.invalid', admin: true },
    at: Date.now() - 86400000,
    now: Date.now() - 86400000,
    cancelUntil: Date.now() + 86400000,
  };
  await request(`orders/${unrelated.token}/cancel-ticket`, { ticketId: scanOnly.id, ...bypassFlags }, 403);
  order = await request(`orders/${reservation.token}`);
  assert.equal(ticketState(order, scanOnly.id).status, 'valid');
  assert.equal(ticketState(order, scanOnly.id).scanned_at, null);
  assert.equal(order.refunded, 0);
  console.log('Le lien d’une autre commande ne permet pas d’annuler un billet.');

  const scanned = await scan(scanOnly);
  assert.equal(scanned.status, 200);
  assert.equal(scanned.body.ok, true);
  const rejectedCancellation = await cancel(scanOnly);
  assert.equal(rejectedCancellation.status, 409, 'Un billet utilisé ne doit pas être annulable par son acheteur.');
  order = await request(`orders/${reservation.token}`);
  assert.equal(ticketState(order, scanOnly.id).status, 'valid');
  assert(ticketState(order, scanOnly.id).scanned_at);
  assert.equal(ticketState(order, scanOnly.id).refund_amount, 0);
  assert.equal(order.refunded, 0, 'Le refus d’annulation d’un billet utilisé ne doit pas rembourser la commande.');
  console.log('Scan puis annulation : entrée conservée, aucun remboursement.');

  const cancelled = await cancel(cancelOnly);
  assert.equal(cancelled.status, 200);
  const rejectedScan = await scan(cancelOnly);
  assert.equal(rejectedScan.status, 409);
  assert.match(rejectedScan.body.error, /annul/i, 'Le contrôle doit indiquer un billet annulé.');
  assert.doesNotMatch(rejectedScan.body.error, /déjà|1970|00:00/i,
    'Une annulation ne doit pas être présentée comme un ancien scan.');
  order = await request(`orders/${reservation.token}`);
  assert.equal(ticketState(order, cancelOnly.id).status, 'cancelled');
  assert.equal(ticketState(order, cancelOnly.id).scanned_at, null);
  assert.equal(ticketState(order, cancelOnly.id).refund_amount, unitPrice);
  console.log('Annulation puis scan : QR refusé et aucune entrée enregistrée.');

  const repeatedResults = await Promise.all(Array.from({ length: 12 }, () => cancel(repeated)));
  assert(repeatedResults.every(result => result.status === 200),
    'Une annulation répétée doit rester idempotente, même avec douze demandes simultanées.');
  const expectedCancelled = new Set([cancelOnly.id, repeated.id]);

  async function settledOrder(expectedRefund) {
    let current;
    for (let attempt = 0; attempt < 15; attempt++) {
      await request('maintenance', {});
      current = await request(`orders/${reservation.token}`);
      assert(current.refunded <= expectedRefund, 'Le total remboursé ne doit pas dépasser celui des billets annulés.');
      if (current.refunded === expectedRefund) return current;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(current.refunded, expectedRefund, 'Les remboursements de démonstration doivent finir leur traitement.');
    return current;
  }

  order = await settledOrder(2 * unitPrice);
  assert.equal(ticketState(order, repeated.id).status, 'cancelled');
  assert.equal(ticketState(order, repeated.id).scanned_at, null);
  assert.equal(ticketState(order, repeated.id).refund_amount, unitPrice);
  console.log('Douze annulations simultanées : un billet annulé et un seul remboursement de sa valeur.');

  let scanWins = 0;
  let cancellationWins = 0;
  for (const ticket of racingTickets) {
    const [scanResult, cancelResult] = await Promise.all([scan(ticket), cancel(ticket)]);
    const scanAccepted = scanResult.status === 200 && scanResult.body.ok === true;
    const cancelAccepted = cancelResult.status === 200 && cancelResult.body.ok === true;
    assert.notEqual(scanAccepted, cancelAccepted,
      `Billet ${ticket.id} : une seule des deux actions concurrentes doit être acceptée.`);
    order = await request(`orders/${reservation.token}`);
    const current = ticketState(order, ticket.id);
    if (scanAccepted) {
      scanWins++;
      assert.equal(cancelResult.status, 409);
      assert.equal(current.status, 'valid');
      assert(current.scanned_at);
      assert.equal(current.refund_amount, 0);
    } else {
      cancellationWins++;
      expectedCancelled.add(ticket.id);
      assert.equal(scanResult.status, 409);
      assert.match(scanResult.body.error, /annul/i);
      assert.doesNotMatch(scanResult.body.error, /déjà|1970|00:00/i);
      assert.equal(current.status, 'cancelled');
      assert.equal(current.scanned_at, null, 'Un billet annulé pendant la course ne doit pas avoir enregistré une entrée.');
      assert.equal(current.refund_amount, unitPrice);
    }
  }
  order = await settledOrder(expectedCancelled.size * unitPrice);
  assert.equal(order.tickets.filter(ticket => ticket.status === 'cancelled').length, expectedCancelled.size);
  assert(order.tickets.every(ticket => !(ticket.status === 'cancelled' && ticket.scanned_at)),
    'Aucun billet de cette commande ne doit être simultanément annulé et utilisé.');
  assert.equal(order.refunded, (2 + cancellationWins) * unitPrice);
  console.log(`Dix courses scan/annulation : ${scanWins} scans acceptés, ${cancellationWins} annulations acceptées, aucune double acceptation.`);

  const lateEvent = await request('events', {
    ...fixtureInput,
    name: `Validation annulation délai ${stamp}`,
    cancelUntil: Date.now() - 60000,
  }, 201);
  createdEventIds.push(lateEvent.id);
  const lateType = (await request(`events/${lateEvent.id}`)).events[0].types
    .find(item => item.name === 'Entrée');
  const lateReservation = await request('reserve', {
    eventId: lateEvent.id, name: 'Acheteur hors délai', email: email('deadline'),
    items: [{ typeId: lateType.id, quantity: 1 }],
  }, 201);
  await request(`orders/${lateReservation.token}/checkout`, {});
  const lateOrder = await request(`orders/${lateReservation.token}`);
  assert.equal(lateOrder.tickets.length, 1);
  await request(`orders/${lateReservation.token}/cancel-ticket`, {
    ticketId: lateOrder.tickets[0].id, ...bypassFlags,
  }, 409);
  const preserved = await request(`orders/${lateReservation.token}`);
  assert.equal(preserved.tickets[0].status, 'valid');
  assert.equal(preserved.tickets[0].scanned_at, null);
  assert.equal(preserved.tickets[0].refund_amount, 0);
  assert.equal(preserved.refunded, 0);
  console.log('Échéance dépassée : billet conservé et aucun remboursement acheteur.');
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
console.log('Annulation acheteur et scan : tous les contrôles de régression ont réussi.');
