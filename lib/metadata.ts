/**
 * Résumé et description des jeux de données produits.
 *
 * data-fair distingue `summary` (description courte, affichée dans les listes et
 * les catalogues, 300 caractères max) et `description` (description détaillée en
 * markdown). Les deux sont dérivés du catalogue schema.data.gouv.fr et ne sont
 * rafraîchis que s'ils n'ont pas été personnalisés par le propriétaire du jeu.
 */
import type { CatalogEntry, CatalogVersion } from './catalog.ts'

export const SUMMARY_MAX_LENGTH = 300

/** Tronque au mot, sur une seule ligne. */
export const truncateSummary = (text: string, max = SUMMARY_MAX_LENGTH): string => {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const kept = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${kept.trimEnd()}…`
}

export const schemaPageUrl = (name: string): string => `https://schema.data.gouv.fr/${name}/`

export const datasetSummary = (entry: CatalogEntry): string => {
  const description = (entry.description ?? '').trim()
  if (description) return truncateSummary(description)
  return truncateSummary(`Spécification du schéma tabulaire « ${entry.title} » publiée sur schema.data.gouv.fr.`)
}

export const datasetDescription = (entry: CatalogEntry, version: CatalogVersion): string => {
  const links = [
    `- Schéma publié sur schema.data.gouv.fr : [${entry.title}](${schemaPageUrl(entry.name)})`,
    `- Schéma d'origine au format JSON : [version ${version.version_name}](${version.schema_url})`
  ]
  if (entry.homepage) links.push(`- Page du standard : <${entry.homepage}>`)
  if (entry.external_doc) links.push(`- Documentation : <${entry.external_doc}>`)
  if (entry.external_tool) links.push(`- Outil de production : <${entry.external_tool}>`)
  if (entry.contact) links.push(`- Contact : ${entry.contact}`)
  if (entry.labels?.length) links.push(`- Labels : ${entry.labels.join(', ')}`)

  const parts: string[] = []
  if (entry.description?.trim()) parts.push(entry.description.trim())
  parts.push(`Ce jeu de données éditable porte le schéma tabulaire **${entry.title}** dans sa version ${version.version_name}.\n\n${links.join('\n')}`)
  return parts.join('\n\n')
}

export interface DatasetMetadata {
  summary?: string
  description?: string
}

/**
 * Patch de résumé/description pour un changement de version du schéma.
 * Ne touche jamais aux personnalisations : la description n'est rafraîchie que
 * si elle correspond encore exactement à celle générée pour la version
 * précédente, et le résumé seulement s'il est absent (il ne dépend pas de la
 * version).
 */
export const metadataPatch = (
  live: DatasetMetadata,
  entry: CatalogEntry,
  previousVersion: CatalogVersion,
  nextVersion: CatalogVersion
): DatasetMetadata => {
  const patch: DatasetMetadata = {}
  if (live.summary === undefined) patch.summary = datasetSummary(entry)
  if ((live.description ?? '').trim() === datasetDescription(entry, previousVersion).trim()) {
    const description = datasetDescription(entry, nextVersion)
    if (description !== live.description) patch.description = description
  }
  return patch
}
