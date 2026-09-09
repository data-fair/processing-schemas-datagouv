import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'
import { fetchCatalog, fetchJSON, latestVersion, tabularEntries, type CatalogEntry } from './catalog.ts'
import { convertTableSchema } from './convert.ts'
import { mergeConcepts } from './concepts.ts'
import { createSchemaDataset, datasetTitle, describeError, getDataset, loadExampleData, needsTitleRepair, patchSchemaDataset } from './datasets.ts'

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
  const { processingConfig, axios, log, patchConfig } = context
  const config = processingConfig as any

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
      await importSchema(entry, { config, tracked, axios, log, patchConfig }, counts)
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

const importSchema = async (
  entry: CatalogEntry,
  { config, tracked, axios, log, patchConfig }: { config: any, tracked: TrackedDataset[], axios: ProcessingContext['axios'], log: ProcessingContext['log'], patchConfig: ProcessingContext['patchConfig'] },
  counts: { created: number, updated: number, unchanged: number, skipped: number, failed: number }
) => {
  const version = latestVersion(entry)
  const known = tracked.find(t => t.schemaName === entry.name)
  const expectedTitle = datasetTitle(entry.title)

  await log.info(`Schéma "${entry.title}" (${entry.name}) : dernière version ${version.version_name}${known ? `, jeu de données "${known.datasetTitle}" (${known.datasetId})` : ', nouveau jeu de données'}`)
  const tableSchema = await fetchJSON(version.schema_url)
  const { schema, primaryKey } = convertTableSchema(tableSchema)

  const conformsTo = { title: entry.title, version: version.version_name, url: version.schema_url }
  const origin = version.schema_url

  if (known) {
    const live = await getDataset(axios, known.datasetId)
    if (!live) {
      await log.warning(`Le jeu de données "${known.datasetTitle}" (${known.datasetId}) n'existe plus, il sera recréé.`)
      tracked.splice(tracked.indexOf(known), 1)
    } else if (live.conformsTo?.version === version.version_name) {
      // le fichier d'un schéma est immuable pour une version donnée : en dehors d'une
      // nouvelle version, on ne répare que ce qui a été perdu (mode master data) ou créé
      // historiquement (titre préfixé en double, concepts absents) — jamais les
      // personnalisations du propriétaire du jeu de données
      const repair: Record<string, unknown> = {}
      const mergedSchema = mergeConcepts(live.schema ?? [], schema)
      if (mergedSchema) repair.schema = mergedSchema
      if (needsTitleRepair(live.title ?? '', expectedTitle)) repair.title = expectedTitle
      if (repair.schema || repair.title) {
        if (!live.masterData) repair.masterData = { standardSchema: { active: true } }
        await patchSchemaDataset(axios, known.datasetId, repair, known.datasetTitle)
        const reasons = [repair.title ? 'titre corrigé' : null, repair.schema ? 'concepts ajoutés' : null].filter(Boolean).join(', ')
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
      if (!live.masterData) patch.masterData = { standardSchema: { active: true } }
      if (needsTitleRepair(live.title ?? '', expectedTitle)) {
        patch.title = expectedTitle
        await log.info(`Titre du jeu de données corrigé en "${expectedTitle}"`)
      }
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
    description: [entry.description, `Schéma importé de [schema.data.gouv.fr](https://schema.data.gouv.fr), version ${version.version_name}.`].filter(Boolean).join('\n\n'),
    schema,
    primaryKey,
    conformsTo,
    origin,
    extras: { 'schema-datagouv': { name: entry.name, version: version.version_name, schemaUrl: version.schema_url } }
  }
  const dataset = await createSchemaDataset(axios, payload, log)
  tracked.push({ schemaName: entry.name, version: version.version_name, datasetId: dataset.id, datasetTitle: dataset.title })
  // enregistré avant de continuer : sans cela une erreur sur un schéma suivant
  // ferait recréer ce jeu de données à la prochaine exécution
  await patchConfig({ createdDatasets: tracked.map(t => ({ ...t })) } as any)
  counts.created++

  if (config.loadExample !== false && entry.examples?.[0]?.path) {
    await loadExampleData(axios, dataset.id, dataset.title, entry.examples[0].path!, log)
  }
}
