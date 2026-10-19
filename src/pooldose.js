// -----------------------------------------------------------------------------
// The PoolDose data model (pure), ported from python-pooldose 0.9.15 (MIT):
//   - the mapping of a model and firmware (src/mappings/*.json, the files of
//     python-pooldose as they are), and the model aliases;
//   - the decoding of the raw instant values with that mapping
//     (values/instant_values.py: sensor, binary_sensor, switch, number,
//     select).
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs';
import { own, parseJson } from './http.js';

/**
 * PRODUCT_CODE reported -> model id of the raw data keys (python-pooldose
 * constants.py MODEL_ALIASES). Also the mapping used when the reported code
 * has no mapping file of its own.
 */
export const MODEL_ALIASES = Object.freeze({
  PDHC1H1HAR1V1: 'PDPR1H1HAR1V0',
  PDHC1H1HAR1V0: 'PDPR1H1HAR1V0',
  PDPR1H1HAW102: 'PDPR1H1HAW100',
  PDPR1H1HAW1B0_I: 'PDPR1H1HAW1B0',
  PDRX1H1HAW100: 'PDPH1H1HAW100',
  KDHC5050AWH01: 'KDPR5050AWH00',
});

const MAPPINGS_DIR = new URL('./mappings/', import.meta.url);
const FILE = /^model_([A-Za-z0-9_]{1,40})_FW([0-9]{1,12})\.json$/;

/** The mapping files shipped: "PRODUCT_FW" -> file name. */
const FILES = new Map(
  readdirSync(MAPPINGS_DIR)
    .map((name) => FILE.exec(name))
    .filter(Boolean)
    .map((m) => [`${m[1]}_FW${m[2]}`, m[0]]),
);

/** The models and firmwares a mapping exists for (for the docs and the status). */
export const SUPPORTED = [...FILES.keys()].sort();

const cache = new Map();

/**
 * The mapping of a device and the prefix of its raw keys, or undefined when
 * no mapping fits its product code and firmware.
 */
export function mappingFor(productCode, fwCode) {
  if (!productCode || !fwCode) {
    return undefined;
  }
  const alias = own(MODEL_ALIASES, productCode);
  const dedicated = FILES.get(`${productCode}_FW${fwCode}`);
  const file = dedicated ?? (alias ? FILES.get(`${alias}_FW${fwCode}`) : undefined);
  if (!file) {
    return undefined;
  }
  if (!cache.has(file)) {
    cache.set(file, parseJson(readFileSync(new URL(file, MAPPINGS_DIR), 'utf8')));
  }
  return {
    mapping: cache.get(file),
    // The raw keys use the alias model id even when a dedicated file exists (client.py).
    prefix: `${alias ?? productCode}_FW${fwCode}_`,
  };
}

/** A conversion of the mapping, for a value seen as a string. */
function convert(attributes, value) {
  const conversion = own(attributes, 'conversion');
  return conversion && typeof conversion === 'object' && Object.hasOwn(conversion, String(value))
    ? conversion[String(value)]
    : value;
}

/** The unit of a `magnitude` (python: none for "undefined" and "ph", "ppm" for chlorine). */
function unitOf(entry) {
  const magnitude = own(entry, 'magnitude');
  const first = Array.isArray(magnitude) ? magnitude[0] : undefined;
  if (typeof first !== 'string' || first === '' || first.length > 16) {
    return undefined;
  }
  // The masculine ordinal "º" and the ring "˚" stand for the degree sign on some firmwares.
  const unit = first.replace(/^[º˚]/, '°');
  const lower = unit.toLowerCase();
  if (lower === 'undefined' || lower === 'ph') {
    return undefined;
  }
  return lower === 'cl2' || lower === 'chlorine' ? 'ppm' : unit;
}

/**
 * "O" (on) / "F" (off), a boolean, 0 / 1 (a number or its string). Anything
 * else is unknown (undefined), never "off": an alarm keeps its last state
 * rather than being cleared by an answer it does not understand.
 */
function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'O' || value === 'o' || value === 1 || value === '1') {
    return true;
  }
  if (value === 'F' || value === 'f' || value === 0 || value === '0') {
    return false;
  }
  return undefined;
}

const isEntry = (entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry);

/** One mapped value: `{ type, value, unit?, min?, max?, step? }`, undefined when absent. */
function decodeOne(attributes, entry) {
  const type = own(attributes, 'type');
  if (type === 'switch' && typeof entry === 'boolean') {
    return { type, value: entry };
  }
  if (!isEntry(entry)) {
    return undefined;
  }
  if (type === 'sensor') {
    const current = own(entry, 'current');
    const value =
      current === undefined || current === null ? undefined : convert(attributes, current);
    return { type, value, unit: unitOf(entry) };
  }
  if (type === 'binary_sensor') {
    const current = own(entry, 'current');
    const value =
      current === undefined || current === null ? undefined : convert(attributes, current);
    return { type, value: toBoolean(value) };
  }
  if (type === 'switch') {
    return { type, value: toBoolean(own(entry, 'current')) };
  }
  if (type === 'number') {
    const field = own(attributes, 'field');
    return {
      type,
      value: own(entry, typeof field === 'string' ? field : 'current'),
      unit: unitOf(entry),
      min: own(entry, 'absMin'),
      max: own(entry, 'absMax'),
      step: own(entry, 'resolution'),
    };
  }
  if (type === 'select') {
    const current = own(entry, 'current');
    const options = own(attributes, 'options');
    const label =
      options && Object.hasOwn(options, String(current)) ? options[String(current)] : undefined;
    return { type, value: convert(attributes, label ?? current) };
  }
  return undefined;
}

/**
 * The values of one device: mapping key -> decoded value, for the keys the
 * device answered. Linear in the size of the mapping.
 */
export function decode(raw, { mapping, prefix }) {
  const values = new Map();
  for (const [name, attributes] of Object.entries(mapping ?? {})) {
    const key = own(attributes, 'key');
    if (typeof key !== 'string') {
      continue;
    }
    const decoded = decodeOne(attributes, own(raw, `${prefix}${key}`));
    if (decoded) {
      values.set(name, decoded);
    }
  }
  return values;
}

/** A finite number from a number or a strict decimal string; undefined otherwise. */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s{0,4}-?\d{1,9}(?:[.,]\d{1,9})?\s{0,4}$/.test(value)) {
    return Number(value.trim().replace(',', '.'));
  }
  return undefined;
}
