import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { run, stop } from '../lib/execute.ts'
import { datasetDescription } from '../lib/metadata.ts'
import type { CatalogEntry } from '../lib/catalog.ts'
import { fakeAxios, fakeContext, jsonResponse, textResponse, withFetch } from './helpers/fake.ts'

const schemaUrl = (name: string, version: string) => `https://schema.data.gouv.fr/schemas/${name}/${version}/schema.json`

const entryA: CatalogEntry = {
  name: 'test/schema-a',
  title: 'Schéma A',
  description: 'Description A',
  schema_type: 'tableschema',
  homepage: 'https://example.org/a',
  contact: 'a@example.org',
  examples: [{ title: 'Exemple valide', path: 'https://example.org/a/exemple-valide.csv' }],
  versions: [
    { version_name: '1.0.0', schema_url: schemaUrl('test/schema-a', '1.0.0') },
    { version_name: '1.1.0', schema_url: schemaUrl('test/schema-a', '1.1.0') }
  ]
}

const entryB: CatalogEntry = {
  name: 'test/schema-b',
  title: 'Schéma B',
  description: 'Description B',
  schema_type: 'tableschema',
  versions: [{ version_name: '1.0.0', schema_url: schemaUrl('test/schema-b', '1.0.0') }]
}

const entryOther: CatalogEntry = {
  name: 'test/other',
  title: 'Autre',
  description: 'Autre',
  schema_type: 'jsonschema',
  versions: [{ version_name: '1.0.0', schema_url: schemaUrl('test/other', '1.0.0') }]
}

const catalog = { schemas: [entryA, entryB, entryOther] }

const tableSchema = {
  fields: [
    { name: 'nom', type: 'string' },
    { name: 'siret', type: 'string' },
    { name: 'code_insee', type: 'string' }
  ]
}

const fetchHandler = (overrides: Record<string, () => Response> = {}) => (url: string): Response => {
  if (overrides[url]) return overrides[url]()
  if (url === 'https://schema.data.gouv.fr/schemas.json') return jsonResponse(catalog)
  if (url.endsWith('/schema.json')) return jsonResponse(tableSchema)
  if (url.endsWith('.csv')) return textResponse('nom,siret,code_insee\nA,123,75056\n')
  throw new Error(`fetch inattendu : ${url}`)
}

describe('exécution : création', () => {
  it('crée un jeu par schéma avec résumé, description et capabilities', async () => {
    const created: any[] = []
    const bulkPosts: string[] = []
    const axios = fakeAxios({
      post: async (url, body) => {
        if (url === 'api/v1/datasets') {
          created.push(body)
          return { id: `ds${created.length}`, title: body.title }
        }
        if (url.includes('_bulk_lines')) {
          bulkPosts.push(url)
          return { nbOk: 1, nbErrors: 0 }
        }
        throw new Error(`post inattendu : ${url}`)
      }
    })
    const { context, patches } = fakeContext({
      processingConfig: { importMode: 'select', schemas: ['test/schema-a'], loadExample: true },
      axios
    })

    await withFetch(fetchHandler(), () => run(context))

    assert.equal(created.length, 1)
    assert.equal(created[0].title, 'Schéma A')
    assert.equal(created[0].summary, 'Description A')
    assert.match(created[0].description, /https:\/\/schema\.data\.gouv\.fr\/test\/schema-a\//)
    assert.match(created[0].description, /version 1\.1\.0/)
    assert.deepEqual(created[0].schema.find((p: any) => p.key === 'siret')['x-capabilities'], { text: false, insensitive: false })
    assert.deepEqual(created[0].schema.find((p: any) => p.key === 'code_insee')['x-capabilities'], { text: false, insensitive: false })
    assert.equal(created[0].masterData.standardSchema.active, true)
    assert.equal(created[0].extras['schema-datagouv'].processingId, 'test-processing')

    assert.equal(bulkPosts.length, 1)
    const tracked = (context.processingConfig as any).createdDatasets
    assert.equal(tracked.length, 1)
    assert.equal(tracked[0].schemaName, 'test/schema-a')
    assert.equal(tracked[0].version, '1.1.0')
    assert.ok(patches.some(patch => patch.createdDatasets))
  })

  it('ne charge pas d\'exemple si l\'option est désactivée', async () => {
    const bulkPosts: string[] = []
    const axios = fakeAxios({
      post: async (url, body) => {
        if (url === 'api/v1/datasets') return { id: 'ds1', title: body.title }
        bulkPosts.push(url)
        return { nbOk: 1, nbErrors: 0 }
      }
    })
    const { context } = fakeContext({
      processingConfig: { importMode: 'select', schemas: ['test/schema-a'], loadExample: false },
      axios
    })
    await withFetch(fetchHandler(), () => run(context))
    assert.equal(bulkPosts.length, 0)
  })

  it('importe tous les schémas tabulaires en mode "all"', async () => {
    const created: string[] = []
    const axios = fakeAxios({
      post: async (url, body) => {
        if (url === 'api/v1/datasets') {
          created.push(body.title)
          return { id: `ds${created.length}`, title: body.title }
        }
        return { nbOk: 1, nbErrors: 0 }
      }
    })
    const { context } = fakeContext({ processingConfig: { importMode: 'all' }, axios })
    await withFetch(fetchHandler(), () => run(context))
    assert.deepEqual(created.sort(), ['Schéma A', 'Schéma B'])
  })

  it('ignore un schéma non tabulaire sélectionné', async () => {
    let created = 0
    const axios = fakeAxios({
      post: async (url, body) => {
        if (url === 'api/v1/datasets') { created++; return { id: 'ds1', title: body.title } }
        return { nbOk: 1, nbErrors: 0 }
      }
    })
    const { context, logs } = fakeContext({
      processingConfig: { importMode: 'select', schemas: ['test/other'] },
      axios
    })
    await withFetch(fetchHandler(), () => run(context))
    assert.equal(created, 0)
    assert.ok(logs.some(entry => entry.level === 'warning' && entry.message.includes('non tabulaire')))
  })

  it('échoue globalement si un schéma ne peut pas être converti', async () => {
    const axios = fakeAxios({
      post: async (url, body) => ({ id: 'ds1', title: body.title })
    })
    const { context, logs } = fakeContext({
      processingConfig: { importMode: 'select', schemas: ['test/schema-a'], loadExample: false },
      axios
    })
    await assert.rejects(
      withFetch(fetchHandler({
        [schemaUrl('test/schema-a', '1.1.0')]: () => jsonResponse({ fields: [] })
      }), () => run(context)),
      /1 schéma/
    )
    assert.ok(logs.some(entry => entry.level === 'error' && entry.message.includes('Échec de l\'import')))
  })

  it('s\'interrompt proprement entre deux schémas', async () => {
    const axios = fakeAxios({
      post: async (url, body) => {
        if (url === 'api/v1/datasets') return { id: 'ds1', title: body.title }
        return { nbOk: 1, nbErrors: 0 }
      }
    })
    const { context } = fakeContext({ processingConfig: { importMode: 'all', loadExample: false }, axios })
    const handler = fetchHandler()
    await assert.rejects(
      withFetch(url => {
        if (url === schemaUrl('test/schema-a', '1.1.0')) stop()
        return handler(url)
      }, () => run(context)),
      /interrompu/
    )
  })
})

describe('exécution : mise à jour', () => {
  const trackedConfig = () => ({
    importMode: 'select',
    schemas: ['test/schema-a'],
    loadExample: true,
    createdDatasets: [{ schemaName: 'test/schema-a', version: '1.0.0', datasetId: 'ds1', datasetTitle: 'Schéma A' }]
  })

  it('répare les concepts manquants sans recharger les exemples à version inchangée', async () => {
    const patches: any[] = []
    const axios = fakeAxios({
      get: async () => ({
        id: 'ds1',
        title: 'Schéma A',
        conformsTo: { version: '1.1.0' },
        masterData: { standardSchema: { active: true } },
        schema: [{ key: 'nom', type: 'string' }],
        extras: { 'schema-datagouv': { name: 'test/schema-a', version: '1.1.0', schemaUrl: schemaUrl('test/schema-a', '1.1.0') } }
      }),
      patch: async (url, body) => { patches.push(body) },
      post: async () => { throw new Error('aucun post attendu') }
    })
    const { context } = fakeContext({ processingConfig: trackedConfig(), axios })
    await withFetch(fetchHandler(), () => run(context))
    assert.equal(patches.length, 1)
    const nom = patches[0].schema.find((p: any) => p.key === 'nom')
    assert.equal(nom['x-refersTo'], 'http://www.w3.org/2000/01/rdf-schema#label')
  })

  it('met à jour la version, le schéma et les métadonnées non personnalisées', async () => {
    let patched: any
    const previous = { version_name: '1.0.0', schema_url: schemaUrl('test/schema-a', '1.0.0') }
    const next = { version_name: '1.1.0', schema_url: schemaUrl('test/schema-a', '1.1.0') }
    const axios = fakeAxios({
      get: async () => ({
        id: 'ds1',
        title: 'Schéma A',
        conformsTo: { version: '1.0.0' },
        masterData: { standardSchema: { active: true } },
        summary: 'Description A',
        description: datasetDescription(entryA, previous),
        schema: [],
        extras: { 'schema-datagouv': { name: 'test/schema-a', version: '1.0.0', schemaUrl: previous.schema_url } }
      }),
      patch: async (url, body) => { patched = body },
      post: async () => { throw new Error('aucun post attendu') }
    })
    const { context } = fakeContext({ processingConfig: trackedConfig(), axios })
    await withFetch(fetchHandler(), () => run(context))
    assert.equal(patched.conformsTo.version, '1.1.0')
    assert.equal(patched.description, datasetDescription(entryA, next))
    assert.equal(patched.summary, undefined)
    assert.equal((context.processingConfig as any).createdDatasets[0].version, '1.1.0')
  })

  it('ne touche pas aux métadonnées personnalisées', async () => {
    let patched: any
    const axios = fakeAxios({
      get: async () => ({
        id: 'ds1',
        title: 'Schéma A',
        conformsTo: { version: '1.0.0' },
        masterData: { standardSchema: { active: true } },
        summary: 'Mon résumé',
        description: 'Ma description',
        schema: [],
        extras: { 'schema-datagouv': { name: 'test/schema-a', version: '1.0.0', schemaUrl: schemaUrl('test/schema-a', '1.0.0') } }
      }),
      patch: async (url, body) => { patched = body },
      post: async () => { throw new Error('aucun post attendu') }
    })
    const { context } = fakeContext({ processingConfig: trackedConfig(), axios })
    await withFetch(fetchHandler(), () => run(context))
    assert.equal(patched.description, undefined)
    assert.equal(patched.summary, undefined)
  })

  it('recrée le jeu de données s\'il a été supprimé', async () => {
    const created: any[] = []
    const axios = fakeAxios({
      get: async () => null,
      post: async (url, body) => {
        if (url === 'api/v1/datasets') { created.push(body); return { id: 'ds2', title: body.title } }
        return { nbOk: 1, nbErrors: 0 }
      }
    })
    const { context } = fakeContext({ processingConfig: trackedConfig(), axios })
    await withFetch(fetchHandler(), () => run(context))
    assert.equal(created.length, 1)
    assert.equal((context.processingConfig as any).createdDatasets[0].datasetId, 'ds2')
  })
})

describe('exécution : suppression', () => {
  const deletedConfig = () => ({
    action: 'delete',
    importMode: 'select',
    schemas: ['test/schema-a'],
    createdDatasets: [
      { schemaName: 'test/schema-a', version: '1.1.0', datasetId: 'ds1', datasetTitle: 'Schéma A' },
      { schemaName: 'test/schema-b', version: '1.0.0', datasetId: 'ds2', datasetTitle: 'Schéma B' }
    ]
  })

  const noFetch = () => { throw new Error('aucun fetch attendu') }

  it('supprime tous les jeux suivis, vide le suivi et revient à l\'import', async () => {
    const deleted: string[] = []
    const axios = fakeAxios({
      delete: async url => { deleted.push(url) },
      post: async () => { throw new Error('aucun post attendu') }
    })
    const { context, patches, logs } = fakeContext({ processingConfig: deletedConfig(), axios })

    await withFetch(noFetch, () => run(context))

    assert.deepEqual(deleted.sort(), ['api/v1/datasets/ds1', 'api/v1/datasets/ds2'])
    assert.deepEqual((context.processingConfig as any).createdDatasets, [])
    assert.equal((context.processingConfig as any).action, 'import')
    assert.ok(patches.some(patch => patch.action === 'import' && Array.isArray(patch.createdDatasets) && patch.createdDatasets.length === 0))
    assert.ok(logs.some(entry => entry.level === 'info' && entry.message.includes('2 supprimé(s)')))
  })

  it('ignore un jeu déjà supprimé manuellement (404)', async () => {
    const axios = fakeAxios({
      delete: async () => { throw Object.assign(new Error('not found'), { response: { status: 404 } }) }
    })
    const { context, logs } = fakeContext({ processingConfig: deletedConfig(), axios })

    await withFetch(noFetch, () => run(context))

    assert.deepEqual((context.processingConfig as any).createdDatasets, [])
    assert.equal((context.processingConfig as any).action, 'import')
    assert.ok(logs.some(entry => entry.level === 'info' && entry.message.includes('déjà absent')))
  })

  it('conserve les jeux en échec pour un nouvel essai', async () => {
    const axios = fakeAxios({
      delete: async url => {
        if (url.endsWith('/ds2')) throw Object.assign(new Error('boom'), { response: { status: 500 } })
      }
    })
    const { context, patches, logs } = fakeContext({ processingConfig: deletedConfig(), axios })

    await withFetch(noFetch, () => assert.rejects(run(context), /1 jeu/))

    const remaining = (context.processingConfig as any).createdDatasets
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].datasetId, 'ds2')
    assert.equal((context.processingConfig as any).action, 'delete')
    assert.ok(!patches.some(patch => patch.action === 'import'))
    assert.ok(logs.some(entry => entry.level === 'error' && entry.message.includes('Échec de la suppression')))
  })

  it('ne fait rien s\'il n\'y a aucun jeu suivi', async () => {
    let deleted = 0
    const axios = fakeAxios({
      get: async () => ({ results: [] }),
      delete: async () => { deleted++ }
    })
    const { context } = fakeContext({ processingConfig: { action: 'delete' }, axios })

    await withFetch(noFetch, () => run(context))

    assert.equal(deleted, 0)
    assert.equal((context.processingConfig as any).action, 'import')
  })

  it('retrouve les jeux créés via leurs métadonnées quand le suivi est vide', async () => {
    const deleted: string[] = []
    const axios = fakeAxios({
      get: async url => {
        assert.match(url, /^api\/v1\/datasets\?.*select=id,title,extras/)
        return {
          results: [
            { id: 'ds1', title: 'Schéma A', extras: { 'schema-datagouv': { name: 'test/schema-a', version: '1.1.0' } } },
            { id: 'ds2', title: 'Schéma B', extras: { 'schema-datagouv': { name: 'test/schema-b', version: '1.0.0', processingId: 'test-processing' } } },
            { id: 'ds3', title: 'Autre', extras: {} }
          ]
        }
      },
      delete: async url => { deleted.push(url) }
    })
    const { context, logs } = fakeContext({ processingConfig: { action: 'delete' }, axios })

    await withFetch(noFetch, () => run(context))

    assert.deepEqual(deleted.sort(), ['api/v1/datasets/ds1', 'api/v1/datasets/ds2'])
    assert.deepEqual((context.processingConfig as any).createdDatasets, [])
    assert.equal((context.processingConfig as any).action, 'import')
    assert.ok(logs.some(entry => entry.level === 'warning' && entry.message.includes('métadonnées')))
  })

  it('ignore les jeux suivis par un autre traitement', async () => {
    let deleted = 0
    const axios = fakeAxios({
      get: async () => ({
        results: [{
          id: 'ds1',
          title: 'Schéma A',
          extras: { 'schema-datagouv': { name: 'test/schema-a', version: '1.1.0', processingId: 'autre-traitement' } }
        }]
      }),
      delete: async () => { deleted++ }
    })
    const { context } = fakeContext({ processingConfig: { action: 'delete' }, axios })

    await withFetch(noFetch, () => run(context))

    assert.equal(deleted, 0)
    assert.equal((context.processingConfig as any).action, 'import')
  })

  it('ne recherche pas les jeux quand le suivi est renseigné', async () => {
    let gets = 0
    const axios = fakeAxios({
      get: async () => { gets++; return { results: [] } },
      delete: async () => {}
    })
    const { context } = fakeContext({ processingConfig: deletedConfig(), axios })

    await withFetch(noFetch, () => run(context))

    assert.equal(gets, 0)
  })
})
