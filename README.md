# lightOnDistance

Application **100% front-end** (HTML/CSS/JS, sans backend) pour établir le palmarès
des kilomètres, du temps et du coût de trajet de plusieurs personnes vers plusieurs lieux,
via l'API **OpenRouteService** (géocodage + matrice de distances).

## Utilisation

Comme il s'agit de modules ES, ouvrez la page via un petit serveur HTTP (pas en `file://`) :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

Ou déposez les fichiers tels quels sur n'importe quel hébergement statique.

1. **Configuration** : saisir la clé API OpenRouteService (clé gratuite sur
   [openrouteservice.org](https://openrouteservice.org/dev/#/signup)), la consommation
   (L/100km, défaut 6) et le prix du carburant (€/L, défaut 2).
2. **Personnes** : éditer le tableau ou importer un CSV `nom,code_postal,ville`
   (séparateur `,` ou `;`).
3. **Lieux** : tableau pré-rempli, éditable ; chaque lieu a une quantité (défaut 1),
   un code postal et une ville.
4. **Palmarès** : « Calculer le palmarès » géocode les adresses, interroge
   OpenRouteService et affiche le classement + les statistiques : d'abord la **vue
   graphique** (barres classées + répartition box plot, avec les stats intégrées), puis
   le **tableau détaillé** juste en dessous.

Les données sont **sauvegardées automatiquement** dans le navigateur (localStorage),
y compris les distances déjà calculées : recharger la page restaure le palmarès sans
rappeler le service de distance.

Un **cache local des réponses OpenRouteService** (géocodages + trajets) est conservé dans
le navigateur : un trajet déjà calculé n'est **jamais redemandé**. Ajouter un lieu ou une
personne ne déclenche le calcul que pour les **nouveaux** trajets.

Les boutons **Exporter / Importer la session** produisent un fichier JSON qui contient
tout (personnes, lieux, config **et matrice des distances**) : le réimporter
**recharge le palmarès sans refaire les calculs OpenRouteService**. L'export/import CSV ne
concerne que la liste des personnes.

> Note : modifier les personnes ou les lieux invalide les distances en cache (il faudra
> relancer le calcul). Changer la consommation, le prix ou le tri recalcule instantanément
> à partir du cache, sans appel réseau.

### En cas de problème de connexion

Si le calcul échoue, un message clair s'affiche selon le cas :
- **Connexion** (hors-ligne, DNS, CORS) : « Problème de connexion au service… » — vérifiez
  votre accès internet puis relancez ; **vos données et les distances en cache sont conservées**.
- **Clé invalide** (401/403), **quota atteint** (429), **adresse invalide** (400/404),
  **service indisponible** (5xx) : messages dédiés indiquant la marche à suivre.

## Règles de calcul

Pour chaque personne, cumulé sur tous les lieux :
- **Km** = `Σ (aller_simple × 2 × quantité)` (aller-retour)
- **Temps** : pause de 30 min par tranche de 2h **par trajet simple**, puis aller-retour
  `2 × (durée + pauses)`, le tout `× quantité`
- **Coût** = `km × (conso/100) × prix_litre`
- **×N** : rapport de chaque métrique au minimum (la personne au minimum = ×1)

**Statistiques (km)** : médiane, moyenne, min, max, écart-type, écart interquartile,
max/médiane. Les personnes au-dessus de `Q3 + 1,5 × IQR` sont surlignées (qui sort du lot).

## Hypothèses / à compléter

- 5ᵉ lieu près d'Albi : à renseigner (ligne laissée vide par défaut).
- Codes postaux des lieux par défaut : suppositions, modifiables dans le tableau.
- L'aller-retour est estimé à 2× l'aller simple.
- La clé API reste dans le navigateur ; elle n'est envoyée qu'à OpenRouteService.

## Structure

- `index.html` — interface (4 sections)
- `styles.css` — mise en forme
- `js/compute.js` — calculs & statistiques (fonctions pures)
- `js/charts.js` — graphiques SVG (classement + répartition) avec stats intégrées
- `js/routing.js` — client OpenRouteService (géocodage + matrice) + gestion d'erreurs
- `js/storage.js` — import/export CSV & JSON, persistance localStorage
- `js/app.js` — état, rendu, orchestration

## Tests

```bash
npm test
```
