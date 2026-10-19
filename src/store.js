// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), with the address it belongs to (a hash, never the address):
//   - the pauses (429, the backoff after errors) and the stop after a refusal
//     (401/403) with its next try, bounded when read back;
//   - the alarms active at the last read of each device, so a restart does
//     not fire the scene triggers again, and an alarm raised meanwhile does.
// The file is readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { TIMINGS } from './constants.js';
import { ALARMS } from './devices.js';
import { parseJson } from './http.js';

export const STATE_FILE = '/data/pooldose-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return parseJson(await readFile(path, 'utf8')) ?? null;
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.writeFile(text, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

const time = (value) => (Number.isFinite(value) && value > 0 ? value : undefined);

/** 'rate' (429) holds every path; 'backoff' (no answer, 5xx) the reads only. */
const PAUSE_CAPS = {
  rate: TIMINGS.rateLimitMax,
  backoff: TIMINGS.backoff.at(-1),
};
const DEVICE_ID = /^[A-Za-z0-9_.-]{1,64}$/;
/** Devices whose alarms are kept (one PoolDose per integration, a few to be safe). */
const MAX_DEVICES = 8;

/**
 * The persisted state, repaired; the end of a pause or of a stop is capped
 * from `now`, so a clock jump or a hand-edited file never stops for good.
 */
export function normalizeMemory(raw, now = Date.now()) {
  const target =
    typeof raw?.target === 'string' && /^[0-9a-f]{32}$/.test(raw.target) ? raw.target : '';
  const p = raw?.pause;
  const pause =
    Object.hasOwn(PAUSE_CAPS, p?.kind ?? '') && time(p.until)
      ? {
          kind: p.kind,
          until: Math.min(p.until, now + PAUSE_CAPS[p.kind]),
          failures: Number.isInteger(p.failures) && p.failures >= 0 ? Math.min(p.failures, 10) : 1,
        }
      : null;
  const b = raw?.block;
  const block =
    target && b?.kind === 'refused'
      ? {
          kind: 'refused',
          retries: Number.isInteger(b.retries) && b.retries >= 0 ? Math.min(b.retries, 10) : 0,
          retryAt: time(b.retryAt)
            ? Math.min(b.retryAt, now + TIMINGS.refusedRetry.at(-1))
            : now + TIMINGS.refusedRetry[0],
        }
      : null;
  // No prototype: a device id is a key here.
  const alarms = Object.create(null);
  const given = raw?.alarms;
  if (target && given && typeof given === 'object' && !Array.isArray(given)) {
    for (const [id, list] of Object.entries(given).slice(0, MAX_DEVICES)) {
      if (DEVICE_ID.test(id) && Array.isArray(list)) {
        alarms[id] = [...new Set(list.filter((role) => ALARMS.includes(role)))];
      }
    }
  }
  return { target, pause, block, alarms };
}
