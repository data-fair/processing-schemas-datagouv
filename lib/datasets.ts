/**
 * Création et mise à jour des jeux de données éditables (REST) qui portent les schémas importés.
 */
import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import FormData from 'form-data'
import { promisify } from 'node:util'
import type { CatalogEntry } from './catalog.ts'
import type { DatasetSchemaProperty } from './convert.ts'
import { exampleCandidates, fetchExample, prepareExample, type PreparedExample } from './examples.ts'

/** Axios masque la raison renvoyée par data-fair dans response.data ; JSON.stringify(err) la perd. */
export const describeError = (err: any): string => {
  const detail = err.response?.data
  const body = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : ''
  return body ? `${err.message} : ${body}` : err.message
}

const SCHEMA_TITLE_RE = /^sch[ée]ma\b/i
const DOUBLED_SCHEMA_TITLE_RE = /^sch[ée]ma\s+sch[ée]ma\b/i

/**
 * Titre du jeu de données porteur d'un schéma du catalogue.
 * Certains titres du catalogue commencent déjà par « Schéma » : ne pas doubler le préfixe.
 */
export const datasetTitle = (catalogTitle: string): string => {
  const trimmed = catalogTitle.trim()
  return SCHEMA_TITLE_RE.test(trimmed) ? trimmed : `Schéma ${trimmed}`
}

/**
 * Le titre historiquement buggy « Schéma Schéma... » est réparé, mais pas les titres
 * personnalisés par le propriétaire du jeu de données.
 */
export const needsTitleRepair = (liveTitle: string, expectedTitle: string): boolean =>
  liveTitle.trim() !== expectedTitle && DOUBLED_SCHEMA_TITLE_RE.test(liveTitle.trim())

export interface CreateDatasetPayload {
  title: string
  summary?: string
  description?: string
  schema: DatasetSchemaProperty[]
  primaryKey?: string[]
  conformsTo: { title: string, version: string, url: string }
  origin: string
  extras: Record<string, unknown>
}

/**
 * Crée le jeu de données éditable porteur du schéma.
 *
 * Le jeu est déclaré "master data" avec l'initialisation de jeux éditables activée :
 * d'autres jeux pourront être initialisés avec son schéma. Si le propriétaire du
 * traitement n'a pas la permission manageMasterData, le jeu est créé sans cette
 * activation, avec un avertissement.
 */
export const createSchemaDataset = async (axios: AxiosInstance, payload: CreateDatasetPayload, log: LogFunctions): Promise<{ id: string, title: string }> => {
  const body: any = {
    isRest: true,
    title: payload.title,
    summary: payload.summary,
    description: payload.description,
    schema: payload.schema,
    conformsTo: payload.conformsTo,
    origin: payload.origin,
    extras: payload.extras,
    masterData: { standardSchema: { active: true } }
  }
  if (payload.primaryKey?.length) body.primaryKey = payload.primaryKey
  try {
    const dataset = (await axios.post('api/v1/datasets', body)).data
    await log.info(`Jeu de données créé : ${dataset.title} (${dataset.id})`)
    return { id: dataset.id, title: dataset.title }
  } catch (err: any) {
    if (err.response?.status === 403) {
      await log.warning(`Permission "manageMasterData" manquante pour le propriétaire du traitement : le jeu "${payload.title}" sera créé sans activation de l'initialisation de jeux éditables.`)
      delete body.masterData
      const dataset = (await axios.post('api/v1/datasets', body)).data
      await log.info(`Jeu de données créé : ${dataset.title} (${dataset.id})`)
      return { id: dataset.id, title: dataset.title }
    }
    throw new Error(`Échec de la création du jeu de données "${payload.title}" : ${describeError(err)}`)
  }
}

export const getDataset = async (axios: AxiosInstance, id: string): Promise<any | null> => {
  try {
    return (await axios.get(`api/v1/datasets/${id}`)).data
  } catch (err: any) {
    if (err.response?.status === 404) return null
    throw new Error(describeError(err))
  }
}

/**
 * Mise à jour du schéma et des métadonnées de provenance d'un jeu existant.
 * Le titre et la description sont laissés au propriétaire du jeu.
 */
export const patchSchemaDataset = async (axios: AxiosInstance, id: string, patch: Record<string, unknown>, title: string): Promise<void> => {
  try {
    await axios.patch(`api/v1/datasets/${id}`, patch)
  } catch (err: any) {
    throw new Error(`Échec de la mise à jour du jeu de données "${title}" : ${describeError(err)}`)
  }
}

/**
 * Supprime un jeu de données.
 *
 * Renvoie `false` s'il a déjà été supprimé manuellement (404), pour que le suivi
 * du traitement puisse être nettoyé sans échouer.
 */
export const deleteDataset = async (axios: AxiosInstance, id: string, title: string): Promise<boolean> => {
  try {
    await axios.delete(`api/v1/datasets/${id}`)
    return true
  } catch (err: any) {
    if (err.response?.status === 404) return false
    throw new Error(`Échec de la suppression du jeu de données "${title}" : ${describeError(err)}`)
  }
}

/**
 * Charge le fichier d'exemple publié avec le schéma comme premières lignes du jeu.
 *
 * Les exemples du catalogue sont hétérogènes (liens HTML, exemples invalides ou
 * obsolètes) : chaque candidat est pré-validé localement et les candidats
 * inexploitables sont ignorés avec un avertissement explicite, plutôt que de
 * laisser l'API répondre 400. Un échec n'interrompt pas le traitement : le
 * schéma reste l'apport principal.
 */
export const loadExampleData = async (
  axios: AxiosInstance,
  datasetId: string,
  datasetTitle: string,
  entry: CatalogEntry,
  schema: DatasetSchemaProperty[],
  log: LogFunctions
): Promise<boolean> => {
  const candidates = exampleCandidates(entry)
  if (!candidates.length) return false

  for (const candidate of candidates) {
    let prepared: PreparedExample
    try {
      prepared = prepareExample(await fetchExample(candidate.url), schema)
    } catch (err: any) {
      await log.warning(`Données d'exemple ignorées pour "${datasetTitle}" (${candidate.url}) : ${err.message}`)
      continue
    }

    try {
      const result = await postExample(axios, datasetId, prepared)
      const nbOk = result?.nbOk ?? 0
      const nbErrors = result?.nbErrors ?? 0
      if (nbOk > 0) {
        await log.info(`Données d'exemple chargées dans "${datasetTitle}" depuis ${candidate.url} : ${nbOk} ligne(s) ok, ${nbErrors} en erreur`)
        if (nbErrors) {
          const first = (result.errors ?? [])[0]
          await log.warning(`Lignes d'exemple en erreur dans "${datasetTitle}"${first ? ` : ${JSON.stringify(first)}` : ''}`)
        }
        return true
      }
      const first = (result?.errors ?? [])[0]
      await log.warning(`Aucune ligne d'exemple chargée dans "${datasetTitle}" depuis ${candidate.url}${first ? ` : ${JSON.stringify(first)}` : ''}`)
    } catch (err: any) {
      await log.warning(`Échec du chargement des données d'exemple dans "${datasetTitle}" depuis ${candidate.url} : ${describeError(err)}`)
    }
  }
  return false
}

const postExample = async (axios: AxiosInstance, datasetId: string, prepared: PreparedExample): Promise<any> => {
  const formData = new FormData()
  if (prepared.kind === 'csv') {
    formData.append('actions', Buffer.from(prepared.text), { filename: 'example.csv', contentType: 'text/csv' })
  } else {
    // le nom et le content-type d'origine permettent à data-fair de convertir le tableur
    formData.append('actions', prepared.buffer, { filename: prepared.fileName, contentType: prepared.mimeType })
  }
  const contentLength = await promisify(formData.getLength.bind(formData))()
  const separator = prepared.kind === 'csv' ? prepared.separator : ','
  return (await axios.post(
    `api/v1/datasets/${datasetId}/_bulk_lines?sep=${encodeURIComponent(separator)}`,
    formData,
    { maxContentLength: Infinity, maxBodyLength: Infinity, headers: { ...formData.getHeaders(), 'content-length': contentLength } }
  )).data
}
