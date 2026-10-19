// -----------------------------------------------------------------------------
// PoolDose values -> Gladys device and states (pure).
//
// One Gladys device per PoolDose, `ext:<selector>:pooldose:<device DID>` (the
// id the device gives itself, "0123456789_DEVICE"). The features are keyed by
// their role (the last part of their external id): those keys are published
// forever, never rename them. A role maps to one or more keys of the
// python-pooldose mappings (the name differs between models). A device
// already created keeps all its features when it is published again.
//
// Read only (v1): every feature is `read_only`; the setpoints and the dosing
// pumps are shown, never commanded.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { text } from './client.js';
import { ALARM_NAMES, DOSING_LABELS, FEATURE_NAMES, word } from './i18n.js';
import { toNumber } from './pooldose.js';

const temperature = {
  category: C.TEMPERATURE_SENSOR,
  type: TYPES.SENSOR.DECIMAL,
  unit: U.CELSIUS,
  min: -10,
  max: 60,
};
const ph = { category: C.PH_SENSOR, type: TYPES.PH_SENSOR.DECIMAL, unit: U.PH, min: 0, max: 14 };
const orp = {
  category: C.ORP_SENSOR,
  type: TYPES.ORP_SENSOR.DECIMAL,
  unit: U.MILLI_VOLT,
  min: 0,
  max: 2000,
};
// Gladys has no chlorine category: a generic sensor in ppm (mg/L in water),
// the exception decided for the salt of gladys-ondilo (TODO.md "Decisions").
const chlorine = { category: C.UNKNOWN, type: TYPES.UNKNOWN.UNKNOWN, unit: U.PPM, min: 0, max: 20 };
const textual = { category: C.TEXT, type: TYPES.TEXT.TEXT, min: 0, max: 0, keep_history: false };
const binary = { category: C.UNKNOWN, type: TYPES.SENSOR.BINARY, min: 0, max: 1 };

/**
 * Every role: its python-pooldose keys (the first one with a value wins), its
 * shape and how its value is read. The order is the order of the features.
 */
const MEASURES = [
  ['temperature', ['temperature'], temperature, 'temperature'],
  ['ph', ['ph'], ph, 'ph'],
  ['orp', ['orp'], orp, 'orp'],
  ['free-chlorine', ['cl'], chlorine, 'chlorine'],
  ['ph-target', ['ph_target'], ph, 'ph'],
  ['orp-target', ['orp_target'], orp, 'orp'],
  ['chlorine-target', ['cl_target'], chlorine, 'chlorine'],
  ['ph-dosing-method', ['peristaltic_ph_dosing', 'ph_type_dosing_method'], textual, 'text'],
  ['orp-dosing-method', ['peristaltic_orp_dosing', 'orp_type_dosing_method'], textual, 'text'],
  ['chlorine-dosing-method', ['peristaltic_cl_dosing', 'cl_type_dosing_method'], textual, 'text'],
  ['ph-dosing-type', ['ph_type_dosing', 'ph_type_dosing_set'], textual, 'text'],
  ['orp-dosing-type', ['orp_type_dosing', 'orp_type_dosing_set'], textual, 'text'],
  ['chlorine-dosing-type', ['cl_type_dosing', 'cl_type_dosing_set'], textual, 'text'],
  ['dosing-paused', ['pause_dosing'], binary, 'binary'],
  ['circulation-pump', ['circulation_pump_status'], binary, 'binary'],
];

/** The alarms: python-pooldose key -> role (binary sensors, and the scene triggers). */
export const ALARM_KEYS = {
  pump_alarm: 'alarm-pump',
  ph_level_alarm: 'alarm-ph-tank',
  orp_level_alarm: 'alarm-orp-tank',
  cl_level_alarm: 'alarm-chlorine-tank',
  flow_rate_alarm: 'alarm-flow',
  relay_alarm: 'alarm-relay',
  alarm_ofa_ph: 'alarm-ph-overfeed',
  alarm_ofa2_ph: 'alarm-ph-overfeed-2',
  alarm_ofa_orp: 'alarm-orp-overfeed',
  alarm_ofa2_orp: 'alarm-orp-overfeed-2',
  alarm_ofa_cl: 'alarm-chlorine-overfeed',
  alarm_ofa2_cl: 'alarm-chlorine-overfeed-2',
  alarm_water_too_cold: 'alarm-water-cold',
  alarm_water_too_hot: 'alarm-water-hot',
  alarm_ph_too_low: 'alarm-ph-low',
  alarm_ph_too_high: 'alarm-ph-high',
  alarm_cl_too_low_orp: 'alarm-orp-low',
  alarm_cl_too_high_orp: 'alarm-orp-high',
  alarm_cl_too_low: 'alarm-chlorine-low',
  alarm_cl_too_high: 'alarm-chlorine-high',
  alarm_system_standby: 'alarm-standby',
};

/** The alarm roles, in their order. */
export const ALARMS = Object.values(ALARM_KEYS);

const ROLE_TABLE = new Map([
  ...MEASURES.map(([role, keys, shape, read]) => [role, { keys, shape, read }]),
  ...Object.entries(ALARM_KEYS).map(([key, role]) => [
    role,
    { keys: [key], shape: binary, read: 'binary', alarm: true },
  ]),
]);

export const ROLES = [...ROLE_TABLE.keys()];

export const deviceIds = (gladys, id) => gladys.externalIds('pooldose', String(id));

/** `{ id, role }` of a feature external id of this integration, undefined otherwise. */
export function parseFeatureId(gladys, featureId) {
  const prefix = gladys.externalId('pooldose:');
  if (typeof featureId !== 'string' || !featureId.startsWith(prefix)) {
    return undefined;
  }
  const rest = featureId.slice(prefix.length);
  const cut = rest.lastIndexOf(':');
  const role = rest.slice(cut + 1);
  return cut > 0 && ROLE_TABLE.has(role) ? { id: rest.slice(0, cut), role } : undefined;
}

const round = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** A dosing label: the known ones translated, another one shown as the device gives it. */
function dosingText(value, language) {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (Object.hasOwn(DOSING_LABELS, value)) {
    return word(DOSING_LABELS[value], language);
  }
  // An unconverted label "|PDPR…_LABEL_w_xxx_FOO_BAR|" -> "foo bar".
  const plain = value.slice(0, 200).replace(/\|/g, '');
  const at = plain.search(/_(?:LABEL|COMBO)_w_/);
  if (at < 0) {
    return text(plain, 60);
  }
  const label = plain
    .slice(at)
    .split('_')
    .slice(4)
    .filter((part) => part !== '')
    .join(' ')
    .toLowerCase();
  return text(label, 60);
}

/** The value of one decoded entry for a role, or undefined when unusable. */
function readValue(read, entry, language, temperatureUnit) {
  const value = entry?.value;
  if (read === 'binary') {
    return typeof value === 'boolean' ? (value ? 1 : 0) : undefined;
  }
  if (read === 'text') {
    return dosingText(value, language);
  }
  const number = toNumber(value);
  if (number === undefined) {
    return undefined;
  }
  const unit = typeof entry.unit === 'string' ? entry.unit.toLowerCase() : undefined;
  if (read === 'temperature') {
    // The device can show °F: Gladys gets °C (the unit is fixed at creation).
    // Without a magnitude, the unit setting of the device (temperature_unit) tells.
    const scale = TEMPERATURE_UNITS[unit ?? temperatureUnit ?? 'c'];
    if (scale === 'f') {
      return round(((number - 32) * 5) / 9, 1);
    }
    return scale === 'c' ? round(number, 1) : undefined;
  }
  if (read === 'ph') {
    return number >= 0 && number <= 14 ? round(number, 2) : undefined;
  }
  if (read === 'orp') {
    return unit === undefined || unit === 'mv' ? Math.round(number) : undefined;
  }
  // Chlorine: ppm and mg/L are the same value in water.
  return unit === undefined || unit === 'ppm' || unit === 'mg/l' ? round(number, 2) : undefined;
}

/** The temperature units a magnitude or the temperature_unit setting can give -> scale. */
const TEMPERATURE_UNITS = Object.assign(Object.create(null), {
  '°c': 'c',
  c: 'c',
  degc: 'c',
  celsius: 'c',
  '°f': 'f',
  f: 'f',
  degf: 'f',
  fahrenheit: 'f',
});

/** role -> value of the decoded values of a device (only the roles it answered). */
export function valuesOf(decoded, language) {
  const values = new Map();
  const setting = decoded.get('temperature_unit')?.value;
  // An unknown setting is ignored (°C, as python-pooldose without a magnitude).
  const temperatureUnit =
    typeof setting === 'string' && TEMPERATURE_UNITS[setting.toLowerCase()]
      ? setting.toLowerCase()
      : undefined;
  for (const [role, { keys, read }] of ROLE_TABLE) {
    for (const key of keys) {
      const value = readValue(read, decoded.get(key), language, temperatureUnit);
      if (value !== undefined) {
        values.set(role, value);
        break;
      }
    }
  }
  return values;
}

/** The alarms read: role -> true/false. */
export function alarmsOf(values) {
  const alarms = new Map();
  for (const role of ALARMS) {
    if (values.has(role)) {
      alarms.set(role, values.get(role) === 1);
    }
  }
  return alarms;
}

const nameOf = (role, language) =>
  word(ROLE_TABLE.get(role).alarm ? ALARM_NAMES[role] : FEATURE_NAMES[role], language);

/** "PoolDose 6789" from "0123456789_DEVICE", or the name of the device. */
export function deviceName(identity) {
  const short = String(identity.deviceId)
    .replace(/_DEVICE$/i, '')
    .slice(-4);
  return (identity.name ?? `PoolDose ${short}`).slice(0, 80);
}

/**
 * The Gladys device of one PoolDose. `seen`: the roles read at least once
 * this session; `created`: the roles of the device already in Gladys, so a
 * republished device never loses a feature.
 */
export function buildDevice(gladys, { identity, seen, created = new Set() }, language) {
  const ids = deviceIds(gladys, identity.deviceId);
  const roles = ROLES.filter((role) => seen.has(role) || created.has(role));
  const params = [
    ['device_id', identity.deviceId],
    ['product_code', identity.productCode],
    ['model', identity.model],
    ['firmware', identity.firmware],
    ['fw_code', identity.fwCode],
  ]
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ({ name, value: String(value) }));
  return {
    name: deviceName(identity),
    external_id: ids.device,
    features: roles.map((role) => ({
      name: nameOf(role, language),
      external_id: ids.feature(role),
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...ROLE_TABLE.get(role).shape,
    })),
    params,
  };
}

/** The Gladys states: `[{ role, state }]` or `[{ role, text }]`. */
export function statesOf(values) {
  return [...values].map(([role, value]) =>
    ROLE_TABLE.get(role).read === 'text' ? { role, text: value } : { role, state: value },
  );
}

/** The name of an alarm for a scene event. */
export const alarmName = (role, language) => word(ALARM_NAMES[role], language);
