
'use strict'

const { describe, test } = require('node:test')
const Assert = require('node:assert')
const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const { spawnSync } = require('node:child_process')

const REPO = Path.join(__dirname, '..')
const SCRIPT = Path.join(REPO, 'admin', 'scripts', 'comment-gate.cjs')

const gate = require(SCRIPT)


function fixture(t, files) {
  const root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'comment-gate-'))
  t.after(() => Fs.rmSync(root, { recursive: true, force: true }))
  for (const [rel, content] of Object.entries({
    'admin/scripts/comment-gate.cjs': Fs.readFileSync(SCRIPT, 'utf8'),
    ...files,
  })) {
    const abs = Path.join(root, rel)
    Fs.mkdirSync(Path.dirname(abs), { recursive: true })
    Fs.writeFileSync(abs, content)
  }
  return root
}


function run(root, ...args) {
  return spawnSync(process.execPath,
    [Path.join(root, 'admin', 'scripts', 'comment-gate.cjs'), ...args],
    { encoding: 'utf8', cwd: root })
}


describe('comment-gate', () => {

  test('gate', () => {
    const findings = gate.checkAll().flatMap((report) => report.findings)
    Assert.deepEqual(findings.map((f) => `${f.file}:${f.line}: ${f.rule}: ${f.detail}`), [])
  })


  test('scope', () => {
    const files = gate.sourceFiles()
    for (const covered of [
      'admin/scripts/comment-gate.cjs',
      'admin/scripts/prose-gate.cjs',
      'admin/scripts/vale-counts.cjs',
      'test/comment-gate.test.cjs',
    ]) {
      Assert.ok(files.includes(covered), `not gated: ${covered}`)
    }
    Assert.ok(files.every((f) => /\.[cm]?js$/.test(f)), 'a non-source file is gated')
  })


  test('explicit-paths', () => {
    const file = 'admin/scripts/prose-gate.cjs'
    for (const spelled of [file, './' + file, Path.join(REPO, file)]) {
      Assert.equal(gate.repoPath(spelled), file, spelled)
      Assert.doesNotThrow(() => gate.checkFile(gate.repoPath(spelled)), spelled)
    }
  })


  test('lexer', () => {
    const source = [
      'const url = "http://x/y" // trailing',
      'const re = /a\\/\\/b/',
      '/* two',
      '   lines */',
    ].join('\n')

    const { comments, codeLines } = gate.lex(source, 'js')

    Assert.deepEqual(comments.map((c) => [c.kind, c.start, c.end]),
      [['line', 1, 1], ['block', 3, 4]])
    Assert.equal(codeLines, 2)

    const keyword = gate.lex('function f(s) { return /[/*]/.test(s) }\nconst x = 1\n', 'js')
    Assert.deepEqual(keyword.comments, [], 'a regular expression after return')
    Assert.equal(keyword.codeLines, 2)

    const property = gate.lex('const half = obj.return / 2 // note\n', 'js')
    Assert.deepEqual(property.comments.map((c) => c.start), [1],
      'a property named return is followed by a division')
  })


  test('lexer-syntaxes', () => {
    const starts = (scan) => scan.comments.map((c) => c.start)

    const hash = gate.lex([
      'a: "x # y" # trailing',
      'b: `raw # not',
      '# still raw`',
      '# own line',
    ].join('\n'), 'hash')
    Assert.deepEqual(starts(hash), [1, 4])
    Assert.equal(hash.codeLines, 2)

    Assert.deepEqual(starts(gate.lex("let a = 'x\n// two\nlet b = 1", 'c')), [2])

    Assert.throws(() => gate.checkText('README.md', '// x\n'),
      /not source in comment-gate.json/)
  })


  test('exempt', () => {
    const source = [
      '/* Copyright (c) 2026 Richard Rodger, MIT License */',
      '// eslint-disable-next-line no-console',
      "console.log('x')",
    ].join('\n')
    Assert.deepEqual(gate.checkText('probe.cjs', source).findings, [])
  })


  test('rules', () => {
    const rules = (text) => gate.checkText('probe.cjs', text).findings.map((f) => f.rule)
    const dense = Array.from({ length: 9 }, (_, i) => `// note ${i}\nconst x${i} = ${i}\n`)

    Assert.deepEqual(rules('// We tried this first.\nconst a = 1\n'), ['narrative'])
    Assert.deepEqual(rules('// The business needs it.\nconst a = 1\n'), ['requirements'])
    Assert.deepEqual(rules('// a\n// b\n// c\n// d\n// e\n// f\nconst a = 1\n'), ['long-block'])
    Assert.deepEqual(rules('// Runs in three passes.\nconst a = 1\n'), ['count-claim'])
    Assert.deepEqual(rules('// Holds since 2026-11-03.\nconst a = 1\n'), ['dated-claim'])
    Assert.deepEqual(rules('// See #12.\nconst a = 1\n'), ['issue-ref'])
    Assert.deepEqual(rules('// Needs v1.2.3.\nconst a = 1\n'), ['version-claim'])
    Assert.deepEqual(rules('// Read by admin/scripts/gone.cjs.\nconst a = 1\n'), ['stale-path'])
    const unknown = ['not', 'Defined', 'Anywhere'].join('')
    Assert.deepEqual(rules(`// Calls \`${unknown}\`.\nconst a = 1\n`), ['stale-symbol'])
    Assert.deepEqual(rules('// const a = foo(1);\nconst b = 2\n'), ['commented-code'])
    Assert.deepEqual(rules(dense.join('')), ['dense-file'])
  })


  test('a-fixture-reads-its-configuration', (t) => {
    const root = fixture(t, {
      'admin/scripts/comment-gate.json': JSON.stringify({
        source: { '.js': 'js', '.py': 'hash' },
        trees: { models: { '.model': 'hash' } },
        generated: ['src/gen.js'],
        fixtures: ['examples'],
        skip: ['node_modules', '.git'],
        decisions: 'ADR.md',
      }),
      'ADR.md': '# Decisions\n\n## ADR-001: Start\n',
      'src/a.js': '// See ADR-001.\nconst a = 1\n// See ADR-999.\nconst b = 2\n',
      'src/gen.js': '// We wrote this.\nconst g = 1\n',
      'examples/x.js': '// We wrote this.\nconst x = 1\n',
      'tool.py': '# We tried this.\nx = 1\n',
      'models/m.model': '# a note\na: 1\n',
      'other.model': '# We wrote this.\n',
    })

    const out = run(root)
    Assert.equal(out.status, 1, out.stdout + out.stderr)
    Assert.deepEqual(out.stdout.split('\n').filter((l) => /^\S+:\d+: /.test(l)), [
      'src/a.js:3: stale-adr: ADR-999',
      'tool.py:1: narrative: "We"',
    ])

    const only = run(root, 'src/a.js')
    Assert.equal(only.status, 1)
    Assert.ok(!only.stdout.includes('tool.py'), only.stdout)

    const measured = run(root, '--measure')
    Assert.equal(measured.status, 0)
    Assert.match(measured.stdout, /^files 3 /)
  })


  test('the-process-names-every-rule', () => {
    const source = Fs.readFileSync(SCRIPT, 'utf8')
    const rules = [...new Set([...source.matchAll(
      /(?:add\(block,\s*|rule:\s*)'([a-z]+(?:-[a-z]+)*)'/g)].map((m) => m[1]))].sort()
    const guide = Fs.readFileSync(Path.join(REPO, 'DEV-PROCESS.md'), 'utf8')
    const section = guide.split('| Rule | Fails when |')[1].split('\n\n')[0]
    const table = section.split('\n')
      .map((row) => row.match(/^\| ([^|]+) \|/))
      .filter((m) => null != m)
      .flatMap((m) => [...m[1].matchAll(/`([a-z]+(?:-[a-z]+)*)`/g)].map((n) => n[1]))
      .sort()

    Assert.ok(10 < rules.length, `only ${rules.length} rules read from the script`)
    Assert.deepEqual(table, rules,
      'the rule table in DEV-PROCESS.md and the rules comment-gate.cjs reports differ')
  })

})
