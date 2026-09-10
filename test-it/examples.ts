import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  checkHeader,
  detectSeparator,
  exampleCandidates,
  exampleFile,
  normalizeExampleUrl,
  parseCsvLine,
  prepareExample,
  rewriteHeader,
  stripBom,
  type FetchedExample
} from '../lib/examples.ts'

describe('exemples : normalisation des URLs', () => {
  it('convertit les liens GitHub blob en contenu brut', () => {
    assert.equal(
      normalizeExampleUrl('https://github.com/cnigfr/schema-paysage/blob/main/schema/classe-dynamique/exemple-valide.csv'),
      'https://raw.githubusercontent.com/cnigfr/schema-paysage/main/schema/classe-dynamique/exemple-valide.csv'
    )
  })

  it('convertit les liens GitLab blob en contenu brut', () => {
    assert.equal(
      normalizeExampleUrl('https://gitlab.com/org/repo/-/blob/v1.0.0/exemples/valide.csv'),
      'https://gitlab.com/org/repo/-/raw/v1.0.0/exemples/valide.csv'
    )
  })

  it('répare les URLs GitHub avec un sous-dossier avant /raw/', () => {
    assert.equal(
      normalizeExampleUrl('https://github.com/cnigfr/schema-sites-economiques/schema/pole-eco/raw/v1.0.1/exemple-valide.csv'),
      'https://raw.githubusercontent.com/cnigfr/schema-sites-economiques/v1.0.1/schema/pole-eco/exemple-valide.csv'
    )
  })

  it('convertit les liens Google Sheets en export CSV', () => {
    assert.equal(
      normalizeExampleUrl('https://docs.google.com/spreadsheets/d/abc123/edit#gid=42'),
      'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42'
    )
    assert.equal(
      normalizeExampleUrl('https://docs.google.com/spreadsheets/d/abc123/edit'),
      'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0'
    )
  })

  it('laisse les URLs brutes inchangées', () => {
    const url = 'https://raw.githubusercontent.com/etalab/schema-irve/v2.3.0/statique/exemple-valide-statique.csv'
    assert.equal(normalizeExampleUrl(url), url)
  })
})

describe('exemples : sélection des candidats', () => {
  it('place les exemples valides en premier et écarte les invalides', () => {
    const candidates = exampleCandidates({
      examples: [
        { title: 'Exemple invalide', name: 'invalide', path: 'https://example.org/exemple-invalide.csv' },
        { title: 'Exemple valide', name: 'valide', path: 'https://example.org/exemple-valide.csv' }
      ]
    })
    assert.equal(candidates.length, 2)
    assert.match(candidates[0].url, /exemple-valide\.csv$/)
    assert.match(candidates[1].url, /exemple-invalide\.csv$/)
  })

  it('ignore les exemples sans chemin', () => {
    assert.deepEqual(exampleCandidates({ examples: [{ title: 'sans chemin' }] }), [])
  })

  it('écarte les gabarits de schéma et listes d\'implémentations', () => {
    const candidates = exampleCandidates({
      examples: [
        { title: 'Schéma au format XLS', name: 'schema_format_xls', path: 'https://example.org/schema.xls' },
        { title: 'Impémentations', path: 'https://docs.google.com/spreadsheets/d/abc/edit' },
        { title: 'Exemple valide', path: 'https://example.org/exemple-valide.csv' }
      ]
    })
    assert.equal(candidates.length, 1)
    assert.match(candidates[0].url, /exemple-valide\.csv$/)
  })

  it('normalise les URLs des candidats', () => {
    const [candidate] = exampleCandidates({ examples: [{ path: 'https://github.com/org/repo/blob/main/exemple.csv' }] })
    assert.equal(candidate.url, 'https://raw.githubusercontent.com/org/repo/main/exemple.csv')
  })
})

describe('exemples : analyse CSV', () => {
  it('supprime le BOM', () => {
    assert.equal(stripBom('\uFEFFnom;ville\n'), 'nom;ville\n')
    assert.equal(stripBom('nom,ville\n'), 'nom,ville\n')
  })

  it('détecte le séparateur hors guillemets', () => {
    assert.equal(detectSeparator('nom;ville;code\n'), ';')
    assert.equal(detectSeparator('nom,ville,code\n'), ',')
    assert.equal(detectSeparator('nom\tville\tcode\n'), '\t')
    assert.equal(detectSeparator('"nom; complet",ville\n'), ',')
    assert.equal(detectSeparator('colonne_unique\n'), ',')
  })

  it('découpe une ligne CSV en respectant les guillemets', () => {
    assert.deepEqual(parseCsvLine('"a,b",c,"d""e"', ','), ['a,b', 'c', 'd"e'])
    assert.deepEqual(parseCsvLine('a;b;c', ';'), ['a', 'b', 'c'])
  })

  it('contrôle l\'en-tête et repère les colonnes renommables', () => {
    const schema = [
      { key: 'nom' },
      { key: 'code_insee', 'x-required': true },
      { key: 'latitude' }
    ]
    const ok = checkHeader(['Nom', 'Code INSEE', 'latitude'], schema)
    assert.deepEqual(ok.unknown, [])
    assert.deepEqual(ok.missingRequired, [])
    assert.equal(ok.renamed.get(0), 'nom')
    assert.equal(ok.renamed.get(1), 'code_insee')

    const bad = checkHeader(['nom', 'inconnu'], schema)
    assert.deepEqual(bad.unknown, ['inconnu'])
    assert.deepEqual(bad.missingRequired, ['code_insee'])
  })

  it('tolère les colonnes techniques _action et _id', () => {
    const check = checkHeader(['_action', '_id', 'nom'], [{ key: 'nom' }])
    assert.deepEqual(check.unknown, [])
  })

  it('réécrit l\'en-tête avec les clés exactes', () => {
    const renamed = new Map([[0, 'nom'], [1, 'code_insee']])
    assert.equal(
      rewriteHeader('Nom,Code INSEE\nDupont,75056\n', ',', renamed),
      'nom,code_insee\nDupont,75056\n'
    )
    assert.equal(rewriteHeader('nom\nDupont\n', ',', new Map()), 'nom\nDupont\n')
  })
})

describe('exemples : type de fichier et préparation', () => {
  it('déduit le type de fichier de l\'extension', () => {
    assert.deepEqual(exampleFile('https://example.org/exemple.csv'), { fileName: 'example.csv', mimeType: 'text/csv', isTabular: false })
    assert.equal(exampleFile('https://example.org/exemple.xlsx').isTabular, true)
    assert.equal(exampleFile('https://example.org/exemple.xls').mimeType, 'application/vnd.ms-excel')
    assert.equal(exampleFile('https://example.org/sans-extension').fileName, 'example.csv')
  })

  const csvExample = (text: string): FetchedExample => ({
    url: 'https://example.org/exemple.csv',
    fileName: 'example.csv',
    mimeType: 'text/csv',
    isTabular: false,
    text
  })

  it('prépare un CSV conforme et normalise l\'en-tête', () => {
    const prepared = prepareExample(csvExample('Nom;Code INSEE\nDupont;75056\n'), [{ key: 'nom' }, { key: 'code_insee' }])
    assert.deepEqual(prepared, { kind: 'csv', separator: ';', text: 'nom;code_insee\nDupont;75056\n' })
  })

  it('rejette un exemple avec des colonnes inconnues', () => {
    assert.throws(
      () => prepareExample(csvExample('nom,inconnu\na,b\n'), [{ key: 'nom' }]),
      /colonnes inconnues/
    )
  })

  it('rejette un exemple sans colonne obligatoire', () => {
    assert.throws(
      () => prepareExample(csvExample('nom\na\n'), [{ key: 'nom' }, { key: 'siret', 'x-required': true }]),
      /colonnes obligatoires absentes/
    )
  })

  it('rejette un fichier vide', () => {
    assert.throws(() => prepareExample(csvExample('   '), [{ key: 'nom' }]), /fichier vide/)
  })

  it('transmet un tableur tel quel', () => {
    const buffer = Buffer.from('PK\u0003\u0004fake')
    const prepared = prepareExample({
      url: 'https://example.org/exemple.xlsx',
      fileName: 'example.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      isTabular: true,
      buffer
    }, [{ key: 'nom' }])
    assert.equal(prepared.kind, 'tabular')
    if (prepared.kind === 'tabular') {
      assert.equal(prepared.fileName, 'example.xlsx')
      assert.equal(prepared.buffer, buffer)
    }
  })
})
