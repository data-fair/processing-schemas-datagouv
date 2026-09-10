import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { datasetDescription, datasetSummary, metadataPatch, schemaPageUrl, truncateSummary } from '../lib/metadata.ts'
import type { CatalogEntry, CatalogVersion } from '../lib/catalog.ts'

const entry: CatalogEntry = {
  name: 'etalab/schema-test',
  title: 'Schéma de test',
  description: 'Spécification du modèle de données de test.',
  homepage: 'https://example.org/standard',
  external_doc: 'https://doc.example.org',
  external_tool: 'https://outil.example.org',
  contact: 'contact@example.org',
  labels: ['Socle Commun des Données Locales'],
  versions: [{ version_name: '1.0.0', schema_url: 'https://schema.data.gouv.fr/schemas/etalab/schema-test/1.0.0/schema.json' }]
}

const version = (name: string): CatalogVersion => ({
  version_name: name,
  schema_url: `https://schema.data.gouv.fr/schemas/etalab/schema-test/${name}/schema.json`
})

describe('métadonnées : résumé', () => {
  it('reprend la description du catalogue', () => {
    assert.equal(datasetSummary(entry), 'Spécification du modèle de données de test.')
  })

  it('tronque proprement les descriptions trop longues', () => {
    const summary = truncateSummary('mot '.repeat(200), 50)
    assert.ok(summary.length <= 50)
    assert.match(summary, /…$/)
    assert.ok(!summary.includes('  '))
  })

  it('génère un résumé de repli sans description', () => {
    const summary = datasetSummary({ ...entry, description: undefined })
    assert.match(summary, /Schéma de test/)
    assert.ok(summary.length <= 300)
  })
})

describe('métadonnées : description', () => {
  it('ajoute les liens utiles', () => {
    const description = datasetDescription(entry, version('1.0.0'))
    assert.match(description, /Spécification du modèle de données de test\./)
    assert.match(description, new RegExp(schemaPageUrl(entry.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(description, /https:\/\/schema\.data\.gouv\.fr\/schemas\/etalab\/schema-test\/1\.0\.0\/schema\.json/)
    assert.match(description, /https:\/\/example\.org\/standard/)
    assert.match(description, /https:\/\/doc\.example\.org/)
    assert.match(description, /https:\/\/outil\.example\.org/)
    assert.match(description, /contact@example\.org/)
    assert.match(description, /Socle Commun des Données Locales/)
  })

  it('fonctionne sans description ni liens optionnels', () => {
    const minimal: CatalogEntry = { name: 'test/simple', title: 'Simple', versions: [] }
    const description = datasetDescription(minimal, version('2.0.0'))
    assert.match(description, /\*\*Simple\*\*/)
    assert.match(description, /version 2\.0\.0/)
  })
})

describe('métadonnées : rafraîchissement conditionnel', () => {
  it('pose le résumé absent et rafraîchit la description générée', () => {
    const live = {
      description: datasetDescription(entry, version('0.9.0'))
    }
    const patch = metadataPatch(live, entry, version('0.9.0'), version('1.0.0'))
    assert.equal(patch.summary, datasetSummary(entry))
    assert.equal(patch.description, datasetDescription(entry, version('1.0.0')))
  })

  it('ne touche pas à une description personnalisée', () => {
    const live = { summary: 'Mon résumé', description: 'Ma description personnalisée' }
    const patch = metadataPatch(live, entry, version('0.9.0'), version('1.0.0'))
    assert.deepEqual(patch, {})
  })
})
