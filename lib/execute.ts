import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'
import { fetchCatalog, fetchJSON, latestVersion, tabularEntries, type CatalogEntry, type CatalogVersion } from './catalog.ts'
import { convertTableSchema } from './convert.ts'
import type { CapabilitiesOptions } from './capabilities.ts'
import { mergeConcepts } from './concepts.ts'
import { datasetDescription, datasetSummary, metadataPatch, schemaPageUrl } from './metadata.ts'
import { createSchemaDataset, datasetTitle, deleteDataset, describeError, getDataset, loadExampleData, needsTitleRepair, patchSchemaDataset } from './datasets.ts'

let shouldBeStopped = false

export const stop = async () => {
  shouldBeStopped = true
}

const throwIfStopped = () => {
  if (shouldBeStopped) throw new Error('Traitement interrompu.')
}

export interface TrackedDataset {
  schemaName: string
  version: string
  datasetId: string
  datasetTitle: string
}

export const run = async (context: ProcessingContext<ProcessingConfig>) => {
  shouldBeStopped = false
  const { processingConfig, axios, log, patchConfig, processingId } = context
  const config = processingConfig as any

  if (config.action === 'delete') {
    await deleteCreatedDatasets(context)
    return
  }

  await log.step('Lecture du catalogue schema.data.gouv.fr')
  const entries = await fetchCatalog()
  const byName = new Map<string, CatalogEntry>(entries.map(e => [e.name, e]))

  let selected: CatalogEntry[]
  if (config.importMode === 'all') {
    selected = tabularEntries(entries)
    await log.info(`Mode « tous les schémas tabulaires » : ${selected.length} schémas à importer`)
  } else {
    const wanted: string[] = config.schemas ?? []
    const unknown = wanted.filter(name => !byName.has(name))
    if (unknown.length) {
      throw new Error(`Schémas introuvables dans le catalogue : ${unknown.join(', ')}`)
    }
    selected = wanted.map(name => byName.get(name)!)
    await log.info(`${selected.length} schéma(s) sélectionné(s)`)
  }
  if (!selected.length) throw new Error('Aucun schéma à importer : sélectionnez au moins un schéma tabulaire.')

  const tracked: TrackedDataset[] = [...(config.createdDatasets ?? [])]
  const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 }

  for (const entry of selected) {
    throwIfStopped()
    try {
      if (entry.schema_type && entry.schema_type !== 'tableschema') {
        await log.warning(`"${entry.name}" ignoré : type de schéma "${entry.schema_type}" non tabulaire, seul un table schema peut être importé.`)
        counts.skipped++
        continue
      }
      await importSchema(entry, { config, tracked, axios, log, patchConfig, processingId }, counts)
    } catch (err: any) {
      counts.failed++
      await log.error(`Échec de l'import du schéma "${entry.name}"`, describeError(err))
    }
  }

  if (config.importMode !== 'all') {
    const orphans = tracked.filter(t => !selected.some(e => e.name === t.schemaName))
    for (const orphan of orphans) {
      await log.info(`Le schéma "${orphan.schemaName}" n'est plus sélectionné : son jeu de données "${orphan.datasetTitle}" (${orphan.datasetId}) est conservé sans mise à jour.`)
    }
  }

  await log.step('Bilan')
  const summary = `${counts.created} créé(s), ${counts.updated} mis à jour, ${counts.unchanged} déjà à jour, ${counts.skipped} ignoré(s), ${counts.failed} en échec`
  await log.info(summary)
  if (counts.failed) throw new Error(`${counts.failed} schéma(s) n'ont pas pu être importé(s), consultez le journal.`)
}

/**
 * Supprime tous les jeux de données créés par le traitement.
 *
 * Action ponctuelle : les jeux supprimés sont retirés du suivi, les échecs y restent
 * pour être retentés au prochain run, et l'action revient à l'import une fois le
 * nettoyage terminé.
 */
const deleteCreatedDatasets = async (context: ProcessingContext<ProcessingConfig>) => {
  const { processingConfig, axios, log, patchConfig, processingId } = context
  const config = processingConfig as any
  let tracked: TrackedDataset[] = [...(config.createdDatasets ?? [])]

  await log.step('Suppression des jeux de données créés')
  if (!tracked.length) {
    tracked = await discoverCreatedDatasets(axios, processingId, log)
    if (!tracked.length) {
      await log.info('Aucun jeu de données créé par ce traitement à supprimer.')
      await patchConfig({ action: 'import' } as any)
      return
    }
  }

  const remaining: TrackedDataset[] = []
  let deleted = 0
  let missing = 0
  let failed = 0

  for (const [index, entry] of tracked.entries()) {
    if (shouldBeStopped) {
      remaining.push(...tracked.slice(index))
      break
    }
    try {
      const existed = await deleteDataset(axios, entry.datasetId, entry.datasetTitle)
      if (existed) {
        deleted++
        await log.info(`Jeu de données supprimé : "${entry.datasetTitle}" (${entry.datasetId})`)
      } else {
        missing++
        await log.info(`Jeu de données déjà absent : "${entry.datasetTitle}" (${entry.datasetId})`)
      }
    } catch (err: any) {
      failed++
      remaining.push(entry)
      await log.error(`Échec de la suppression du jeu de données "${entry.datasetTitle}"`, describeError(err))
    }
  }

  // persisté avant de conclure : les jeux supprimés ne doivent pas être retentés au
  // prochain run, et l'action reste "delete" tant qu'il reste des échecs à retenter
  await patchConfig({
    createdDatasets: remaining.map(t => ({ ...t })),
    ...(shouldBeStopped || failed ? {} : { action: 'import' })
  } as any)

  await log.step('Bilan')
  await log.info(`${deleted} supprimé(s), ${missing} déjà absent(s), ${failed} en échec`)
  if (shouldBeStopped) return
  if (failed) throw new Error(`${failed} jeu(x) de données n'ont pas pu être supprimé(s), consultez le journal.`)
}

const DISCOVERY_PAGE_SIZE = 1000
const DISCOVERY_MAX_PAGES = 10

/**
 * Retrouve les jeux de données créés par ce traitement via leurs métadonnées
 * `extras['schema-datagouv']`.
 *
 * Utilisé en secours quand le suivi `createdDatasets` est vide : une sauvegarde du
 * formulaire de configuration purgeait ce champ readOnly avant qu'il ne soit
 * explicitement conservé par le schéma.
 *
 * Seuls les jeux portant le `processingId` de ce traitement sont repris : sans cette
 * vérification, tous les jeux marqués mais créés par un autre traitement ou une
 * version antérieure du plugin (sans processingId) seraient supprimés à tort.
 */
const discoverCreatedDatasets = async (
  axios: ProcessingContext['axios'],
  processingId: string,
  log: ProcessingContext['log']
): Promise<TrackedDataset[]> => {
  const found: TrackedDataset[] = []
  const withoutProcessingId: TrackedDataset[] = []
  try {
    for (let page = 1; page <= DISCOVERY_MAX_PAGES; page++) {
      const { data } = await axios.get(`api/v1/datasets?type=rest&select=id,title,extras&size=${DISCOVERY_PAGE_SIZE}&page=${page}&count=false`)
      const results: any[] = data?.results ?? []
      for (const dataset of results) {
        const extra = dataset.extras?.['schema-datagouv']
        if (!extra?.name) continue
        const candidate: TrackedDataset = {
          schemaName: extra.name,
          version: extra.version ?? '',
          datasetId: dataset.id,
          datasetTitle: dataset.title
        }
        // seuls les jeux portant le processingId de ce traitement sont supprimés ; ceux
        // d'un autre traitement sont laissés en place, et ceux sans processingId
        // (imports antérieurs à son introduction) sont signalés pour un traitement manuel
        if (extra.processingId === processingId) found.push(candidate)
        else if (!extra.processingId) withoutProcessingId.push(candidate)
      }
      if (results.length < DISCOVERY_PAGE_SIZE) break
      if (page === DISCOVERY_MAX_PAGES) {
        await log.warning(`Recherche des jeux de données interrompue après ${DISCOVERY_MAX_PAGES * DISCOVERY_PAGE_SIZE} jeux : certains jeux créés pourraient ne pas être supprimés par cette exécution.`)
      }
    }
  } catch (err: any) {
    throw new Error(`Échec de la recherche des jeux de données créés : ${describeError(err)}`)
  }
  if (found.length) {
    await log.warning(`${found.length} jeu(x) de données retrouvé(s) via leurs métadonnées, le suivi du traitement étant vide : ils seront supprimés.`)
  }
  if (withoutProcessingId.length) {
    await log.warning(`${withoutProcessingId.length} jeu(x) de données marqué(s) "schema-datagouv" mais sans processingId ne sont pas supprimés par ce traitement : vérifiez-les et supprimez-les manuellement si nécessaire.`)
    for (const orphan of withoutProcessingId) {
      await log.warning(`Jeu conservé faute de processingId : "${orphan.datasetTitle}" (${orphan.datasetId}), schéma "${orphan.schemaName}"`)
    }
  }
  return found
}

const capabilitiesOptions = (config: any): CapabilitiesOptions => ({
  mode: config.capabilitiesMode === 'standard' ? 'standard' : 'auto',
  textSearchOnCodes: config.textSearchOnCodes === true,
  restrictLongText: config.restrictLongText !== false,
  vectorTiles: config.vectorTiles === true
})

/** Version du schéma précédemment appliquée, d'après les métadonnées du jeu en place. */
const previousVersion = (live: any, entry: CatalogEntry, fallbackVersion: string): CatalogVersion => {
  const extra = live.extras?.['schema-datagouv']
  const name = extra?.name ?? entry.name
  const versionName = extra?.version ?? fallbackVersion
  return {
    version_name: versionName,
    schema_url: extra?.schemaUrl ?? `https://schema.data.gouv.fr/schemas/${name}/${versionName}/schema.json`
  }
}

const importSchema = async (
  entry: CatalogEntry,
  { config, tracked, axios, log, patchConfig, processingId }: { config: any, tracked: TrackedDataset[], axios: ProcessingContext['axios'], log: ProcessingContext['log'], patchConfig: ProcessingContext['patchConfig'], processingId: string },
  counts: { created: number, updated: number, unchanged: number, skipped: number, failed: number }
) => {
  const version = latestVersion(entry)
  const known = tracked.find(t => t.schemaName === entry.name)
  const expectedTitle = datasetTitle(entry.title)

  await log.info(`Schéma "${entry.title}" (${entry.name}) : dernière version ${version.version_name}${known ? `, jeu de données "${known.datasetTitle}" (${known.datasetId})` : ', nouveau jeu de données'}`)
  const tableSchema = await fetchJSON(version.schema_url)
  const { schema, primaryKey, projection, warnings = [] } = convertTableSchema(tableSchema, capabilitiesOptions(config))
  for (const warning of warnings) {
    await log.warning(`Schéma "${entry.title}" (${entry.name}) : ${warning}`)
  }

  // le lien "conformsTo" est affiché tel quel dans les portails : on pointe vers
  // la page de présentation du schéma, pas vers le fichier JSON (porté par origin)
  const conformsTo = { title: entry.title, version: version.version_name, url: schemaPageUrl(entry.name) }
  const origin = version.schema_url

  if (known) {
    const live = await getDataset(axios, known.datasetId)
    if (!live) {
      await log.warning(`Le jeu de données "${known.datasetTitle}" (${known.datasetId}) n'existe plus, il sera recréé.`)
      tracked.splice(tracked.indexOf(known), 1)
    } else if (live.conformsTo?.version === version.version_name) {
      // le fichier d'un schéma est immuable pour une version donnée : en dehors d'une
      // nouvelle version, on ne répare que ce qui a été perdu (mode master data) ou créé
      // historiquement (titre préfixé en double, concepts absents, lien conformsTo vers
      // le JSON) — jamais les personnalisations du propriétaire du jeu de données
      const repair: Record<string, unknown> = {}
      const mergedSchema = mergeConcepts(live.schema ?? [], schema)
      if (mergedSchema) repair.schema = mergedSchema
      if (needsTitleRepair(live.title ?? '', expectedTitle)) repair.title = expectedTitle
      // projection identifiée par les nouvelles règles (ex. géométries Lambert-93) et absente
      // ou différente sur le jeu en place : on la pose pour que les champs projetés soient exploitables
      if (projection && live.projection?.code !== projection.code) repair.projection = projection
      // les jeux historiques pointaient le JSON du schéma : on ne corrige le lien
      // que s'il porte encore la valeur générée, jamais une personnalisation
      if (live.conformsTo?.url && live.conformsTo.url !== schemaPageUrl(entry.name) && live.conformsTo.url === previousVersion(live, entry, known.version).schema_url) {
        repair.conformsTo = { ...live.conformsTo, url: schemaPageUrl(entry.name) }
      }
      if (repair.schema || repair.title || repair.conformsTo || repair.projection) {
        if (!live.masterData) repair.masterData = { standardSchema: { active: true } }
        await patchSchemaDataset(axios, known.datasetId, repair, known.datasetTitle)
        const reasons = [
          repair.title ? 'titre corrigé' : null,
          repair.schema ? 'concepts ajoutés ou corrigés' : null,
          repair.projection ? 'système de projection défini' : null,
          repair.conformsTo ? 'lien du schéma corrigé' : null
        ].filter(Boolean).join(', ')
        await log.info(`Jeu de données "${known.datasetTitle}" réparé (${reasons})`)
        counts.updated++
        if (repair.title) {
          known.datasetTitle = expectedTitle
          await patchConfig({ createdDatasets: tracked.map(t => ({ ...t })) } as any)
        }
      } else {
        counts.unchanged++
        // le mode master data est réparé s'il a été perdu, jamais s'il a été désactivé volontairement
        if (!live.masterData) {
          await patchSchemaDataset(axios, known.datasetId, { masterData: { standardSchema: { active: true } } }, known.datasetTitle)
          await log.info(`Initialisation de jeux éditables réactivée sur "${known.datasetTitle}"`)
        }
      }
      return
    } else {
      const patch: Record<string, unknown> = { schema, conformsTo, origin }
      if (primaryKey?.length) patch.primaryKey = primaryKey
      if (projection && live.projection?.code !== projection.code) patch.projection = projection
      if (!live.masterData) patch.masterData = { standardSchema: { active: true } }
      if (needsTitleRepair(live.title ?? '', expectedTitle)) {
        patch.title = expectedTitle
        await log.info(`Titre du jeu de données corrigé en "${expectedTitle}"`)
      }
      // résumé/description rafraîchis uniquement s'ils n'ont pas été personnalisés
      Object.assign(patch, metadataPatch(live, entry, previousVersion(live, entry, known.version), version))
      await patchSchemaDataset(axios, known.datasetId, patch, known.datasetTitle)
      known.version = version.version_name
      if (patch.title) known.datasetTitle = expectedTitle
      counts.updated++
      await log.info(`Jeu de données "${known.datasetTitle}" mis à jour vers la version ${version.version_name}`)
      await patchConfig({ createdDatasets: tracked.map(t => ({ ...t })) } as any)
      return
    }
  }

  const payload = {
    title: expectedTitle,
    summary: datasetSummary(entry),
    description: datasetDescription(entry, version),
    schema,
    primaryKey,
    projection,
    conformsTo,
    origin,
    extras: { 'schema-datagouv': { name: entry.name, version: version.version_name, schemaUrl: version.schema_url, processingId } }
  }
  const dataset = await createSchemaDataset(axios, payload, log)
  tracked.push({ schemaName: entry.name, version: version.version_name, datasetId: dataset.id, datasetTitle: dataset.title })
  // enregistré avant de continuer : sans cela une erreur sur un schéma suivant
  // ferait recréer ce jeu de données à la prochaine exécution
  await patchConfig({ createdDatasets: tracked.map(t => ({ ...t })) } as any)
  counts.created++

  if (config.loadExample !== false) {
    await loadExampleData(axios, dataset.id, dataset.title, entry, schema, log)
  }
}
