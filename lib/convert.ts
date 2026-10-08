/**
 * Conversion d'un table schema frictionless (format des schémas tabulaires de
 * schema.data.gouv.fr) en propriétés de schéma data-fair, annotées au maximum
 * avec les concepts reconnus par la plateforme.
 */
import { applyConcepts, mergeConcepts, normalizeLabel, type SchemaProjection } from './concepts.ts'
import { applyCapabilities, type CapabilitiesOptions } from './capabilities.ts'

export interface TableSchemaField {
  name: string
  title?: string
  description?: string
  type?: string
  example?: unknown
  constraints?: {
    required?: boolean | string
    minLength?: number
    maxLength?: number
    minimum?: number | string
    maximum?: number | string
    pattern?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface TableSchema {
  title?: string
  description?: string
  version?: string
  primaryKey?: string | string[]
  fields: TableSchemaField[]
  [key: string]: unknown
}

export interface DatasetSchemaProperty {
  key: string
  title: string
  description?: string
  type: string
  format?: string
  'x-originalName': string
  'x-required'?: boolean
  'x-refersTo'?: string
  'x-capabilities'?: Record<string, boolean>
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  'x-labels'?: Record<string, string>
  'x-labelsRestricted'?: boolean
}

/**
 * Types frictionless tabulaires dont la conversion est explicite.
 * Tous les autres types (time, yearmonth, geopoint, geojson, object, array,
 * duration, any...) sont dégradés en chaîne de caractères.
 */
const TYPE_MAPPING: Record<string, { type: string, format?: string }> = {
  string: { type: 'string' },
  number: { type: 'number' },
  integer: { type: 'integer' },
  year: { type: 'integer' },
  boolean: { type: 'boolean' },
  date: { type: 'string', format: 'date' },
  datetime: { type: 'string', format: 'date-time' }
}

/**
 * Clé data-fair d'un champ : data-fair interprète les points comme des chemins
 * imbriqués (mapping elasticsearch, flatten), on normalise donc les noms en
 * minuscules sans accent, les caractères non alphanumériques devenant "_".
 * Le nom d'origine du table schema reste porté par "x-originalName".
 */
export const escapeKey = (name: string): string => normalizeLabel(name)

/** Caractères qu'une expression régulière en mode unicode accepte d'échapper. */
const SYNTAX_CHARACTERS = '^$\\.*+?()[]{}|/'

const isValidUnicodeRegExp = (pattern: string): boolean => {
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, 'u')
    return true
  } catch {
    return false
  }
}

/**
 * Les patterns des table schemas sont écrits pour Python, qui tolère les échappements
 * inutiles (\-, \', \’...). data-fair les compile avec ajv en mode unicode, qui les
 * refuse : le jeu de données deviendrait alors impossible à alimenter. On retire ces
 * échappements (sauf \- dans une classe de caractères, où il reste significatif).
 * Les patterns d'un table schema sont implicitement ancrés : on les ancre explicitement.
 * Retourne undefined si le pattern reste inexploitable.
 */
export const sanitizePattern = (pattern: string): string | undefined => {
  let cleaned = ''
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '\\' && i + 1 < pattern.length) {
      const next = pattern[++i]
      const keep = /[A-Za-z0-9]/.test(next) || SYNTAX_CHARACTERS.includes(next) || (inClass && next === '-')
      cleaned += keep ? char + next : next
      continue
    }
    if (char === '[') inClass = true
    else if (char === ']') inClass = false
    cleaned += char
  }
  const anchored = `^(?:${cleaned})$`
  return isValidUnicodeRegExp(anchored) ? anchored : undefined
}

export const convertField = (field: TableSchemaField, warnings: string[] = []): DatasetSchemaProperty => {
  if (!field?.name || typeof field.name !== 'string') {
    throw new Error(`Champ de schéma invalide (nom absent) : ${JSON.stringify(field)}`)
  }
  const key = escapeKey(field.name)
  if (!key) {
    throw new Error(`Champ de schéma invalide (nom inexploitable en clé data-fair) : ${JSON.stringify(field.name)}`)
  }
  const mapped = TYPE_MAPPING[field.type ?? 'string'] ?? { type: 'string' }
  const property: DatasetSchemaProperty = {
    key,
    title: field.title ?? field.name,
    type: mapped.type,
    'x-originalName': field.name
  }
  if (mapped.format) property.format = mapped.format
  if (field.description) property.description = field.description

  const constraints = field.constraints
  if (constraints) {
    if (constraints.required === true) property['x-required'] = true
    if (typeof constraints.minLength === 'number') property.minLength = constraints.minLength
    if (typeof constraints.maxLength === 'number') property.maxLength = constraints.maxLength
    if (typeof constraints.pattern === 'string' && constraints.pattern) {
      const pattern = sanitizePattern(constraints.pattern)
      if (pattern) property.pattern = pattern
      else warnings.push(`contrainte pattern du champ "${field.name}" ignorée, incompatible avec data-fair : ${constraints.pattern}`)
    }
    // liste de valeurs autorisées : libellés restreints, validés par data-fair et proposés à la saisie.
    // data-fair compare des clés de libellés (chaînes) : seuls les champs texte sont concernés.
    if (Array.isArray(constraints.enum) && constraints.enum.length && mapped.type === 'string' && !mapped.format) {
      const values = constraints.enum.filter((value): value is string => typeof value === 'string')
      if (values.length) {
        property['x-labels'] = Object.fromEntries(values.map(value => [value, value]))
        property['x-labelsRestricted'] = true
      }
    }
    // les contraintes minimum/maximum ne sont reprises que sur les champs numériques :
    // dans un table schema elles peuvent aussi porter des dates, que data-fair ne sait pas contraindre
    if (mapped.type === 'number' || mapped.type === 'integer') {
      if (typeof constraints.minimum === 'number' && Number.isFinite(constraints.minimum)) property.minimum = constraints.minimum
      if (typeof constraints.maximum === 'number' && Number.isFinite(constraints.maximum)) property.maximum = constraints.maximum
    }
  }
  return property
}

/**
 * Convertit un table schema complet.
 * Retourne les propriétés data-fair, la clé primaire si elle est déclarée et cohérente,
 * et la projection cartographique à poser sur le jeu de données si des champs géographiques
 * projetés ont été identifiés (cf. applyConcepts).
 */
export const convertTableSchema = (tableSchema: TableSchema, options: CapabilitiesOptions = {}): { schema: DatasetSchemaProperty[], primaryKey?: string[], projection?: SchemaProjection, warnings?: string[] } => {
  if (!Array.isArray(tableSchema?.fields) || !tableSchema.fields.length) {
    throw new Error('Table schema invalide : aucun champ déclaré dans "fields".')
  }
  const seen = new Set<string>()
  for (const field of tableSchema.fields) {
    if (seen.has(field.name)) {
      throw new Error(`Table schema invalide : le champ "${field.name}" est déclaré plusieurs fois.`)
    }
    seen.add(field.name)
  }
  const fieldWarnings: string[] = []
  const schema = tableSchema.fields.map(field => convertField(field, fieldWarnings))
  const keys = new Map<string, string>()
  for (const property of schema) {
    const other = keys.get(property.key)
    if (other) {
      throw new Error(`Table schema invalide : les champs "${other}" et "${property['x-originalName']}" produisent la même clé data-fair "${property.key}".`)
    }
    keys.set(property.key, property['x-originalName'])
  }
  const { projection, warnings: conceptWarnings } = applyConcepts(schema, tableSchema.fields)
  const warnings = [...fieldWarnings, ...conceptWarnings]
  applyCapabilities(schema, tableSchema.fields, options)

  let primaryKey: string[] | undefined
  if (tableSchema.primaryKey) {
    const parts = Array.isArray(tableSchema.primaryKey) ? tableSchema.primaryKey : [tableSchema.primaryKey]
    const known = parts.filter(p => seen.has(p)).map(escapeKey).filter(p => keys.has(p))
    if (known.length) primaryKey = known
  }
  return {
    schema,
    ...(primaryKey?.length ? { primaryKey } : {}),
    ...(projection ? { projection } : {}),
    ...(warnings.length ? { warnings } : {})
  }
}

/**
 * Patterns invalides en mode unicode posés par une version antérieure du traitement :
 * ils rendent le jeu impossible à alimenter, on les corrige (ou les retire).
 * Retourne null si rien ne change.
 */
export const repairPatterns = (liveSchema: any[]): any[] | null => {
  let changed = false
  const repaired = liveSchema.map(liveProp => {
    if (typeof liveProp.pattern !== 'string' || isValidUnicodeRegExp(liveProp.pattern)) return liveProp
    changed = true
    const pattern = sanitizePattern(liveProp.pattern)
    if (pattern) return { ...liveProp, pattern }
    const { pattern: _pattern, ...rest } = liveProp
    return rest
  })
  return changed ? repaired : null
}

/** Contraintes portées par le table schema : retirées du jeu quand la nouvelle version ne les déclare plus. */
const SOURCE_CONSTRAINTS = ['format', 'x-required', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'x-labelsRestricted']
/** Réglages du propriétaire du jeu de données, conservés lors d'une montée de version. */
const OWNER_SETTINGS = ['x-refersTo', 'x-concept', 'x-capabilities']

/**
 * Schéma d'un jeu existant après montée de version du table schema.
 *
 * Remplacer le schéma supprimerait dans data-fair les colonnes absentes de la nouvelle
 * version et leurs données (colonnes renommées ou ajoutées par le propriétaire) : elles
 * sont conservées et signalées dans `kept`. Les champs du table schema reprennent sa
 * définition (titre, type, contraintes), en conservant les concepts et capacités
 * d'indexation choisis par le propriétaire.
 */
export const mergeSchema = (liveSchema: any[], properties: DatasetSchemaProperty[]): { schema: any[], kept: string[] } => {
  const live = (mergeConcepts(liveSchema, properties) ?? liveSchema).filter(prop => prop['x-extension'] || !prop['x-calculated'])
  const used = new Set<any>()
  const schema = properties.map(property => {
    const liveProp = live.find(prop => prop.key === property.key || prop.key === property['x-originalName'])
    if (!liveProp) return property
    used.add(liveProp)
    const merged: any = { ...liveProp, ...property, key: liveProp.key }
    for (const key of SOURCE_CONSTRAINTS) {
      if (!(key in property)) delete merged[key]
    }
    for (const key of OWNER_SETTINGS) {
      if (key in liveProp) merged[key] = liveProp[key]
    }
    return merged
  })
  const kept = live.filter(prop => !used.has(prop))
  return { schema: [...schema, ...kept], kept: kept.map(prop => prop.key) }
}
