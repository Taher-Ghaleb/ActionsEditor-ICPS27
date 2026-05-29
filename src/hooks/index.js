import { useState, useCallback, useRef } from 'react'

// ============================================================
// useToast — lightweight toast notifications
// ============================================================
export function useToast() {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((msg, type = 'info', duration = 3200) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  return { toasts, showToast }
}

// ============================================================
// useUndoRedo — undo/redo stack for any state
// ============================================================
export function useUndoRedo(initialState) {
  const [state, setState] = useState(initialState)
  const undoStack = useRef([])
  const redoStack = useRef([])

  const set = useCallback((updater) => {
    setState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      undoStack.current = [...undoStack.current.slice(-49), prev]
      redoStack.current = []
      return next
    })
  }, [])

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return false
    const prev = undoStack.current[undoStack.current.length - 1]
    undoStack.current = undoStack.current.slice(0, -1)
    setState(cur => {
      redoStack.current = [...redoStack.current, cur]
      return prev
    })
    return true
  }, [])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return false
    const next = redoStack.current[redoStack.current.length - 1]
    redoStack.current = redoStack.current.slice(0, -1)
    setState(cur => {
      undoStack.current = [...undoStack.current, cur]
      return next
    })
    return true
  }, [])

  return {
    state,
    set,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  }
}

// ============================================================
// useGitHub — GitHub API helpers
// ============================================================
export function useGitHub() {
  const [token, setToken] = useState('')
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('')   // '' | 'loading' | 'error:...' | 'success'

  const connect = useCallback(async (pat) => {
    if (!pat) { setStatus('error:Please enter a Personal Access Token'); return false }
    setStatus('loading')
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${pat}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })
      if (!res.ok) throw new Error('Invalid token or insufficient permissions')
      const u = await res.json()
      const scopes = (res.headers.get('x-oauth-scopes') || '').split(',').map(s => s.trim())
      setToken(pat)
      setUser(u)
      setStatus('success')
      return { user: u, scopes }
    } catch (e) {
      setStatus(`error:${e.message}`)
      return false
    }
  }, [])

  const disconnect = useCallback(() => {
    setToken('')
    setUser(null)
    setStatus('')
  }, [])

  const importWorkflows = useCallback(async (repoUrl) => {
    setStatus('loading')
    try {
      const headers = { Accept: 'application/vnd.github.v3+json' }
      if (token) headers.Authorization = `token ${token}`

      const target = parseGitHubImportTarget(repoUrl)
      const repoInfo = await fetchRepositoryInfo(target.owner, target.repo, headers)

      const results = target.type === 'file'
        ? [await fetchWorkflowFile(target, headers)]
        : await fetchWorkflowDirectory(target, headers)

      if (results.length === 0) throw new Error('No YAML workflow files found')

      setStatus('')
      return {
        importMode: target.type,
        project: {
          kind: 'github',
          name: repoInfo.full_name,
          repoKey: repoInfo.full_name.toLowerCase(),
          owner: repoInfo.owner.login,
          repo: repoInfo.name,
          sourceUrl: repoUrl,
        },
        files: results,
      }
    } catch (e) {
      setStatus(`error:${e.message}`)
      return null
    }
  }, [token])

  const saveWorkflow = useCallback(async ({ repoUrl, filename, content, commitMsg }) => {
    setStatus('loading')
    try {
      const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/\s]+?)(?:\.git)?$/)
      if (!match) throw new Error('Invalid GitHub repository URL')
      const [, owner, repo] = match
      const filePath = `.github/workflows/${filename}`

      const headers = {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      }

      // Check if file exists to get SHA
      let sha
      try {
        const check = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
          { headers }
        )
        if (check.ok) {
          const data = await check.json()
          sha = data.sha
        }
      } catch (_) {}

      // Base64 encode
      const encoded = btoa(unescape(encodeURIComponent(content)))
      const body = { message: commitMsg || 'Update workflow', content: encoded }
      if (sha) body.sha = sha

      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
        { method: 'PUT', headers, body: JSON.stringify(body) }
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || `Failed to save (${res.status})`)
      }
      setStatus('')
      return true
    } catch (e) {
      setStatus(`error:${e.message}`)
      return false
    }
  }, [token])

  return { token, user, status, setStatus, connect, disconnect, importWorkflows, saveWorkflow }
}

function parseGitHubImportTarget(input) {
  let url

  try {
    url = new URL(input)
  } catch {
    throw new Error('Invalid GitHub URL')
  }

  if (url.hostname !== 'github.com') throw new Error('Only github.com URLs are supported')

  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) throw new Error('Invalid GitHub repository URL')

  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/, '')
  const marker = parts[2]
  const ref = parts[3]
  const path = parts.slice(4).join('/')
  const isWorkflowFile = /\.(yml|yaml)$/i.test(path)

  if (marker === 'blob' && ref && path && isWorkflowFile) {
    return { type: 'file', owner, repo, ref, path }
  }

  if (marker === 'tree' && ref) {
    return { type: 'repo', owner, repo, ref }
  }

  return { type: 'repo', owner, repo, ref: null }
}

async function fetchRepositoryInfo(owner, repo, headers) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
  if (!res.ok) throwGitHubError(res, 'repository')
  return res.json()
}

async function fetchWorkflowDirectory(target, headers) {
  const url = new URL(`https://api.github.com/repos/${target.owner}/${target.repo}/contents/.github/workflows`)
  if (target.ref) url.searchParams.set('ref', target.ref)

  const res = await fetch(url, { headers })
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('No .github/workflows directory found in this repository')
    }
    throwGitHubError(res, 'directory')
  }

  const files = await res.json()
  const yamlFiles = files.filter(file => /\.(yml|yaml)$/i.test(file.name))
  const results = []

  for (const file of yamlFiles.slice(0, 25)) {
    const fileContent = await fetchWorkflowFile({
      owner: target.owner,
      repo: target.repo,
      ref: target.ref,
      path: file.path,
    }, headers)
    results.push(fileContent)
  }

  return results
}

async function fetchWorkflowFile(target, headers) {
  const encodedPath = target.path.split('/').map(encodeURIComponent).join('/')
  const url = new URL(`https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodedPath}`)
  if (target.ref) url.searchParams.set('ref', target.ref)

  const res = await fetch(url, { headers })
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`File not found: ${target.path}`)
    }
    throwGitHubError(res, 'file')
  }

  const data = await res.json()
  if (!/\.(yml|yaml)$/i.test(data.name)) {
    throw new Error('Only YAML workflow files can be imported directly')
  }

  return {
    name: data.name,
    path: data.path,
    content: decodeGitHubContent(data.content, data.encoding),
  }
}

function decodeGitHubContent(content, encoding) {
  if (encoding !== 'base64') {
    throw new Error(`Unsupported GitHub content encoding: ${encoding || 'unknown'}`)
  }

  const binary = atob(content.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function throwGitHubError(res, targetName) {
  if (res.status === 403) {
    throw new Error('Access denied. For private repositories, connect your GitHub account first.')
  }

  if (res.status === 404) {
    throw new Error(`GitHub ${targetName} not found`)
  }

  throw new Error(`GitHub API error: ${res.status}`)
}
