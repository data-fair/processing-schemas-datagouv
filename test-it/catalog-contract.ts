import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { fetchCatalog, latestVersion, tabularEntries } from '../lib/catalog.ts'
import { convertTableSchema } from '../lib/convert.ts'
import { exampleCandidates } from '../lib/examples.ts'
import { COORD_X_CONCEPT, COORD_Y_CONCEPT, GEOMETRY_PROJ_CONCEPT } from '../lib/concepts.ts'

/** Projections supportées par data-fair (cf. api/contract/projections.js). */
const SUPPORTED_PROJECTIONS = ['EPSG:2154', 'EPSG:27572', 'EPSG:3857', 'EPSG:32620', 'EPSG:5490', 'EPSG:4326']

// Test de contrat avec le catalogue réel : désactivé par défaut pour ne pas
// dépendre du réseau en intégration continue.
// Lancer avec : CATALOG_TEST=1 npm test
const enabled = process.env.CATALOG_TEST === '1'

describe('contrat avec le catalogue schema.data.gouv.fr', { skip: enabled ? false : 'CATALOG_TEST=1 pour activer' }, () => {
  it('convertit tous les schémas tabulaires du catalogue', async () => {
    const entries = tabularEntries(await fetchCatalog())
    assert.ok(entries.length > 0)
    for (const entry of entries) {
      const tableSchema = await (await fetch(latestVersion(entry).schema_url)).json()
      const { schema } = convertTableSchema(tableSchema)
      assert.ok(schema.length > 0, `aucun champ converti pour ${entry.name}`)
      // les clés doivent être des clés data-fair : pas de point (chemin imbriqué)
      // et pas de collision après normalisation
      const keys = new Set<string>()
      for (const property of schema) {
        assert.match(property.key, /^[a-z0-9][a-z0-9_]*$/, `clé non normalisée pour ${entry.name} : ${property.key}`)
        assert.ok(!keys.has(property.key), `clé dupliquée pour ${entry.name} : ${property.key}`)
        keys.add(property.key)
      }
    }
  })

  it('n\'annote les concepts projetés qu\'avec une projection supportée', async () => {
    const entries = tabularEntries(await fetchCatalog())
    for (const entry of entries) {
      const tableSchema = await (await fetch(latestVersion(entry).schema_url)).json()
      const { schema, projection } = convertTableSchema(tableSchema)
      for (const property of schema) {
        const projected = [GEOMETRY_PROJ_CONCEPT, COORD_X_CONCEPT, COORD_Y_CONCEPT].includes(property['x-refersTo'] as string)
        if (projected) {
          assert.ok(projection, `projection manquante pour ${entry.name} (${property.key})`)
          assert.ok(SUPPORTED_PROJECTIONS.includes(projection!.code), `projection non supportée pour ${entry.name} : ${projection!.code}`)
        }
      }
      if (projection) {
        assert.ok(SUPPORTED_PROJECTIONS.includes(projection.code), `projection non supportée pour ${entry.name} : ${projection.code}`)
      }
    }
  })

  it('normalise les URLs des exemples du catalogue', async () => {
    const entries = tabularEntries(await fetchCatalog())
    for (const entry of entries) {
      for (const candidate of exampleCandidates(entry)) {
        assert.ok(!candidate.url.includes('/blob/'), `URL non normalisée pour ${entry.name} : ${candidate.url}`)
        assert.match(candidate.url, /^https:\/\//, `URL invalide pour ${entry.name} : ${candidate.url}`)
      }
    }
  })
})
