// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, device and feature names,
// dosing modes, alarms), in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts?.[language] ?? texts?.en;

const both = (en, fr) => ({ en, fr });

/** Two messages one after the other, in each language. */
export const join = (...messages) =>
  both(messages.map((m) => m.en).join(' '), messages.map((m) => m.fr).join(' '));

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 120) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  temperature: both('Water temperature', 'Température de l’eau'),
  ph: both('pH', 'pH'),
  orp: both('ORP (redox)', 'Redox (ORP)'),
  'free-chlorine': both('Free chlorine', 'Chlore libre'),
  'ph-target': both('pH setpoint', 'Consigne de pH'),
  'orp-target': both('ORP setpoint', 'Consigne de redox'),
  'chlorine-target': both('Chlorine setpoint', 'Consigne de chlore'),
  'ph-dosing-method': both('pH dosing pump mode', 'Mode de la pompe pH'),
  'orp-dosing-method': both('ORP dosing pump mode', 'Mode de la pompe redox'),
  'chlorine-dosing-method': both('Chlorine dosing pump mode', 'Mode de la pompe chlore'),
  'ph-dosing-type': both('pH dosing direction', 'Sens du dosage pH'),
  'orp-dosing-type': both('ORP dosing direction', 'Sens du dosage redox'),
  'chlorine-dosing-type': both('Chlorine dosing direction', 'Sens du dosage chlore'),
  'dosing-paused': both('Dosing paused', 'Dosage en pause'),
  'circulation-pump': both('Circulation pump (signal)', 'Pompe de circulation (signal)'),
};

/** The alarm names: the feature names and the `alarm_name` of the scene triggers. */
export const ALARM_NAMES = {
  'alarm-pump': both('Dosing pump alarm', 'Alarme pompe doseuse'),
  'alarm-ph-tank': both('pH tank level alarm', 'Alarme niveau bidon pH'),
  'alarm-orp-tank': both('ORP tank level alarm', 'Alarme niveau bidon redox'),
  'alarm-chlorine-tank': both('Chlorine tank level alarm', 'Alarme niveau bidon chlore'),
  'alarm-flow': both('Water flow alarm', 'Alarme débit d’eau'),
  'alarm-relay': both('Alarm relay', 'Relais d’alarme'),
  'alarm-ph-overfeed': both('pH overfeed alarm', 'Alarme surdosage pH'),
  'alarm-ph-overfeed-2': both('pH overfeed alarm 2', 'Alarme surdosage pH 2'),
  'alarm-orp-overfeed': both('ORP overfeed alarm', 'Alarme surdosage redox'),
  'alarm-orp-overfeed-2': both('ORP overfeed alarm 2', 'Alarme surdosage redox 2'),
  'alarm-chlorine-overfeed': both('Chlorine overfeed alarm', 'Alarme surdosage chlore'),
  'alarm-chlorine-overfeed-2': both('Chlorine overfeed alarm 2', 'Alarme surdosage chlore 2'),
  'alarm-water-cold': both('Water too cold', 'Eau trop froide'),
  'alarm-water-hot': both('Water too hot', 'Eau trop chaude'),
  'alarm-ph-low': both('pH too low', 'pH trop bas'),
  'alarm-ph-high': both('pH too high', 'pH trop haut'),
  'alarm-orp-low': both('Chlorine too low (ORP)', 'Chlore trop bas (redox)'),
  'alarm-orp-high': both('Chlorine too high (ORP)', 'Chlore trop haut (redox)'),
  'alarm-chlorine-low': both('Chlorine too low', 'Chlore trop bas'),
  'alarm-chlorine-high': both('Chlorine too high', 'Chlore trop haut'),
  'alarm-standby': both('System on standby', 'Système en veille'),
};

/** The dosing modes and directions the mappings convert to (python-pooldose). */
export const DOSING_LABELS = {
  off: both('Off', 'Arrêt'),
  proportional: both('Proportional', 'Proportionnel'),
  'on / off': both('On / off', 'Tout ou rien'),
  on_off: both('On / off', 'Tout ou rien'),
  timed: both('Timed', 'Temporisé'),
  cycle: both('Cycle', 'Cycle'),
  acid: both('Acid (pH−)', 'Acide (pH−)'),
  alcalyne: both('Alkaline (pH+)', 'Alcalin (pH+)'),
  // The ORP / chlorine dosing direction as the device names it, without guessing its meaning.
  low: both('Low', 'Bas'),
  high: both('High', 'Haut'),
};

const plural = (n, en, fr) => (n > 1 ? both(`${en}s`, `${fr}s`) : both(en, fr));

export const T = {
  noHost: both(
    'Enter the IP address (or the host name) of your PoolDose on the local network.',
    'Saisissez l’adresse IP (ou le nom d’hôte) de votre PoolDose sur le réseau local.',
  ),
  badHost: both(
    'The address is not valid: an IP address or a host name only, without http:// nor a path.',
    'L’adresse n’est pas valide : une adresse IP ou un nom d’hôte seulement, sans http:// ni chemin.',
  ),
  connecting: both('Connecting to the PoolDose…', 'Connexion au PoolDose…'),
  connected: (name, model) =>
    both(
      `Connected to ${name}${model ? ` (${model})` : ''}. Open Discovery to add it. Read only: no dosing command.`,
      `Connecté à ${name}${model ? ` (${model})` : ''}. Ouvrez Découverte pour l’ajouter. Lecture seule : aucune commande de dosage.`,
    ),
  unsupported: (code, fw) =>
    both(
      `PoolDose found, but its model ${code ?? '?'} (firmware ${fw ?? '?'}) has no mapping yet: nothing can be read. See the documentation to ask for it.`,
      `PoolDose trouvé, mais son modèle ${code ?? '?'} (micrologiciel ${fw ?? '?'}) n’a pas encore de correspondance : rien ne peut être lu. Voir la documentation pour la demander.`,
    ),
  unreachable: (reason, wait) =>
    both(
      `The PoolDose does not answer (${reason.en}). Next try in ${wait.en}.`,
      `Le PoolDose ne répond pas (${reason.fr}). Nouvel essai dans ${wait.fr}.`,
    ),
  refused: (wait) =>
    both(
      `The PoolDose refused the access (HTTP 401/403): check the address, and what stands in front of the device. Stopped; one new try in ${wait.en}, or use the test button.`,
      `Le PoolDose a refusé l’accès (HTTP 401/403) : vérifiez l’adresse, et ce qui se trouve devant l’appareil. Arrêté ; un nouvel essai dans ${wait.fr}, ou utilisez le bouton de test.`,
    ),
  rateLimited: (wait) =>
    both(
      `The PoolDose asks to slow down (HTTP 429): paused for ${wait.en}.`,
      `Le PoolDose demande de ralentir (HTTP 429) : en pause pendant ${wait.fr}.`,
    ),
  backoffKept: (wait) =>
    both(
      `The PoolDose did not answer before the restart: next try in ${wait.en}.`,
      `Le PoolDose ne répondait pas avant le redémarrage : nouvel essai dans ${wait.fr}.`,
    ),
  busy: both(
    'A read is already running, try again in a moment.',
    'Une lecture est déjà en cours, réessayez dans un instant.',
  ),
  cooldown: both('Tested less than 30 s ago.', 'Testé il y a moins de 30 s.'),
  readOnly: both(
    'Read only in this version: the PoolDose is never commanded from Gladys (no dosing, no setpoint).',
    'Lecture seule dans cette version : le PoolDose n’est jamais commandé depuis Gladys (ni dosage, ni consigne).',
  ),
  storeFailed: both(
    'Warning: the state could not be saved in /data (pauses and alarms are lost at a restart, an alarm may be announced twice).',
    'Attention : l’état n’a pas pu être enregistré dans /data (pauses et alarmes perdues au redémarrage, une alarme peut être annoncée deux fois).',
  ),
  deviceNoAnswer: both('The PoolDose does not answer.', 'Le PoolDose ne répond pas.'),
  alarms: (n) => plural(n, `${n} active alarm`, `${n} alarme active`),
};

/** The network reasons of src/http.js, in French. */
const NETWORK_FR = {
  'connection refused': 'connexion refusée',
  'connection reset': 'connexion interrompue',
  'host unreachable': 'hôte injoignable',
  'network unreachable': 'réseau injoignable',
  'unknown host name': 'nom d’hôte inconnu',
  'host name not resolved': 'nom d’hôte non résolu',
  'connection timed out': 'connexion expirée',
  'connection closed': 'connexion fermée',
  'self-signed certificate': 'certificat auto-signé',
  'certificate not verified': 'certificat non vérifié',
  'certificate expired': 'certificat expiré',
  'certificate for another name': 'certificat d’un autre nom',
  'TLS error': 'erreur TLS',
  'network error': 'erreur réseau',
};

/** The reason of an error, in each language. */
export function reasonOf(err) {
  switch (err?.kind) {
    case 'timeout':
      return both('no answer in time', 'pas de réponse à temps');
    case 'network':
      return both(err.message, NETWORK_FR[err.message] ?? 'erreur réseau');
    case 'unavailable':
      return both(
        `device error ${err.status ?? ''}`.trim(),
        `erreur de l’appareil ${err.status ?? ''}`.trim(),
      );
    case 'not_found':
      return both(
        'not a PoolDose API at this address (HTTP 404)',
        'pas d’API PoolDose à cette adresse (HTTP 404)',
      );
    case 'bad_response':
    case 'size':
      return both('unexpected answer', 'réponse inattendue');
    default:
      return both(`HTTP ${err?.status ?? '?'}`, `HTTP ${err?.status ?? '?'}`);
  }
}
