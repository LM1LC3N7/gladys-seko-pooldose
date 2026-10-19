// -----------------------------------------------------------------------------
// A fake PoolDose behind the transport the integration is given (no network):
// params.js, the debug config and the instant values of a "PoolDose Double"
// (PDPR1H1HAW100, firmware code 539187, the mapping of python-pooldose).
// Records every request; one-shot answers can be queued.
// -----------------------------------------------------------------------------

import { PoolDoseError } from '../../src/http.js';

export const HOST = '192.168.1.50';
export const DEVICE_ID = '0123456789_DEVICE';
export const NOW = Date.UTC(2026, 6, 14, 10, 0, 0);
export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

const PREFIX = 'PDPR1H1HAW100_FW539187_';
const label = (key, name) => `|${PREFIX}LABEL_${key}_${name}|`;

/** The raw instant values (keys of model_PDPR1H1HAW100_FW539187.json). */
export function instantValues() {
  const v = {
    w_1eommf39k: { current: 26.4, magnitude: ['°C'] },
    w_1ekeigkin: { current: 7.18, magnitude: ['ph'] },
    w_1eklenb23: { current: 712, magnitude: ['mV'] },
    w_1eo03t46k: { current: 0.8, magnitude: ['CL2', 'Chlorine'] },
    w_1eklg44ro: { current: label('w_1eklg44ro', 'ACID'), magnitude: ['undefined'] },
    w_1eklj6euj: { current: label('w_1eklj6euj', 'PROPORTIONAL') },
    w_1eklgnolb: { current: label('w_1eklgnolb', 'LOW') },
    w_1eo1s18s8: { current: label('w_1eo1s18s8', 'ON_OFF') },
    w_1ekga097n: { current: 'F' },
    w_1eklf77pm: { current: 'F' },
    w_1eo04bcr2: { current: 'F' },
    w_1eo04nc5n: { current: 'F' },
    w_1fahufum0: { current: 'F' },
    w_1fahuft7o: { current: 'F' },
    w_1ekeiqfat: { current: 7.2, absMin: 6, absMax: 8, resolution: 0.1, magnitude: ['ph'] },
    w_1eklgnjk2: { current: 700, absMin: 0, absMax: 1000, resolution: 1, magnitude: ['mV'] },
    w_1eo1unpqb: { current: 1, absMin: 0, absMax: 10, resolution: 0.1, magnitude: ['Chlorine'] },
    w_1emtltkel: { current: 'F' },
    w_1eo2fpohe: { current: label('w_1eo2fpohe', 'ENABLED') },
    // A key no mapping knows: ignored.
    w_unknown: { current: 1 },
  };
  return Object.fromEntries(Object.entries(v).map(([k, value]) => [`${PREFIX}${k}`, value]));
}

/** The keys of the alarms of the fixture, by role. */
export const ALARM_RAW = {
  'alarm-pump': 'w_1ekga097n',
  'alarm-ph-tank': 'w_1eklf77pm',
  'alarm-ph-high': 'w_1fahufum0',
};
export const rawKey = (key) => `${PREFIX}${key}`;

export const debugConfig = () => ({
  GATEWAY: { DID: '0123456789', NAME: 'PoolDose Double', FW_REL: '1.30' },
  DEVICES: [
    {
      DID: DEVICE_ID,
      NAME: 'PoolDose Double',
      PRODUCT_CODE: 'PDPR1H1HAW100',
      FW_REL: '539187',
      FW_CODE: '539187',
    },
  ],
});

const PARAMS = 'var params = {\n  softwareVersion: "1.30",\n  apiversion: "v1/",\n};\n';

const json = (status, body, headers = {}) => ({
  status,
  headers,
  body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
});

export function fakePoolDose() {
  const server = {
    values: instantValues(),
    debug: debugConfig(),
    params: PARAMS,
    requests: [],
    /** true: every request ends with a network error. */
    down: false,
    /** One-shot answers: { match(request), status, body, headers, throws } */
    queue: [],
    paths() {
      return this.requests.map((r) => `${r.method} ${r.path}`);
    },
    setAlarm(role, on) {
      this.values[rawKey(ALARM_RAW[role])] = { current: on ? 'O' : 'F' };
    },
  };
  server.transport = async (url, options = {}) => {
    const target = new URL(url);
    const request = {
      url,
      host: target.hostname,
      port: target.port,
      protocol: target.protocol,
      path: target.pathname,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      body: options.body,
      insecure: options.insecure,
      timeout: options.timeout,
    };
    server.requests.push(request);
    const index = server.queue.findIndex((entry) => entry.match(request));
    if (index >= 0) {
      const [entry] = server.queue.splice(index, 1);
      if (entry.throws) {
        throw entry.throws;
      }
      return json(entry.status ?? 200, entry.body, entry.headers);
    }
    if (server.down) {
      throw new PoolDoseError('network', 'connection refused', { code: 'ECONNREFUSED' });
    }
    if (request.method === 'GET' && request.path === '/js_libs/params.js') {
      return json(200, server.params);
    }
    if (request.method === 'GET' && request.path === '/api/v1/debug/config') {
      return json(200, server.debug);
    }
    if (request.method === 'POST' && request.path === '/api/v1/DWI/getInstantValues') {
      return json(200, { devicedata: { [DEVICE_ID]: server.values } });
    }
    return json(404, { error: 'not found' });
  };
  return server;
}

/** Request matchers. */
export const to = {
  params: (r) => r.path === '/js_libs/params.js',
  debug: (r) => r.path === '/api/v1/debug/config',
  values: (r) => r.path === '/api/v1/DWI/getInstantValues',
  any: () => true,
};

export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
