import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { createSchemaDataset, loadExampleData, patchSchemaDataset } from '../lib/datasets.ts'
import type { CatalogEntry } from '../lib/catalog.ts'
import type { DatasetSchemaProperty } from '../lib/convert.ts'
import { fakeAxios, fakeLog, textResponse, binaryResponse, withFetch } from './helpers/fake.ts'

const entry = (examples: CatalogEntry['examples']): CatalogEntry => ({
  name: 'test/schema',
  title: 'Schéma de test',
  versions: [],
  examples
})

const schema: DatasetSchemaProperty[] = [
  { key: 'nom', title: 'Nom', type: 'string', 'x-originalName': 'nom' },
  { key: 'latitude', title: 'Latitude', type: 'number', 'x-originalName': 'latitude' }
]

describe('création d\'un jeu de données', () => {
  it('transmet résumé, description et activation master data', async () => {
    let body: any
    const axios = fakeAxios({
      post: async (url, payload) => {
        assert.equal(url, 'api/v1/datasets')
        body = payload
        return { id: 'ds1', title: payload.title }
      }
    })
    const { log } = fakeLog()
    const dataset = await createSchemaDataset(axios, {
      title: 'Schéma de test',
      summary: 'Un résumé',
      description: 'Une description',
      schema,
      conformsTo: { title: 'Test', version: '1.0.0', url: 'https://example.org/schema.json' },
      origin: 'https://example.org/schema.json',
      extras: { 'schema-datagouv': {} }
    }, log)
    assert.deepEqual(dataset, { id: 'ds1', title: 'Schéma de test' })
    assert.equal(body.summary, 'Un résumé')
    assert.equal(body.description, 'Une description')
    assert.equal(body.isRest, true)
    assert.deepEqual(body.masterData, { standardSchema: { active: true } })
  })

  it('recrée sans master data si la permission est absente', async () => {
    const bodies: any[] = []
    const axios = fakeAxios({
      post: async (url, payload) => {
        bodies.push(JSON.parse(JSON.stringify(payload)))
        if (bodies.length === 1) {
          const err: any = new Error('Forbidden')
          err.response = { status: 403 }
          throw err
        }
        return { id: 'ds1', title: payload.title }
      }
    })
    const { log, logs } = fakeLog()
    await createSchemaDataset(axios, {
      title: 'Schéma de test',
      schema,
      conformsTo: { title: 'Test', version: '1.0.0', url: 'https://example.org/schema.json' },
      origin: 'https://example.org/schema.json',
      extras: {}
    }, log)
    assert.equal(bodies.length, 2)
    assert.equal(bodies[0].masterData !== undefined, true)
    assert.equal(bodies[1].masterData, undefined)
    assert.ok(logs.some(entry => entry.level === 'warning' && entry.message.includes('manageMasterData')))
  })

  it('remonte une erreur de création explicite', async () => {
    const axios = fakeAxios({
      post: async () => {
        const err: any = new Error('Bad Request')
        err.response = { status: 400, data: { message: 'schéma invalide' } }
        throw err
      }
    })
    const { log } = fakeLog()
    await assert.rejects(
      createSchemaDataset(axios, {
        title: 'Schéma de test',
        schema,
        conformsTo: { title: 'Test', version: '1.0.0', url: 'https://example.org/schema.json' },
        origin: 'https://example.org/schema.json',
        extras: {}
      }, log),
      /Échec de la création du jeu de données "Schéma de test".*schéma invalide/
    )
  })
})

describe('mise à jour d\'un jeu de données', () => {
  it('remonte une erreur de patch explicite', async () => {
    const axios = fakeAxios({
      patch: async () => {
        const err: any = new Error('Conflict')
        err.response = { status: 409, data: 'conflit' }
        throw err
      }
    })
    await assert.rejects(
      patchSchemaDataset(axios, 'ds1', { title: 'x' }, 'Schéma de test'),
      /Échec de la mise à jour du jeu de données "Schéma de test".*conflit/
    )
  })
})

describe('chargement des données d\'exemple', () => {
  it('charge un CSV valide en normalisant l\'en-tête', async () => {
    const posted: { url: string, buffer: string }[] = []
    const axios = fakeAxios({
      post: async (url, body) => {
        posted.push({ url, buffer: body.getBuffer().toString('utf8') })
        return { nbOk: 2, nbErrors: 0 }
      }
    })
    const { log } = fakeLog()
    const ok = await withFetch(
      () => textResponse('Nom,Latitude\nA,1.5\n'),
      () => loadExampleData(axios, 'ds1', 'Schéma de test', entry([
        { title: 'Exemple valide', path: 'https://example.org/exemple-valide.csv' }
      ]), schema, log)
    )
    assert.equal(ok, true)
    assert.equal(posted.length, 1)
    assert.match(posted[0].url, /_bulk_lines\?sep=%2C/)
    assert.match(posted[0].buffer, /nom,latitude/)
  })

  it('supprime le BOM avant l\'envoi', async () => {
    let buffer = Buffer.alloc(0)
    const axios = fakeAxios({
      post: async (url, body) => {
        buffer = body.getBuffer()
        return { nbOk: 1, nbErrors: 0 }
      }
    })
    const { log } = fakeLog()
    await withFetch(
      () => textResponse('\uFEFFnom,latitude\nA,1.5\n'),
      () => loadExampleData(axios, 'ds1', 'Schéma de test', entry([
        { title: 'Exemple valide', path: 'https://example.org/exemple-valide.csv' }
      ]), schema, log)
    )
    assert.notEqual(buffer.subarray(0, 3).toString('hex'), 'efbbbf')
  })

  it('ignore un exemple aux colonnes inconnues sans appeler l\'API', async () => {
    let posted = false
    const axios = fakeAxios({ post: async () => { posted = true; return {} } })
    const { log, logs } = fakeLog()
    const ok = await withFetch(
      () => textResponse('nom,inconnu\nA,B\n'),
      () => loadExampleData(axios, 'ds1', 'Schéma de test', entry([
        { title: 'Exemple valide', path: 'https://example.org/exemple-valide.csv' }
      ]), schema, log)
    )
    assert.equal(ok, false)
    assert.equal(posted, false)
    assert.ok(logs.some(entry => entry.level === 'warning' && entry.message.includes('colonnes inconnues')))
  })

  it('privilégie l\'exemple valide même s\'il est déclaré après', async () => {
    const fetched: string[] = []
    const axios = fakeAxios({ post: async () => ({ nbOk: 1, nbErrors: 0 }) })
    const { log } = fakeLog()
    await withFetch(
      url => {
        fetched.push(url)
        return textResponse('nom,latitude\nA,1.5\n')
      },
      () => loadExampleData(axios, 'ds1', 'Schéma de test', entry([
        { title: 'Exemple invalide', path: 'https://example.org/exemple-invalide.csv' },
        { title: 'Exemple valide', path: 'https://example.org/exemple-valide.csv' }
      ]), schema, log)
    )
    assert.match(fetched[0], /exemple-valide\.csv$/)
  })

  it('essaie le candidat suivant après un échec de l\'API', async () => {
    let posts = 0
    const axios = fakeAxios({
      post: async () => {
        posts++
        if (posts === 1) {
          const err: any = new Error('Request failed with status code 400')
          err.response = { status: 400, data: { nbOk: 0, nbErrors: 1 } }
          throw err
        }
        return { nbOk: 3, nbErrors: 0 }
      }
    })
    const { log } = fakeLog()
    const ok = await withFetch(
      () => textResponse('nom,latitude\nA,1.5\n'),
      () => loadExampleData(axios, 'ds1', 'Schéma de test', entry([
        { title: 'Exemple valide', path: 'https://example.org/exemple-valide.csv' },
        { title: 'Autre exemple', path: 'https://example.org/autre.csv' }
      ]), schema, log)
    )
    assert.equal(ok, true)
    assert.equal(posts, 2)
  })

  it('ignore une page HTML', async () => {
    const axios = fakeAxios({ post: async () => { throw new Error('ne doit pas être appelé') } })
    const { log, logs } = fakeLog()
    const ok = await withFetch(
      () => textResponse('<html></html>', 'text/html'),
      () => loadExampleData(axios, 'ds1', 'Schéma de test', entry([
        { title: 'Exemple valide', path: 'https://example.org/exemple-valide.csv' }
      ]), schema, log)
    )
    assert.equal(ok, false)
    assert.ok(logs.some(entry => entry.level === 'warning' && entry.message.includes('page HTML')))
  })

  it('transmet un tableur avec son nom et son type d\'origine', async () => {
    let buffer = ''
    const axios = fakeAxios({
      post: async (url, body) => {
        buffer = body.getBuffer().toString('latin1')
        return { nbOk: 1, nbErrors: 0 }
      }
    })
    const { log } = fakeLog()
    await withFetch(
      () => binaryResponse(Buffer.from('PK\u0003\u0004fake'), 'application/octet-stream'),
      () => loadExampleData(axios, 'ds1', 'Schéma de test', entry([
        { title: 'Exemple valide (XLSX)', path: 'https://example.org/exemple-valide.xlsx' }
      ]), schema, log)
    )
    assert.match(buffer, /filename="example\.xlsx"/)
    assert.match(buffer, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/)
  })
})
