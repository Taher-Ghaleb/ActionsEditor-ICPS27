// ============================================================
// Line locator — maps a structural position in a workflow
// (a trigger, a job, the Nth step of a job, a key inside one of
// them) to a 1-based line number in the YAML text the editor
// displays.
//
// The linter reasons about the workflow *model*, which has no
// source positions, so findings used to be reported at line 1.
// The YAML shown in the editor is produced by generateYAML() in
// one fixed block-style layout, so the locator can find each
// element by indentation instead of re-parsing the document with
// position tracking. If an element cannot be found (for example
// flow-style YAML), the locator falls back to the nearest
// enclosing element, and finally to line 1.
// ============================================================

const KEY_RE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s:#'"-][^:#]*?|-[^\s:#][^:#]*?))\s*:(?=\s|$)/

function indentOf(line) {
  return line.length - line.trimStart().length
}

function parseKey(trimmed) {
  const m = KEY_RE.exec(trimmed)
  if (!m) return null
  return m[1] ?? m[2] ?? m[3]
}

export function buildLineLocator(yamlStr) {
  const lines = String(yamlStr || '').split('\n')
  const isSkippable = l => l.trim() === '' || l.trim().startsWith('#')

  // First line after `i` (exclusive) that is NOT part of the block opened at `i`.
  function blockEnd(i) {
    const base = indentOf(lines[i])
    for (let j = i + 1; j < lines.length; j++) {
      if (isSkippable(lines[j])) continue
      const ind = indentOf(lines[j])
      if (ind < base) return j
      if (ind === base && !lines[j].trim().startsWith('- ')) return j
    }
    return lines.length
  }

  // Indentation used by the direct children of the block opened at `i`.
  function childIndent(i, end) {
    for (let j = i + 1; j < end; j++) {
      if (!isSkippable(lines[j])) return indentOf(lines[j])
    }
    return -1
  }

  // Line of mapping key `name` that is a direct child of the block at `parent`.
  function childKey(parent, name) {
    const end = blockEnd(parent)
    const ci = childIndent(parent, end)
    if (ci < 0) return -1
    for (let j = parent + 1; j < end; j++) {
      if (isSkippable(lines[j]) || indentOf(lines[j]) !== ci) continue
      if (parseKey(lines[j].trim()) === name) return j
    }
    return -1
  }

  function topKey(name) {
    for (let j = 0; j < lines.length; j++) {
      if (!isSkippable(lines[j]) && indentOf(lines[j]) === 0 && parseKey(lines[j].trim()) === name) return j
    }
    return -1
  }

  function jobBlock(id) {
    const jobs = topKey('jobs')
    return jobs < 0 ? -1 : childKey(jobs, id)
  }

  // [start, end) of the n-th item (0-based) of `steps:` in job `id`.
  function stepRange(id, n) {
    const jb = jobBlock(id)
    if (jb < 0) return null
    const steps = childKey(jb, 'steps')
    if (steps < 0) return null
    const end = blockEnd(steps)
    const starts = []
    let itemIndent = -1
    for (let j = steps + 1; j < end; j++) {
      if (isSkippable(lines[j])) continue
      const t = lines[j].trim()
      if (!(t.startsWith('- ') || t === '-')) continue
      const ind = indentOf(lines[j])
      if (itemIndent < 0) itemIndent = ind
      if (ind === itemIndent) starts.push(j)
    }
    if (n >= starts.length) return null
    return { start: starts[n], end: n + 1 < starts.length ? starts[n + 1] : end, itemIndent }
  }

  // Line of `key` inside step range `r`; the first key sits on the "- " line.
  function stepKey(r, key) {
    for (let j = r.start; j < r.end; j++) {
      if (isSkippable(lines[j])) continue
      let t = lines[j].trim()
      if (j === r.start) t = t.replace(/^-\s*/, '')
      else if (indentOf(lines[j]) !== r.itemIndent + 2) continue
      if (parseKey(t) === key) return j
    }
    return -1
  }

  // Line of mapping entry `sub` nested under the key line `k`.
  function subKey(k, sub) {
    if (k < 0) return -1
    const j = childKey(k, sub)
    return j < 0 ? k : j
  }

  function triggerLine(type) {
    const on = topKey('on')
    if (on < 0) return -1
    const t = childKey(on, type)
    return t < 0 ? on : t
  }

  function findText(from, text) {
    if (from < 0 || text == null) return from
    const end = blockEnd(from)
    for (let j = from + 1; j < end; j++) {
      if (lines[j].includes(String(text))) return j
    }
    return from
  }

  // spec: { top } | { trigger, text? } | { job, key?, sub? } | { job, step, key?, sub? }
  function locate(spec) {
    let idx = -1
    if (!spec) return 1
    if (spec.top) {
      idx = topKey(spec.top)
    } else if (spec.trigger) {
      idx = findText(triggerLine(spec.trigger), spec.text)
    } else if (spec.job != null && spec.step != null) {
      const r = stepRange(spec.job, spec.step)
      if (r) {
        idx = r.start
        if (spec.key) {
          const k = stepKey(r, spec.key)
          if (k >= 0) idx = spec.sub ? subKey(k, spec.sub) : k
        }
      } else {
        idx = jobBlock(spec.job)
      }
    } else if (spec.job != null) {
      idx = jobBlock(spec.job)
      if (idx >= 0 && spec.key) {
        const k = childKey(idx, spec.key)
        if (k >= 0) idx = spec.sub ? subKey(k, spec.sub) : k
      }
    }
    return idx >= 0 ? idx + 1 : 1
  }

  return { locate }
}
