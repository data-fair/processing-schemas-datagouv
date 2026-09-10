/**
 * Préparation des fichiers d'exemple publiés avec les schémas du catalogue.
 *
 * Les exemples du catalogue sont hétérogènes : liens GitHub `blob` (pages HTML),
 * liens GitLab, Google Sheets, fichiers CSV ou tableurs, exemples volontairement
 * invalides, parfois obsolètes par rapport à la dernière version du schéma.
 * L'API data-fair `_bulk_lines` répond 400 dès qu'aucune ligne n'est acceptée
 * (colonne inconnue, colonne obligatoire absente, séparateur mal détecté) : on
 * pré-valide donc ici pour ignorer proprement un exemple inexploitable.
 */
import { normalizeLabel } from './concepts.ts'

export interface CatalogExample {
  title?: string
  name?: string
  path?: string
}

export interface ExampleCandidate {
  title?: string
  name?: string
  url: string
}

export interface ExampleSchemaProperty {
  key: string
  'x-required'?: boolean
}

const INVALID_RE = /invalide|invalid/i
const VALID_RE = /valide|valid/i
/** exemples qui documentent le schéma (gabarits, implémentations) plutôt que des données */
const NOT_DATA_RE = /sch[ée]ma|structure|impl?[ée]mentation/i

const TABULAR_EXTENSIONS: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  dbf: 'application/dbase'
}

const TEXT_EXTENSIONS = ['csv', 'tsv', 'txt']

/**
 * Normalise les URLs d'exemple vers une ressource brute téléchargeable.
 * Retourne null si le lien n'est manifestement pas un fichier de données.
 */
export const normalizeExampleUrl = (url: string): string | null => {
  let match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  if (match) return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`

  match = url.match(/^https?:\/\/gitlab\.com\/(.+)\/-\/blob\/(.+)$/)
  if (match) return `https://gitlab.com/${match[1]}/-/raw/${match[2]}`

  // URL GitHub malformée du type .../{sous-dossier}/raw/{ref}/{fichier}
  match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(.+)\/raw\/([^/]+)\/(.+)$/)
  if (match) return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[4]}/${match[3]}/${match[5]}`

  match = url.match(/^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)/)
  if (match) {
    const gid = url.match(/[#?&]gid=(\d+)/)?.[1] ?? '0'
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`
  }

  return url
}

/**
 * Candidats d'exemple, les plus pertinents d'abord : les exemples « valides »
 * avant les autres, et jamais un exemple explicitement « invalide » en premier.
 */
export const exampleCandidates = (entry: { examples?: CatalogExample[] }): ExampleCandidate[] => {
  const candidates = (entry.examples ?? [])
    .filter(example => !!example.path)
    .filter(example => !NOT_DATA_RE.test(`${example.title ?? ''} ${example.name ?? ''}`))
    .map(example => ({
      title: example.title,
      name: example.name,
      url: normalizeExampleUrl(example.path!)!
    }))
    .filter(candidate => !!candidate.url)

  const label = (candidate: ExampleCandidate) => `${candidate.title ?? ''} ${candidate.name ?? ''} ${candidate.url}`
  const isValid = (candidate: ExampleCandidate) => !INVALID_RE.test(label(candidate)) && VALID_RE.test(label(candidate))
  return [...candidates.filter(isValid), ...candidates.filter(candidate => !isValid(candidate))]
}

export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text)

export const firstLine = (text: string): string => text.split(/\r?\n/)[0] ?? ''

/** Découpe une ligne CSV en tenant compte des guillemets. */
export const parseCsvLine = (line: string, separator: string): string[] => {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === separator && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells.map(cell => cell.trim())
}

/** Séparateur le plus probable, compté hors guillemets sur la ligne d'en-tête. */
export const detectSeparator = (text: string): string => {
  const line = firstLine(stripBom(text))
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') i++
      else inQuotes = !inQuotes
    } else if (!inQuotes && char in counts) {
      counts[char]++
    }
  }
  const [separator, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return count > 0 ? separator : ','
}

export interface HeaderCheck {
  unknown: string[]
  missingRequired: string[]
  /** index de colonne -> clé exacte du schéma (casse/accents différents) */
  renamed: Map<number, string>
}

/**
 * Vérifie que l'en-tête de l'exemple correspond au schéma produit.
 * L'API compare les en-têtes bruts aux clés (`x-originalName`), on réécrit donc
 * l'en-tête quand seule la casse ou les accents diffèrent.
 */
export const checkHeader = (header: string[], schema: ExampleSchemaProperty[]): HeaderCheck => {
  const keys = schema.map(property => property.key)
  const keyByLabel = new Map<string, string | null>()
  for (const key of keys) {
    const label = normalizeLabel(key)
    keyByLabel.set(label, keyByLabel.has(label) ? null : key)
  }

  const unknown: string[] = []
  const renamed = new Map<number, string>()
  const present = new Set<string>()
  header.forEach((cell, index) => {
    const clean = cell.trim()
    if (!clean || clean === '_action' || clean === '_id') return
    if (keys.includes(clean)) {
      present.add(clean)
      return
    }
    const key = keyByLabel.get(normalizeLabel(clean))
    if (key && !present.has(key)) {
      renamed.set(index, key)
      present.add(key)
      return
    }
    unknown.push(clean)
  })

  return {
    unknown,
    missingRequired: schema.filter(property => property['x-required'] && !present.has(property.key)).map(property => property.key),
    renamed
  }
}

/** Réécrit la ligne d'en-tête avec les clés exactes du schéma. */
export const rewriteHeader = (text: string, separator: string, renamed: Map<number, string>): string => {
  if (!renamed.size) return text
  const newlineIndex = text.indexOf('\n')
  const line = newlineIndex === -1 ? text : text.slice(0, newlineIndex)
  const rest = newlineIndex === -1 ? '' : text.slice(newlineIndex)
  const cells = parseCsvLine(line, separator)
  for (const [index, key] of renamed) cells[index] = key
  const rebuilt = cells
    .map(cell => (cell.includes(separator) || cell.includes('"') || cell.includes('\n') ? `"${cell.replace(/"/g, '""')}"` : cell))
    .join(separator)
  return rebuilt + rest
}

export interface FetchedExample {
  url: string
  fileName: string
  mimeType: string
  isTabular: boolean
  text?: string
  buffer?: Buffer
}

export const exampleFile = (url: string): { fileName: string, mimeType: string, isTabular: boolean } => {
  const path = url.split(/[?#]/)[0]
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  if (TABULAR_EXTENSIONS[extension]) {
    return { fileName: `example.${extension}`, mimeType: TABULAR_EXTENSIONS[extension], isTabular: true }
  }
  if (TEXT_EXTENSIONS.includes(extension)) {
    return { fileName: `example.${extension}`, mimeType: extension === 'tsv' ? 'text/tab-separated-values' : 'text/csv', isTabular: false }
  }
  return { fileName: 'example.csv', mimeType: 'text/csv', isTabular: false }
}

/** Télécharge l'exemple en rejetant les pages HTML (liens `blob` non normalisés...). */
export const fetchExample = async (url: string): Promise<FetchedExample> => {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`erreur HTTP ${res.status}`)
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
  if (contentType.includes('text/html')) {
    throw new Error('le lien ne pointe pas vers un fichier de données (page HTML)')
  }
  const { fileName, mimeType, isTabular } = exampleFile(url)
  if (isTabular) {
    return { url, fileName, mimeType, isTabular, buffer: Buffer.from(await res.arrayBuffer()) }
  }
  return { url, fileName, mimeType, isTabular, text: stripBom(await res.text()) }
}

export type PreparedExample =
  | { kind: 'csv', separator: string, text: string }
  | { kind: 'tabular', fileName: string, mimeType: string, buffer: Buffer }

/**
 * Prépare un exemple pour l'API `_bulk_lines` : validation de l'en-tête et
 * normalisation du CSV, ou passage tel quel d'un tableur (converti par l'API).
 * Lève une erreur explicite si l'exemple ne correspond pas au schéma.
 */
export const prepareExample = (example: FetchedExample, schema: ExampleSchemaProperty[]): PreparedExample => {
  if (example.isTabular) {
    return { kind: 'tabular', fileName: example.fileName, mimeType: example.mimeType, buffer: example.buffer! }
  }
  const text = example.text ?? ''
  if (!text.trim()) throw new Error('fichier vide')
  const separator = detectSeparator(text)
  const header = parseCsvLine(firstLine(text), separator)
  const check = checkHeader(header, schema)
  if (check.unknown.length) {
    const sample = check.unknown.slice(0, 5).join(', ')
    throw new Error(`colonnes inconnues dans l'exemple : ${sample}${check.unknown.length > 5 ? '…' : ''} (exemple probablement obsolète par rapport à la version du schéma)`)
  }
  if (check.missingRequired.length) {
    throw new Error(`colonnes obligatoires absentes de l'exemple : ${check.missingRequired.join(', ')}`)
  }
  return { kind: 'csv', separator, text: rewriteHeader(text, separator, check.renamed) }
}
