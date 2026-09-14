/**
 * Réglages d'indexation (x-capabilities) des propriétés de schéma.
 *
 * data-fair applique ses propres heuristiques (« code-like », « textarea »)
 * uniquement lors de l'analyse d'un fichier ; les jeux de données REST créés
 * avec un schéma explicite héritent des capacités par défaut. On reproduit ici
 * ces heuristiques à partir des informations objectives du table schema.
 */
import type { DatasetSchemaProperty, TableSchemaField } from './convert.ts'
import { codeConceptIdentifiers, normalizeLabel } from './concepts.ts'

export interface CapabilitiesOptions {
  /** `auto` (défaut) applique les heuristiques, `standard` laisse les défauts data-fair */
  mode?: 'auto' | 'standard'
  /** conserver la recherche textuelle sur les champs de type code */
  textSearchOnCodes?: boolean
  /** restreindre les capacités des champs de texte long (défaut : true) */
  restrictLongText?: boolean
  /** préparer les tuiles vectorielles des géométries */
  vectorTiles?: boolean
}

export const GEOMETRY_CONCEPT = 'https://purl.org/geojson/vocab#geometry'

/** Capacités data-fair d'un champ de type code (cf. mergeFileSchema dans data-fair). */
const CODE_CAPABILITIES = { text: false, insensitive: false }

/** Capacités data-fair d'un champ de texte long (cf. mergeFileSchema dans data-fair). */
const LONG_TEXT_CAPABILITIES = { index: false, values: false, insensitive: false }

/** Champs de texte libre reconnus par leur nom ou leur titre. */
const LONG_TEXT_NAMES = new Set([
  'description',
  'descriptions',
  'commentaire',
  'commentaires',
  'observation',
  'observations',
  'remarque',
  'remarques',
  'precision',
  'precisions',
  'complement',
  'complements',
  'conditions_utilisation_texte',
  'texte_libre',
  'notes'
])

const LONG_TEXT_MIN_MAX_LENGTH = 255

/**
 * Segments de nom de champ qui désignent un code : la recherche textuelle n'a
 * pas de sens dessus, contrairement au filtrage sur valeur exacte et au tri.
 * On reste volontairement sur ces signaux explicites plutôt que sur la seule
 * présence d'une contrainte `pattern`, qui sert aussi à valider des listes de
 * libellés ou des noms de voie.
 */
const CODE_NAME_SEGMENTS = new Set([
  'code',
  'id',
  'identifiant',
  'siret',
  'siren',
  'insee',
  'postal',
  'cp',
  'naf',
  'ape',
  'cpv',
  'rnb',
  'iris',
  'epci',
  'parcelle',
  'cj',
  'cog',
  'nic',
  'rid',
  'ridet',
  'rna'
])

const isCodeName = (key: string): boolean => {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  return normalizeLabel(snake).split('_').some(segment => CODE_NAME_SEGMENTS.has(segment))
}

/**
 * Les heuristiques s'appuient sur le nom d'origine du table schema : la clé
 * data-fair est normalisée (minuscules, sans accents), ce qui efface les
 * frontières de casse (ex. "menuCollSiret" -> "menucollsiret").
 */
const sourceName = (property: DatasetSchemaProperty): string => property['x-originalName'] || property.key

const isCodeLike = (property: DatasetSchemaProperty): boolean => {
  if (isCodeName(sourceName(property))) return true
  // le titre peut porter le signal (ex. « Numéro SIRET ») sauf s'il décrit un texte long
  if (property.title && !LONG_TEXT_NAMES.has(normalizeLabel(sourceName(property))) && isCodeName(property.title)) return true
  return !!property['x-refersTo'] && codeConceptIdentifiers.has(property['x-refersTo'])
}

const isLongText = (property: DatasetSchemaProperty, field?: TableSchemaField): boolean => {
  if (property.type !== 'string' || property.format) return false
  if (field?.constraints?.pattern || property.pattern) return false
  if (field?.constraints?.enum) return false
  if (typeof property.maxLength === 'number' && property.maxLength >= LONG_TEXT_MIN_MAX_LENGTH) return true
  const key = normalizeLabel(sourceName(property))
  if (LONG_TEXT_NAMES.has(key)) return true
  return !!property.title && LONG_TEXT_NAMES.has(normalizeLabel(property.title))
}

/**
 * Annote les propriétés avec les capacités d'indexation adaptées.
 * `fields` permet de retrouver les contraintes d'origine (enum, pattern) que la
 * conversion ne reprend pas telles quelles.
 */
export const applyCapabilities = (
  properties: DatasetSchemaProperty[],
  fields: TableSchemaField[] = [],
  options: CapabilitiesOptions = {}
): void => {
  if (options.mode === 'standard') return
  const fieldByKey = new Map(fields.map(field => [field.name, field]))

  for (const property of properties) {
    const field = fieldByKey.get(property['x-originalName'] || property.key)

    if (property['x-refersTo'] === GEOMETRY_CONCEPT) {
      if (options.vectorTiles) {
        property['x-capabilities'] = { ...property['x-capabilities'], vtPrepare: true }
      }
      continue
    }

    if (isCodeLike(property)) {
      if (options.textSearchOnCodes) continue
      property['x-capabilities'] = { ...property['x-capabilities'], ...CODE_CAPABILITIES }
      continue
    }

    if (options.restrictLongText !== false && isLongText(property, field)) {
      property['x-capabilities'] = { ...property['x-capabilities'], ...LONG_TEXT_CAPABILITIES }
    }
  }
}
