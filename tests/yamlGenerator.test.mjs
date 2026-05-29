import { test } from 'node:test'
import assert from 'node:assert/strict'
import jsyaml from 'js-yaml'
import { generateYAML, quoteYAMLScalar, needsYAMLQuoting } from '../src/utils/yamlGenerator.js'

// ------------------------------------------------------------
// quoteYAMLScalar / needsYAMLQuoting
// Each case: INPUT -> EXPECTED OUTPUT, with the reason it matters.
// ------------------------------------------------------------

test('plain safe string is left unquoted', () => {
  // INPUT:    'ubuntu-latest'
  // EXPECTED: 'ubuntu-latest'  (no special characters, quoting would just add noise)
  assert.equal(quoteYAMLScalar('ubuntu-latest'), 'ubuntu-latest')
})

test('colon-space is quoted (would otherwise look like a YAML key)', () => {
  // INPUT:    'Build: prod'
  // EXPECTED: '"Build: prod"'
  assert.equal(quoteYAMLScalar('Build: prod'), '"Build: prod"')
})

test('colon with no following space is left unquoted (e.g. docker image tags, URLs with ports)', () => {
  // INPUT:    'node:18'
  // EXPECTED: 'node:18'  (a bare colon is not special in YAML; only ": " or a trailing ":" is)
  assert.equal(quoteYAMLScalar('node:18'), 'node:18')
  assert.equal(quoteYAMLScalar('https://example.com:8080/api'), 'https://example.com:8080/api')
})

test('a trailing colon is quoted', () => {
  // INPUT:    'note:'
  // EXPECTED: '"note:"'
  assert.equal(quoteYAMLScalar('note:'), '"note:"')
})

test('leading "!" is quoted (YAML would otherwise read it as a type tag)', () => {
  // INPUT:    '!cancelled()'
  // EXPECTED: '"!cancelled()"'
  assert.equal(quoteYAMLScalar('!cancelled()'), '"!cancelled()"')
})

test('YAML reserved words are quoted so they stay strings', () => {
  // INPUT:    'yes' / 'true' / 'null'
  // EXPECTED: '"yes"' / '"true"' / '"null"'  (unquoted, YAML would parse these as boolean/null, not string)
  assert.equal(quoteYAMLScalar('yes'), '"yes"')
  assert.equal(quoteYAMLScalar('true'), '"true"')
  assert.equal(quoteYAMLScalar('null'), '"null"')
})

test('a number-looking string is quoted so it stays a string', () => {
  // INPUT:    '42'
  // EXPECTED: '"42"'
  assert.equal(quoteYAMLScalar('42'), '"42"')
})

test('embedded quotes and backslashes are escaped', () => {
  // INPUT:    echo "hello: world"
  // EXPECTED: "echo \"hello: world\""   (double-quoted, with internal quotes escaped)
  assert.equal(quoteYAMLScalar('echo "hello: world"'), '"echo \\"hello: world\\""')
})

test('empty string is quoted', () => {
  // INPUT:    ''
  // EXPECTED: '""'
  assert.equal(quoteYAMLScalar(''), '""')
})

// ------------------------------------------------------------
// generateYAML — full round-trip: object -> YAML string -> parsed back
// ------------------------------------------------------------

test('generateYAML output round-trips through js-yaml for tricky values', () => {
  // INPUT: a workflow object with a colon in the name, a "!"-leading
  // condition, a run command with embedded quotes and a colon, and a
  // "with:" value equal to the YAML reserved word "yes".
  const workflow = {
    name: 'Build: prod',
    triggers: [{ type: 'push', branches: ['main'] }],
    jobs: [
      {
        id: 'build',
        runsOn: 'ubuntu-latest',
        condition: '!cancelled()',
        steps: [
          { name: 'Run: tests', run: 'echo "hello: world"' },
          { name: 'Deploy', uses: 'actions/checkout@v4', with: { ref: 'yes' } },
        ],
      },
    ],
  }

  const yamlStr = generateYAML(workflow)

  // EXPECTED: js-yaml parses the generated string without throwing...
  const parsed = jsyaml.load(yamlStr)

  // ...and every tricky value survives the round trip unchanged.
  assert.equal(parsed.name, 'Build: prod')
  assert.equal(parsed.jobs.build.if, '!cancelled()')
  assert.equal(parsed.jobs.build.steps[0].run, 'echo "hello: world"')
  assert.equal(parsed.jobs.build.steps[1].with.ref, 'yes')
  assert.equal(typeof parsed.jobs.build.steps[1].with.ref, 'string') // not parsed as boolean true
})
