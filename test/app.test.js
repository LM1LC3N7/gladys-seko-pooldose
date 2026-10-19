// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake PoolDose behind the transport. Timers and Date are
// mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PoolDoseApp } from '../src/app.js';
import { ACTIONS, API, SCENE_TRIGGERS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { PoolDoseError } from '../src/http.js';
import {
  DEVICE_ID,
  HOST,
  HOUR,
  MINUTE,
  NOW,
  SECOND,
  fakePoolDose,
  memoryStore,
  rawKey,
  settle,
  to,
} from './helpers/fakePoolDose.js';

const CONFIG = { host: HOST };
const DEV = `ext:test-integration:pooldose:${DEVICE_ID}`;

/** A logger keeping every line. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  {
    config = CONFIG,
    store = memoryStore(),
    server = fakePoolDose(),
    create = true,
    logs = [],
    devices = [],
  } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config, devices: structuredClone(devices) });
  const app = new PoolDoseApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 5 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
    await settle();
  }
  return { gladys, app, server, store, advance, logs };
}

const device = (gladys) => gladys.fake.discoveredDevices.find((d) => d.external_id === DEV);
const feature = (gladys, role) =>
  device(gladys).features.find((f) => f.external_id === `${DEV}:${role}`);
const roles = (gladys) => device(gladys).features.map((f) => f.external_id.split(':').pop());
const last = (gladys, role) => gladys.fake.lastState(`${DEV}:${role}`);
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const badge = (gladys) => gladys.fake.transports.filter((b) => b.device_external_id === DEV).at(-1);

test('without an address, the status asks for it and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: {} });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /adresse IP/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /IP address/);
});

test('an address with a path or a user is refused, never requested', async (t) => {
  for (const host of ['192.168.1.50/api', 'user@192.168.1.50', '192.168.1.50:80', 'a b']) {
    const { gladys, server, app } = await setup(t, { config: { host } });
    assert.equal(server.requests.length, 0, host);
    assert.match(message(gladys).en, /not valid/, host);
    app.stop();
    t.mock.timers.reset();
  }
});

test('start: params.js, the debug config, the instant values; never a Wi-Fi endpoint', async (t) => {
  const { gladys, server } = await setup(t);
  assert.deepEqual(server.paths(), [
    'GET /js_libs/params.js',
    'GET /api/v1/debug/config',
    'POST /api/v1/DWI/getInstantValues',
  ]);
  assert.ok(server.requests.every((r) => r.url.startsWith(`http://${HOST}/`)));
  assert.ok(server.requests.every((r) => r.headers['User-Agent'] === API.userAgent));
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected to PoolDose Double (PoolDose Double). Open Discovery to add it. Read only: no dosing command.',
      fr: 'Connecté à PoolDose Double (PoolDose Double). Ouvrez Découverte pour l’ajouter. Lecture seule : aucune commande de dosage.',
    },
  });
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.deepEqual(roles(gladys), [
    'temperature',
    'ph',
    'orp',
    'free-chlorine',
    'ph-target',
    'orp-target',
    'chlorine-target',
    'ph-dosing-method',
    'orp-dosing-method',
    'ph-dosing-type',
    'orp-dosing-type',
    'dosing-paused',
    'circulation-pump',
    'alarm-pump',
    'alarm-ph-tank',
    'alarm-orp-tank',
    'alarm-flow',
    'alarm-ph-low',
    'alarm-ph-high',
  ]);
  assert.ok(
    device(gladys).features.every((f) => f.read_only === true),
    'read only',
  );
  assert.deepEqual(device(gladys).params, [
    { name: 'device_id', value: DEVICE_ID },
    { name: 'product_code', value: 'PDPR1H1HAW100' },
    { name: 'model', value: 'PoolDose Double' },
    { name: 'firmware', value: '539187' },
    { name: 'fw_code', value: '539187' },
  ]);
  const ph = feature(gladys, 'ph');
  assert.deepEqual([ph.category, ph.type, ph.unit], ['ph-sensor', 'decimal', 'ph']);
  const orp = feature(gladys, 'orp');
  assert.deepEqual([orp.category, orp.type, orp.unit], ['orp-sensor', 'decimal', 'millivolt']);
  const chlorine = feature(gladys, 'free-chlorine');
  assert.deepEqual(
    [chlorine.category, chlorine.type, chlorine.unit],
    ['unknown', 'unknown', 'ppm'],
  );
  const temperature = feature(gladys, 'temperature');
  assert.deepEqual([temperature.category, temperature.unit], ['temperature-sensor', 'celsius']);
  assert.equal(feature(gladys, 'alarm-pump').type, 'binary');
  assert.equal(feature(gladys, 'ph-dosing-method').category, 'text');
  assert.equal(feature(gladys, 'ph').name, 'pH');
  assert.equal(feature(gladys, 'alarm-ph-tank').name, 'Alarme niveau bidon pH');
});

test('the states of the created device, the badge local', async (t) => {
  const { gladys } = await setup(t);
  assert.equal(last(gladys, 'temperature'), 26.4);
  assert.equal(last(gladys, 'ph'), 7.18);
  assert.equal(last(gladys, 'orp'), 712);
  assert.equal(last(gladys, 'free-chlorine'), 0.8);
  assert.equal(last(gladys, 'ph-target'), 7.2);
  assert.equal(last(gladys, 'orp-target'), 700);
  assert.equal(last(gladys, 'chlorine-target'), 1);
  assert.equal(last(gladys, 'ph-dosing-method'), 'Proportionnel');
  assert.equal(last(gladys, 'orp-dosing-method'), 'Tout ou rien');
  assert.equal(last(gladys, 'ph-dosing-type'), 'Acide (pH−)');
  assert.equal(last(gladys, 'orp-dosing-type'), 'Bas', 'the word of the device, not a guess');
  assert.equal(last(gladys, 'dosing-paused'), 0);
  assert.equal(last(gladys, 'circulation-pump'), 1, 'the ENABLED label, through the mapping');
  assert.equal(last(gladys, 'alarm-pump'), 0);
  assert.equal(badge(gladys).transport, 'local');
});

test('read again at the interval, never faster; identity again after 6 h only', async (t) => {
  const { server, advance } = await setup(t);
  const count = () => server.requests.filter(to.values).length;
  assert.equal(count(), 1);
  await advance(59 * SECOND);
  assert.equal(count(), 1);
  await advance(2 * SECOND);
  assert.equal(count(), 2);
  assert.equal(server.requests.filter(to.debug).length, 1);
  await advance(6 * HOUR);
  assert.equal(server.requests.filter(to.debug).length, 2);
});

test('the alarm triggers: the first read is a baseline, then one event per transition', async (t) => {
  const store = memoryStore();
  const server = fakePoolDose();
  server.setAlarm('alarm-ph-tank', true);
  const { gladys, advance } = await setup(t, { store, server });
  assert.equal(last(gladys, 'alarm-ph-tank'), 1);
  assert.deepEqual(gladys.fake.sceneEvents, [], 'an alarm there at the first read is not news');
  assert.deepEqual(store.data.alarms[DEVICE_ID], ['alarm-ph-tank']);

  server.setAlarm('alarm-ph-high', true);
  server.setAlarm('alarm-ph-tank', false);
  await advance(MINUTE);
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.ALARM_RAISED,
      data: {
        device: DEV,
        alarm: 'alarm-ph-high',
        alarm_name: 'pH trop haut',
        device_name: 'PoolDose Double',
      },
    },
    {
      key: SCENE_TRIGGERS.ALARM_CLEARED,
      data: {
        device: DEV,
        alarm: 'alarm-ph-tank',
        alarm_name: 'Alarme niveau bidon pH',
        device_name: 'PoolDose Double',
      },
    },
  ]);
  assert.equal(last(gladys, 'alarm-ph-high'), 1);
  await advance(MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 2, 'an alarm still on fires nothing');

  // An alarm not read this time keeps its state: no "cleared".
  delete server.values[rawKey('w_1fahufum0')];
  await advance(MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 2);
  assert.deepEqual(store.data.alarms[DEVICE_ID], ['alarm-ph-high']);
});

test('a restart never fires an alarm again; one raised meanwhile fires', async (t) => {
  const store = memoryStore();
  const server = fakePoolDose();
  server.setAlarm('alarm-pump', true);
  const first = await setup(t, { store, server });
  first.app.stop();
  t.mock.timers.reset();
  const again = await setup(t, { store, server });
  assert.deepEqual(again.gladys.fake.sceneEvents, []);
  again.app.stop();
  t.mock.timers.reset();
  server.setAlarm('alarm-ph-high', true);
  const third = await setup(t, { store, server });
  assert.deepEqual(
    third.gladys.fake.sceneEvents.map((e) => [e.key, e.data.alarm]),
    [[SCENE_TRIGGERS.ALARM_RAISED, 'alarm-ph-high']],
  );
});

test('a command is refused: read only, nothing sent', async (t) => {
  const { gladys, server } = await setup(t);
  const before = server.requests.length;
  const ack = await gladys.fake.setValue(device(gladys), feature(gladys, 'ph-target'), 7.4);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Lecture seule/);
  assert.equal(server.requests.length, before);
  assert.ok(
    server.requests.every((r) => !r.path.includes('set')),
    'no write endpoint',
  );
});

test('a refusal (401/403): stopped, kept in /data, one new try after 1 h, the button retries', async (t) => {
  const store = memoryStore();
  const server = fakePoolDose();
  server.queue.push({ match: to.params, status: 401, body: {} });
  const { gladys, app, advance } = await setup(t, { store, server });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /refusé l’accès/);
  assert.equal(store.data.block.kind, 'refused');
  assert.equal(server.requests.length, 1);
  await advance(30 * MINUTE, MINUTE);
  assert.equal(server.requests.length, 1, 'no loop');

  // A restart keeps the stop.
  app.stop();
  t.mock.timers.reset();
  const again = await setup(t, { store, server });
  assert.equal(server.requests.length, 1);
  assert.match(message(again.gladys).en, /refused the access/);

  // The button tries at once.
  const ack = await again.gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Connected to/);
  assert.equal(store.data.block, null);
});

test('a refusal is retried by itself after 1 h, then 6 h', async (t) => {
  const server = fakePoolDose();
  server.queue.push({ match: to.any, status: 403 }, { match: to.any, status: 403 });
  const { advance, gladys } = await setup(t, { server });
  assert.equal(server.requests.length, 1);
  await advance(HOUR + MINUTE, MINUTE);
  assert.equal(server.requests.length, 2);
  assert.match(message(gladys).en, /6 h/);
  await advance(6 * HOUR + MINUTE, 10 * MINUTE);
  assert.ok(server.requests.filter(to.values).length >= 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a 429: a pause of Retry-After for every path, kept across a restart and a reconnection', async (t) => {
  const store = memoryStore();
  const server = fakePoolDose();
  const { gladys, app, advance } = await setup(t, { store, server });
  server.queue.push({ match: to.values, status: 429, headers: { 'retry-after': '1800' } });
  await advance(MINUTE);
  assert.match(message(gladys).en, /HTTP 429\): paused for 30 min/);
  assert.equal(store.data.pause.kind, 'rate');
  const count = server.requests.length;
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /paused/);
  await app.connected(CONFIG);
  await advance(20 * MINUTE, MINUTE);
  assert.equal(server.requests.length, count, 'nothing during the pause');
  app.stop();
  t.mock.timers.reset();
  await setup(t, { store, server, create: false });
  assert.equal(server.requests.length, count, 'a restart keeps the pause');
});

test('no answer: a backoff never faster than the interval, kept in /data, the badge unreachable', async (t) => {
  const store = memoryStore();
  const server = fakePoolDose();
  const { gladys, advance } = await setup(t, { store, server });
  server.down = true;
  await advance(MINUTE);
  assert.match(message(gladys).fr, /ne répond pas \(connexion refusée\)/);
  assert.equal(badge(gladys).transport, 'unreachable');
  assert.equal(store.data.pause.kind, 'backoff');
  const reads = () => server.requests.filter(to.values).length;
  const before = reads();
  await advance(59 * SECOND);
  assert.equal(reads(), before);
  await advance(2 * SECOND);
  assert.equal(reads(), before + 1);
  // The second failure waits 2 min.
  await advance(MINUTE + 50 * SECOND);
  assert.equal(reads(), before + 1);
  server.down = false;
  await advance(20 * SECOND);
  assert.equal(reads(), before + 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(badge(gladys).transport, 'local');
  assert.equal(store.data.pause, null);
});

test('a 5xx is a backoff too; a 404 reads the identity again', async (t) => {
  const server = fakePoolDose();
  const { gladys, advance } = await setup(t, { server });
  server.queue.push({ match: to.values, status: 503 });
  await advance(MINUTE);
  assert.match(message(gladys).en, /device error 503/);
  await advance(MINUTE);
  server.queue.push({ match: to.values, status: 404 });
  await advance(MINUTE);
  assert.match(message(gladys).en, /HTTP 404/);
  const debug = server.requests.filter(to.debug).length;
  await advance(MINUTE);
  assert.equal(server.requests.filter(to.debug).length, debug + 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a model without mapping: found, said in the status, nothing published', async (t) => {
  const server = fakePoolDose();
  server.debug.DEVICES[0].PRODUCT_CODE = 'PDXX9999';
  const { gladys } = await setup(t, { server });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /model PDXX9999 \(firmware 539187\) has no mapping yet/);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.equal(server.requests.filter(to.values).length, 0);
});

test('an alias model reads the mapping of its base model', async (t) => {
  const server = fakePoolDose();
  // A POOLDOSE pH+ORP CF Group: its own code, the keys of PDPR1H1HAW100.
  server.debug.DEVICES[0].PRODUCT_CODE = 'PDPR1H1HAW102';
  const { gladys } = await setup(t, { server });
  assert.equal(last(gladys, 'ph'), 7.18);
});

test('°F on the device: Gladys gets °C', async (t) => {
  const server = fakePoolDose();
  server.values[rawKey('w_1eommf39k')] = { current: 80.6, magnitude: ['°F'] };
  const { gladys } = await setup(t, { server });
  assert.equal(last(gladys, 'temperature'), 27);
});

test('a hostile answer: no prototype pollution, out-of-range values dropped', async (t) => {
  const server = fakePoolDose();
  server.queue.push({
    match: to.values,
    body: `{"devicedata":{"${DEVICE_ID}":{"__proto__":{"polluted":1},"${rawKey('w_1ekeigkin')}":{"current":99},"${rawKey('w_1eommf39k')}":{"current":"26,5"}}}}`,
  });
  const { gladys } = await setup(t, { server });
  assert.equal({}.polluted, undefined);
  assert.equal(last(gladys, 'ph'), undefined, 'a pH of 99 is not a pH');
  assert.equal(last(gladys, 'temperature'), 26.5);
});

test('an answer too deep or not JSON is a bad answer, never a crash', async (t) => {
  const server = fakePoolDose();
  const deep = `${'{"a":'.repeat(50)}1${'}'.repeat(50)}`;
  server.queue.push({ match: to.values, body: deep });
  const { gladys, advance } = await setup(t, { server });
  assert.match(message(gladys).en, /unexpected answer/);
  server.queue.push({ match: to.values, body: '<html>' });
  await advance(2 * MINUTE);
  assert.match(message(gladys).en, /unexpected answer/);
});

test('a republished device keeps its features when a value is gone', async (t) => {
  const server = fakePoolDose();
  const { gladys, app } = await setup(t, { server });
  delete server.values[rawKey('w_1eo03t46k')];
  app.stop();
  t.mock.timers.reset();
  // A new run that never sees the chlorine; Gladys has the feature.
  const again = await setup(t, { server, create: false, devices: gladys.fake.devices });
  assert.ok(roles(again.gladys).includes('free-chlorine'));
  assert.equal(roles(again.gladys).length, roles(gladys).length);
});

test('the status and the Discovery list are sent again at each reconnection', async (t) => {
  const { gladys, app } = await setup(t);
  const statuses = gladys.fake.connectionStatuses.length;
  const published = [];
  const publish = gladys.publishDiscoveredDevices.bind(gladys);
  gladys.publishDiscoveredDevices = async (devices) => {
    published.push(devices.length);
    return publish(devices);
  };
  await app.connected(CONFIG);
  assert.ok(gladys.fake.connectionStatuses.length > statuses);
  assert.deepEqual(published, [1]);
});

test('a new address restarts on that device and lifts the stop; the language applies at once', async (t) => {
  const store = memoryStore();
  const server = fakePoolDose();
  server.queue.push({ match: to.any, status: 403 });
  const { gladys } = await setup(t, { store, server });
  assert.equal(store.data.block.kind, 'refused');
  await gladys.fake.configUpdated({ host: '192.168.1.51' });
  await settle();
  assert.equal(server.requests.at(-1).host, '192.168.1.51');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await gladys.fake.deviceCreated(device(gladys));
  await settle();
  assert.equal(gladys.fake.lastState(`${DEV}:ph-dosing-method`), 'Proportionnel');
  await gladys.fake.configUpdated({ host: '192.168.1.51', language: 'en' });
  await settle();
  assert.equal(gladys.fake.lastState(`${DEV}:ph-dosing-method`), 'Proportional');
});

test('HTTPS, a port, a self-signed certificate on request', async (t) => {
  const { server } = await setup(t, {
    config: { host: 'pooldose.local', port: 8443, use_ssl: true, ssl_verify: false },
  });
  const [first] = server.requests;
  assert.equal(first.url, 'https://pooldose.local:8443/js_libs/params.js');
  assert.equal(first.insecure, true);
});

test('the button: at most one read per 30 s', async (t) => {
  const { gladys, server } = await setup(t);
  const first = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(first.data.message.en, /Connected/);
  const count = server.requests.length;
  const second = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(second.data.message.en, /less than 30 s/);
  assert.equal(server.requests.length, count);
});

test('the logs never hold the address of the device', async (t) => {
  const logs = [];
  const server = fakePoolDose();
  server.queue.push({
    match: to.params,
    throws: new PoolDoseError('network', 'host unreachable', { code: 'EHOSTUNREACH' }),
  });
  await setup(t, { server, logs });
  assert.ok(logs.length > 0);
  assert.ok(
    logs.every((line) => !line.includes(HOST)),
    logs.join('\n'),
  );
});

// --- Review fixes (milestone 1) ----------------------------------------------

const TEMPERATURE_UNIT = rawKey('w_1fkpc4jak');

test('I1: °F in every spelling, or from temperature_unit without a magnitude', async (t) => {
  for (const [magnitude, setting] of [
    [undefined, '|PDPR1H1HAW100_FW539187_LABEL_w_1fkpc4jak__F|'],
    [['ºF']],
    [['˚F']],
    [['°F']],
    [['F']],
  ]) {
    const server = fakePoolDose();
    server.values[rawKey('w_1eommf39k')] = magnitude
      ? { current: 80.6, magnitude }
      : { current: 80.6 };
    if (setting) {
      server.values[TEMPERATURE_UNIT] = { current: setting };
    }
    const { gladys, app } = await setup(t, { server });
    assert.equal(last(gladys, 'temperature'), 27, JSON.stringify(magnitude));
    app.stop();
    t.mock.timers.reset();
  }
  // °C by the setting, and a magnitude wins over the setting.
  const server = fakePoolDose();
  server.values[rawKey('w_1eommf39k')] = { current: 26, magnitude: ['°C'] };
  server.values[TEMPERATURE_UNIT] = { current: '|PDPR1H1HAW100_FW539187_LABEL_w_1fkpc4jak__F|' };
  const { gladys } = await setup(t, { server });
  assert.equal(last(gladys, 'temperature'), 26);
});

test('M1: an alarm answer other than O/F, a boolean or 0/1 keeps the alarm as it was', async (t) => {
  const server = fakePoolDose();
  server.setAlarm('alarm-pump', true);
  const { gladys, advance } = await setup(t, { server });
  assert.equal(last(gladys, 'alarm-pump'), 1);
  for (const current of ['', 'X', 2, null, '|PDPR1H1HAW100_FW539187_LABEL_w_1ekga097n_ON|']) {
    server.values[rawKey('w_1ekga097n')] = { current };
    await advance(MINUTE);
    assert.deepEqual(gladys.fake.sceneEvents, [], `"${current}" is not a "cleared"`);
    assert.equal(last(gladys, 'alarm-pump'), 1);
  }
  server.values[rawKey('w_1ekga097n')] = { current: 0 };
  await advance(MINUTE);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.alarm]),
    [[SCENE_TRIGGERS.ALARM_CLEARED, 'alarm-pump']],
  );
  server.values[rawKey('w_1ekga097n')] = { current: '1' };
  await advance(MINUTE);
  assert.equal(gladys.fake.sceneEvents.at(-1).key, SCENE_TRIGGERS.ALARM_RAISED);
});

test('M2: a failed write of /data is said in the status, until a write works again', async (t) => {
  const store = memoryStore();
  const server = fakePoolDose();
  const { gladys, advance } = await setup(t, { store, server });
  const save = store.save.bind(store);
  store.save = async () => {
    throw new Error('EROFS');
  };
  server.setAlarm('alarm-pump', true);
  await advance(MINUTE);
  assert.match(message(gladys).en, /could not be saved in \/data/);
  assert.match(message(gladys).fr, /Connecté à .*pas pu être enregistré dans \/data/);
  store.save = save;
  await advance(MINUTE);
  assert.doesNotMatch(message(gladys).en, /could not be saved/);
  assert.match(message(gladys).en, /^Connected to/);
});

test('M3: a new address keeps the alarms of the device (DID), only the pause and the stop go', async (t) => {
  const store = memoryStore();
  const server = fakePoolDose();
  server.setAlarm('alarm-pump', true);
  const { gladys } = await setup(t, { store, server });
  server.setAlarm('alarm-pump', false);
  server.queue.push({ match: to.values, status: 429, headers: { 'retry-after': '3600' } });
  // The pause belongs to the old address.
  await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(store.data.pause.kind, 'rate');
  await gladys.fake.configUpdated({ host: '192.168.1.77' });
  await settle();
  assert.equal(store.data.pause, null);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.alarm]),
    [[SCENE_TRIGGERS.ALARM_CLEARED, 'alarm-pump']],
  );
  assert.equal(device(gladys).external_id, DEV);
});

test('M4: a restart while the device does not answer turns its badge unreachable', async (t) => {
  const store = memoryStore();
  const server = fakePoolDose();
  const first = await setup(t, { store, server });
  assert.equal(store.data.deviceId, DEVICE_ID);
  first.app.stop();
  t.mock.timers.reset();
  server.down = true;
  const again = await setup(t, {
    store,
    server,
    create: false,
    devices: first.gladys.fake.devices,
  });
  assert.equal(badge(again.gladys).transport, 'unreachable');
  again.app.stop();
  t.mock.timers.reset();
  // Without the DID in /data: the only PoolDose device of the integration.
  const bare = memoryStore({ target: store.data.target });
  const third = await setup(t, {
    store: bare,
    server,
    create: false,
    devices: first.gladys.fake.devices,
  });
  assert.equal(badge(third.gladys).transport, 'unreachable');
});

test('M8: getInstantValues is a POST without a body (Content-Length: 0)', async (t) => {
  const { server } = await setup(t);
  const post = server.requests.find(to.values);
  assert.equal(post.method, 'POST');
  assert.equal(post.body, undefined);
  assert.equal(post.headers['Content-Length'], '0');
  assert.ok(
    server.requests.filter((r) => r.method === 'GET').every((r) => !r.headers['Content-Length']),
  );
});
