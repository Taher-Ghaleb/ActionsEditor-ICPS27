// Week 2 evaluation — Part 1, "Round-trip correctness test".
//
// For every real-world workflow file in tests/fixtures/corpus/, this checks
// two different, complementary notions of "round-trips correctly":
//
//   Level A (does the app's own model survive a round trip through itself?):
//     parse(original) -> workflow1
//     generate(workflow1) -> regeneratedYaml
//     parse(regeneratedYaml) -> workflow2
//     workflow1 deep-equals workflow2 ?
//   This answers "if I load a file, don't touch it, and save it, does the
//   app's internal representation stay stable?" It does NOT tell you whether
//   information from the ORIGINAL file was silently dropped on the very
//   first parse — that's what Level B is for.
//
//   Level B (does the regenerated YAML preserve the same data as the
//   original file, at the raw-YAML-value level?):
//     jsyaml.load(original) vs jsyaml.load(regeneratedYaml), deep-equal
//   Differences here are then split into "expected" (fields the parser is
//   already known not to model — see KNOWN_UNMODELED_PATHS below, which
//   mirrors the gaps found by earlier code review of yamlParser.js) vs
//   "unexpected" (anything else — a real, previously undocumented fidelity
//   bug).
//
// Usage: node scripts/evalRoundTrip.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jsyaml from 'js-yaml'
import { parseYAMLToWorkflow } from '../src/utils/yamlParser.js'
import { generateYAML } from '../src/utils/yamlGenerator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'corpus')
const OUT_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'roundtrip-report.json')

const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'manifest.json'), 'utf8'))
const files = manifest.files.map(f => f.file)

// How a Level-B difference is classified. Matching is done on the *anchored*
// diff path (jobs.<id>.<field>, on.<trigger>.<field>, ...), never on a loose
// substring: an earlier version matched ".with" / ".uses" anywhere in the
// path, which also swallowed step-level "with:" differences (a boolean or
// number turned into a string) and reported them as "expected".
//
// KNOWN_UNMODELED: fields yamlParser.js does not carry into the workflow
// model at all, so they are lost on save. Documented as limitations.
const KNOWN_UNMODELED = [
  /^run-name$/,
  /(^|\.)defaults(\.|$)/,
  /^on\.workflow_call\.(secrets|outputs)(\.|$)/,
  /^on\.workflow_run\.workflows(\.|\[|$)/,
  /^on\.[^.]+\.inputs\.[^.]+\.options(\.|\[|$)/,
  /^jobs\.[^.]+\.concurrency(\.|$)/,
  /^jobs\.[^.]+\.container\.(?!image$)/,
  /^jobs\.[^.]+\.services\.[^.]+\.(options|volumes|credentials)(\.|\[|$)/,
]

// DELIBERATE: intentional editor simplifications, not fidelity bugs.
//  - an explicit "shell: bash" (the default) is omitted on save
//  - a step with no name is written back with the placeholder "Unnamed step"
//  - a job "name:" equal to the job id is omitted (same display name)
//  - an input without "required:" is written back with "required: false"
//    (its documented default)
function isDeliberate(d) {
  if (/\.shell$/.test(d.path) && d.original === 'bash' && d.regenerated === undefined) return true
  if (/\.steps\[\d+\]\.name$/.test(d.path) && d.original === undefined && d.regenerated === 'Unnamed step') return true
  if (/^jobs\.[^.]+\.name$/.test(d.path) && d.regenerated === undefined) return true
  if (/^on\.[^.]+\.inputs\.[^.]+\.required$/.test(d.path) && d.original === undefined && d.regenerated === false) return true
  return false
}

function classify(d) {
  if (KNOWN_UNMODELED.some(re => re.test(d.path))) return 'knownUnmodeled'
  if (isDeliberate(d)) return 'deliberate'
  return 'unexpected'
}

// Minimal recursive deep-diff that reports JSON-Pointer-ish paths, since
// assert.deepEqual only tells you THAT two objects differ, not WHERE —
// and for a report meant to end up in a paper's limitations table, WHERE
// is the entire point.
function diff(a, b, pathStr = '') {
  const diffs = []
  if (a === b) return diffs
  const aIsObj = a && typeof a === 'object'
  const bIsObj = b && typeof b === 'object'
  if (!aIsObj || !bIsObj) {
    diffs.push({ path: pathStr || '(root)', original: a, regenerated: b })
    return diffs
  }
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr !== bArr) {
    diffs.push({ path: pathStr || '(root)', original: a, regenerated: b })
    return diffs
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const childPath = aArr ? `${pathStr}[${key}]` : (pathStr ? `${pathStr}.${key}` : key)
    diffs.push(...diff(a[key], b[key], childPath))
  }
  return diffs
}

// Strip UI-only, intentionally-nondeterministic bookkeeping fields before
// comparing two parses of "the same" workflow. parseYAMLToWorkflow() stamps
// every trigger/job/step with a freshly generated React list key on each
// call (job.\_key, step.\_key, and trigger.id in the form "id_<timestamp>_<n>"),
// so two parses of byte-identical YAML will never be reference-equal even
// though nothing about the WORKFLOW changed. Job.id and step.id are a
// different thing (the real, YAML-meaningful GitHub Actions id) and are
// deliberately left untouched.
function stripUiOnlyFields(value) {
  if (Array.isArray(value)) return value.map(stripUiOnlyFields)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === '_key') continue
      if (k === 'id' && typeof v === 'string' && /^id_\d+_\d+$/.test(v)) continue
      out[k] = stripUiOnlyFields(v)
    }
    return out
  }
  return value
}

// Key order is not meaningful in a workflow model, so compare with sorted keys.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  }
  return value
}

function deepEqualJson(a, b) {
  return JSON.stringify(canonical(stripUiOnlyFields(a))) === JSON.stringify(canonical(stripUiOnlyFields(b)))
}

const perFile = []
let levelAPass = 0        // strict: load+save once leaves the model unchanged
let levelAFixedPoint = 0  // the SECOND save changes nothing (model has settled)
let levelBExact = 0       // regenerated YAML has identical values, no diff at all
let levelBNoUnexpected = 0 // only known-unmodeled / deliberate differences
let totalUnexpected = 0
let totalKnown = 0
let totalDeliberate = 0

for (const file of files) {
  const filePath = path.join(CORPUS_DIR, file)
  const originalYaml = fs.readFileSync(filePath, 'utf8')

  let workflow1, regeneratedYaml, workflow2, regeneratedYaml2, workflow3
  let crashed = null
  try {
    workflow1 = parseYAMLToWorkflow(originalYaml)
    regeneratedYaml = generateYAML(workflow1)
    workflow2 = parseYAMLToWorkflow(regeneratedYaml)
    regeneratedYaml2 = generateYAML(workflow2)
    workflow3 = parseYAMLToWorkflow(regeneratedYaml2)
  } catch (e) {
    crashed = e.message
  }

  const levelA = crashed
    ? { pass: false, fixedPoint: false, crashed }
    : {
        pass: deepEqualJson(workflow1, workflow2),
        fixedPoint: deepEqualJson(workflow2, workflow3),
        crashed: null,
      }
  if (levelA.pass) levelAPass++
  if (levelA.fixedPoint) levelAFixedPoint++

  let levelB = { pass: null, exact: null, knownUnmodeledDiffs: [], deliberateDiffs: [], unexpectedDiffs: [] }
  if (!crashed) {
    const allDiffs = diff(jsyaml.load(originalYaml), jsyaml.load(regeneratedYaml))
    const knownUnmodeledDiffs = allDiffs.filter(d => classify(d) === 'knownUnmodeled')
    const deliberateDiffs = allDiffs.filter(d => classify(d) === 'deliberate')
    const unexpectedDiffs = allDiffs.filter(d => classify(d) === 'unexpected')
    levelB = {
      pass: unexpectedDiffs.length === 0,
      exact: allDiffs.length === 0,
      knownUnmodeledDiffs,
      deliberateDiffs,
      unexpectedDiffs,
    }
    if (levelB.exact) levelBExact++
    if (levelB.pass) levelBNoUnexpected++
    totalUnexpected += unexpectedDiffs.length
    totalKnown += knownUnmodeledDiffs.length
    totalDeliberate += deliberateDiffs.length
  }

  perFile.push({ file, crashed, levelA, levelB })
}

const n = files.length
const report = {
  generated: new Date().toISOString(),
  corpusSize: n,
  summary: {
    levelA_modelUnchangedByOneSave: `${levelAPass}/${n}`,
    levelA_modelStableOnSecondSave: `${levelAFixedPoint}/${n}`,
    levelB_identicalValues: `${levelBExact}/${n}`,
    levelB_noUnexpectedDifferences: `${levelBNoUnexpected}/${n}`,
    totalUnexpectedDiffs: totalUnexpected,
    totalKnownUnmodeledDiffs: totalKnown,
    totalDeliberateDiffs: totalDeliberate,
  },
  files: perFile,
}

fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2))

console.log(`Round-trip check across ${n} real-world workflow files`)
console.log(`  Level A  model unchanged by one load+save:              ${levelAPass}/${n}`)
console.log(`  Level A  model stable on the second save (fixed point): ${levelAFixedPoint}/${n}`)
console.log(`  Level B  regenerated values identical to original:      ${levelBExact}/${n}`)
console.log(`  Level B  no UNEXPECTED differences:                     ${levelBNoUnexpected}/${n}`)
console.log(`  differences: ${totalUnexpected} unexpected, ${totalKnown} known-unmodeled, ${totalDeliberate} deliberate`)
console.log('')
for (const f of perFile) {
  if (f.crashed) { console.log(`  ${f.file}: CRASH ${f.crashed}`); continue }
  const b = f.levelB
  console.log(`  ${f.file}: A=${f.levelA.pass ? 'ok' : 'DIFF'}/${f.levelA.fixedPoint ? 'stable' : 'UNSTABLE'}  B=${b.exact ? 'identical' : b.pass ? 'ok' : `${b.unexpectedDiffs.length} unexpected`}` +
    ` (known ${b.knownUnmodeledDiffs.length}, deliberate ${b.deliberateDiffs.length})`)
  for (const d of b.unexpectedDiffs.slice(0, 5)) console.log(`      UNEXPECTED at ${d.path}`)
}
console.log('')
console.log(`Full report written to tests/fixtures/roundtrip-report.json`)
