// -----------------------------------------------------------------------------
// The pure parts: the mappings of python-pooldose, the decoding, the roles,
// the configuration, the parsing of hostile answers, the persisted state.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { baseUrl, PoolDoseClient } from '../src/client.js';
import { normalizeConfig, parseHost } from '../src/config.js';
import { TIMINGS } from '../src/constants.js';
import { ALARM_KEYS, ALARMS, ROLES, buildDevice, valuesOf } from '../src/devices.js';
import { parseJson } from '../src/http.js';
import { ALARM_NAMES, FEATURE_NAMES } from '../src/i18n.js';
import { MODEL_ALIASES, SUPPORTED, decode, mappingFor, toNumber } from '../src/pooldose.js';
import { normalizeMemory } from '../src/store.js';
import { DEVICE_ID, NOW, instantValues } from './helpers/fakePoolDose.js';

test('the eight mappings of python-pooldose 0.9.15 load, with their prefix', () => {
  assert.equal(SUPPORTED.length, 8);
  for (const key of SUPPORTED) {
    const [code, fw] = key.split('_FW');
    const found = mappingFor(code, fw);
    assert.ok(found?.mapping?.ph || found?.mapping?.orp, key);
    for (const entry of Object.values(found.mapping)) {
      assert.match(entry.type, /^(sensor|binary_sensor|number|switch|select)$/);
      assert.equal(typeof entry.key, 'string');
    }
  }
  assert.equal(mappingFor('PDPR1H1HAW100', '539187').prefix, 'PDPR1H1HAW100_FW539187_');
  assert.equal(mappingFor('nope', '1'), undefined);
  assert.equal(mappingFor(undefined, '1'), undefined);
});

test('the aliases: the alias mapping, or a dedicated one, the raw keys of the alias', () => {
  const alias = mappingFor('PDPR1H1HAW102', '539187');
  assert.equal(alias.prefix, 'PDPR1H1HAW100_FW539187_');
  assert.equal(alias.mapping, mappingFor('PDPR1H1HAW100', '539187').mapping);
  // VÁGNER POOL VA DOS EXACT: its own file, the keys of PDPR1H1HAR1V0.
  const exact = mappingFor('PDHC1H1HAR1V1', '539224');
  assert.equal(exact.prefix, 'PDPR1H1HAR1V0_FW539224_');
  assert.ok(exact.mapping.cl, 'the dedicated file (with chlorine)');
  assert.ok(Object.isFrozen(MODEL_ALIASES));
  assert.equal(mappingFor('toString', '539187'), undefined);
});

test('every key of the mappings that is an alarm has a role; every role a name', () => {
  for (const key of SUPPORTED) {
    const [code, fw] = key.split('_FW');
    for (const [name, entry] of Object.entries(mappingFor(code, fw).mapping)) {
      if (entry.type === 'binary_sensor' && /alarm/.test(name)) {
        assert.ok(ALARM_KEYS[name], `${key}: ${name} has no alarm role`);
      }
    }
  }
  for (const role of ROLES) {
    const names = ALARMS.includes(role) ? ALARM_NAMES[role] : FEATURE_NAMES[role];
    assert.ok(names?.en && names?.fr, role);
  }
  assert.equal(new Set(ROLES).size, ROLES.length);
});

test('decode: sensors with units, binaries O/F, numbers with their range, conversions', () => {
  const values = decode(instantValues(), mappingFor('PDPR1H1HAW100', '539187'));
  assert.deepEqual(values.get('temperature'), { type: 'sensor', value: 26.4, unit: '°C' });
  assert.deepEqual(values.get('ph'), { type: 'sensor', value: 7.18, unit: undefined });
  assert.deepEqual(values.get('cl'), { type: 'sensor', value: 0.8, unit: 'ppm' });
  assert.equal(values.get('ph_type_dosing').value, 'acid');
  assert.equal(values.get('peristaltic_orp_dosing').value, 'on / off');
  assert.deepEqual(values.get('pump_alarm'), { type: 'binary_sensor', value: false });
  assert.deepEqual(values.get('ph_target'), {
    type: 'number',
    value: 7.2,
    unit: undefined,
    min: 6,
    max: 8,
    step: 0.1,
  });
  assert.equal(values.get('pause_dosing').value, false);
  assert.equal(values.has('relay_aux1'), false, 'absent from the answer');
});

test('decode: a select through its options and conversion, a minT field', () => {
  const found = mappingFor('PDHC1H1HAR1V1', '539224');
  const raw = {
    [`${found.prefix}${found.mapping.ph_type_dosing_method.key}`]: { current: 2 },
    [`${found.prefix}${found.mapping.ofa_ph_lower.key}`]: { minT: 6.5, maxT: 8, current: 7 },
  };
  const values = decode(raw, found);
  assert.equal(values.get('ph_type_dosing_method').value, 'on / off');
  assert.equal(values.get('ofa_ph_lower').value, 6.5);
  assert.equal(valuesOf(values, 'en').get('ph-dosing-method'), 'On / off');
});

test('roles: an unknown dosing label shown plainly, a wrong unit dropped', () => {
  const decoded = new Map([
    [
      'peristaltic_ph_dosing',
      { type: 'sensor', value: '|PDPR1H1HAW100_FW539187_LABEL_w_x_SMART_MODE|' },
    ],
    ['orp', { type: 'sensor', value: 650, unit: 'V' }],
    ['cl', { type: 'sensor', value: '0.6', unit: 'mg/L' }],
    ['pump_alarm', { type: 'binary_sensor', value: true }],
    ['temperature', { type: 'sensor', value: 25, unit: 'K' }],
  ]);
  const values = valuesOf(decoded, 'fr');
  assert.equal(values.get('ph-dosing-method'), 'smart mode');
  assert.equal(values.has('orp'), false);
  assert.equal(values.get('free-chlorine'), 0.6);
  assert.equal(values.get('alarm-pump'), 1);
  assert.equal(values.has('temperature'), false);
});

test('toNumber: strict', () => {
  assert.equal(toNumber(7.2), 7.2);
  assert.equal(toNumber('7,2'), 7.2);
  for (const bad of [null, '', ' ', 'abc', '1e9', NaN, Infinity, [], {}, true]) {
    assert.equal(toNumber(bad), undefined, String(bad));
  }
});

test('the device: stable external ids, read only, created roles kept', () => {
  const gladys = createFakeGladys();
  const identity = { deviceId: DEVICE_ID, name: undefined };
  const device = buildDevice(
    gladys,
    { identity, seen: new Set(['ph']), created: new Set(['orp']) },
    'en',
  );
  assert.equal(device.external_id, `ext:test-integration:pooldose:${DEVICE_ID}`);
  assert.equal(device.name, 'PoolDose 6789');
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').pop()),
    ['ph', 'orp'],
  );
  assert.ok(device.features.every((f) => f.read_only));
});

test('the address: a host name or an IP only', () => {
  assert.equal(parseHost(' 192.168.1.50 '), '192.168.1.50');
  assert.equal(parseHost('http://PoolDose.local/'), 'pooldose.local');
  assert.equal(parseHost('[fe80::1]'), 'fe80::1');
  for (const bad of ['', 'a/b', 'a b', 'u@h', 'h:80', 'h?x', '-h', 'h..x', 'x'.repeat(300)]) {
    assert.equal(parseHost(bad), undefined, bad);
  }
  assert.equal(baseUrl({ host: 'fe80::1', port: 0, useSsl: false }), 'http://[fe80::1]');
  assert.equal(baseUrl({ host: 'h', port: 443, useSsl: true }), 'https://h');
  assert.equal(baseUrl({ host: 'h', port: 8080, useSsl: false }), 'http://h:8080');
});

test('the configuration: defaults, bounds', () => {
  const config = normalizeConfig({ host: 'h', poll_interval: 5, port: 99999, language: 'de' });
  assert.equal(config.pollInterval, 30);
  assert.equal(config.port, 0);
  assert.equal(config.language, 'fr');
  assert.equal(config.sslVerify, true);
  assert.equal(config.useSsl, false);
  assert.equal(normalizeConfig({ host: 'h', poll_interval: 5000 }).pollInterval, 900);
  assert.equal(normalizeConfig({ host: 'h', use_ssl: 'true' }).useSsl, true);
  assert.equal(normalizeConfig({ host: 'a/b' }).badHost, true);
  assert.notEqual(
    normalizeConfig({ host: 'h' }).target,
    normalizeConfig({ host: 'h', port: 81 }).target,
  );
});

test('parseJson: no prototype key, a bounded depth', () => {
  const value = parseJson('{"__proto__":{"x":1},"constructor":{"prototype":{"y":1}},"a":1}');
  assert.deepEqual(Object.keys(value), ['a']);
  assert.equal({}.x, undefined);
  assert.throws(() => parseJson(`${'['.repeat(40)}${']'.repeat(40)}`), /too deep/);
  assert.throws(() => parseJson('nope'), /not JSON/);
  assert.equal(parseJson(''), undefined);
});

test('the client: the identity checked, a reserved id refused', async () => {
  const answer = (body) => async () => ({ status: 200, headers: {}, body: JSON.stringify(body) });
  const client = new PoolDoseClient({
    transport: answer({ DEVICES: [{ DID: '__proto__', PRODUCT_CODE: 'X', FW_CODE: '1' }] }),
  });
  client.configure({ host: 'h', port: 0, useSsl: false, sslVerify: true });
  await assert.rejects(client.identity(), /no device/);
  const other = new PoolDoseClient({ transport: answer({ devicedata: {} }) });
  other.configure({ host: 'h', port: 0, useSsl: false, sslVerify: true });
  await assert.rejects(other.instantValues(DEVICE_ID), /no instant values/);
  const script = new PoolDoseClient({
    transport: async () => ({
      status: 200,
      headers: {},
      body: `x${' '.repeat(50_000)}softwareVersion`,
    }),
  });
  script.configure({ host: 'h', port: 0, useSsl: false, sslVerify: true });
  assert.deepEqual(await script.params(), { softwareVersion: undefined, apiVersion: undefined });
});

test('the persisted state: repaired and bounded', () => {
  const target = 'a'.repeat(32);
  const memory = normalizeMemory(
    {
      target,
      pause: { kind: 'rate', until: NOW + 100 * 3600_000, failures: 'x' },
      block: { kind: 'refused', retries: 99, retryAt: NOW + 1e12 },
      alarms: { [DEVICE_ID]: ['alarm-pump', 'nope', 'alarm-pump'], 'bad id!': ['alarm-pump'] },
    },
    NOW,
  );
  assert.equal(memory.pause.until, NOW + TIMINGS.rateLimitMax);
  assert.equal(memory.pause.failures, 1);
  assert.equal(memory.block.retries, 10);
  assert.equal(memory.block.retryAt, NOW + TIMINGS.refusedRetry.at(-1));
  assert.deepEqual({ ...memory.alarms }, { [DEVICE_ID]: ['alarm-pump'] });
  assert.equal(Object.getPrototypeOf(memory.alarms), null);
  assert.deepEqual(normalizeMemory({ pause: { kind: 'other', until: NOW } }, NOW).pause, null);
  assert.equal(normalizeMemory({ block: { kind: 'refused' } }, NOW).block, null, 'no target');
});
