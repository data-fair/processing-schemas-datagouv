/**
 * Annotation des propriétés de schéma avec les concepts reconnus par data-fair.
 *
 * Un concept est posé via "x-refersTo" (l'identifiant du concept) ; l'API data-fair
 * le résout ensuite en "x-concept" (cf. fixConcepts dans data-fair) et l'utilise pour
 * les fonctions sémantiques de la plateforme (affichage d'une ligne, géolocalisation,
 * calendrier, référentiels administratifs français...).
 *
 * Les identifiants sont issus du vocabulaire officiel :
 * https://github.com/data-fair/data-fair/blob/main/api/contract/vocabulary.js
 *
 * Le mapping est basé sur le nom du champ, avec repli sur son titre. Il est volontairement
 * conservatif : compatibilité de type exigée et un seul champ annoté par concept
 * (le premier, dans l'ordre de déclaration des champs du table schema).
 */
import type { DatasetSchemaProperty } from './convert.ts'

export interface ConceptDefinition {
  identifier: string
  /** type data-fair attendu de la propriété annotée */
  type: 'string' | 'number'
  /** formats acceptés (concepts calendaire, qui exigent un format date ou date-time) */
  formats?: string[]
  /** accepte aussi un entier (l'API le reconvertit en chaîne), ex. le concept année */
  allowInteger?: boolean
  /** identifiant de type code : la recherche textuelle n'a pas de sens (cf. capabilities) */
  code?: boolean
}

const DATE_FORMATS = ['date', 'date-time']

const definitions: { concept: ConceptDefinition, names: string[] }[] = [
  // Présentation
  {
    concept: { identifier: 'http://www.w3.org/2000/01/rdf-schema#label', type: 'string' },
    names: ['nom', 'name', 'libelle', 'denomination', 'titre', 'intitule', 'nom_commercial', 'enseigne', 'nom_du_site', 'nom_site', 'nom_etablissement', 'nom_du_lieu']
  },
  {
    concept: { identifier: 'http://schema.org/description', type: 'string' },
    names: ['description']
  },
  {
    concept: { identifier: 'http://schema.org/image', type: 'string' },
    names: ['image', 'photo', 'illustration', 'logo', 'url_image', 'image_url', 'lien_image']
  },
  // Géographie
  {
    concept: { identifier: 'http://schema.org/latitude', type: 'number' },
    names: ['latitude', 'lat']
  },
  {
    concept: { identifier: 'http://schema.org/longitude', type: 'number' },
    names: ['longitude', 'lon', 'lng']
  },
  {
    concept: { identifier: 'http://www.w3.org/2003/01/geo/wgs84_pos#lat_long', type: 'string' },
    names: ['geopoint', 'coordonnees', 'coordonnees_gps', 'coordonnee_gps', 'coordonnees_geographiques', 'coordonnee_geographique', 'coord_gps', 'lat_lon', 'latlong']
  },
  {
    concept: { identifier: 'https://purl.org/geojson/vocab#geometry', type: 'string' },
    names: ['geometrie', 'geom', 'geojson', 'geo_shape', 'geoshape', 'shape']
  },
  {
    concept: { identifier: 'http://data.ign.fr/def/geometrie#coordX', type: 'number' },
    names: ['coord_x', 'coordx']
  },
  {
    concept: { identifier: 'http://data.ign.fr/def/geometrie#coordY', type: 'number' },
    names: ['coord_y', 'coordy']
  },
  // Adresse
  {
    concept: { identifier: 'http://schema.org/address', type: 'string' },
    names: ['adresse', 'address', 'adresse_textuelle', 'adresse_complete', 'adresse_postale']
  },
  {
    concept: { identifier: 'http://schema.org/streetAddress', type: 'string' },
    names: ['voie', 'nom_voie', 'nom_de_voie', 'rue', 'nom_rue', 'street', 'adresse_voie', 'lieu_dit']
  },
  {
    concept: { identifier: 'http://www.ontotext.com/proton/protonext#StreetNumber', type: 'string', code: true },
    names: ['numero_voie', 'num_voie', 'no_voie', 'numero_rue', 'num_rue', 'street_number']
  },
  {
    concept: { identifier: 'http://schema.org/City', type: 'string' },
    names: ['commune', 'nom_commune', 'nom_de_la_commune', 'ville', 'nom_ville', 'city']
  },
  {
    concept: { identifier: 'http://schema.org/postalCode', type: 'string', code: true },
    names: ['code_postal', 'postal_code', 'cp']
  },
  {
    concept: { identifier: 'http://rdf.insee.fr/def/geo#Departement', type: 'string' },
    names: ['departement', 'nom_departement', 'nom_du_departement']
  },
  {
    concept: { identifier: 'https://schema.org/addressRegion', type: 'string' },
    names: ['region', 'nom_region', 'nom_de_la_region']
  },
  {
    concept: { identifier: 'http://schema.org/addressCountry', type: 'string' },
    names: ['pays', 'nom_pays', 'nom_du_pays', 'country']
  },
  {
    concept: { identifier: 'http://dbpedia.org/ontology/iso31661Code', type: 'string', code: true },
    names: ['code_pays_iso', 'code_pays_iso2', 'code_iso_pays', 'country_code', 'code_iso2']
  },
  // Référentiels administratifs français
  {
    concept: { identifier: 'http://rdf.insee.fr/def/geo#codeCommune', type: 'string', code: true },
    names: ['code_insee', 'insee', 'code_commune', 'insee_commune']
  },
  {
    concept: { identifier: 'http://rdf.insee.fr/def/geo#codeDepartement', type: 'string', code: true },
    names: ['code_departement', 'code_dept']
  },
  {
    concept: { identifier: 'http://rdf.insee.fr/def/geo#codeRegion', type: 'string', code: true },
    names: ['code_region']
  },
  {
    concept: { identifier: 'http://rdf.insee.fr/def/geo#EtablissementPublicDeCooperationIntercommunale', type: 'string', code: true },
    names: ['code_epci']
  },
  {
    concept: { identifier: 'http://rdf.insee.fr/def/geo#codeIRIS', type: 'string', code: true },
    names: ['code_iris', 'iris_insee', 'iris_code']
  },
  {
    concept: { identifier: 'http://dbpedia.org/ontology/codeLandRegistry', type: 'string', code: true },
    names: ['code_parcelle', 'parcelle', 'parcelle_cadastrale', 'id_parcelle', 'identifiant_parcelle']
  },
  {
    concept: { identifier: 'http://www.datatourisme.fr/ontology/core/1.0/#siret', type: 'string', code: true },
    names: ['siret', 'numero_siret']
  },
  {
    concept: { identifier: 'http://dbpedia.org/ontology/siren', type: 'string', code: true },
    names: ['siren', 'numero_siren']
  },
  {
    concept: { identifier: 'http://www.datatourisme.fr/ontology/core/1.0#apeNaf', type: 'string', code: true },
    names: ['code_ape', 'ape', 'code_naf', 'naf']
  },
  {
    concept: { identifier: 'http://data.europa.eu/cpv/cpv', type: 'string', code: true },
    names: ['code_cpv', 'cpv']
  },
  {
    concept: { identifier: 'https://sig.ville.gouv.fr/qpv', type: 'string', code: true },
    names: ['qpv', 'quartier_prioritaire']
  },
  {
    concept: { identifier: 'https://rnb.gouv.fr/#ID-RNB', type: 'string', code: true },
    names: ['id_rnb', 'identifiant_rnb', 'rnb']
  },
  // Calendrier
  {
    concept: { identifier: 'http://schema.org/Date', type: 'string', formats: DATE_FORMATS },
    names: ['date', 'date_evenement', 'horodatage', 'timestamp', 'date_time', 'datetime', 'date_et_heure', 'date_maj', 'date_de_mise_a_jour']
  },
  {
    concept: { identifier: 'https://schema.org/startDate', type: 'string', formats: DATE_FORMATS },
    names: ['date_debut', 'date_de_debut', 'date_du_debut', 'debut']
  },
  {
    concept: { identifier: 'https://schema.org/endDate', type: 'string', formats: DATE_FORMATS },
    names: ['date_fin', 'date_de_fin', 'fin']
  },
  {
    concept: { identifier: 'http://schema.org/dateCreated', type: 'string', formats: DATE_FORMATS },
    names: ['date_creation', 'date_de_creation']
  },
  {
    concept: { identifier: 'https://www.w3.org/TR/owl-time/#time:year', type: 'string', allowInteger: true },
    names: ['annee', 'exercice', 'millesime']
  },
  {
    concept: { identifier: 'https://schema.org/openingHours', type: 'string' },
    names: ['horaires', 'horaires_ouverture', 'horaire_ouverture', 'horaires_d_ouverture', 'opening_hours']
  },
  // Informations de contact et liens
  {
    concept: { identifier: 'https://www.w3.org/2006/vcard/ns#email', type: 'string' },
    names: ['email', 'mail', 'courriel', 'adresse_mail', 'adresse_electronique', 'email_contact', 'contact_email']
  },
  {
    concept: { identifier: 'https://www.w3.org/2006/vcard/ns#tel', type: 'string' },
    names: ['telephone', 'tel', 'num_tel', 'num_telephone', 'numero_telephone', 'telephone_contact', 'contact_telephone', 'phone']
  },
  {
    concept: { identifier: 'https://schema.org/WebPage', type: 'string' },
    names: ['site_internet', 'site_web', 'site_url', 'url', 'url_site', 'page_web', 'contact_url', 'lien', 'website']
  },
  // Commerce
  {
    concept: { identifier: 'https://schema.org/price', type: 'number' },
    names: ['prix', 'prix_unitaire', 'tarif', 'price']
  }
]

const conceptsByLabel = new Map<string, ConceptDefinition>()
for (const { concept, names } of definitions) {
  for (const name of names) {
    if (!conceptsByLabel.has(name)) conceptsByLabel.set(name, concept)
  }
}

/** Identifiants de concepts de type code (recherche textuelle peu pertinente). */
export const codeConceptIdentifiers = new Set(
  definitions.filter(({ concept }) => concept.code).map(({ concept }) => concept.identifier)
)

/** Minuscules, sans accents, caractères non alphanumériques réduits à "_". */
export const normalizeLabel = (label: string): string =>
  label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const conceptFitsProperty = (concept: ConceptDefinition, property: DatasetSchemaProperty): boolean => {
  if (concept.allowInteger && property.type === 'integer') return true
  if (concept.type === 'number') return property.type === 'number'
  if (concept.formats) return property.type === 'string' && !!property.format && concept.formats.includes(property.format)
  return property.type === 'string'
}

/**
 * Annote les propriétés avec les concepts reconnus, au maximum un champ par concept.
 * Ne touche à rien sur les champs non reconnus ou incompatibles avec le type du concept.
 */
export const applyConcepts = (properties: DatasetSchemaProperty[]): void => {
  const attributed = new Set<string>()
  for (const property of properties) {
    const concept =
      conceptsByLabel.get(normalizeLabel(property.key)) ??
      (property.title ? conceptsByLabel.get(normalizeLabel(property.title)) : undefined)
    if (!concept || attributed.has(concept.identifier)) continue
    if (!conceptFitsProperty(concept, property)) continue
    property['x-refersTo'] = concept.identifier
    attributed.add(concept.identifier)
  }
}

/**
 * Fusionne les concepts du schéma calculé dans un schéma existant (jeu de données en place).
 * Seuls les "x-refersTo" absents sont ajoutés : un concept posé ou absent volontairement
 * côté propriétaire, ainsi que toutes ses autres personnalisations, sont préservés.
 * Les champs créés par une version antérieure du traitement (clé brute, non normalisée)
 * sont retrouvés par leur nom d'origine pour ne pas perdre la réparation.
 * Retourne null si rien ne change.
 */
export const mergeConcepts = (liveSchema: any[], properties: DatasetSchemaProperty[]): any[] | null => {
  let changed = false
  const merged = liveSchema.map(liveProp => {
    const desired = properties.find(p => p.key === liveProp.key || p['x-originalName'] === liveProp.key)
    if (!desired?.['x-refersTo'] || liveProp['x-refersTo']) return liveProp
    changed = true
    return { ...liveProp, 'x-refersTo': desired['x-refersTo'] }
  })
  return changed ? merged : null
}
