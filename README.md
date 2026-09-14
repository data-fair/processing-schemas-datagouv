# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="30"> @data-fair/processing-schemas-datagouv

Importe et met à jour les schémas tabulaires de [schema.data.gouv.fr](https://schema.data.gouv.fr) comme jeux de données éditables data-fair.

Chaque schéma importé produit un jeu de données éditable (REST) :

- son schéma est la conversion de la dernière version publiée du table schema : les clés des champs sont normalisées en clés data-fair (minuscules, sans accents, caractères non alphanumériques remplacés par `_`, notamment les points que data-fair interprète comme des chemins imbriqués), le nom d'origine du champ restant porté par `x-originalName` ;
- la méta `conformsTo` porte le nom, la version et l'URL de la page du schéma sur schema.data.gouv.fr (le fichier JSON reste porté par `origin` et la description) ;
- son résumé et sa description sont dérivés du catalogue (liens vers le schéma, la documentation, le contact, les labels) ;
- les champs géographiques sont annotés avec les concepts data-fair dans le respect des systèmes de projection : latitude/longitude, paires latitude/longitude et géométries WGS84 (GeoJSON ou WKT) sont reconnues directement ; les géométries et couples x/y projetés (Lambert-93 ou Lambert II étendu, identifiés par leur libellé ou leur exemple) sont annotés avec les concepts dédiés et la projection correspondante est posée sur le jeu de données. En cas de doute — projection inconnue, géométrie GML, `geopoint` frictionless (ordre longitude,latitude inverse de celui de data-fair) — le champ n'est pas annoté ;
- les capacités d'indexation des champs sont adaptées automatiquement : recherche textuelle désactivée sur les codes (SIRET, code INSEE...), filtrage exact et tri désactivés sur les textes longs (réglages dans l'onglet « Indexation ») ;
- le jeu est déclaré **master data** avec l'initialisation de jeux éditables activée : d'autres jeux de données peuvent être initialisés avec son schéma ;
- optionnellement, les données d'exemple publiées avec le schéma sont chargées comme premières lignes. Les exemples invalides, obsolètes ou non téléchargeables sont ignorés avec un avertissement, sans bloquer l'import.

À chaque exécution, les jeux déjà créés sont mis à jour vers la dernière version publiée du schéma (sinon ils sont laissés inchangés). Le résumé et la description ne sont rafraîchis que s'ils n'ont pas été personnalisés. Les annotations géographiques posées par une version antérieure du traitement sont corrigées ou retirées (et la projection ajoutée) sans toucher aux personnalisations du propriétaire.

L'onglet « Action » propose aussi une action ponctuelle de nettoyage : « Supprimer les jeux de données créés » supprime tous les jeux suivis par le traitement (y compris leurs personnalisations), puis l'action repasse automatiquement sur l'import et l'exécution s'arrête sans rien importer. Seuls les jeux portant l'identifiant de ce traitement sont supprimés : d'anciens jeux marqués comme issus du catalogue mais sans cet identifiant sont signalés dans le journal et laissés en place, pour un nettoyage manuel. Un jeu déjà supprimé manuellement est ignoré ; en cas d'échec, les jeux restants sont conservés et l'action sera retentée à l'exécution suivante.

## Publication

```bash
npm version minor
npm publish
git push --follow-tags
```
