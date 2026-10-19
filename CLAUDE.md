# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads a SEKO PoolDose pool controller through its local HTTP API (ported
from python-pooldose 0.9.15, MIT; its mapping files are in `src/mappings/`,
unchanged). Read `TODO.md` "Decisions" before touching a feature or adding a
command: v1 is read only (chemical dosing), chlorine is `unknown` in ppm (the
Ondilo exception), units and external id keys are fixed forever.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/pooldose.test.js         # one file
node --test --test-name-pattern "alarm"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers before connect())
src/handlers.js                   the SDK handlers -> PoolDoseApp (shared with the tests)
src/app.js                        PoolDoseApp: polling, stops/pauses, alarms and their triggers
src/client.js                     the local API (params.js, debug config, instant values)
src/http.js                       bounded HTTP(S), safe JSON, errors without the address
src/pooldose.js                   mappings and aliases, decoding of the raw values (pure)
src/mappings/*.json               the mapping files of python-pooldose, as they are
src/devices.js                    -> Gladys device, states, alarms (pure)
src/store.js                      /data: pauses, stop, active alarms
src/publisher.js                  states within the Gladys limits
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
gladys-assistant-integration.json manifest: name, config_schema, actions, scene triggers...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, the SDK's fake Gladys + a fake PoolDose
scripts/cover.mjs                 draws cover.png (800x534), plain Node
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (here the `DID`), never a label nor the IP
  address. The same goes for every key users store: manifest
  `config_schema`, `actions`, scene trigger keys, alarm option values,
  feature keys.
- **Read only in v1.** Never call a write endpoint of the device; a command
  (v2) follows the rules of `TODO.md`.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log the address of the device nor its Wi-Fi data.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading: the Release workflow
  moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language.
  `scene_triggers` need `gladys_version` >= 5.1.0. `test/manifest.test.js`
  ties the manifest to the code: change both sides together.
- **User-facing text** is bilingual (English and French), kept in sync.
  Files are UTF-8 without BOM (`test/encoding.test.js`); a secret field, if
  one is ever added, is "kept by Gladys in its database, never shown again".
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
