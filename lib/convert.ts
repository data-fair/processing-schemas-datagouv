/**
 * Conversion d'un table schema frictionless (format des schémas tabulaires de
 * schema.data.gouv.fr) en propriétés de schéma data-fair.
 */

export interface TableSchemaField {
  name: string
  title?: string
  description?: string
  type?: string
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
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
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

export const convertField = (field: TableSchemaField): DatasetSchemaProperty => {
  if (!field?.name || typeof field.name !== 'string') {
    throw new Error(`Champ de schéma invalide (nom absent) : ${JSON.stringify(field)}`)
  }
  const mapped = TYPE_MAPPING[field.type ?? 'string'] ?? { type: 'string' }
  const property: DatasetSchemaProperty = {
    key: field.name,
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
    if (typeof constraints.pattern === 'string' && constraints.pattern) property.pattern = constraints.pattern
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
 * Retourne les propriétés data-fair et, si elle est déclarée et cohérente, la clé primaire.
 */
export const convertTableSchema = (tableSchema: TableSchema): { schema: DatasetSchemaProperty[], primaryKey?: string[] } => {
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
  const schema = tableSchema.fields.map(convertField)

  let primaryKey: string[] | undefined
  if (tableSchema.primaryKey) {
    const parts = Array.isArray(tableSchema.primaryKey) ? tableSchema.primaryKey : [tableSchema.primaryKey]
    const known = parts.filter(p => seen.has(p))
    if (known.length) primaryKey = known
  }
  return primaryKey?.length ? { schema, primaryKey } : { schema }
}
