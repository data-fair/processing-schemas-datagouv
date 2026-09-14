import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import testUtils from '@data-fair/lib-processing-dev/tests-utils.js'
import processingConfigSchema from '../processing-config-schema.json' with { type: 'json' }
import * as schemasDatagouv from '../index.ts'
import { convertField, convertTableSchema } from '../lib/convert.ts'
import {
  mergeConcepts,
  COORD_X_CONCEPT,
  COORD_Y_CONCEPT,
  GEOMETRY_CONCEPT,
  GEOMETRY_PROJ_CONCEPT,
  LAT_LON_CONCEPT,
  LATITUDE_CONCEPT,
  LONGITUDE_CONCEPT
} from '../lib/concepts.ts'
import { datasetTitle, needsTitleRepair } from '../lib/datasets.ts'
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
    assert.equal(processingConfigSchema.layout.comp, 'tabs')
    // l'UI monte vjsf avec readOnlyPropertiesMode "remove" : sans cette surcharge,
    // toute sauvegarde de la config purge le suivi createdDatasets
    assert.equal(processingConfigSchema.layout.readOnlyPropertiesMode, 'hide')
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

    it('normalise les clés et conserve le nom d\'origine', () => {
      const property = convertField({ name: 'note_A_c1.1', title: 'Note A c1.1', type: 'number' })
      assert.equal(property.key, 'note_a_c1_1')
      assert.equal(property['x-originalName'], 'note_A_c1.1')
      assert.equal(property.title, 'Note A c1.1')
    })

    it('normalise la clé primaire', () => {
      const { primaryKey } = convertTableSchema({
        fields: [
          { name: 'note_A_c1.1', type: 'number' },
          { name: 'id_unique', type: 'string' }
        ],
        primaryKey: 'note_A_c1.1'
      })
      assert.deepEqual(primaryKey, ['note_a_c1_1'])
    })

    it('rejette une collision de clés après normalisation', () => {
      assert.throws(
        () => convertTableSchema({ fields: [{ name: 'a.b' }, { name: 'a_b' }] }),
        /même clé/
      )
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

  describe('annotation des concepts', () => {
    it('annote les champs reconnus par leur nom', () => {
      const { schema } = convertTableSchema({
        fields: [
          { name: 'nom_du_site', type: 'string' },
          { name: 'latitude', type: 'number' },
          { name: 'longitude', type: 'number' },
          { name: 'code_insee', type: 'string' },
          { name: 'date_maj', type: 'date' },
          { name: 'siret', type: 'string' }
        ]
      })
      const byKey = Object.fromEntries(schema.map(p => [p.key, p]))
      assert.equal(byKey.nom_du_site['x-refersTo'], 'http://www.w3.org/2000/01/rdf-schema#label')
      assert.equal(byKey.latitude['x-refersTo'], 'http://schema.org/latitude')
      assert.equal(byKey.longitude['x-refersTo'], 'http://schema.org/longitude')
      assert.equal(byKey.code_insee['x-refersTo'], 'http://rdf.insee.fr/def/geo#codeCommune')
      assert.equal(byKey.date_maj['x-refersTo'], 'http://schema.org/Date')
      assert.equal(byKey.siret['x-refersTo'], 'http://www.datatourisme.fr/ontology/core/1.0/#siret')
    })

    it('utilise le titre en repli et ignore les accents', () => {
      const { schema } = convertTableSchema({
        fields: [
          { name: 'contact_tel', title: 'Téléphone', type: 'string' },
          { name: 'champ_geo', title: 'Géométrie', type: 'string', example: 'POLYGON((2.3 48.8, 2.4 48.8, 2.4 48.9, 2.3 48.8))' }
        ]
      })
      assert.equal(schema[0]['x-refersTo'], 'https://www.w3.org/2006/vcard/ns#tel')
      assert.equal(schema[1]['x-refersTo'], 'https://purl.org/geojson/vocab#geometry')
    })

    it('respecte la compatibilité de type du concept', () => {
      const { schema } = convertTableSchema({
        fields: [
          { name: 'latitude', type: 'string' },
          { name: 'date_maj', type: 'string' },
          { name: 'annee', type: 'integer' }
        ]
      })
      assert.equal(schema[0]['x-refersTo'], undefined)
      assert.equal(schema[1]['x-refersTo'], undefined)
      assert.equal(schema[2]['x-refersTo'], 'https://www.w3.org/TR/owl-time/#time:year')
    })

    it('n\'annote qu\'un seul champ par concept', () => {
      const { schema } = convertTableSchema({
        fields: [
          { name: 'nom', type: 'string' },
          { name: 'name', type: 'string' }
        ]
      })
      assert.equal(schema[0]['x-refersTo'], 'http://www.w3.org/2000/01/rdf-schema#label')
      assert.equal(schema[1]['x-refersTo'], undefined)
    })

    it('n\'annote pas les champs sans correspondance', () => {
      const { schema } = convertTableSchema({ fields: [{ name: 'date_decision', title: 'Date de décision', type: 'date' }] })
      assert.equal(schema[0]['x-refersTo'], undefined)
    })
  })

  describe('annotation des concepts géographiques', () => {
    it('annote les coordonnées WGS84 explicites, y compris les conventions xlong/ylat', () => {
      const { schema, projection } = convertTableSchema({
        fields: [
          { name: 'Xlong', type: 'number' },
          { name: 'Ylat', type: 'number' },
          { name: 'lat_wgs84', type: 'number' },
          { name: 'lon_wgs84', type: 'number' }
        ]
      })
      const byKey = Object.fromEntries(schema.map(p => [p.key, p]))
      assert.equal(byKey.xlong['x-refersTo'], LONGITUDE_CONCEPT)
      assert.equal(byKey.ylat['x-refersTo'], LATITUDE_CONCEPT)
      // un seul champ annoté par concept
      assert.equal(byKey.lat_wgs84['x-refersTo'], undefined)
      assert.equal(byKey.lon_wgs84['x-refersTo'], undefined)
      assert.equal(projection, undefined)
    })

    it('n\'annote pas un geopoint frictionless (ordre longitude,latitude)', () => {
      const { schema } = convertTableSchema({ fields: [{ name: 'geopoint', type: 'geopoint' }] })
      assert.equal(schema[0]['x-refersTo'], undefined)
    })

    it('n\'annote pas un champ "coordonnees" ambigu (adresse postale DECP)', () => {
      const { schema } = convertTableSchema({
        fields: [{ name: 'coordonnees', type: 'string', description: "Les coordonnées de l'acheteur concerné" }]
      })
      assert.equal(schema[0]['x-refersTo'], undefined)
    })

    it('annote une géométrie geojson ou WKT WGS84', () => {
      const { schema, projection } = convertTableSchema({
        fields: [
          { name: 'geometrie', type: 'geojson' },
          { name: 'champ_geo', title: 'Géométrie', type: 'string', example: 'POLYGON((2.3 48.8, 2.4 48.8, 2.4 48.9, 2.3 48.8))' }
        ]
      })
      assert.equal(schema[0]['x-refersTo'], GEOMETRY_CONCEPT)
      assert.equal(schema[1]['x-refersTo'], undefined)
      assert.equal(projection, undefined)
    })

    it('n\'annote pas une géométrie incertaine (GML, chaîne sans exemple)', () => {
      const gml = convertTableSchema({
        fields: [{ name: 'geometrie', type: 'string', example: '<gml:Point xmlns:gml="http://www.opengis.net/gml/3.2"><gml:pos>1 2</gml:pos></gml:Point>' }]
      })
      assert.equal(gml.schema[0]['x-refersTo'], undefined)
      const inconnue = convertTableSchema({ fields: [{ name: 'geometrie', type: 'string' }] })
      assert.equal(inconnue.schema[0]['x-refersTo'], undefined)
    })

    it('annote une géométrie Lambert-93 avec le concept projeté et la projection du jeu', () => {
      const { schema, projection } = convertTableSchema({
        fields: [{
          name: 'sect_geomsurf',
          title: 'géométrie',
          type: 'geojson',
          example: { type: 'Polygon', coordinates: [[[656589.7, 6425785.32], [656655.02, 6425866.31], [656589.7, 6425785.32]]] }
        }]
      })
      assert.equal(schema[0]['x-refersTo'], GEOMETRY_PROJ_CONCEPT)
      assert.deepEqual(projection, { code: 'EPSG:2154' })
    })

    it('annote un couple x/y projeté quand la projection est explicite', () => {
      const { schema, projection } = convertTableSchema({
        fields: [
          { name: 'x', title: 'x en lambert 93 (précision de 2 décimales)', type: 'number', example: '723894.42' },
          { name: 'y', title: 'y en lambert 93 (précision de 2 décimales)', type: 'number', example: '6262032.84' }
        ]
      })
      const byKey = Object.fromEntries(schema.map(p => [p.key, p]))
      assert.equal(byKey.x['x-refersTo'], COORD_X_CONCEPT)
      assert.equal(byKey.y['x-refersTo'], COORD_Y_CONCEPT)
      assert.deepEqual(projection, { code: 'EPSG:2154' })
    })

    it('n\'annote pas des coordonnées projetées dont la projection est inconnue', () => {
      const { schema, projection } = convertTableSchema({
        fields: [
          { name: 'coord_x', type: 'number', example: 1234567.89 },
          { name: 'coord_y', type: 'number', example: 8765432.1 }
        ]
      })
      assert.equal(schema[0]['x-refersTo'], undefined)
      assert.equal(schema[1]['x-refersTo'], undefined)
      assert.equal(projection, undefined)
    })

    it('n\'annote rien en cas de projections contradictoires', () => {
      const { schema, projection, warnings } = convertTableSchema({
        fields: [
          { name: 'geometrie', type: 'geojson', description: 'géométrie Lambert-93', example: { type: 'Point', coordinates: [656589.7, 6425785.32] } },
          { name: 'x', type: 'number', title: 'x', description: 'coordonnée WGS84', example: 2.3 },
          { name: 'y', type: 'number', title: 'y', description: 'coordonnée Lambert II étendu', example: 2_200_000 }
        ]
      })
      assert.equal(schema[0]['x-refersTo'], undefined)
      assert.equal(schema[1]['x-refersTo'], undefined)
      assert.equal(schema[2]['x-refersTo'], undefined)
      assert.equal(projection, undefined)
      assert.ok(warnings?.some(warning => warning.includes('contradictoires')))
    })
  })

  describe('titre des jeux de données', () => {
    it('ne double pas un préfixe Schéma déjà présent', () => {
      assert.equal(datasetTitle('Schéma des fontaines à eau'), 'Schéma des fontaines à eau')
      assert.equal(datasetTitle('Schéma directeur des IRVE'), 'Schéma directeur des IRVE')
      assert.equal(datasetTitle('IRVE statique'), 'Schéma IRVE statique')
      assert.equal(datasetTitle(' Atlas Paysager'), 'Schéma Atlas Paysager')
    })

    it('détecte uniquement le titre buggy à préfixe doublé', () => {
      assert.equal(needsTitleRepair('Schéma Schéma des fontaines à eau', 'Schéma des fontaines à eau'), true)
      assert.equal(needsTitleRepair('schema schema pour les passages à niveau', 'Schéma pour les passages à niveau'), true)
      assert.equal(needsTitleRepair('Mon titre personnalisé', 'Schéma des fontaines à eau'), false)
      assert.equal(needsTitleRepair('Schéma IRVE statique', 'Schéma IRVE statique'), false)
    })
  })

  describe('fusion des concepts dans un schéma existant', () => {
    it('ajoute les concepts absents sans toucher au reste', () => {
      const live = [
        { key: 'nom', type: 'string', title: 'Nom' },
        { key: 'latitude', type: 'number', 'x-refersTo': 'http://schema.org/latitude', 'x-capabilities': { index: true } }
      ]
      const desired = [
        { key: 'nom', type: 'string', title: 'Nom', 'x-refersTo': 'http://www.w3.org/2000/01/rdf-schema#label' },
        { key: 'latitude', type: 'number', 'x-refersTo': 'http://schema.org/latitude' }
      ]
      const merged = mergeConcepts(live, desired)
      assert.ok(merged)
      assert.equal(merged![0]['x-refersTo'], 'http://www.w3.org/2000/01/rdf-schema#label')
      assert.equal(merged![1]['x-refersTo'], 'http://schema.org/latitude')
      assert.deepEqual(merged![1]['x-capabilities'], { index: true })
    })

    it('retourne null si rien ne change', () => {
      const schema = [{ key: 'nom', type: 'string', 'x-refersTo': 'http://www.w3.org/2000/01/rdf-schema#label' }]
      assert.equal(mergeConcepts(schema, schema), null)
    })

    it('retire un concept posé par une ancienne version quand les règles ne le posent plus', () => {
      const live = [{ key: 'coordonnees', type: 'string', 'x-refersTo': LAT_LON_CONCEPT, 'x-concept': { id: 'latLon' } }]
      const desired = [{ key: 'coordonnees', title: 'Coordonnées', type: 'string', 'x-originalName': 'coordonnees' }]
      const merged = mergeConcepts(live, desired)
      assert.ok(merged)
      assert.equal(merged![0]['x-refersTo'], undefined)
      assert.equal(merged![0]['x-concept'], undefined)
    })

    it('corrige une géométrie WGS84 annotée à tort vers le concept projeté', () => {
      const live = [{ key: 'sect_geomsurf', type: 'string', 'x-refersTo': GEOMETRY_CONCEPT }]
      const desired = [{ key: 'sect_geomsurf', title: 'géométrie', type: 'string', 'x-originalName': 'sect_geomsurf', 'x-refersTo': GEOMETRY_PROJ_CONCEPT }]
      const merged = mergeConcepts(live, desired)
      assert.ok(merged)
      assert.equal(merged![0]['x-refersTo'], GEOMETRY_PROJ_CONCEPT)
    })

    it('préserve un concept personnalisé qui ne vient pas de l\'ancien mapping', () => {
      const live = [{ key: 'coordonnees', type: 'string', 'x-refersTo': 'https://example.org/mon-concept' }]
      const desired = [{ key: 'coordonnees', title: 'Coordonnées', type: 'string', 'x-originalName': 'coordonnees' }]
      assert.equal(mergeConcepts(live, desired), null)
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
      assert.ok(live.summary)
      assert.match(live.description, /schema\.data\.gouv\.fr/)
      assert.ok(live.schema.some((property: any) => property['x-capabilities']))
    } finally {
      const datasets: any[] = (context.processingConfig as any).createdDatasets ?? []
      for (const dataset of datasets) {
        await context.axios.delete(`api/v1/datasets/${dataset.datasetId}`)
      }
    }
  })
})
