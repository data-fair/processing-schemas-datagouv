# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="30"> @data-fair/processing-schemas-datagouv

Importe et met à jour les schémas tabulaires de [schema.data.gouv.fr](https://schema.data.gouv.fr) comme jeux de données éditables data-fair.

Chaque schéma importé produit un jeu de données éditable (REST) :

- son schéma est la conversion de la dernière version publiée du table schema ;
- la méta `conformsTo` porte le nom, la version et l'URL du schéma d'origine ;
- le jeu est déclaré **master data** avec l'initialisation de jeux éditables activée : d'autres jeux de données peuvent être initialisés avec son schéma ;
- optionnellement, les données d'exemple publiées avec le schéma sont chargées comme premières lignes.

À chaque exécution, les jeux déjà créés sont mis à jour vers la dernière version publiée du schéma (sinon ils sont laissés inchangés).

## Publication

```bash
npm version minor
npm publish
git push --follow-tags
```
