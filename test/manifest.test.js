// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS, POLL_INTERVAL, SCENE_TRIGGERS } from '../src/constants.js';
import { ALARMS } from '../src/devices.js';
import { ALARM_NAMES } from '../src/i18n.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics, version 0.1.0 everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.gladys_version, '>=5.1.0', 'scene_triggers need Gladys 5.1');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-seko-pooldose:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(manifest.version, JSON.parse(read('package-lock.json')).version);
  assert.equal(manifest.version, JSON.parse(read('package-lock.json')).packages[''].version);
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    const flat = docs.replace(/\n>?\s*/g, ' ');
    assert.match(flat, /not affiliated with SEKO|sans lien avec SEKO/i);
    assert.match(flat, /never been tested with a real device|jamais testé avec un vrai appareil/i);
    assert.match(flat, /read only|lecture seule/i);
    assert.doesNotMatch(flat, /encrypt|chiffr/i, `docs/${lang}.md`);
  }
  for (const file of ['README.md', 'TODO.md', 'CLAUDE.md', 'CHANGELOG.md']) {
    assert.doesNotMatch(read(file), /encrypt|chiffr/i, file);
  }
  assert.match(read('CHANGELOG.md'), /## \[Unreleased\]/);
  // M7: the unconfirmed meaning of alarm-pump on R1V0/HC is tracked and said.
  assert.match(read('TODO.md'), /`alarm-pump` on R1V0\/HC/);
  assert.match(
    read('docs/en.md').replace(/\s+/g, ' '),
    /PDPR1H1HAR1V0.*dosing pump alarm\*\* is not confirmed/,
  );
  assert.match(
    read('docs/fr.md').replace(/\s+/g, ' '),
    /PDPR1H1HAR1V0.*alarme pompe doseuse\*\* n'est pas confirmé/,
  );
  assert.match(read('TODO.md'), /## Decisions/);
});

test('the licenses ship with the image; LICENSE is the standard text, without a name', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  assert.doesNotMatch(license, /Louis|lmilcent|LM1LC3N7|Milcent/i);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /lmaertin\/python-pooldose/);
  assert.match(notices, /0\.9\.15/);
  assert.match(notices, /MIT License/);
  assert.match(notices, /Copyright \(c\) 2025 Lukas/);
  assert.match(notices, /THE SOFTWARE IS PROVIDED "AS IS"/);
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY .*LICENSE/);
  assert.match(dockerfile, /COPY .*THIRD_PARTY_NOTICES\.md/);
  assert.match(dockerfile, /COPY src \.\/src/, 'the mappings ship in src/mappings');
  const png = readFileSync(new URL('../cover.png', import.meta.url));
  assert.ok(existsSync(new URL('../cover.png', import.meta.url)));
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 534);
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code; no secret field', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(fields.host.type, 'string');
  assert.equal(fields.host.required, true);
  assert.ok(
    manifest.config_schema.every((f) => f.type !== 'secret'),
    'the local API has no secret',
  );
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max, fields.poll_interval.default],
    [POLL_INTERVAL.min, POLL_INTERVAL.max, POLL_INTERVAL.default],
  );
  assert.ok(
    manifest.config_schema.every((f) => !/allow|command|dosing/i.test(f.key)),
    'read only in v1: no command option',
  );
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(
      intro.description[lang],
      /never tested with a real device|jamais testé avec un vrai appareil/,
    );
    assert.match(intro.description[lang], /Read only|Lecture seule/);
  }
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
  assert.deepEqual(
    manifest.scene_triggers.map((s) => s.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  for (const trigger of manifest.scene_triggers) {
    const fields = Object.fromEntries(trigger.fields.map((f) => [f.key, f]));
    assert.equal(fields.device.source, 'devices');
    assert.equal(fields.alarm.type, 'multi_select');
    assert.deepEqual(
      fields.alarm.options.map((o) => o.value),
      ALARMS,
      `${trigger.key}: the alarm options are the alarm roles`,
    );
    for (const option of fields.alarm.options) {
      assert.deepEqual(option.label, ALARM_NAMES[option.value]);
    }
    assert.deepEqual(
      trigger.variables.map((v) => v.key),
      ['alarm_name', 'device_name'],
    );
  }
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
});
