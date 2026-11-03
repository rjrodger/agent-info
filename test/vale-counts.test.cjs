
'use strict'

const { describe, test } = require('node:test')
const Assert = require('node:assert')
const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const { spawnSync } = require('node:child_process')

const REPO = Path.join(__dirname, '..')
const SCRIPTS = Path.join(REPO, 'admin', 'scripts')

const STUB = `#!${process.execPath}
const args = process.argv.slice(2)
if (args.includes('--version')) {
  process.stdout.write('vale version ' + process.env.STUB_VERSION + '\\n')
}
else {
  const config = args[args.indexOf('--config') + 1]
  process.stdout.write(config.endsWith('.vale-counts.ini')
    ? process.env.STUB_ALL : process.env.STUB_LIVE)
}
`

const INI = [
  '# Measured over the gated set: 10 alerts across 2 files.',
  'StylesPath = .vale/styles',
  'Vocab = House',
  '',
  '[*.md]',
  'BasedOnStyles = Vale',
  '',
  '# Off for a house rule. 3 hits.',
  'Google.We = NO',
  '',
  '# Advisory, and wrapped: 4',
  '# hits.',
  'Google.Passive = suggestion',
  '',
  '# The vocabulary holds 2 domain terms, and a 3rd is a typo.',
  'Vale.Spelling = error',
  '',
].join('\n')


function alerts(counts) {
  const out = { 'docs/a.md': [], 'docs/b.md': [] }
  let i = 0
  for (const [rule, n] of Object.entries(counts)) {
    for (let k = 0; k < n; k++) out[0 === i++ % 2 ? 'docs/a.md' : 'docs/b.md'].push({ Check: rule })
  }
  return JSON.stringify(out)
}


function fixture(t, { accept = 'one\ntwo\n', workflow = "env:\n  VALE_VERSION: '3.14.0'\n" } = {}) {
  const root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'vale-counts-'))
  t.after(() => Fs.rmSync(root, { recursive: true, force: true }))
  const files = {
    'admin/scripts/prose-gate.cjs': Fs.readFileSync(Path.join(SCRIPTS, 'prose-gate.cjs'), 'utf8'),
    'admin/scripts/vale-counts.cjs': Fs.readFileSync(Path.join(SCRIPTS, 'vale-counts.cjs'), 'utf8'),
    'admin/scripts/prose-gate.json': JSON.stringify({ pages: ['docs/*.md'] }),
    '.vale.ini': INI,
    '.vale/styles/config/vocabularies/House/accept.txt': '# A comment is not a term.\n' + accept,
    '.github/workflows/docs.yml': workflow,
    'docs/a.md': '# A\n',
    'docs/b.md': '# B\n',
    'stub-vale': STUB,
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = Path.join(root, rel)
    Fs.mkdirSync(Path.dirname(abs), { recursive: true })
    Fs.writeFileSync(abs, content)
  }
  Fs.chmodSync(Path.join(root, 'stub-vale'), 0o755)
  return root
}


function run(root, { live, all, version = '3.14.0' }, ...args) {
  return spawnSync(process.execPath,
    [Path.join(root, 'admin', 'scripts', 'vale-counts.cjs'), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VALE: Path.join(root, 'stub-vale'),
        STUB_VERSION: version,
        STUB_LIVE: alerts(live),
        STUB_ALL: alerts(all),
      },
    })
}


const AS_RECORDED = {
  live: { 'Google.Passive': 4, 'Vale.Spelling': 6 },
  all: { 'Google.We': 3, 'Google.Passive': 4, 'Vale.Spelling': 6 },
}

const DRIFTED = {
  live: { 'Google.Passive': 5, 'Vale.Spelling': 6 },
  all: { 'Google.We': 2, 'Google.Passive': 5, 'Vale.Spelling': 6 },
}


describe('vale-counts', () => {

  test('counts-as-recorded-pass', (t) => {
    const root = fixture(t)
    const out = run(root, AS_RECORDED)
    Assert.equal(out.status, 0, out.stdout + out.stderr)
    Assert.equal(out.stdout, 'vale-counts: 10 alerts across 2 files, as recorded\n')
    Assert.ok(!Fs.existsSync(Path.join(root, '.vale-counts.ini')), 'the scratch copy is left behind')
  })


  test('drifted-counts-fail-and-write-re-measures', (t) => {
    const root = fixture(t, { accept: 'one\ntwo\nthree\n' })

    const out = run(root, DRIFTED)
    Assert.equal(out.status, 1, out.stdout + out.stderr)
    for (const claim of [
      'Google.We: .vale.ini claims 3 hits, Vale reports 2',
      'Google.Passive: .vale.ini claims 4 hits, Vale reports 5',
      '.vale.ini: claims 10 alerts across 2 files, Vale reports 11 across 2 files',
      '.vale.ini: claims 2 domain terms, the vocabulary accepts 3',
      '.vale.ini: calls the next term the 3rd, the vocabulary accepts 3',
    ]) {
      Assert.ok(out.stderr.includes(claim), `missing: ${claim}\n${out.stderr}`)
    }
    Assert.equal(Fs.readFileSync(Path.join(root, '.vale.ini'), 'utf8'), INI, 'a check wrote')

    Assert.equal(run(root, DRIFTED, '--write').status, 0)
    const ini = Fs.readFileSync(Path.join(root, '.vale.ini'), 'utf8')
    for (const line of [
      '# Measured over the gated set: 11 alerts across 2 files.',
      '# Off for a house rule. 2 hits.',
      '# Advisory, and wrapped: 5',
      '# The vocabulary holds 3 domain terms, and a 4th is a typo.',
    ]) {
      Assert.ok(ini.split('\n').includes(line), `not rewritten: ${line}\n${ini}`)
    }

    const again = run(root, DRIFTED)
    Assert.equal(again.status, 0, again.stdout + again.stderr)
  })


  test('a-different-vale-is-reported', (t) => {
    const root = fixture(t)
    const out = run(root, { ...AS_RECORDED, version: '3.13.0' })
    Assert.equal(out.status, 1, out.stdout + out.stderr)
    Assert.match(out.stderr, /Vale 3\.13\.0 is measuring what CI pins to 3\.14\.0/)
  })


  test('a-double-quoted-pin-is-read', (t) => {
    const root = fixture(t, { workflow: 'env:\n  VALE_VERSION: "3.12.0"\n' })
    const out = run(root, AS_RECORDED)
    Assert.equal(out.status, 1, out.stdout + out.stderr)
    Assert.match(out.stderr, /Vale 3\.14\.0 is measuring what CI pins to 3\.12\.0/)
  })


  test('a-pin-in-a-release-url-is-read', (t) => {
    const root = fixture(t, {
      workflow: 'run: curl -sSfL https://github.com/errata-ai/vale/releases/download/v3.12.0/vale.tar.gz\n',
    })
    const out = run(root, AS_RECORDED)
    Assert.equal(out.status, 1, out.stdout + out.stderr)
    Assert.match(out.stderr, /Vale 3\.14\.0 is measuring what CI pins to 3\.12\.0/)
  })

})
