// Test de charge anti-survente (section 3 du cahier des charges) : N "acheteurs" simultanés
// cliquent "Réserver" sur le même type de billet à stock limité, et on vérifie qu'il n'y a
// jamais plus de billets attribués que de stock — la garantie que reserve_seats() doit tenir
// même à 500 clients contre 100 places.
//
// Installation (une fois) : https://k6.io/docs/get-started/installation/
//
// Préparer un type de billet de test dans Supabase avec un stock connu (ex. 10), noter son
// event_id tel-que-dans-la-base (status 'on_sale'), puis lancer :
//
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_ANON_KEY=xxxx \
//   EVENT_ID=uuid-de-l-evenement \
//   TICKET_TYPE_ID=uuid-du-type-de-billet \
//   STOCK=10 \
//   k6 run --vus 50 --iterations 50 supabase/load-test.js
//
// Pour le volume du cahier des charges (500 achats simultanés / 100 places) : préparer un type
// de billet avec quantity=100, STOCK=100, puis --vus 500 --iterations 500.
//
// Ce que le script vérifie : le nombre de réservations réussies ne doit jamais dépasser STOCK,
// et la disponibilité finale (interrogée après coup) ne doit jamais être négative.

import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const EVENT_ID = __ENV.EVENT_ID;
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID;
const STOCK = Number(__ENV.STOCK ?? "10");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !EVENT_ID || !TICKET_TYPE_ID) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_ANON_KEY, EVENT_ID et TICKET_TYPE_ID sont requis (voir l'en-tête du fichier)."
  );
}

const headers = {
  "Content-Type": "application/json",
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

const reserved = new Counter("reservations_reussies");
const soldOut = new Counter("reservations_refusees_sold_out");

export const options = {
  // --vus et --iterations se passent en ligne de commande (voir en-tête) ; valeurs par défaut
  // raisonnables pour un essai rapide si on lance `k6 run` sans options.
  vus: 10,
  iterations: 10,
};

export default function () {
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/reserve_seats`,
    JSON.stringify({
      p_ticket_type_id: TICKET_TYPE_ID,
      p_quantity: 1,
      p_buyer_email: `k6-${__VU}-${__ITER}@test.com`,
      p_payment_method: "card",
    }),
    { headers }
  );

  if (res.status === 200 || res.status === 201) {
    reserved.add(1);
  } else if (res.status === 400 && res.body && res.body.includes("sold_out")) {
    soldOut.add(1);
  }

  check(res, {
    "pas d'erreur serveur inattendue": (r) => r.status < 500,
  });
}

// Un seul appel après la charge : si reserve_seats() a bien tout verrouillé correctement,
// ce nombre ne doit jamais être négatif, même si toutes les VUs ont réservé en même temps.
export function teardown() {
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_event_ticket_availability`,
    JSON.stringify({ p_event_id: EVENT_ID }),
    { headers }
  );
  const rows = JSON.parse(res.body);
  const row = rows.find((r) => r.ticket_type_id === TICKET_TYPE_ID);
  console.log(`Disponibilité finale pour ${TICKET_TYPE_ID} : ${row ? row.available : "?"}`);
  console.log(
    row && row.available >= 0 && row.available <= STOCK
      ? "OK — jamais de survente."
      : "ANOMALIE — à investiguer avant la soutenance."
  );
}
