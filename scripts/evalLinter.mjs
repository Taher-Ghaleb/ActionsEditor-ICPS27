// Week 2 evaluation — Part 1, "Run the linter across the corpus".
//
// For every real-world workflow file in tests/fixtures/corpus/, this parses
// it the same way the app does (parseYAMLToWorkflow), then runs the linter
// (lintWorkflow) against it, and writes an aggregate JSON report plus a
// human-readable summary to stdout. This is meant to answer one question for
// the paper: when pointed at workflows nobody wrote for this tool, does the
// linter produce sane, non-crashing output, and what does it actually flag?
//
// Usage: node scripts/evalLinter.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYAMLToWorkflow } from '../src/utils/yamlParser.js'
import { lintWorkflow } from '../src/utils/linter.js'
import { CATEGORIES, categorize } from './lintCategories.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'corpus')
const OUT_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'linter-report.json')

const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'manifest.json'), 'utf8'))
const files = manifest.files.map(f => f.file)

const perFile = []
let totalIssues = 0
let totalErrors = 0
let totalWarnings = 0
let parseFailures = 0
const byMessagePrefix = new Map() // finer-grained: first words of each message
const byCategory = Object.fromEntries(CATEGORIES.map(c => [c, { errors: 0, warnings: 0, total: 0, files: new Set() }]))

for (const file of files) {
  const filePath = path.join(CORPUS_DIR, file)
  const yamlStr = fs.readFileSync(filePath, 'utf8')

  let workflow = null
  let parseError = null
  try {
    workflow = parseYAMLToWorkflow(yamlStr)
  } catch (e) {
    parseError = e.message
    parseFailures++
  }

  let issues = []
  let lintCrashed = null
  try {
    issues = lintWorkflow(yamlStr, workflow)
  } catch (e) {
    lintCrashed = e.message
  }

  const errors = issues.filter(i => i.type === 'error')
  const warnings = issues.filter(i => i.type === 'warning')
  totalIssues += issues.length
  totalErrors += errors.length
  totalWarnings += warnings.length

  for (const issue of issues) {
    // Bucket by the first ~6 words, which is stable enough across files to
    // group "same kind of finding" without needing to hand-maintain a
    // category enum that will drift from the linter's actual messages.
    const key = issue.msg.split(' ').slice(0, 6).join(' ')
    byMessagePrefix.set(key, (byMessagePrefix.get(key) || 0) + 1)

    issue.category = categorize(issue.msg)
    const bucket = byCategory[issue.category]
    bucket.total++
    bucket[issue.type === 'error' ? 'errors' : 'warnings']++
    bucket.files.add(file)
  }

  perFile.push({
    file,
    parseError,
    lintCrashed,
    issueCount: issues.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    issues: issues.map(i => ({ type: i.type, category: i.category, line: i.line, msg: i.msg })),
  })
}

const report = {
  generated: new Date().toISOString(),
  corpusSize: files.length,
  totals: {
    issues: totalIssues,
    errors: totalErrors,
    warnings: totalWarnings,
    parseFailures,
  },
  issuesByCategory: Object.fromEntries(
    Object.entries(byCategory).map(([c, b]) => [c, { errors: b.errors, warnings: b.warnings, total: b.total, files: b.files.size }])
  ),
  issueFrequencyByMessage: Object.fromEntries(
    [...byMessagePrefix.entries()].sort((a, b) => b[1] - a[1])
  ),
  files: perFile,
}

fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2))

console.log(`Linted ${files.length} real-world workflow files from tests/fixtures/corpus/`)
console.log(`  total issues:   ${totalIssues}  (${totalErrors} errors, ${totalWarnings} warnings)`)
console.log(`  parse failures: ${parseFailures}`)
console.log('')
console.log('By category (errors / warnings / files affected):')
for (const [c, b] of Object.entries(byCategory)) {
  console.log(`  ${c.padEnd(24)} ${String(b.errors).padStart(2)} / ${String(b.warnings).padStart(2)} / ${b.files.size}`)
}
console.log('')
console.log('Per-file:')
for (const f of perFile) {
  const flag = f.parseError ? ' [PARSE ERROR]' : f.lintCrashed ? ' [LINTER CRASHED]' : ''
  console.log(`  ${f.file}: ${f.issueCount} issues (${f.errorCount}e/${f.warningCount}w)${flag}`)
}
console.log('')
console.log(`Full report written to tests/fixtures/linter-report.json`)
