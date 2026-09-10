# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="30"> @data-fair/processing-schemas-datagouv

Importe et met à jour les schémas tabulaires de [schema.data.gouv.fr](https://schema.data.gouv.fr) comme jeux de données éditables data-fair.

Chaque schéma importé produit un jeu de données éditable (REST) :

- son schéma est la conversion de la dernière version publiée du table schema ;
- la méta `conformsTo` porte le nom, la version et l'URL du schéma d'origine ;
- son résumé et sa description sont dérivés du catalogue (liens vers le schéma, la documentation, le contact, les labels) ;
- les capacités d'indexation des champs sont adaptées automatiquement : recherche textuelle désactivée sur les codes (SIRET, code INSEE...), filtrage exact et tri désactivés sur les textes longs (réglages dans l'onglet « Indexation ») ;
- le jeu est déclaré **master data** avec l'initialisation de jeux éditables activée : d'autres jeux de données peuvent être initialisés avec son schéma ;
- optionnellement, les données d'exemple publiées avec le schéma sont chargées comme premières lignes. Les exemples invalides, obsolètes ou non téléchargeables sont ignorés avec un avertissement, sans bloquer l'import.

À chaque exécution, les jeux déjà créés sont mis à jour vers la dernière version publiée du schéma (sinon ils sont laissés inchangés). Le résumé et la description ne sont rafraîchis que s'ils n'ont pas été personnalisés.

## Publication

```bash
npm version minor
npm publish
git push --follow-tags
```
