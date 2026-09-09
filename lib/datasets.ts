/**
 * Création et mise à jour des jeux de données éditables (REST) qui portent les schémas importés.
 */
import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import FormData from 'form-data'
import { promisify } from 'node:util'
import type { DatasetSchemaProperty } from './convert.ts'

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
 * Charge le fichier d'exemple publié avec le schéma comme premières lignes du jeu.
 * Un échec n'interrompt pas le traitement : le schéma reste l'apport principal.
 */
export const loadExampleData = async (axios: AxiosInstance, datasetId: string, datasetTitle: string, exampleUrl: string, log: LogFunctions): Promise<void> => {
  let text: string
  try {
    const res = await fetch(exampleUrl, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) throw new Error(`erreur HTTP ${res.status}`)
    text = await res.text()
  } catch (err: any) {
    await log.warning(`Impossible de récupérer les données d'exemple de "${datasetTitle}" (${exampleUrl}) : ${err.message}`)
    return
  }
  const header = text.slice(0, text.indexOf('\n'))
  const sep = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ';' : ','
  const formData = new FormData()
  formData.append('actions', Buffer.from(text), { filename: 'example.csv' })
  const contentLength = await promisify(formData.getLength.bind(formData))()
  try {
    const result = (await axios.post(
      `api/v1/datasets/${datasetId}/_bulk_lines?sep=${encodeURIComponent(sep)}`,
      formData,
      { maxContentLength: Infinity, maxBodyLength: Infinity, headers: { ...formData.getHeaders(), 'content-length': contentLength } }
    )).data
    await log.info(`Données d'exemple chargées dans "${datasetTitle}" : ${result.nbOk} ligne(s) ok, ${result.nbErrors} en erreur`)
    if (result.nbErrors) {
      const first = (result.errors ?? [])[0]
      await log.warning(`Lignes d'exemple en erreur dans "${datasetTitle}"${first ? ` : ${JSON.stringify(first)}` : ''}`)
    }
  } catch (err: any) {
    await log.warning(`Échec du chargement des données d'exemple dans "${datasetTitle}" : ${describeError(err)}`)
  }
}
