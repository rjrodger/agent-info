
'use strict'

const { describe, test } = require('node:test')
const Assert = require('node:assert')
const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const { spawnSync } = require('node:child_process')

const REPO = Path.join(__dirname, '..')
const SCRIPT = Path.join(REPO, 'admin', 'scripts', 'prose-gate.cjs')

const gate = require(SCRIPT)


function fixture(t, files) {
  const root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'prose-gate-'))
  t.after(() => Fs.rmSync(root, { recursive: true, force: true }))
  for (const [rel, content] of Object.entries({
    'admin/scripts/prose-gate.cjs': Fs.readFileSync(SCRIPT, 'utf8'),
    ...files,
  })) {
    const abs = Path.join(root, rel)
    Fs.mkdirSync(Path.dirname(abs), { recursive: true })
    Fs.writeFileSync(abs, content)
  }
  return root
}


function run(root, ...args) {
  const out = spawnSync(process.execPath,
    [Path.join(root, 'admin', 'scripts', 'prose-gate.cjs'), ...args],
    { encoding: 'utf8' })
  const findings = out.stdout.split('\n')
    .map((line) => line.match(/^(\S+):(\d+): ([a-z-]+): (.*)$/))
    .filter((m) => null != m)
    .map((m) => `${m[1]}:${m[2]} ${m[3]} ${m[4]}`)
  return { status: out.status, stdout: out.stdout, stderr: out.stderr, findings }
}


const CONFIG = JSON.stringify({
  pages: ['README.md', 'docs/**/*.md', 'STYLE-GUIDE.md'],
  tutorials: ['docs/tutorial-*.md'],
  contributor: ['README.md'],
  links: ['**/*.md'],
  skip: ['node_modules', '.git', 'sketch'],
  names: [{ pattern: 'Widget', spelled: 'widget' }],
  internal: [{ pattern: 'LANDED', what: 'a status' }],
})

const REJECT = [
  '# --- Filler and false emphasis ---',
  'worth noting',
  'robust',
  '',
  '# --- Made-up category ---',
  'frobnicate',
  '',
].join('\n')

const VOCABULARY = '.vale/styles/config/vocabularies/House/reject.txt'


describe('prose-gate', () => {

  test('a-fixture-reports-what-it-holds', (t) => {
    const root = fixture(t, {
      'admin/scripts/prose-gate.json': CONFIG,
      [VOCABULARY]: REJECT,
      'STYLE-GUIDE.md': '# Guide\n\nThe list quotes `robust`. Filler and false emphasis.\n',
      'AGENTS.md': '# Agents\n',
      'README.md': '# widget\n\nSee ADR-3, and the [guide](STYLE-GUIDE.md#guide).\n',
      'docs/tutorial-start.md': [
        '# Start here',
        '',
        'We write the file together. It works!',
        'Then it works again!',
        '',
      ].join('\n'),
      'docs/reference-cli.md': [
        '---',
        'title: The command',
        '---',
        '# The command',
        '',
        'The command is robust — and it reads `we` in code.',
        'I ran it once. See ADR-12 and [the guide](../AGENTS.md).',
        'This is worth',
        'noting here.',
        'Our tool \u{1F680} is spelled Widget here, US English, LANDED.',
        '[Missing](missing.md), [heading](tutorial-start.md#nowhere), [fine](tutorial-start.md#start-here).',
        '',
        '```sh',
        '$ widget --robust # ADR-1 — we!',
        '```',
        '',
      ].join('\n'),
      'sketch/notes.md': '[broken](nowhere.md)\n',
    })

    const out = run(root)
    Assert.equal(out.status, 1, out.stdout + out.stderr)
    Assert.deepEqual(out.findings.sort(), [
      `${VOCABULARY}:5 guide-category "Made-up category" has no summary in STYLE-GUIDE.md`,
      'docs/reference-cli.md:10 emoji an emoji',
      'docs/reference-cli.md:10 first-person-plural "Our" outside a tutorial',
      'docs/reference-cli.md:10 internal-citation cites a status',
      'docs/reference-cli.md:10 name-spelling "Widget" is spelled widget',
      'docs/reference-cli.md:11 dead-link missing.md: no such file',
      'docs/reference-cli.md:11 dead-link tutorial-start.md#nowhere: no such heading',
      'docs/reference-cli.md:14 internal-citation cites a decision record',
      'docs/reference-cli.md:6 banned-phrase "robust"',
      'docs/reference-cli.md:6 em-dash an em dash in prose',
      'docs/reference-cli.md:7 first-person-singular "I"',
      'docs/reference-cli.md:7 internal-citation cites a decision record',
      'docs/reference-cli.md:7 internal-citation cites a link to a contributor guide',
      'docs/reference-cli.md:8 banned-phrase "worth noting"',
      'docs/tutorial-start.md:4 exclamation mark 2, and a tutorial gets one',
    ].sort())

    Assert.deepEqual(run(root, '--list').stdout.split('\n').filter(Boolean),
      ['README.md', 'docs/reference-cli.md', 'docs/tutorial-start.md'],
      'the guide is never a gated page')
  })


  test('a-clean-fixture-passes', (t) => {
    const root = fixture(t, {
      'admin/scripts/prose-gate.json': CONFIG,
      [VOCABULARY]: REJECT.replace('Made-up category', 'Filler and false emphasis'),
      'STYLE-GUIDE.md': '# Guide\n\nFiller and false emphasis.\n',
      'docs/how-to.md': '# Do the thing\n\nRun it, then read [the options](reference.md#options).\n',
      'docs/reference.md': '# Reference\n\n## Options\n\nEach option is listed here.\n',
    })
    const out = run(root)
    Assert.equal(out.status, 0, out.stdout + out.stderr)
    Assert.equal(out.stdout, 'prose gate: clean\n')
  })


  test('reference-links-and-setext-anchors-are-checked', (t) => {
    const root = fixture(t, {
      'admin/scripts/prose-gate.json': JSON.stringify({ pages: [], links: ['**/*.md'] }),
      [VOCABULARY]: 'robust\n',
      'docs/a.md': [
        '[the missing page][missing], [the options][opts] and a note.[^1]',
        '',
        '[missing]: missing-page.md',
        '[opts]: b.md#options',
        '[^1]: A footnote is text, not a destination.',
        '',
      ].join('\n'),
      'docs/b.md': 'Options for\nthe command\n-------\n\n[back](b.md#options-for-the-command)\n',
      'docs/c.md': '[gone](b.md#options)\n',
    })
    const out = run(root)
    Assert.equal(out.status, 1, out.stdout + out.stderr)
    Assert.deepEqual(out.findings.sort(), [
      'docs/a.md:3 dead-link missing-page.md: no such file',
      'docs/a.md:4 dead-link b.md#options: no such heading',
      'docs/c.md:1 dead-link b.md#options: no such heading',
    ])
  })


  test('a-bare-hash-in-the-banned-list-is-refused', (t) => {
    const root = fixture(t, {
      'admin/scripts/prose-gate.json': CONFIG,
      [VOCABULARY]: 'robust\n#\n',
      'docs/a.md': '# A\n',
    })
    const out = run(root)
    Assert.equal(out.status, 2, out.stdout + out.stderr)
    Assert.match(out.stderr, /only "#" bans the character/)
  })


  test('the-checks-catch-what-they-claim', () => {
    const faults = []
    const claim = (ok, what) => {
      if (!ok) faults.push(what)
    }
    const { CODE_SPAN, CODE_WRAP, EMOJI, EXCLAMATION, FIRST_WE, INTERNAL } = gate

    claim('' === '``a `b` c``'.replace(CODE_SPAN, ''), 'multi-backtick span')
    claim('x  y' === 'x `my` y'.replace(CODE_SPAN, ''), 'single-backtick span')
    claim('````not just```' === '````not just```'.replace(CODE_SPAN, ''),
      'a shorter closing run is not a code span')
    claim('a \n b' === 'a `x !(y ==\nz)` b'.replace(CODE_SPAN, '')
      .replace(CODE_WRAP, (m) => m.replace(/[^\n]/g, '')).replace(/ +/g, ' '),
      'a span that wraps once is still a span')
    claim('an odd ` mark\nand my line' ===
      'an odd ` mark\nand my line'.replace(CODE_SPAN, ''),
      'an unpaired backtick does not swallow the next line')

    for (const text of ['⚠', '✓', '↔', '†']) {
      claim(!EMOJI.test(text), `text-presentation symbol ${text} is not emoji`)
    }
    for (const text of ['\u{1F680}', '1️⃣', '\u{1F1EC}\u{1F1E7}',
      '©️', '↗️']) {
      claim(EMOJI.test(text), `${text} is emoji`)
    }

    claim(null != gate.firstSingular('My grammar is strict.'), 'My opens a sentence')
    claim(null != gate.firstSingular('Mine is stricter.'), 'Mine opens a sentence')
    claim(null == gate.firstSingular('The disk I/O is buffered.'), 'I/O is not a pronoun')
    claim(null == gate.firstSingular('A unify step, i.e. a merge.'), 'the i of i.e.')
    claim(null != gate.firstSingular('Then I ran it.'), 'a capital I is a pronoun')

    claim(FIRST_WE.test('Then we run it.'), 'we is a pronoun')
    claim(FIRST_WE.test('Let’s run it.'), 'a curly apostrophe in let’s')
    claim(!FIRST_WE.test('Google style is US English.'), 'US is an initialism')
    claim(!FIRST_WE.test('The status is set.'), 'us inside a word')

    const bang = (text) => (text.match(EXCLAMATION) || []).length
    claim(1 === bang('It works **now!** Next'), 'mark before bold close')
    claim(1 === bang('He said "Done!" then'), 'mark before a quote')
    claim(1 === bang('Really?!'), 'mark after another mark')
    claim(2 === bang('Great!!'), 'two marks are two marks')
    claim(0 === bang('if (a != b)'), '!= is an operator')
    claim(0 === bang('![alt](src)'), 'an image is not a mark')
    claim(0 === bang(gate.prose('See [docs](https://host/a!b) now.')),
      'a link destination is not prose')
    claim(0 === bang(gate.prose('Read <https://host/a!b>.')), 'nor an autolink')
    claim(0 === bang(gate.prose('Read https://host/a!b today.')), 'nor a bare one')
    claim(1 === bang(gate.prose('Read https://host/a!')),
      'the mark ending the sentence after one still counts')
    claim(1 === bang(gate.prose('See [docs](https://host/a) now!')),
      'the mark outside one still counts')
    claim('' === gate.prose('Text ``a ` !\nb`` more.').replace(/[^!]/g, ''),
      'a wrapped span holding a shorter run is still a span')
    claim(7 === gate.prose('---\na: 1\n---\nx\n<!-- a\nb -->\ny').split('\n').length,
      'frontmatter and comments keep their lines')
    claim(!/We|robust|!/.test(gate.prose(
      '- Example:\n\n    ```js\n    const text = "We are robust!"\n    ```\n')),
      'a fence indented inside a list item is still a fence')

    const joins = (md, phrase) =>
      gate.logical(md).some((para) => para.text.includes(phrase))
    claim(!joins('## Something worth\nnoting this', 'worth noting'),
      'a heading is not the paragraph under it')
    claim(!joins('| a | worth |\n| noting | b |', 'worth | | noting'),
      'a table row is not the row above it')
    claim(joins('| This explanation is worth\nnoting here', 'worth noting'),
      'one pipe is a sentence, not a table row')
    claim(!joins('| Not only one\n| ---\n| but two', 'one | --- | but'),
      'a delimiter row makes one pipe a table row after all')
    claim(joins('a sentence worth\nnoting here', 'worth noting'),
      'a wrapped paragraph still joins')
    claim(joins('- an item worth\n  noting here', 'worth noting'),
      'a wrapped list item still joins')

    const banned = (text) => gate.bannedList().some(([re]) => {
      re.lastIndex = 0
      return re.test(text)
    })
    claim(banned('so let’s break it down'), 'a curly apostrophe')
    claim(banned("so let's break it down"), 'a straight apostrophe')
    claim(!banned('the API surface'), 'a noun the guide leaves alone')

    const cites = (text) => INTERNAL.some(([re]) => {
      re.lastIndex = 0
      return re.test(text)
    })
    claim(cites('ADR-018 removed the pipe'), 'a numbered decision record')
    claim(cites('as the ADR says'), 'the bare record')
    claim(cites('the steps in admin/scripts'), 'the admin folder')
    claim(cites('[the gate](../admin/scripts/comment-gate.cjs)'),
      'the admin folder climbed to from a page')
    claim(cites('[a tracker](../../admin/README.md)'),
      'the admin folder climbed to from a nested page')
    claim(!cites('a model at services/admin/roles.json'),
      'a path that ends in admin/')
    claim(!cites('a model at ../services/admin/roles.json'),
      'a climbed path that ends in admin/')
    claim(cites('[the process](../DEV-PROCESS.md#testing)'), 'a link to the process')
    claim(!cites('the tool writes AGENTS.md'), 'the bare name is product surface')
    claim(cites('a Diátaxis tutorial'), 'the documentation framework by name')
    claim(cites('the DIATAXIS split'), 'the framework without its accent, in capitals')

    claim('the-structure-diátaxis-enforced-by-placement' ===
      gate.slug('The structure: Diátaxis, enforced by placement'), 'a letter outside ASCII')
    claim('--list-and-more' === gate.slug('`--list` and more'), 'a code span in a heading')
    const repeats = gate.anchors('# Notes\n## Notes\n```\n# Notes\n```\n')
    claim(repeats.has('notes') && repeats.has('notes-1') && !repeats.has('notes-2'),
      'a repeated heading counts its repeats, and a fence holds none')
    const setext = [...gate.anchors('---\ntitle: x\n---\nTitle\n=====\n\nSee\nalso\n---\n---\n')]
    claim('title,see-also' === setext.join(','),
      'a Setext heading is an anchor, and frontmatter and a second rule are not')

    Assert.deepEqual(faults, [],
      `these rules no longer catch what they claim:\n${faults.join('\n')}`)
  })


  test('the-guide-names-every-rule', () => {
    const source = Fs.readFileSync(SCRIPT, 'utf8')
    const rules = [...new Set([...source.matchAll(
      /(?:add\([^,()]+,\s*|rule:\s*)'([a-z]+(?:-[a-z]+)*)'/g)]
      .map((m) => m[1]))].sort()
    const guide = Fs.readFileSync(Path.join(REPO, 'STYLE-GUIDE.md'), 'utf8')
    const section = guide.split('| Rule | Fails when |')[1].split('\n\n')[0]
    const table = [...section.matchAll(/^\| `([a-z]+(?:-[a-z]+)*)` \|/gm)]
      .map((m) => m[1]).sort()

    Assert.ok(8 < rules.length, `only ${rules.length} rules read from the script`)
    Assert.deepEqual(table, rules,
      'the rule table in STYLE-GUIDE.md and the rules prose-gate.cjs reports differ')
  })


  test('the-style-guide-names-both-gates', () => {
    const guide = Fs.readFileSync(Path.join(REPO, 'STYLE-GUIDE.md'), 'utf8')
    for (const name of ['prose-gate.cjs', 'prose-gate.json', '.vale.ini', 'reject.txt',
      'vale-counts.cjs']) {
      Assert.ok(guide.includes(name), `STYLE-GUIDE.md does not name ${name}`)
    }
  })


  test('this-repository-is-clean', () => {
    const findings = gate.checkAll()
    Assert.deepEqual(findings.map((f) => `${f.file}:${f.line}: ${f.rule}: ${f.detail}`), [])
  })

})
