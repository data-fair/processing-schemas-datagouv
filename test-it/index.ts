import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import testUtils from '@data-fair/lib-processing-dev/tests-utils.js'
import processingConfigSchema from '../processing-config-schema.json' with { type: 'json' }
import * as schemasDatagouv from '../index.ts'
import { convertField, convertTableSchema } from '../lib/convert.ts'
import { latestVersion, tabularEntries } from '../lib/catalog.ts'

// #config refuses to load without a data-fair instance declared in
// config/local-test.mjs, which is gitignored: the integration test is then skipped
let config: any = null
try {
  config = (await import('#config')).default
} catch {
  config = null
}

describe('processing-schemas-datagouv', () => {
  it('expose son schéma de configuration', () => {
    assert.ok(processingConfigSchema)
    assert.equal(processingConfigSchema.type, 'object')
    assert.equal(processingConfigSchema.layout, 'tabs')
  })

  it('expose les hooks attendus par la plateforme', () => {
    assert.equal(typeof schemasDatagouv.run, 'function')
    assert.equal(typeof schemasDatagouv.prepare, 'function')
    assert.equal(typeof schemasDatagouv.stop, 'function')
  })

  it('ne déplace aucun secret en préparation', async () => {
    const processingConfig: any = { importMode: 'select', schemas: ['etalab/schema-irve-statique'] }
    const secrets = {}
    const result = await schemasDatagouv.prepare({ processingConfig, secrets })
    assert.deepEqual(result.secrets, {})
    assert.equal((result.processingConfig as any).schemas[0], 'etalab/schema-irve-statique')
  })

  describe('conversion des table schemas', () => {
    it('convertit les types courants', () => {
      const property = convertField({ name: 'date_decision', title: 'Date de décision', description: 'La date', type: 'date' })
      assert.equal(property.key, 'date_decision')
      assert.equal(property.title, 'Date de décision')
      assert.equal(property.type, 'string')
      assert.equal(property.format, 'date')
      assert.equal(property['x-originalName'], 'date_decision')
      assert.equal(property.description, 'La date')
    })

    it('dégrade les types non tabulaires en chaîne', () => {
      for (const type of ['time', 'yearmonth', 'geopoint', 'geojson', 'object', 'array', 'duration', 'any', 'type_inconnu']) {
        const property = convertField({ name: 'champ', type })
        assert.equal(property.type, 'string')
        assert.equal(property.format, undefined)
      }
    })

    it('convertit les contraintes', () => {
      const property = convertField({
        name: 'siret',
        type: 'string',
        constraints: { required: true, minLength: 14, maxLength: 14, pattern: '^\\d{14}$' }
      })
      assert.equal(property['x-required'], true)
      assert.equal(property.minLength, 14)
      assert.equal(property.maxLength, 14)
      assert.equal(property.pattern, '^\\d{14}$')
    })

    it('ne porte les bornes numériques que sur les champs numériques', () => {
      const numberProperty = convertField({ name: 'montant', type: 'number', constraints: { minimum: 0, maximum: 100 } })
      assert.equal(numberProperty.minimum, 0)
      assert.equal(numberProperty.maximum, 100)
      const dateProperty = convertField({ name: 'date', type: 'date', constraints: { minimum: '2020-01-01' } })
      assert.equal(dateProperty.minimum, undefined)
    })

    it('convertit un schéma complet avec clé primaire', () => {
      const { schema, primaryKey } = convertTableSchema({
        title: 'Test',
        version: '1.0.0',
        primaryKey: 'id',
        fields: [
          { name: 'id', type: 'string', constraints: { required: true } },
          { name: 'annee', type: 'year' }
        ]
      })
      assert.equal(schema.length, 2)
      assert.deepEqual(primaryKey, ['id'])
    })

    it('ignore une clé primaire incohérente', () => {
      const { primaryKey } = convertTableSchema({
        fields: [{ name: 'id', type: 'string' }],
        primaryKey: ['id', 'absent']
      })
      assert.deepEqual(primaryKey, ['id'])
    })

    it('rejette les doublons et les schémas vides', () => {
      assert.throws(() => convertTableSchema({ fields: [] }), /aucun champ/)
      assert.throws(() => convertTableSchema({ fields: [{ name: 'a' }, { name: 'a' }] }), /plusieurs fois/)
    })
  })

  describe('sélection dans le catalogue', () => {
    it('détermine la dernière version', () => {
      const entry: any = {
        name: 'test/schema',
        versions: [
          { version_name: '2.0.0', schema_url: 'https://schema.data.gouv.fr/schemas/test/schema/2.0.0/schema.json' },
          { version_name: '2.0.10', schema_url: 'https://schema.data.gouv.fr/schemas/test/schema/2.0.10/schema.json' },
          { version_name: '1.9.9', schema_url: 'https://schema.data.gouv.fr/schemas/test/schema/1.9.9/schema.json' }
        ]
      }
      assert.equal(latestVersion(entry).version_name, '2.0.10')
    })

    it('filtre les entrées tabulaires', () => {
      const entries: any[] = [
        { name: 'a', schema_type: 'tableschema', versions: [] },
        { name: 'b', schema_type: 'jsonschema', versions: [] },
        { name: 'c', schema_type: 'other', versions: [] }
      ]
      assert.deepEqual(tabularEntries(entries).map(e => e.name), ['a'])
    })
  })

  // Needs a real data-fair instance.
  // Declare the instance in config/local-test.mjs to enable it.
  it('importe un schéma sélectionné dans un jeu de données éditable', { skip: !config?.dataFairUrl }, async () => {
    const context = testUtils.context({
      processingConfig: {
        importMode: 'select',
        schemas: ['etalab/schema-lieux-covoiturage'],
        loadExample: true
      }
    }, config, false)

    try {
      await schemasDatagouv.run(context as any)
      const datasets: any[] = (context.processingConfig as any).createdDatasets
      assert.equal(datasets.length, 1)
      assert.equal(datasets[0].schemaName, 'etalab/schema-lieux-covoiturage')
      const live = (await context.axios.get(`api/v1/datasets/${datasets[0].datasetId}`)).data
      assert.ok(live.conformsTo?.version)
      assert.equal(live.masterData?.standardSchema?.active, true)
      assert.ok(live.schema.length > 0)
      assert.equal(live.isRest, true)
    } finally {
      const datasets: any[] = (context.processingConfig as any).createdDatasets ?? []
      for (const dataset of datasets) {
        await context.axios.delete(`api/v1/datasets/${dataset.datasetId}`)
      }
    }
  })
})
