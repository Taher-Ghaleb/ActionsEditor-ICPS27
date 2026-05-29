import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lintWorkflow, findDependencyCycles, validateExpression,
  validateGlobPattern, validateRunnerLabel,
  findScriptInjectionRisk, findCredentialLeak, findHardcodedSecretPattern,
} from '../src/utils/linter.js'
import { generateYAML } from '../src/utils/yamlGenerator.js'

// ------------------------------------------------------------
// Circular dependency detection
// ------------------------------------------------------------

test('detects a 2-job cycle (A needs B, B needs A)', () => {
  // INPUT:    jobs A(needs:B), B(needs:A)
  // EXPECTED: exactly one cycle found
  const jobs = [{ id: 'A', needs: ['B'] }, { id: 'B', needs: ['A'] }]
  const cycles = findDependencyCycles(jobs)
  assert.equal(cycles.length, 1)
})

test('detects a 3-job cycle (A -> C -> B -> A)', () => {
  // INPUT:    jobs A(needs:C), B(needs:A), C(needs:B)
  // EXPECTED: exactly one cycle found
  const jobs = [{ id: 'A', needs: ['C'] }, { id: 'B', needs: ['A'] }, { id: 'C', needs: ['B'] }]
  const cycles = findDependencyCycles(jobs)
  assert.equal(cycles.length, 1)
})

test('a valid linear DAG has no cycles', () => {
  // INPUT:    build -> test (needs build) -> deploy (needs test)
  // EXPECTED: zero cycles found
  const jobs = [
    { id: 'build', needs: [] },
    { id: 'test', needs: ['build'] },
    { id: 'deploy', needs: ['test'] },
  ]
  assert.equal(findDependencyCycles(jobs).length, 0)
})

// ------------------------------------------------------------
// Conditional expression validation
// ------------------------------------------------------------

test('a valid bare expression passes', () => {
  // INPUT:    success()
  // EXPECTED: no problems
  assert.deepEqual(validateExpression('success()'), [])
})

test('a valid wrapped expression with a string literal passes', () => {
  // INPUT:    ${{ github.event_name == 'push' }}
  // EXPECTED: no problems (the string literal is not mistaken for a context)
  assert.deepEqual(validateExpression("${{ github.event_name == 'push' }}"), [])
})

test('an unbalanced ${{ }} wrapper is flagged', () => {
  // INPUT:    ${{ success()
  // EXPECTED: one problem, about the malformed wrapper
  const problems = validateExpression('${{ success()')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /wrapper/)
})

test('an unknown context is flagged', () => {
  // INPUT:    ${{ foobar.event_name }}
  // EXPECTED: one problem, naming "foobar" as unknown
  const problems = validateExpression('${{ foobar.event_name }}')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /foobar/)
})

// ------------------------------------------------------------
// Glob pattern validation
// ------------------------------------------------------------

test('a normal glob pattern is valid', () => {
  // INPUT:    src/**
  // EXPECTED: no problems
  assert.deepEqual(validateGlobPattern('src/**'), [])
})

test('an unclosed character class is flagged', () => {
  // INPUT:    docs/[unclosed
  // EXPECTED: one problem about unbalanced brackets
  const problems = validateGlobPattern('docs/[unclosed')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /\[/)
})

// ------------------------------------------------------------
// Runner label validation
// ------------------------------------------------------------

test('a known GitHub-hosted runner label is valid', () => {
  // INPUT:    ubuntu-latest
  // EXPECTED: no problems
  assert.deepEqual(validateRunnerLabel('ubuntu-latest'), [])
})

test('a typo\'d runner label is flagged', () => {
  // INPUT:    ubuntu-latest-typo
  // EXPECTED: one problem
  assert.equal(validateRunnerLabel('ubuntu-latest-typo').length, 1)
})

test('a self-hosted runner array is valid', () => {
  // INPUT:    ['self-hosted', 'linux', 'x64']
  // EXPECTED: no problems
  assert.deepEqual(validateRunnerLabel(['self-hosted', 'linux', 'x64']), [])
})

test('a matrix expression is not second-guessed', () => {
  // INPUT:    ${{ matrix.os }}
  // EXPECTED: no problems (resolved at run time)
  assert.deepEqual(validateRunnerLabel('${{ matrix.os }}'), [])
})

// ------------------------------------------------------------
// Script injection risk
// ------------------------------------------------------------

test('interpolating an untrusted issue title directly is flagged', () => {
  // INPUT:    echo "${{ github.event.issue.title }}"
  // EXPECTED: one problem, mentioning script injection
  const problems = findScriptInjectionRisk('echo "${{ github.event.issue.title }}"')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /injection/)
})

test('reading the same value through env: first is safe', () => {
  // INPUT:    echo "$TITLE"   (the ${{ }} interpolation would be in env:, not run:)
  // EXPECTED: no problems
  assert.deepEqual(findScriptInjectionRisk('echo "$TITLE"'), [])
})

test('an unrelated expression in run: is safe', () => {
  // INPUT:    echo ${{ github.sha }}
  // EXPECTED: no problems (github.sha is not attacker-controlled free text)
  assert.deepEqual(findScriptInjectionRisk('echo ${{ github.sha }}'), [])
})

// ------------------------------------------------------------
// Hardcoded credential detection
// ------------------------------------------------------------

test('a literal value on a sensitively-named key is flagged', () => {
  // INPUT:    key="DB_PASSWORD", value="hunter2"
  // EXPECTED: one problem
  assert.equal(findCredentialLeak('DB_PASSWORD', 'hunter2').length, 1)
})

test('a secrets.* reference on the same key name is safe', () => {
  // INPUT:    key="DB_PASSWORD", value="${{ secrets.DB_PASSWORD }}"
  // EXPECTED: no problems
  assert.deepEqual(findCredentialLeak('DB_PASSWORD', '${{ secrets.DB_PASSWORD }}'), [])
})

test('a non-sensitive key with any value is safe', () => {
  // INPUT:    key="NODE_ENV", value="production"
  // EXPECTED: no problems
  assert.deepEqual(findCredentialLeak('NODE_ENV', 'production'), [])
})

test('an AWS access key literal is flagged regardless of key name', () => {
  // INPUT:    key="SOME_VAR", value="AKIAIOSFODNN7EXAMPLE"
  // EXPECTED: one problem
  assert.equal(findCredentialLeak('SOME_VAR', 'AKIAIOSFODNN7EXAMPLE').length, 1)
})

test('a known secret pattern inside a run: script is flagged', () => {
  // INPUT:    aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE
  // EXPECTED: one problem
  assert.equal(findHardcodedSecretPattern('aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE').length, 1)
})

test('a clean run: script is safe', () => {
  // INPUT:    npm run build
  // EXPECTED: no problems
  assert.deepEqual(findHardcodedSecretPattern('npm run build'), [])
})

// ------------------------------------------------------------
// Full integration: lintWorkflow end to end
// ------------------------------------------------------------

test('a deliberately bad workflow trips every new check at once', () => {
  // INPUT: a workflow combining a bad glob, a typo'd runner, a
  // hardcoded secret, and a script-injection risk.
  const workflow = {
    name: 'Bad Workflow',
    triggers: [{ type: 'push', branches: ['main', 'feat/[bad'] }],
    jobs: [
      {
        id: 'build',
        runsOn: 'ubuntu-latest-typo',
        env: { API_TOKEN: 'sk-abcdefghijklmnopqrstuvwx' },
        steps: [
          { name: 'Greet', run: 'echo "${{ github.event.issue.title }}"' },
          { name: 'Deploy', uses: 'actions/checkout@v4' },
        ],
      },
    ],
  }
  const issues = lintWorkflow(generateYAML(workflow), workflow)

  // EXPECTED: at least one issue mentioning each of the four new checks.
  const messages = issues.map(i => i.msg).join('\n')
  assert.match(messages, /filter pattern/)       // glob check
  assert.match(messages, /runner label/)          // runner check
  assert.match(messages, /hardcoded credential|secret key/) // credential check
  assert.match(messages, /injection/)             // script injection check
})

test('a clean, correctly-written workflow produces zero errors', () => {
  // INPUT: a valid two-job workflow using secrets.* correctly and
  // no risky patterns.
  const workflow = {
    name: 'Clean',
    triggers: [{ type: 'push', branches: ['main'] }],
    jobs: [
      {
        id: 'build', runsOn: 'ubuntu-latest', env: { NODE_ENV: 'production' },
        steps: [
          { name: 'Checkout', uses: 'actions/checkout@v4' },
          { name: 'Build', run: 'npm run build' },
        ],
      },
      {
        id: 'deploy', runsOn: 'ubuntu-latest', needs: ['build'],
        env: { API_TOKEN: '${{ secrets.API_TOKEN }}' },
        steps: [{ name: 'Deploy', run: 'echo deploying' }],
      },
    ],
  }
  const issues = lintWorkflow(generateYAML(workflow), workflow)
  const errors = issues.filter(i => i.type === 'error')
  assert.deepEqual(errors, [])
})
