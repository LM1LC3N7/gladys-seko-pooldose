# SEKO PoolDose

Intégration non officielle, sans lien avec SEKO. Elle amène dans Gladys un
régulateur de piscine **SEKO PoolDose** (et les modèles qui en dérivent :
VÁGNER POOL VA DOS, BWT MEDO CONNECT, KEMI DOSE AQUAVIVA), lu par **sa propre
API HTTP sur le réseau local**, sans compte ni cloud.

> **Attention : cette intégration n'a jamais été testée avec un vrai appareil.** Elle a été écrite à partir de la bibliothèque python-pooldose (celle de Home Assistant) et testée contre un faux PoolDose seulement. Les retours sont les bienvenus.

**Lecture seule.** Gladys ne commande jamais le PoolDose : ni dosage, ni
pompe doseuse, ni consigne de pH, de redox ou de chlore, ni pause du dosage.
Un mauvais dosage chimique met les baigneurs en danger ; ces valeurs sont
seulement affichées. Les commandes sont prévues pour une version ultérieure,
désactivées par défaut.

## Ce que vous obtenez

Un appareil « PoolDose » avec, selon votre modèle :

| Fonctionnalité                        | Type dans Gladys                                             |
| ------------------------------------- | ------------------------------------------------------------ |
| Température de l'eau                  | Température (°C)                                             |
| pH, consigne de pH                    | pH                                                           |
| Redox (ORP), consigne de redox        | Redox (mV)                                                   |
| Chlore libre, consigne de chlore      | Capteur générique en ppm (= mg/L)                            |
| Mode des pompes pH, redox, chlore     | Texte (arrêt, proportionnel, tout ou rien, temporisé, cycle) |
| Sens du dosage pH, redox, chlore      | Texte (acide pH−, alcalin pH+…)                              |
| Dosage en pause, pompe de circulation | Binaire (0/1)                                                |
| Alarmes                               | Binaire (0/1), et déclencheurs                               |

Gladys n'a pas de catégorie « chlore » : le chlore libre est un capteur
générique en ppm, comme le sel de l'intégration Ondilo. Une température
affichée en °F par l'appareil arrive en °C dans Gladys. Une valeur absente de
votre modèle ne crée pas de fonctionnalité.

Les **alarmes** : pompe doseuse, niveau des bidons (pH, redox, chlore), débit
d'eau, relais d'alarme, surdosage (pH, redox, chlore), eau trop froide ou trop
chaude, pH trop bas ou trop haut, chlore trop bas ou trop haut (redox ou
mesure directe), système en veille. Chacune est une fonctionnalité binaire et
sert aux deux **déclencheurs de scène** :

- **Alarme PoolDose déclenchée** : une alarme passe à 1 ;
- **Alarme PoolDose terminée** : une alarme repasse à 0.

Dans la scène, choisissez le PoolDose et les alarmes qui vous intéressent
(aucune = toutes). Les variables `alarm_name` (nom de l'alarme) et
`device_name` (nom de l'appareil) sont disponibles dans les actions, par
exemple pour un message. Une alarme déjà active à la toute première lecture
n'est pas annoncée (elle se voit dans sa fonctionnalité) ; l'état des alarmes
est gardé dans `/data`, si bien qu'un redémarrage ne répète pas une alarme et
annonce celle apparue pendant l'arrêt.

## Modèles pris en charge

Les modèles de python-pooldose 0.9.15 : PoolDose Double (PDPR1H1HAW100, et
PDPR1H1HAW102), PoolDose Double Spa (PDPR1H04AW100), PoolDose pH
(PDPH1H1HAW100), BWT MEDO CONNECT (PDPH1H1HAW1B0), VÁGNER POOL VA DOS BASIC et
EXACT (PDHC1H1HAR1V0, PDHC1H1HAR1V1), KEMI DOSE AQUAVIVA (KDPR5050AWH00,
KDHC5050AWH01), avec leur micrologiciel connu. Un autre modèle est trouvé,
mais rien n'est lu : l'état de l'intégration donne son code produit et son
micrologiciel. Pour le faire ajouter, suivez la procédure de python-pooldose
(fichier `docs/device-support.md` de ce projet) puis signalez-le ici.

## Installation

1. Le PoolDose doit être sur votre Wi-Fi (application SEKO ou interface web de
   l'appareil). Donnez-lui une **adresse fixe** dans votre box (réservation
   DHCP).
2. Dans Gladys, installez l'intégration SEKO PoolDose, saisissez l'**adresse
   IP** de l'appareil (par exemple `192.168.1.50`), puis enregistrez.
3. Ajoutez l'appareil depuis l'onglet **Découverte**.

Le port (0 = standard), le HTTPS et la vérification de son certificat ne
servent que si votre appareil répond autrement qu'en HTTP sur le port 80.

## Vie privée et sécurité

- Aucun compte, aucun mot de passe : l'API locale du PoolDose n'en demande
  pas. Rien ne sort de votre réseau.
- Seules trois adresses de l'appareil sont lues : `/js_libs/params.js`
  (versions), `/api/v1/debug/config` (modèle, micrologiciel, identifiants) et
  `/api/v1/DWI/getInstantValues` (valeurs). Les adresses Wi-Fi de l'appareil,
  qui renvoient la clé Wi-Fi, ne sont jamais appelées. Aucune adresse
  d'écriture n'est appelée.
- L'intégration se présente comme « gladys-seko-pooldose ».
- Les journaux ne contiennent pas l'adresse de l'appareil.

## Rafraîchissement

L'appareil est lu toutes les 60 secondes par défaut (30 à 900) : une requête
pour les valeurs. Le modèle et le micrologiciel sont relus toutes les 6 heures
(une mise à jour du micrologiciel), et par le bouton **Tester la connexion**.

## Erreurs

- **Pas de réponse** (appareil éteint, Wi-Fi coupé, mauvaise adresse) ou
  erreur 5xx : nouvel essai après 1, 2, 5, 10 puis toutes les 15 minutes,
  jamais plus vite que l'intervalle ; le badge passe à « injoignable ». Cette
  attente est gardée au redémarrage ; le bouton **Tester la connexion** essaie
  aussitôt.
- **Accès refusé** (HTTP 401 ou 403, par exemple un proxy devant
  l'appareil) : l'intégration s'arrête, sans boucle ; un nouvel essai après
  1 h, 6 h puis toutes les 24 h, ou aussitôt avec le bouton ou une nouvelle
  adresse. L'arrêt est gardé au redémarrage.
- **L'appareil demande de ralentir** (429) : une pause d'au moins 1 minute
  (Retry-After s'il est donné, 6 h au plus), gardée au redémarrage.
- **Réponse inattendue** (404, pas du JSON) : le modèle est relu à l'essai
  suivant.

## Limites

- Jamais testé avec un vrai appareil : les correspondances viennent de
  python-pooldose, vérifiées par ses utilisateurs.
- Sur les VÁGNER POOL VA DOS (PDPR1H1HAR1V0, PDHC1H1HAR1V0/V1), le sens de
  l'**alarme pompe doseuse** n'est pas confirmé : l'appareil donne un libellé
  ON/OFF qui pourrait signifier « la pompe tourne » plutôt qu'« alarme ».
  Vérifiez-la sur l'appareil avant de vous en servir dans une scène.
- Les valeurs « Bas » / « Haut » du sens du dosage redox ou chlore sont
  données telles que l'appareil les nomme.
- Lecture seule : pas de commande des pompes doseuses, des consignes, de la
  pause du dosage ni des relais (prévu plus tard, désactivé par défaut).
- Non lus pour l'instant : calibrations des sondes, seuils de surdosage,
  débit et compteur d'eau, relais auxiliaires, temporisations.

## Crédits

- [python-pooldose](https://github.com/lmaertin/python-pooldose) de lmaertin
  (MIT) : l'API locale, l'identification du modèle et le décodage des valeurs
  sont portés en JavaScript, les fichiers de correspondance sont repris tels
  quels.
- Voir `THIRD_PARTY_NOTICES.md`.

SEKO et PoolDose sont des marques de leurs propriétaires ; ce projet est sans
lien avec SEKO.
