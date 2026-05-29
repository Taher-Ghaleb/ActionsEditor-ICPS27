// Maps a linter message to the validation category it belongs to, using the
// same category names as the "Linting and Rule Checking" list in the paper.
// Order matters: the first matching rule wins, and the more specific rules
// (glob patterns, runner labels, conditional expressions) come before the
// broader "Trigger ..." / "Job ..." ones whose messages start the same way.
// categorize() throws on a message it does not recognize, so a new linter
// message cannot silently end up uncounted in the evaluation report.

export const CATEGORIES = [
  'YAML-level',
  'Trigger',
  'Job structure',
  'Dependency graph',
  'Step',
  'Conditional expression',
  'Security',
  'Hardcoded credential',
  'Glob pattern',
  'Runner label',
]

const RULES = [
  ['YAML-level', /^YAML syntax error/],
  ['Glob pattern', /has an invalid (branch|tag|path) filter pattern/],
  ['Conditional expression', /has an invalid conditional expression/],
  ['Runner label', /not a recognized GitHub-hosted runner/],
  ['Dependency graph', /needs ".*", but no job with that ID exists|cannot depend on itself|^Circular dependency/],
  ['Security', /without a version pin|pinned to a mutable Git ref|attacker-controllable value/],
  ['Hardcoded credential', /hardcoded credential|contains what looks like/],
  ['Trigger', /^No triggers defined|^Trigger "|^Invalid cron|^Workflow is missing a "name"/],
  ['Job structure', /^No jobs defined|^A job is missing an ID|^Job ID|^Duplicate job ID|is missing "runs-on"|has no steps defined|calls a reusable workflow/],
  ['Step', /has both "uses" and "run"|has neither "uses" nor "run"|has no name|^Duplicate step ID/],
]

export function categorize(message) {
  for (const [category, re] of RULES) {
    if (re.test(message)) return category
  }
  throw new Error(`Linter message has no evaluation category: ${message}`)
}
