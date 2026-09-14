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
 *
 * Les concepts géographiques dépendent d'un système de projection :
 * - latitude/longitude/lat_long et le concept "geometry" sont réservés aux données WGS84
 *   (pour "geometry", le type frictionless "geojson" fait foi, sinon l'exemple doit être
 *   un GeoJSON/WKT dans les bornes WGS84) ;
 * - les données projetées ne sont annotées (concepts coordX/coordY et geometryProj) que si
 *   leur projection est identifiée dans le schéma et supportée par data-fair, auquel cas
 *   elle est posée sur le jeu de données ;
 * - en cas de doute (projection inconnue, exemple hors bornes non identifié, contenu
 *   GML...), le champ n'est pas annoté : mieux vaut pas de carte qu'une carte fausse.
 */
import type { DatasetSchemaProperty, TableSchemaField } from './convert.ts'

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

/** Projection cartographique identifiée, au format attendu par data-fair (dataset.projection). */
export interface SchemaProjection {
  code: string
}

export const LATITUDE_CONCEPT = 'http://schema.org/latitude'
export const LONGITUDE_CONCEPT = 'http://schema.org/longitude'
export const LAT_LON_CONCEPT = 'http://www.w3.org/2003/01/geo/wgs84_pos#lat_long'
export const GEOMETRY_CONCEPT = 'https://purl.org/geojson/vocab#geometry'
export const GEOMETRY_PROJ_CONCEPT = 'http://data.ign.fr/def/geometrie#Geometry'
export const COORD_X_CONCEPT = 'http://data.ign.fr/def/geometrie#coordX'
export const COORD_Y_CONCEPT = 'http://data.ign.fr/def/geometrie#coordY'

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

// ---------------------------------------------------------------------------
// Concepts géographiques et systèmes de projection
// ---------------------------------------------------------------------------

/** Noms de champs désignant une latitude WGS84 en degrés décimaux. */
const LATITUDE_NAMES = ['latitude', 'lat', 'lat_wgs84', 'ylat', 'ylat_wgs84']
/** Noms de champs désignant une longitude WGS84 en degrés décimaux. */
const LONGITUDE_NAMES = ['longitude', 'lon', 'lng', 'lon_wgs84', 'xlong', 'xlong_wgs84']
/**
 * Noms de champs désignant une paire WGS84 au format "latitude,longitude" (l'ordre attendu
 * par data-fair). Le type frictionless "geopoint" est volontairement exclu : il impose
 * l'ordre inverse "longitude,latitude".
 */
const LAT_LON_NAMES = ['lat_lon', 'latlong', 'coordonnees_gps', 'coordonnee_gps', 'coord_gps', 'coordonnees_geographiques', 'coordonnee_geographique']
/** Noms de champs désignant une géométrie GeoJSON ou WKT. */
const GEOMETRY_NAMES = ['geometrie', 'geom', 'geojson', 'geo_shape', 'geoshape', 'shape']
/** Noms de champs candidats pour un couple de coordonnées projetées. */
const COORD_X_NAMES = ['coord_x', 'coordx', 'x']
const COORD_Y_NAMES = ['coord_y', 'coordy', 'y']

/**
 * Projections reconnues dans les libellés, limitées à celles supportées par data-fair
 * (cf. api/contract/projections.js). L'ordre compte : les projections projetées avant
 * le repli WGS84 générique.
 */
const PROJECTION_PATTERNS: { code: string, re: RegExp }[] = [
  { code: 'EPSG:2154', re: /lambert[\s_-]*93|rgf[\s_-]*93|epsg[\s:._-]*2154/i },
  { code: 'EPSG:27572', re: /lambert[\s_-]*(?:ii\b|2\b|zone[\s_-]*ii)|epsg[\s:._-]*27572/i },
  { code: 'EPSG:3857', re: /epsg[\s:._-]*3857|pseudo[\s_-]*mercator|web[\s_-]*mercator/i },
  { code: 'EPSG:32620', re: /epsg[\s:._-]*32620|utm[\s_-]*(?:zone[\s_-]*)?20[\s_-]*n/i },
  { code: 'EPSG:5490', re: /epsg[\s:._-]*5490|rgaf[\s_-]*09/i },
  { code: 'EPSG:4326', re: /epsg[\s:._-]*4326|wgs[\s_-]*84/i }
]

/** Bornes des coordonnées WGS84 en degrés décimaux. */
const WGS84_MAX = 180

/** Emprises (très approximatives) des projections projetées françaises, pour l'inférence depuis un exemple. */
const PROJECTED_EMPRISES: { code: string, test: (numbers: number[]) => boolean }[] = [
  { code: 'EPSG:2154', test: n => n.some(v => v >= 6_000_000 && v <= 7_200_000) && n.some(v => v >= 0 && v <= 1_300_000) },
  { code: 'EPSG:27572', test: n => n.some(v => v >= 1_700_000 && v <= 2_700_000) && n.some(v => v >= 0 && v <= 1_300_000) }
]

const EXAMPLE_NUMBER_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

/** Extrait tous les nombres d'un exemple (objet GeoJSON, tableau, chaîne WKT...). */
const collectNumbers = (value: unknown, numbers: number[]): void => {
  if (typeof value === 'number' && Number.isFinite(value)) numbers.push(value)
  else if (typeof value === 'string') {
    for (const match of value.matchAll(EXAMPLE_NUMBER_RE)) numbers.push(Number(match[0]))
  } else if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, numbers)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, numbers)
  }
}

/** Exemple GML (non supporté par data-fair : ni GeoJSON ni WKT). */
const looksLikeGml = (example: unknown): boolean => typeof example === 'string' && /<\w+:/i.test(example)

/** Projection identifiée dans un libellé, ou déduite de l'emprise de l'exemple. */
const detectProjection = (text: string): string | undefined => {
  for (const { code, re } of PROJECTION_PATTERNS) {
    if (re.test(text)) return code
  }
  return undefined
}

const projectionFromExample = (example: unknown): string | undefined => {
  const numbers: number[] = []
  collectNumbers(example, numbers)
  if (!numbers.length) return undefined
  // des coordonnées toutes dans les bornes WGS84 ne permettent pas de conclure à une projection
  if (numbers.every(number => Math.abs(number) <= WGS84_MAX)) return undefined
  return PROJECTED_EMPRISES.find(emprise => emprise.test(numbers))?.code
}

/** Projection associée à un champ : libellés (nom, titre, description) puis exemple. */
const fieldProjection = (property: DatasetSchemaProperty, field?: TableSchemaField): string | undefined =>
  detectProjection([property.key, property.title, property.description, field?.title, field?.description].filter(Boolean).join(' ')) ??
  projectionFromExample(field?.example)

const isLabeled = (property: DatasetSchemaProperty, names: string[]): boolean => {
  const labels = [normalizeLabel(property.key)]
  if (property.title) labels.push(normalizeLabel(property.title))
  return labels.some(label => names.includes(label))
}

/**
 * Une géométrie est tenue pour WGS84 si son type source est "geojson" (la spécification
 * GeoJSON impose WGS84) ou si son exemple est un GeoJSON/WKT dans les bornes WGS84.
 * Un exemple GML ou hors bornes sans projection identifiée ne permet pas de conclure.
 */
const isWgs84Geometry = (field?: TableSchemaField): boolean => {
  if (looksLikeGml(field?.example)) return false
  const numbers: number[] = []
  collectNumbers(field?.example, numbers)
  if (numbers.length) return numbers.every(number => Math.abs(number) <= WGS84_MAX)
  return field?.type === 'geojson'
}

interface GeoField {
  property: DatasetSchemaProperty
  field?: TableSchemaField
}

/**
 * Annote les propriétés avec les concepts reconnus, au maximum un champ par concept.
 * Ne touche à rien sur les champs non reconnus, incompatibles avec le type du concept,
 * ou dont le système de projection n'est pas identifié de façon fiable.
 *
 * Retourne la projection à poser sur le jeu de données quand des concepts projetés
 * (geometryProj, coordX/coordY) ont été appliqués.
 */
export const applyConcepts = (properties: DatasetSchemaProperty[], fields: TableSchemaField[] = []): { projection?: SchemaProjection, warnings: string[] } => {
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

  const warnings: string[] = []
  const fieldByKey = new Map(fields.map(field => [field.name, field]))
  const geoFields: GeoField[] = properties.map(property => ({
    property,
    field: fieldByKey.get(property['x-originalName'] || property.key)
  }))

  // latitude, longitude et paires lat,lon WGS84 : concepts explicitement WGS84, pas de projection
  const annotateWgs84 = (names: string[], identifier: string, fits: (property: DatasetSchemaProperty) => boolean) => {
    if (attributed.has(identifier)) return
    const candidate = geoFields.find(({ property }) => isLabeled(property, names) && fits(property))
    if (!candidate) return
    candidate.property['x-refersTo'] = identifier
    attributed.add(identifier)
  }
  annotateWgs84(LATITUDE_NAMES, LATITUDE_CONCEPT, property => property.type === 'number')
  annotateWgs84(LONGITUDE_NAMES, LONGITUDE_CONCEPT, property => property.type === 'number')
  annotateWgs84(LAT_LON_NAMES, LAT_LON_CONCEPT, property => property.type === 'string')

  // géométries et couples de coordonnées candidats
  const geometryFields = geoFields.filter(({ property }) => isLabeled(property, GEOMETRY_NAMES))
  const xField = geoFields.find(({ property, field }) => isLabeled(property, COORD_X_NAMES) && fieldProjection(property, field))
  const yField = geoFields.find(({ property, field }) => isLabeled(property, COORD_Y_NAMES) && fieldProjection(property, field))

  // une seule projection par jeu de données : en cas de contradiction, on n'annote rien
  const projectionFields: GeoField[] = [...geometryFields]
  if (xField) projectionFields.push(xField)
  if (yField) projectionFields.push(yField)
  const codes = new Set<string>()
  for (const { property, field } of projectionFields) {
    const code = fieldProjection(property, field)
    if (code && code !== 'EPSG:4326') codes.add(code)
  }
  if (codes.size > 1) {
    warnings.push(`projections cartographiques contradictoires détectées (${[...codes].join(', ')}) : les coordonnées et géométries projetées ne sont pas annotées`)
  }
  const projectionCode = codes.size === 1 ? [...codes][0] : undefined

  // géométrie : WGS84 pour le concept "geometry", projetée pour "geometryProj"
  const geometryField = geometryFields[0]
  if (geometryField && !attributed.has(GEOMETRY_CONCEPT) && !attributed.has(GEOMETRY_PROJ_CONCEPT)) {
    const { property, field } = geometryField
    const code = fieldProjection(property, field)
    if (code && code !== 'EPSG:4326') {
      // la projection doit être identifiée et sans ambiguïté pour être posée sur le jeu
      if (projectionCode === code) {
        property['x-refersTo'] = GEOMETRY_PROJ_CONCEPT
        attributed.add(GEOMETRY_PROJ_CONCEPT)
      }
    } else if (code === 'EPSG:4326' || isWgs84Geometry(field)) {
      property['x-refersTo'] = GEOMETRY_CONCEPT
      attributed.add(GEOMETRY_CONCEPT)
    } else if (projectionCode) {
      // géométrie sans indice propre, dans un jeu dont la projection est connue
      property['x-refersTo'] = GEOMETRY_PROJ_CONCEPT
      attributed.add(GEOMETRY_PROJ_CONCEPT)
    }
  }

  // coordonnées projetées : seulement un couple complet et homogène
  let projection: SchemaProjection | undefined
  if (attributed.has(GEOMETRY_PROJ_CONCEPT)) projection = { code: projectionCode! }
  if (xField && yField && !attributed.has(COORD_X_CONCEPT) && !attributed.has(COORD_Y_CONCEPT) && projectionCode) {
    const xCode = fieldProjection(xField.property, xField.field)
    const yCode = fieldProjection(yField.property, yField.field)
    if (xCode === projectionCode && yCode === projectionCode) {
      xField.property['x-refersTo'] = COORD_X_CONCEPT
      yField.property['x-refersTo'] = COORD_Y_CONCEPT
      attributed.add(COORD_X_CONCEPT)
      attributed.add(COORD_Y_CONCEPT)
      projection = { code: projectionCode }
    }
  }

  return { projection, warnings }
}

// ---------------------------------------------------------------------------
// Réparation des schémas existants
// ---------------------------------------------------------------------------

/**
 * Anciennes règles d'annotation géographique (avant la gestion des projections).
 * Conservées uniquement pour reconnaître les concepts posés par une version antérieure
 * du traitement et pouvoir les corriger ou les retirer sans toucher aux
 * personnalisations du propriétaire du jeu de données.
 */
const LEGACY_DEFINITIONS: { identifier: string, type: 'string' | 'number', names: string[] }[] = [
  { identifier: LATITUDE_CONCEPT, type: 'number', names: ['latitude', 'lat'] },
  { identifier: LONGITUDE_CONCEPT, type: 'number', names: ['longitude', 'lon', 'lng'] },
  { identifier: LAT_LON_CONCEPT, type: 'string', names: ['geopoint', 'coordonnees', 'coordonnees_gps', 'coordonnee_gps', 'coordonnees_geographiques', 'coordonnee_geographique', 'coord_gps', 'lat_lon', 'latlong'] },
  { identifier: GEOMETRY_CONCEPT, type: 'string', names: ['geometrie', 'geom', 'geojson', 'geo_shape', 'geoshape', 'shape'] },
  { identifier: COORD_X_CONCEPT, type: 'number', names: ['coord_x', 'coordx'] },
  { identifier: COORD_Y_CONCEPT, type: 'number', names: ['coord_y', 'coordy'] }
]

const legacyConcepts = (properties: DatasetSchemaProperty[]): Map<string, string> => {
  const byLabel = new Map<string, { identifier: string, type: 'string' | 'number' }>()
  for (const definition of LEGACY_DEFINITIONS) {
    for (const name of definition.names) {
      if (!byLabel.has(name)) byLabel.set(name, definition)
    }
  }
  const attributed = new Set<string>()
  const result = new Map<string, string>()
  for (const property of properties) {
    const definition =
      byLabel.get(normalizeLabel(property.key)) ??
      (property.title ? byLabel.get(normalizeLabel(property.title)) : undefined)
    if (!definition || attributed.has(definition.identifier)) continue
    if (definition.type === 'number' ? property.type !== 'number' : property.type !== 'string') continue
    attributed.add(definition.identifier)
    result.set(property.key, definition.identifier)
  }
  return result
}

/**
 * Fusionne les concepts du schéma calculé dans un schéma existant (jeu de données en place).
 *
 * - un "x-refersTo" absent est ajouté ;
 * - un concept posé par une version antérieure du traitement (règles legacy) mais que les
 *   règles actuelles ne posent plus, ou posent différemment, est corrigé ou retiré ;
 * - toutes les autres personnalisations du propriétaire du jeu de données sont préservées.
 *
 * Les champs créés par une version antérieure du traitement (clé brute, non normalisée)
 * sont retrouvés par leur nom d'origine pour ne pas perdre la réparation.
 * Retourne null si rien ne change.
 */
export const mergeConcepts = (liveSchema: any[], properties: DatasetSchemaProperty[]): any[] | null => {
  const legacy = legacyConcepts(properties)
  let changed = false
  const merged = liveSchema.map(liveProp => {
    const desired = properties.find(p => p.key === liveProp.key || p['x-originalName'] === liveProp.key)
    const wanted: string | undefined = desired?.['x-refersTo']
    const live: string | undefined = liveProp['x-refersTo']
    if (live && live !== wanted) {
      const legacyConcept = desired ? legacy.get(desired.key) : undefined
      if (legacyConcept && live === legacyConcept) {
        changed = true
        if (wanted) return { ...liveProp, 'x-refersTo': wanted }
        const { 'x-refersTo': _refersTo, 'x-concept': _concept, ...rest } = liveProp
        return rest
      }
      return liveProp
    }
    if (wanted && !live) {
      changed = true
      return { ...liveProp, 'x-refersTo': wanted }
    }
    return liveProp
  })
  return changed ? merged : null
}
