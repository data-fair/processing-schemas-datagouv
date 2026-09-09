/**
 * Lecture du catalogue public de schema.data.gouv.fr.
 * Le catalogue est un fichier statique : https://schema.data.gouv.fr/schemas.json
 */

export interface CatalogVersion {
  version_name: string
  schema_url: string
}

export interface CatalogEntry {
  name: string
  title: string
  description?: string
  schema_type?: string
  homepage?: string
  examples?: { title?: string, path?: string }[]
  versions: CatalogVersion[]
  schema_url?: string
  [key: string]: unknown
}

export interface TableSchemaResponse {
  [key: string]: unknown
}

export const CATALOG_URL = 'https://schema.data.gouv.fr/schemas.json'

const FETCH_TIMEOUT = 30000

export const fetchJSON = async (url: string): Promise<any> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status} en interrogeant ${url}`)
  return res.json()
}

export const fetchCatalog = async (): Promise<CatalogEntry[]> => {
  const catalog = await fetchJSON(CATALOG_URL)
  if (!Array.isArray(catalog?.schemas)) {
    throw new Error(`Le catalogue ${CATALOG_URL} n'a pas la structure attendue (liste "schemas" absente).`)
  }
  return catalog.schemas
}

/** Seuls les table schemas sont importables comme jeux de données éditables tabulaires. */
export const tabularEntries = (entries: CatalogEntry[]): CatalogEntry[] =>
  entries.filter(e => e.schema_type === 'tableschema')

const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i])
    const nb = Number(pb[i])
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na - nb
    } else if (pa[i] !== pb[i]) {
      return (pa[i] ?? '').localeCompare(pb[i] ?? '')
    }
  }
  return 0
}

/** La dernière version publiée d'une entrée du catalogue. */
export const latestVersion = (entry: CatalogEntry): CatalogVersion => {
  if (!Array.isArray(entry.versions) || !entry.versions.length) {
    throw new Error(`Le schéma "${entry.name}" n'expose aucune version dans le catalogue.`)
  }
  return [...entry.versions].sort((a, b) => compareVersions(a.version_name, b.version_name)).at(-1)!
}
