import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lintWorkflow } from '../src/utils/linter.js'
import { buildLineLocator } from '../src/utils/lineLocator.js'
import { parseYAMLToWorkflow } from '../src/utils/yamlParser.js'
import { generateYAML } from '../src/utils/yamlGenerator.js'

// The app lints generateYAML(workflow), so the tests do the same and then
// check that the text on the reported line is the offending element.
function lintLines(src) {
  const wf = parseYAMLToWorkflow(src)
  const yaml = generateYAML(wf)
  const lines = yaml.split('\n')
  return lintWorkflow(yaml, wf).map(i => ({ ...i, text: (lines[i.line - 1] || '').trim() }))
}
const find = (issues, fragment) => issues.find(i => i.msg.includes(fragment))

const SRC = `name: Lint cases
on:
  push:
    branches: [main]
  schedule:
    - cron: '0 0 * *'
jobs:
  a:
    runs-on: ubuntu-latest
    needs: [b]
    steps:
      - name: one
        run: echo a
  b:
    runs-on: ubuntu-latest
    needs: [a]
    steps:
      - name: two
        if: \${{ gihtub.event_name == 'push' }}
        run: echo b
      - name: inject
        run: echo "\${{ github.event.issue.title }}"
      - uses: actions/checkout@main
  c:
    runs-on: ubuntu-lastest
    steps:
      - name: leak
        env:
          OK: fine
          TOKEN: ghp_abcdefghijklmnopqrstuvwxyz0123456789
        run: echo hi
`

test('findings are reported on the line of the offending element, not line 1', () => {
  const issues = lintLines(SRC)
  assert.match(find(issues, 'Invalid cron').text, /^- cron: 0 0 \* \*$/)
  assert.match(find(issues, 'invalid conditional expression').text, /^if: .*gihtub/)
  assert.match(find(issues, 'interpolates an attacker-controllable').text, /^run: echo/)
  assert.match(find(issues, 'mutable Git ref').text, /^uses: actions\/checkout@main$/)
  assert.match(find(issues, 'ubuntu-lastest').text, /^runs-on: ubuntu-lastest$/)
  assert.match(find(issues, 'hardcoded credential').text, /^TOKEN: ghp_/)
  assert.match(find(issues, 'Circular dependency').text, /^needs: /)
  assert.ok(issues.every(i => i.line > 1), 'no finding should be left at line 1')
})

test('the unnamed-step warning points at the step, and the steps are told apart by position', () => {
  const issues = lintLines(SRC)
  const unnamed = find(issues, 'has no name')
  assert.match(unnamed.text, /^- name: Unnamed step$/)
  // it is the 3rd step of job "b", so it must come after the "inject" step's line
  assert.ok(unnamed.line > find(issues, 'interpolates an attacker-controllable').line)
})

test('findings keep line 1 only when they concern the workflow as a whole', () => {
  const wf = parseYAMLToWorkflow('on:\n  push:\n    branches: [main]\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - name: x\n        run: echo hi\n')
  wf.name = ''
  const issues = lintWorkflow(generateYAML(wf), wf)
  const missingName = issues.find(i => i.msg.includes('missing a "name"'))
  assert.equal(missingName.line, 1)
})

test('syntax errors still report the parser line', () => {
  const issues = lintWorkflow('name: x\non: [push\njobs: {}\n', parseYAMLToWorkflow('name: x'))
  assert.equal(issues[0].msg.startsWith('YAML syntax error'), true)
  assert.ok(issues[0].line >= 1)
})

test('the locator handles quoted keys, flow-style fallbacks and unknown targets', () => {
  const y = 'on:\n  push:\n    branches: [main]\njobs:\n  "my-job":\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo a\n      - name: second\n        uses: a/b@v1\n'
  const loc = buildLineLocator(y)
  assert.equal(loc.locate({ job: 'my-job' }), 5)
  assert.equal(loc.locate({ job: 'my-job', key: 'runs-on' }), 6)
  assert.equal(loc.locate({ job: 'my-job', step: 0 }), 8)
  assert.equal(loc.locate({ job: 'my-job', step: 1, key: 'uses' }), 10)
  assert.equal(loc.locate({ trigger: 'push' }), 2)
  assert.equal(loc.locate({ job: 'nope' }), 1)                       // unknown job
  assert.equal(loc.locate({ job: 'my-job', step: 9 }), 5)            // unknown step -> its job
  assert.equal(buildLineLocator('on: [push]\njobs: {}\n').locate({ trigger: 'push' }), 1) // flow style -> 'on:' line
  assert.equal(loc.locate(undefined), 1)
})

test('a multi-line run block does not confuse the locator', () => {
  const y = 'jobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - name: s\n        run: |\n          uses: not-a-key\n          if: also-not-a-key\n        env:\n          K: v\n'
  const loc = buildLineLocator(y)
  assert.equal(loc.locate({ job: 'b', step: 0, key: 'run' }), 6)
  assert.equal(loc.locate({ job: 'b', step: 0, key: 'env', sub: 'K' }), 10)
  assert.equal(loc.locate({ job: 'b', step: 0, key: 'uses' }), 5) // not a real key -> step line
})
