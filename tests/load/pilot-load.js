/**
 * QA-9 — Synthetic load injection: 150 briefings/h contra produção pré-pilot.
 *
 * Run:
 *   BASE_URL=https://propmatch.com.br \
 *   TEST_TOKEN=<broker_access_token> \
 *   k6 run tests/load/pilot-load.js
 *
 * Scenario: ramp up to 150 briefings/h (2.5/min = ~1 VU with think time) then
 * sustain for 20 minutes. Per PRD, p95 briefing-to-clipboard target < 10s.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const briefingDuration = new Trend('briefing_to_search_ms');
const briefingErrorRate = new Rate('briefing_errors');

const BASE_URL = __ENV.BASE_URL ?? 'http://localhost:3000';
const TOKEN = __ENV.TEST_TOKEN ?? '';

export const options = {
  scenarios: {
    pilot_load: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1m',
      preAllocatedVUs: 10,
      maxVUs: 30,
      stages: [
        { duration: '5m', target: 5 },   // ramp to 5/min
        { duration: '10m', target: 10 },  // ramp to 10/min (= 600/h, ~4× peak)
        { duration: '5m', target: 2 },    // ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p95<5000'],        // API response p95 < 5s
    briefing_to_search_ms: ['p95<10000'],   // briefing → first result < 10s
    briefing_errors: ['rate<0.01'],          // error rate < 1%
    http_req_failed: ['rate<0.01'],
  },
};

const SAMPLE_BRIEFINGS = [
  'Apartamento 2 quartos em Pinheiros até R$ 800 mil, com vaga',
  'Casa 3 quartos em Moema ou Itaim, até 1,5 milhão, mobiliada',
  'Studio no Centro ou República até R$ 400k, perto de metrô',
  'Cobertura duplex Vila Olímpia, 4 suítes, até R$ 4 milhões',
  'Apartamento 1 quarto no Brooklin até R$ 600k, academia no prédio',
  'Casa de vila em Perdizes ou Pompéia, 2 ou 3 quartos, até 1,2 mi',
  'Flat para locação mensal em Jardins, 1 quarto, máx R$ 5k/mês',
  'Galpão industrial em Santo André 500m² até R$ 15k/mês',
];

export default function () {
  const rawText = SAMPLE_BRIEFINGS[Math.floor(Math.random() * SAMPLE_BRIEFINGS.length)];
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  };

  const t0 = Date.now();

  // Create briefing
  const briefingRes = http.post(
    `${BASE_URL}/api/v1/briefings`,
    JSON.stringify({ rawText }),
    { headers },
  );

  const ok = check(briefingRes, {
    'briefing created': (r) => r.status === 201 || r.status === 202,
  });

  if (!ok) {
    briefingErrorRate.add(1);
    return;
  }

  briefingErrorRate.add(0);

  const briefingId = briefingRes.json('data.id');
  if (!briefingId) return;

  // Poll for ready status (max 15s)
  let ready = false;
  for (let i = 0; i < 15; i++) {
    sleep(1);
    const statusRes = http.get(`${BASE_URL}/api/v1/briefings/${briefingId}`, { headers });
    const status = statusRes.json('data.status');
    if (status === 'ready' || status === 'searching') {
      ready = true;
      break;
    }
  }

  if (ready) {
    briefingDuration.add(Date.now() - t0);
  } else {
    briefingErrorRate.add(1);
  }

  // Think time: simulate human pace (~4s between actions)
  sleep(4);
}
