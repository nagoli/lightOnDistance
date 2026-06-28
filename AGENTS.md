# AGENTS.md — Guide pour les IA et contributeurs

Document de référence pour comprendre et faire évoluer **lightOnDistance**.

## 1. Objectif du projet

Application web **100 % front-end** (HTML/CSS/JS, **aucun backend**, déployable sur
n'importe quel hébergement statique). À partir :
- d'une **liste de personnes** (nom, code postal, ville),
- d'une **clé API OpenRouteService**,
- d'une **liste de lieux** (quantité, code postal, ville),

elle calcule, pour chaque personne et **cumulé sur tous les lieux**, le total de
**kilomètres**, de **temps** et de **coût** de trajet, puis affiche un **palmarès**
classé avec des indicateurs **×N** et des **statistiques** de dispersion.

## 2. Contraintes fortes (à ne pas casser)

- **Pas de backend, pas d'étape de build.** Uniquement HTML/CSS/JS natif + modules ES.
- **Pas de dépendances runtime.** Les tests utilisent le test runner natif de Node
  (`node:test`) — aucune dépendance npm n'est installée.
- La **clé API reste dans le navigateur** ; elle n'est envoyée qu'à OpenRouteService.
- Les fichiers doivent être servis via HTTP (les modules ES ne marchent pas en `file://`).

### Service de calcul de distance : OpenRouteService (ORS)
- API REST appelée directement depuis le navigateur via `fetch` (CORS supporté), **sans backend**.
- Deux endpoints utilisés dans `js/routing.js` :
  - **Géocodage** `GET /geocode/search` (clé en query `api_key`) → `[lon, lat]` (limité à la France).
  - **Matrice** `POST /v2/matrix/driving-car` (clé dans l'en-tête `Authorization`) →
    `{ distances: [[m]], durations: [[s]] }`.
- ORS travaille en **coordonnées** : on géocode d'abord chaque adresse, puis on envoie les
  coordonnées à la matrice, par **lots** (≤ 50 locations par requête) pour respecter les
  limites du plan gratuit.
- Clé gratuite : https://openrouteservice.org/dev/#/signup

### Cache persistant des réponses ORS (économie d'appels)
- Objectif : **ne jamais refaire un appel déjà effectué**. Implémenté dans `storage.js`
  (`createOrsCache`, `loadOrsCacheStore`, `saveOrsCacheStore`, clé `ORS_CACHE_KEY`).
- Deux dictionnaires persistés en `localStorage` :
  - `geo`  : adresse → `[lon, lat]` (ou `null` = géocodé mais introuvable, mémorisé pour
    éviter de réessayer indéfiniment).
  - `legs` : `legKey(origineAddr, destAddr)` → `{ distanceM, durationS }` (trajet aller simple).
- `buildDistanceMatrix(apiKey, people, places, onProgress, cache)` :
  1. géocode **uniquement** les adresses absentes du cache ;
  2. lit les trajets déjà connus depuis le cache ;
  3. ne lance une requête matrice que sur la **grille manquante** (personnes×lieux ayant au
     moins un trajet manquant), puis met le cache à jour.
- Conséquence : ajouter un lieu/une personne ne recalcule que les **nouveaux** trajets.
  `app.js` charge le cache au démarrage et le sauvegarde après chaque calcul (y compris en
  cas d'échec, pour conserver ce qui a déjà été récupéré).
- En tests, on injecte un cache en mémoire et on **compte les appels `fetch`** pour vérifier
  qu'aucun appel n'est refait (cf. `tests/routing.test.mjs`).

## 3. Règles métier (validées avec l'utilisateur)

Pour chaque personne, cumulé sur tous les lieux :
- **Km** = `Σ (distance_aller_simple × 2 × quantité)` (aller-retour).
- **Temps** : pause de **30 min par tranche de 2 h de conduite**, calculée
  **par trajet simple** (pas sur le cumul) ; un aller-retour vaut
  `2 × (durée_trajet + pauses)`, le tout `× quantité`, puis sommé sur les lieux.
- **Coût** = `km × (consommation / 100) × prix_litre`.
  Défauts configurables : **consommation 6 L/100km**, **prix 2 €/L**.
- **×N** : pour chaque métrique (km, temps, coût), rapport de la valeur au **minimum**
  observé → la personne au minimum vaut **×1**.
- **Statistiques (sur les km)** : médiane, moyenne, min, max, écart-type,
  écart interquartile (IQR), max/médiane. Une personne est **outlier** (surlignée)
  si `km > Q3 + 1,5 × IQR`.

### Hypothèses / points ouverts
- L'aller-retour est estimé à **2× l'aller simple** (le trajet peut différer selon le sens).
- **5ᵉ lieu près d'Albi** : non renseigné (ligne par défaut laissée vide).
- Codes postaux des lieux par défaut : suppositions modifiables. Lieux pré-remplis :
  Mélionnec (56480), Chalon-sur-Saône (71100), Burzy (71460), Fons-sur-Lussan (30580).

## 4. Architecture des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Interface, 4 sections : config, personnes, lieux, palmarès. |
| `styles.css` | Mise en forme (aucune lib CSS). |
| `js/compute.js` | **Fonctions pures** : calculs km/temps/coût, pauses, ×N, statistiques. **Aucun accès DOM/réseau.** |
| `js/routing.js` | Client **OpenRouteService** : géocodage + matrice de distances (`driving-car`, par lots) + gestion d'erreurs (`RoutingError`). |
| `js/charts.js` | Graphiques **SVG** (zéro dépendance) : barres classées + répartition (box plot + points), avec annotations statistiques. Helpers purs `niceMax`/`linearScale`/`ticks` testés. |
| `js/storage.js` | (Dé)sérialisation pure, persistance `localStorage`, import/export CSV & JSON. |
| `js/app.js` | État de l'app, rendu des tableaux éditables, rendu graphiques + tableau de résultats, branchement des événements, orchestration. |
| `tests/*.test.mjs` | Tests unitaires (`node:test`). |

### Flux de données
1. `app.js` tient l'état `{ people, places }` + la config lue depuis les inputs.
2. Au clic « Calculer » : `routing.js#buildDistanceMatrix(apiKey, ...)` géocode puis interroge la
   matrice ORS → `matrix[personId][placeId] = {distanceM, durationS} | {error}`.
3. `compute.js#computeRanking(...)` → `{ rows, stats, errors }` purement à partir de cette matrice.
4. `app.js#renderResults()` affiche les **statistiques**, les **graphiques** (`charts.js`),
   puis le **tableau détaillé** (toujours visible, sous les graphiques) et les erreurs.

### Visualisation (`js/charts.js`)
- **Graphique 1 — Classement** : barres horizontales triées selon la métrique active
  (`sort-by`), avec lignes de **médiane** et **moyenne**, et barres ambrées pour les outliers.
- **Graphique 2 — Répartition (km)** : box plot (IQR, médiane, moustaches) + bande
  **moyenne ± écart-type** + une bulle par personne. Chaque bulle porte les **2 initiales**
  du nom (bleu = normal, ambre = outlier au-delà de `Q3 + 1,5·IQR`) et affiche le **nom
  complet + km au survol** (élément SVG `<title>`). Les valeurs stat (médiane, moyenne,
  écart-type, IQR, seuil) sont affichées en « chips » dans le graphique.
- Tout est en SVG inline responsive (`viewBox`, `width:100%`), stylé via classes dans `styles.css`.
- Le graphique de classement suit la métrique de tri ; la répartition reste sur les **km**
  (métrique de dispersion de référence, cohérente avec `stats`).

### Gestion des erreurs de connexion / service (important)
- `routing.js` enveloppe tout échec dans une **`RoutingError`** avec un champ `kind` :
  - `network` : `fetch` a échoué (hors-ligne, DNS, CORS) → « Problème de connexion… ».
  - `auth` (401/403) : clé invalide. `quota` (429) : limite atteinte.
  - `request` (400/404/422) : adresse/paramètre invalide. `service` (5xx) : ORS indisponible.
- `app.js#formatComputeError()` traduit ces `kind` en messages clairs pour l'utilisateur et
  **rappelle que les données et distances en cache sont conservées** en cas de coupure réseau.
- En cas d'erreur pendant le calcul, l'état/le cache existants ne sont pas écrasés.

### Persistance & session
- **Auto-sauvegarde** dans `localStorage` (clé `STORAGE_KEY` dans `storage.js`) à chaque
  modification (édition, ajout/suppression, import, changement de config y compris la clé API).
- Chargement automatique au démarrage (`loadFromLocalStorage`). À défaut, lieux par défaut.
- **Session = état + matrice de distances ORS en cache** (`state.matrix`). L'export/import
  « session » (boutons JSON) **inclut cette matrice**, ce qui permet de **recharger le palmarès
  sans rappeler OpenRouteService**. Idem au rechargement de page via localStorage.
- `serializeState` / `deserializeState` sont **purs**, partagés entre JSON et localStorage, et
  conservent le champ `matrix`.

### Invalidation du cache (important)
- Toute modification de **personnes/lieux** appelle `invalidateMatrix()` → `state.matrix = null`
  et masque le palmarès (les résultats deviendraient incohérents avec les nouvelles données).
- Les changements de **consommation / prix / tri** n'invalident PAS la matrice : on recalcule
  localement via `recomputeFromCache()` (rapide, sans appel réseau), car ces paramètres ne
  dépendent pas des distances.
- `onCompute()` est le seul chemin qui appelle OpenRouteService ; il remplit `state.matrix` puis persiste.

## 5. Tests — méthodologie TDD

- Lancer : `npm test` (ou `npm run test:watch`).
- Runner : **`node --test`** natif, fichiers `tests/*.test.mjs`, assertions `node:assert/strict`.
- **La logique pure est testée** (`compute.js`, parties pures de `storage.js`, et le mapping
  d'erreurs de `routing.js`). Les fonctions réseau de `routing.js` sont testées en **stubbant
  `globalThis.fetch`** (cf. `tests/routing.test.mjs`). Le code touchant le DOM n'est pas testé
  unitairement → on **isole** toujours la logique métier dans des fonctions pures.
- **Démarche attendue : TDD.** Pour toute évolution de règle de calcul ou de format :
  1. écrire/adapter le test qui échoue dans `tests/`,
  2. implémenter le minimum pour le faire passer,
  3. vérifier que `npm test` est tout vert.
- Note d'implémentation : `cryptoId()` utilise `globalThis.crypto` (fonctionne sous Node) ;
  les wrappers `localStorage` sont protégés par try/catch et renvoient `null`/no-op hors navigateur.

## 6. Vérification manuelle (navigateur)

```bash
python3 -m http.server 8000   # puis http://localhost:8000
```
Nécessite une **clé OpenRouteService** (gratuite : https://openrouteservice.org/dev/#/signup).
La clé doit avoir accès aux endpoints **Geocode** et **Matrix**.

## 7. Conventions

- Français pour l'UI et la documentation.
- JS moderne (modules ES), pas de framework, pas de build.
- Garder `compute.js` et la (dé)sérialisation **sans effets de bord** pour préserver la testabilité.
- Ne pas introduire de dépendances sans raison forte (le projet doit rester déployable en statique).
