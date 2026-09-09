import type { PrepareFunction } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'

/**
 * Ce traitement n'utilise aucune donnée sensible : la préparation n'a rien à valider
 * ni à déplacer dans les secrets.
 */
const prepare: PrepareFunction<ProcessingConfig> = async ({ processingConfig, secrets }) => ({ processingConfig, secrets })

export default prepare
