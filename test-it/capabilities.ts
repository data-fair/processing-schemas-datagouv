import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { convertTableSchema } from '../lib/convert.ts'
import { applyCapabilities, GEOMETRY_CONCEPT } from '../lib/capabilities.ts'
import { GEOMETRY_PROJ_CONCEPT } from '../lib/concepts.ts'
import type { DatasetSchemaProperty } from '../lib/convert.ts'

const byKey = (schema: DatasetSchemaProperty[]) => Object.fromEntries(schema.map(property => [property.key, property]))

describe('capabilities : champs de type code', () => {
  it('restreint la recherche textuelle des champs dont le nom désigne un code', () => {
    const { schema } = convertTableSchema({
      fields: [
        { name: 'identifiant', type: 'string', constraints: { pattern: '^[A-Z0-9]{14}$' } },
        { name: 'menuCollSiret', type: 'string' },
        { name: 'porteurCodeSiret', type: 'string' },
        { name: 'sirenDeclarant', type: 'string' }
      ]
    })
    for (const property of schema) {
      assert.deepEqual(property['x-capabilities'], { text: false, insensitive: false })
    }
  })

  it('ne se fie pas à la seule présence d\'une contrainte pattern', () => {
    const { schema } = convertTableSchema({
      fields: [
        { name: 'services', type: 'string', constraints: { pattern: '^(Gratuit|Payant)$' } },
        { name: 'EMPRISE_DESIGNATION', type: 'string', constraints: { pattern: '^[a-zA-Z0-9 ]+$' } }
      ]
    })
    assert.equal(schema[0]['x-capabilities'], undefined)
    assert.equal(schema[1]['x-capabilities'], undefined)
  })

  it('utilise le titre quand le nom ne suffit pas', () => {
    const { schema } = convertTableSchema({
      fields: [{ name: 'pivot', title: 'SIRET ou RNA ou RIDET', type: 'string' }]
    })
    assert.deepEqual(schema[0]['x-capabilities'], { text: false, insensitive: false })
  })

  it('ne confond pas un texte long dont le titre mentionne un code', () => {
    const { schema } = convertTableSchema({
      fields: [{ name: 'commentaire', title: 'Commentaire sur le code', type: 'string' }]
    })
    assert.deepEqual(schema[0]['x-capabilities'], { index: false, values: false, insensitive: false })
  })

  it('restreint la recherche textuelle des concepts de type code', () => {
    const { schema } = convertTableSchema({
      fields: [
        { name: 'siret', type: 'string' },
        { name: 'code_insee', type: 'string' },
        { name: 'code_postal', type: 'string' }
      ]
    })
    const properties = byKey(schema)
    assert.deepEqual(properties.siret['x-capabilities'], { text: false, insensitive: false })
    assert.deepEqual(properties.code_insee['x-capabilities'], { text: false, insensitive: false })
    assert.deepEqual(properties.code_postal['x-capabilities'], { text: false, insensitive: false })
  })

  it('conserve la recherche textuelle si l\'option est activée', () => {
    const { schema } = convertTableSchema(
      { fields: [{ name: 'siret', type: 'string' }] },
      { textSearchOnCodes: true }
    )
    assert.equal(schema[0]['x-capabilities'], undefined)
  })

  it('n\'applique rien en mode standard', () => {
    const { schema } = convertTableSchema(
      { fields: [{ name: 'siret', type: 'string', constraints: { pattern: '^\\d{14}$' } }] },
      { mode: 'standard' }
    )
    assert.equal(schema[0]['x-capabilities'], undefined)
  })
})

describe('capabilities : textes longs', () => {
  it('restreint le filtrage et le tri des champs reconnus par leur nom', () => {
    const { schema } = convertTableSchema({
      fields: [
        { name: 'description', type: 'string' },
        { name: 'commentaire', type: 'string' }
      ]
    })
    for (const property of schema) {
      assert.deepEqual(property['x-capabilities'], { index: false, values: false, insensitive: false })
    }
  })

  it('restreint les champs à maxLength élevé', () => {
    const { schema } = convertTableSchema({
      fields: [{ name: 'contenu', type: 'string', constraints: { maxLength: 2000 } }]
    })
    assert.deepEqual(schema[0]['x-capabilities'], { index: false, values: false, insensitive: false })
  })

  it('ne restreint pas les champs à liste de valeurs', () => {
    const { schema } = convertTableSchema({
      fields: [{ name: 'description', type: 'string', constraints: { enum: ['a', 'b'] } }]
    })
    assert.equal(schema[0]['x-capabilities'], undefined)
  })

  it('ne restreint pas si l\'option est désactivée', () => {
    const { schema } = convertTableSchema(
      { fields: [{ name: 'description', type: 'string' }] },
      { restrictLongText: false }
    )
    assert.equal(schema[0]['x-capabilities'], undefined)
  })

  it('n\'applique rien aux champs non textuels', () => {
    const { schema } = convertTableSchema({
      fields: [
        { name: 'date_description', type: 'date' },
        { name: 'montant', type: 'number' }
      ]
    })
    assert.equal(schema[0]['x-capabilities'], undefined)
    assert.equal(schema[1]['x-capabilities'], undefined)
  })
})

describe('capabilities : géométries', () => {
  it('active la préparation des tuiles vectorielles sur demande', () => {
    const { schema } = convertTableSchema(
      { fields: [{ name: 'geometrie', type: 'geojson' }] },
      { vectorTiles: true }
    )
    assert.equal(schema[0]['x-refersTo'], GEOMETRY_CONCEPT)
    assert.deepEqual(schema[0]['x-capabilities'], { vtPrepare: true })
  })

  it('ne touche pas aux géométries sans option', () => {
    const { schema } = convertTableSchema({ fields: [{ name: 'geometrie', type: 'geojson' }] })
    assert.equal(schema[0]['x-capabilities'], undefined)
  })

  it('active la préparation des tuiles vectorielles sur une géométrie projetée', () => {
    const { schema } = convertTableSchema(
      {
        fields: [{
          name: 'sect_geomsurf',
          title: 'géométrie',
          type: 'geojson',
          example: { type: 'Point', coordinates: [656589.7, 6425785.32] }
        }]
      },
      { vectorTiles: true }
    )
    assert.equal(schema[0]['x-refersTo'], GEOMETRY_PROJ_CONCEPT)
    assert.deepEqual(schema[0]['x-capabilities'], { vtPrepare: true })
  })
})

describe('capabilities : fusion', () => {
  it('préserve les capacités déjà posées', () => {
    const properties: DatasetSchemaProperty[] = [{
      key: 'siret',
      title: 'SIRET',
      type: 'string',
      'x-originalName': 'siret',
      'x-capabilities': { values: false }
    }]
    applyCapabilities(properties, [{ name: 'siret', constraints: { pattern: '^\\d{14}$' } }])
    assert.deepEqual(properties[0]['x-capabilities'], { values: false, text: false, insensitive: false })
  })
})
