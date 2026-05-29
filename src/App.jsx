import { useState, useEffect, useRef, useCallback } from 'react'
import './styles/global.css'
import './styles/components.css'

// Utils
import { generateYAML }        from './utils/yamlGenerator.js'
import { parseYAMLToWorkflow } from './utils/yamlParser.js'
import { lintWorkflow }        from './utils/linter.js'
import { buildLineNavigation, getLineTarget } from './utils/lineNavigation.js'
import {
  PREVIEW_FORMATS,
  generatePreviewConfig,
  getPreviewDownloadName,
  getPreviewNotice,
} from './utils/ciPreviewGenerator.js'

// Hooks
import { useToast, useGitHub } from './hooks/index.js'

// Components
import TopBar    from './components/TopBar.jsx'
import FileSidebar from './components/FileSidebar.jsx'
import Toolbar   from './components/Toolbar.jsx'
import Sidebar   from './components/Sidebar.jsx'
import StatusBar from './components/StatusBar.jsx'
import Toast     from './components/Toast.jsx'
import AIPanel   from './components/AIPanel.jsx'
import { AI_ASSISTANT_ENABLED } from './config.js'
import EditorView  from './components/EditorView.jsx'
import DesignPanel from './components/DesignPanel.jsx'
import VisualGraph from './components/VisualGraph.jsx'
import { PreviewView, TemplatesView, DiffView, LintPanel } from './components/Views.jsx'
import {
  ModalOverlay,
  ConfirmModal,
  GitHubConnectModal,
  ImportGitHubModal,
  SaveGitHubModal,
  UnsavedModal,
} from './components/Modals.jsx'

// Default empty workflow
const newWorkflow = () => ({
  name: 'My Workflow',
  env: {},
  permissions: {},
  triggers: [{ id: `t_${Date.now()}`, type: 'push', branches: ['main'] }],
  concurrency: null,
  jobs: [{
    _key: `j_${Date.now()}`,
    id: 'build', name: 'Build',
    runsOn: 'ubuntu-latest', needs: [], condition: '', env: {}, permissions: {},
    timeout: '', continueOnError: false, container: '',
    outputs: {}, services: {}, strategy: null, environment: '',
    collapsed: false,
    steps: [
      {
        _key: `s_${Date.now()}_1`,
        id: '', name: 'Checkout code', uses: 'actions/checkout@v4',
        run: '', shell: '', condition: '', with: {}, env: {},
        timeout: '', continueOnError: false, workingDirectory: '',
      },
      {
        _key: `s_${Date.now()}_2`,
        id: '', name: 'Run tests', uses: '',
        run: 'npm ci\nnpm test', shell: 'bash', condition: '', with: {}, env: {},
        timeout: '', continueOnError: false, workingDirectory: '',
      },
    ],
  }],
})

let _tabId = 2
let _projectId = 2
const DEFAULT_PROJECT_ID = 1
const DEFAULT_PROJECT = { id: DEFAULT_PROJECT_ID, name: 'Local Project', kind: 'local', repoKey: null }
const WORKSPACE_STORAGE_KEY = 'gha-editor-workspace-v1'
const RATING_FORM_URL = 'https://forms.gle/WM27fEbjykeKfkK49'
const YAML_FILE_TYPES = [
  {
    description: 'YAML files',
    accept: {
      'application/yaml': ['.yml', '.yaml'],
      'text/yaml': ['.yml', '.yaml'],
      'text/plain': ['.yml', '.yaml'],
    },
  },
]

function getBaseName(path) {
  return String(path || '').split('/').pop() || 'workflow.yml'
}

function renamePathPreservingParent(path, nextLeafName) {
  const sanitizedLeaf = String(nextLeafName || '').trim().replace(/[\\/]+/g, '-')
  if (!sanitizedLeaf) return path

  const source = String(path || '')
  const lastSlashIndex = source.lastIndexOf('/')
  if (lastSlashIndex === -1) return sanitizedLeaf
  return `${source.slice(0, lastSlashIndex + 1)}${sanitizedLeaf}`
}

function createDefaultWorkspaceState() {
  return {
    theme: 'dark',
    projects: [DEFAULT_PROJECT],
    activeProjectId: DEFAULT_PROJECT_ID,
    tabs: [{ id: 1, projectId: DEFAULT_PROJECT_ID, name: '.github/workflows/main.yml', modified: false, sourcePath: '.github/workflows/main.yml' }],
    activeTabId: 1,
    projectSelections: { [DEFAULT_PROJECT_ID]: 1 },
    workflows: { 1: newWorkflow() },
    undoStacks: { 1: [] },
    redoStacks: { 1: [] },
    activeView: 'split',
    splitPrimaryView: 'editor',
    aiVisible: false,
    zoom: 100,
    visualZoom: 100,
    previewFormat: 'github',
    visualLayouts: { 1: {} },
  }
}

function loadWorkspaceState() {
  const defaults = createDefaultWorkspaceState()

  if (typeof window === 'undefined') return defaults

  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return defaults

    const parsed = JSON.parse(raw)
    const data = parsed?.version === 1 ? parsed.data : parsed
    if (!data || typeof data !== 'object') return defaults

    const parsedProjects = Array.isArray(data.projects) && data.projects.length > 0 ? data.projects : defaults.projects
    const projectIds = new Set(parsedProjects.map(project => project.id))
    const parsedTabs = Array.isArray(data.tabs)
      ? data.tabs.filter(tab => projectIds.has(tab.projectId))
      : defaults.tabs
    const tabs = parsedTabs.length > 0 ? parsedTabs : defaults.tabs
    const workflows = { ...(data.workflows || {}) }
    const undoStacks = { ...(data.undoStacks || {}) }
    const redoStacks = { ...(data.redoStacks || {}) }
    const visualLayouts = { ...(data.visualLayouts || {}) }

    tabs.forEach(tab => {
      if (!workflows[tab.id]) workflows[tab.id] = newWorkflow()
      if (!Array.isArray(undoStacks[tab.id])) undoStacks[tab.id] = []
      if (!Array.isArray(redoStacks[tab.id])) redoStacks[tab.id] = []
      if (!visualLayouts[tab.id]) visualLayouts[tab.id] = {}
    })

    const activeTabId = tabs.some(tab => tab.id === data.activeTabId)
      ? data.activeTabId
      : tabs[0].id
    const activeTab = tabs.find(tab => tab.id === activeTabId) || tabs[0]
    const activeProjectId = parsedProjects.some(project => project.id === data.activeProjectId)
      ? data.activeProjectId
      : activeTab.projectId

    const projectSelections = {}
    parsedProjects.forEach(project => {
      const projectTabs = tabs.filter(tab => tab.projectId === project.id)
      if (projectTabs.length === 0) return

      const savedSelection = data.projectSelections?.[project.id]
      projectSelections[project.id] = projectTabs.some(tab => tab.id === savedSelection)
        ? savedSelection
        : projectTabs[0].id
    })

    return {
      theme: data.theme === 'light' ? 'light' : defaults.theme,
      projects: parsedProjects,
      activeProjectId,
      tabs,
      activeTabId,
      projectSelections,
      workflows,
      undoStacks,
      redoStacks,
      activeView: ['split', 'editor', 'design', 'visual', 'preview', 'templates', 'diff'].includes(data.activeView)
        ? data.activeView
        : defaults.activeView,
      splitPrimaryView: ['editor', 'visual'].includes(data.splitPrimaryView)
        ? data.splitPrimaryView
        : defaults.splitPrimaryView,
      aiVisible: Boolean(data.aiVisible),
      zoom: Number.isFinite(data.zoom) ? Math.max(40, Math.min(data.zoom, 200)) : defaults.zoom,
      visualZoom: Number.isFinite(data.visualZoom) ? Math.max(40, Math.min(data.visualZoom, 200)) : defaults.visualZoom,
      previewFormat: PREVIEW_FORMATS.some(format => format.id === data.previewFormat)
        ? data.previewFormat
        : defaults.previewFormat,
      visualLayouts,
    }
  } catch {
    return defaults
  }
}

export default function App() {
  const initialWorkspace = useRef(loadWorkspaceState()).current

  // Theme
  const [theme, setTheme] = useState(initialWorkspace.theme)

  // Projects
  const [projects, setProjects] = useState(initialWorkspace.projects)
  const [activeProjectId, setActiveProjectId] = useState(initialWorkspace.activeProjectId)

  // Tabs
  const [tabs, setTabs]           = useState(initialWorkspace.tabs)
  const [activeTabId, setActive]  = useState(initialWorkspace.activeTabId)
  const projectSelections = useRef(initialWorkspace.projectSelections)

  // Per-tab workflow state using undo/redo
  const workflows = useRef(initialWorkspace.workflows)
  const undoStacks = useRef(initialWorkspace.undoStacks)
  const redoStacks = useRef(initialWorkspace.redoStacks)
  const [workspaceVersion, setWorkspaceVersion] = useState(0)
  const rerender = () => setWorkspaceVersion(n => n + 1)

  // Current workflow
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]
  const workflow  = workflows.current[activeTabId] || newWorkflow()

  // UI state
  const [activeView,   setActiveView]   = useState(initialWorkspace.activeView)
  const [splitPrimaryView, setSplitPrimaryView] = useState(initialWorkspace.splitPrimaryView)
  const [aiVisible,    setAiVisible]    = useState(initialWorkspace.aiVisible)
  const [zoom,         setZoom]         = useState(initialWorkspace.zoom)
  const [visualZoom,   setVisualZoom]   = useState(initialWorkspace.visualZoom)
  const [previewFormat, setPreviewFormat] = useState(initialWorkspace.previewFormat)
  const [selectedLine, setSelectedLine] = useState(null)
  const [designFocusTarget, setDesignFocusTarget] = useState(null)
  const [visualLayouts, setVisualLayouts] = useState(initialWorkspace.visualLayouts)
  const [contextMenu,  setContextMenu]  = useState(null)
  const [modal,        setModal]        = useState(null)  // string key
  const [confirmState, setConfirmState] = useState(null)
  const [pendingNewProjectId, setPendingNewProjectId] = useState(null)
  const fileHandles = useRef({})
  const previewHandles = useRef({})

  // Toast
  const { toasts, showToast } = useToast()

  // GitHub
  const gh = useGitHub()

  // Lint
  const [lintIssues, setLintIssues] = useState([])

  // YAML
  const yamlOutput = generateYAML(workflow)
  const yamlLines  = yamlOutput.split('\n')
  const previewOutput = generatePreviewConfig(workflow, previewFormat)
  const previewLines = previewOutput.split('\n')
  const previewNotice = getPreviewNotice(previewFormat)
  const lineNavigation = buildLineNavigation(workflow)

  _tabId = Math.max(_tabId, ...tabs.map(tab => tab.id + 1))
  _projectId = Math.max(_projectId, ...projects.map(project => project.id + 1))

  const persistWorkspace = useCallback(() => {
    if (typeof window === 'undefined') return

    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
      version: 1,
      data: {
        theme,
        projects,
        activeProjectId,
        tabs,
        activeTabId,
        projectSelections: projectSelections.current,
        workflows: workflows.current,
        undoStacks: undoStacks.current,
        redoStacks: redoStacks.current,
        activeView,
        splitPrimaryView,
        aiVisible,
        zoom,
        visualZoom,
        previewFormat,
        visualLayouts,
      },
    }))
  }, [
    theme,
    projects,
    activeProjectId,
    tabs,
    activeTabId,
    activeView,
    splitPrimaryView,
    aiVisible,
    zoom,
    visualZoom,
    previewFormat,
    visualLayouts,
  ])

  const requestConfirmation = useCallback((config) => {
    setConfirmState(config)
  }, [])

  // Lint on every change
  useEffect(() => {
    setLintIssues(lintWorkflow(yamlOutput, workflow))
  }, [yamlOutput])

  // Persist the whole workspace so refresh/close restores the current session.
  useEffect(() => {
    try {
      persistWorkspace()
    } catch {
      // Ignore storage failures so editing remains uninterrupted.
    }
  }, [persistWorkspace, workspaceVersion])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = e => {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); doRedo() }
      if (ctrl && e.key === 's') { e.preventDefault(); handlePrimarySave() }
      if (e.key === 'Escape') { setModal(null); setConfirmState(null); setContextMenu(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  useEffect(() => {
    const handler = () => {
      try {
        persistWorkspace()
      } catch {
        // Ignore storage failures during shutdown.
      }
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [persistWorkspace])

  // Close menus on outside click
  useEffect(() => {
    const h = () => setContextMenu(null)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [])

  /* ---- Workflow mutation ---- */
  const updateWorkflow = useCallback((updater) => {
    const prev = workflows.current[activeTabId]
    undoStacks.current[activeTabId] = [...(undoStacks.current[activeTabId] || []).slice(-49), prev]
    redoStacks.current[activeTabId] = []
    const next = typeof updater === 'function' ? updater(prev) : updater
    workflows.current[activeTabId] = next
    setTabs(tabs => tabs.map(t => t.id === activeTabId ? { ...t, modified: true } : t))
    rerender()
  }, [activeTabId])

  const doUndo = () => {
    const stack = undoStacks.current[activeTabId] || []
    if (stack.length === 0) return
    const prev = stack[stack.length - 1]
    undoStacks.current[activeTabId] = stack.slice(0, -1)
    redoStacks.current[activeTabId] = [...(redoStacks.current[activeTabId] || []), workflows.current[activeTabId]]
    workflows.current[activeTabId] = prev
    rerender()
    showToast('Undo', 'info', 1200)
  }
  const doRedo = () => {
    const stack = redoStacks.current[activeTabId] || []
    if (stack.length === 0) return
    const next = stack[stack.length - 1]
    redoStacks.current[activeTabId] = stack.slice(0, -1)
    undoStacks.current[activeTabId] = [...(undoStacks.current[activeTabId] || []), workflows.current[activeTabId]]
    workflows.current[activeTabId] = next
    rerender()
    showToast('Redo', 'info', 1200)
  }

  const canUndo = (undoStacks.current[activeTabId] || []).length > 0
  const canRedo = (redoStacks.current[activeTabId] || []).length > 0

  const changeView = useCallback((nextView) => {
    if (nextView === 'split') {
      if (activeView === 'visual') setSplitPrimaryView('visual')
      if (activeView === 'editor') setSplitPrimaryView('editor')
    }

    if (nextView === 'visual') setSplitPrimaryView('visual')
    if (nextView === 'editor') setSplitPrimaryView('editor')

    setActiveView(nextView)
  }, [activeView])

  const queueDesignFocus = useCallback((target) => {
    setDesignFocusTarget(prev => ({
      ...target,
      requestKey: (prev?.requestKey || 0) + 1,
    }))
  }, [])

  const findLineForNavId = useCallback((navId) => {
    if (!navId) return null

    for (let index = 1; index < lineNavigation.length; index += 1) {
      if (lineNavigation[index]?.navId === navId) {
        return index
      }
    }

    return null
  }, [lineNavigation])

  const selectTab = useCallback((tabId) => {
    const tab = tabs.find(item => item.id === tabId)
    if (!tab) return

    projectSelections.current[tab.projectId] = tabId
    setActiveProjectId(tab.projectId)
    setActive(tabId)
  }, [tabs])

  const selectProject = useCallback((projectId) => {
    const projectTabs = tabs.filter(tab => tab.projectId === projectId)
    if (projectTabs.length === 0) return

    const nextTabId = projectSelections.current[projectId] && projectTabs.some(tab => tab.id === projectSelections.current[projectId])
      ? projectSelections.current[projectId]
      : projectTabs[0].id

    projectSelections.current[projectId] = nextTabId
    setActiveProjectId(projectId)
    setActive(nextTabId)
  }, [tabs])

  /* ---- File ops ---- */
  const downloadContent = (filename, content) => {
    const blob = new Blob([content], { type: 'text/yaml' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const writeWithHandle = useCallback(async (handle, content) => {
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
  }, [])

  const pickSaveHandle = useCallback(async (filename) => {
    if (!window.showSaveFilePicker) return null

    const options = {
      suggestedName: filename,
      startIn: 'desktop',
      types: YAML_FILE_TYPES,
    }

    try {
      return await window.showSaveFilePicker(options)
    } catch (error) {
      if (error?.name === 'TypeError') {
        return window.showSaveFilePicker({
          suggestedName: filename,
          types: YAML_FILE_TYPES,
        })
      }
      throw error
    }
  }, [])

  const saveContentToDesktop = useCallback(async ({ content, filename, handleKey, handleStore }) => {
    const existingHandle = handleStore.current[handleKey]

    if (existingHandle && existingHandle.name === filename) {
      try {
        await writeWithHandle(existingHandle, content)
        return { status: 'saved' }
      } catch (error) {
        delete handleStore.current[handleKey]
        if (error?.name !== 'NotAllowedError' && error?.name !== 'SecurityError') {
          throw error
        }
      }
    }

    if (window.showSaveFilePicker) {
      try {
        const handle = await pickSaveHandle(filename)
        if (!handle) return { status: 'cancelled' }

        await writeWithHandle(handle, content)
        handleStore.current[handleKey] = handle
        return { status: 'saved' }
      } catch (error) {
        if (error?.name === 'AbortError') {
          return { status: 'cancelled' }
        }
        throw error
      }
    }

    downloadContent(filename, content)
    return { status: 'downloaded' }
  }, [downloadContent, pickSaveHandle, writeWithHandle])

  const saveFile = async (tabId = activeTabId) => {
    const targetTab = tabs.find(tab => tab.id === tabId)
    if (!targetTab) return false

    const content = generateYAML(workflows.current[tabId])
    const filename = getBaseName(targetTab.name)

    try {
      const result = await saveContentToDesktop({
        content,
        filename,
        handleKey: tabId,
        handleStore: fileHandles,
      })

      if (result.status === 'cancelled') return false

      setTabs(t => t.map(tab => tab.id === tabId ? { ...tab, modified: false } : tab))
      showToast(result.status === 'saved' ? 'File saved' : 'File downloaded', 'success')
      return true
    } catch {
      showToast('Save failed', 'error')
      return false
    }
  }

  const copyYAML = () => {
    navigator.clipboard?.writeText(yamlOutput)
      .then(() => showToast('YAML copied to clipboard', 'success'))
      .catch(() => showToast('Copy failed', 'error'))
  }

  const copyPreview = () => {
    navigator.clipboard?.writeText(previewOutput)
      .then(() => showToast(`${PREVIEW_FORMATS.find(item => item.id === previewFormat)?.label || 'Preview'} copied`, 'success'))
      .catch(() => showToast('Copy failed', 'error'))
  }

  const savePreview = async () => {
    const filename = getPreviewDownloadName(activeTab?.name?.split('/').pop(), previewFormat)
    const previewKey = `${activeTabId}:${previewFormat}`

    try {
      const result = await saveContentToDesktop({
        content: previewOutput,
        filename,
        handleKey: previewKey,
        handleStore: previewHandles,
      })

      if (result.status === 'cancelled') return false

      showToast(
        `${PREVIEW_FORMATS.find(item => item.id === previewFormat)?.label || 'Preview'} ${result.status === 'saved' ? 'saved' : 'downloaded'}`,
        'success'
      )
      return true
    } catch {
      showToast('Preview save failed', 'error')
      return false
    }
  }

  const resetWorkspace = useCallback(() => {
    const freshWorkflow = newWorkflow()

    _tabId = 2
    _projectId = 2
    fileHandles.current = {}
    previewHandles.current = {}
    projectSelections.current = { [DEFAULT_PROJECT_ID]: 1 }
    workflows.current = { 1: freshWorkflow }
    undoStacks.current = { 1: [] }
    redoStacks.current = { 1: [] }

    setProjects([DEFAULT_PROJECT])
    setTabs([{ id: 1, projectId: DEFAULT_PROJECT_ID, name: '.github/workflows/main.yml', modified: false, sourcePath: '.github/workflows/main.yml' }])
    setActiveProjectId(DEFAULT_PROJECT_ID)
    setActive(1)
    setVisualLayouts({ 1: {} })
    setActiveView('split')
    setSplitPrimaryView('editor')
    setPreviewFormat('github')
    setSelectedLine(null)
    setDesignFocusTarget(null)
    setPendingNewProjectId(null)
    setContextMenu(null)
    rerender()
  }, [])

  const handlePrimarySave = () => (
    activeView === 'preview'
      ? savePreview()
      : saveFile()
  )

  const renameProject = useCallback((projectId, nextName) => {
    const trimmedName = String(nextName || '').trim()
    if (!trimmedName) return

    setProjects(prev => prev.map(project => (
      project.id === projectId ? { ...project, name: trimmedName } : project
    )))
    showToast('Project renamed', 'success', 1200)
  }, [showToast])

  const doDeleteProject = useCallback((projectId) => {
    const projectTabs = tabs.filter(tab => tab.projectId === projectId)
    const remainingProjects = projects.filter(project => project.id !== projectId)
    const remainingTabs = tabs.filter(tab => tab.projectId !== projectId)

    if (remainingProjects.length === 0 || remainingTabs.length === 0) {
      resetWorkspace()
      showToast('Project deleted', 'success', 1500)
      return
    }

    delete projectSelections.current[projectId]
    projectTabs.forEach(tab => {
      delete workflows.current[tab.id]
      delete undoStacks.current[tab.id]
      delete redoStacks.current[tab.id]
      delete fileHandles.current[tab.id]
      Object.keys(previewHandles.current)
        .filter(key => key.startsWith(`${tab.id}:`))
        .forEach(key => delete previewHandles.current[key])
    })

    setProjects(remainingProjects)
    setTabs(remainingTabs)
    setVisualLayouts(prev => {
      const next = { ...prev }
      projectTabs.forEach(tab => delete next[tab.id])
      return next
    })

    const deletedTabIds = new Set(projectTabs.map(tab => tab.id))
    const activeTabWasDeleted = deletedTabIds.has(activeTabId)
    const activeProjectWasDeleted = activeProjectId === projectId

    if (activeTabWasDeleted || activeProjectWasDeleted) {
      const nextActiveTab = remainingTabs.find(tab => tab.id === projectSelections.current[remainingProjects[0].id]) || remainingTabs[0]
      projectSelections.current[nextActiveTab.projectId] = nextActiveTab.id
      setActiveProjectId(nextActiveTab.projectId)
      setActive(nextActiveTab.id)
    }

    if (pendingNewProjectId === projectId) {
      setPendingNewProjectId(null)
    }

    showToast('Project deleted', 'success', 1500)
  }, [activeProjectId, activeTabId, pendingNewProjectId, projects, resetWorkspace, showToast, tabs])

  const deleteProject = useCallback((projectId) => {
    const project = projects.find(item => item.id === projectId)
    if (!project) return

    const projectTabs = tabs.filter(tab => tab.projectId === projectId)
    const modifiedCount = projectTabs.filter(tab => tab.modified).length
    const deletingLastProject = projects.length === 1

    requestConfirmation({
      icon: '🗑',
      title: 'Delete Project',
      desc: deletingLastProject
        ? `Delete "${project.name}"? This will remove all ${projectTabs.length} file${projectTabs.length === 1 ? '' : 's'} from the current workspace and reset the editor to a fresh blank project.${modifiedCount > 0 ? ` ${modifiedCount} file${modifiedCount === 1 ? '' : 's'} have unsaved changes.` : ''}`
        : `Delete "${project.name}" and its ${projectTabs.length} file${projectTabs.length === 1 ? '' : 's'} from the current workspace?${modifiedCount > 0 ? ` ${modifiedCount} file${modifiedCount === 1 ? '' : 's'} have unsaved changes.` : ''}`,
      confirmLabel: 'Delete Project',
      confirmClass: 'btn--danger',
      onConfirm: () => doDeleteProject(projectId),
    })
  }, [doDeleteProject, projects, requestConfirmation, tabs])

  const renameTab = useCallback((tabId, nextName) => {
    const trimmedName = String(nextName || '').trim()
    if (!trimmedName) return

    setTabs(prev => prev.map(tab => (
      tab.id === tabId
        ? { ...tab, name: renamePathPreservingParent(tab.name, trimmedName) }
        : tab
    )))

    delete fileHandles.current[tabId]
    Object.keys(previewHandles.current)
      .filter(key => key.startsWith(`${tabId}:`))
      .forEach(key => delete previewHandles.current[key])

    showToast('File renamed', 'success', 1200)
  }, [showToast])

  const importFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yml,.yaml'
    input.multiple = true
    input.onchange = e => {
      Array.from(e.target.files).forEach(file => {
        const reader = new FileReader()
        reader.onload = ev => {
          const content = ev.target.result
          const parsed  = parseYAMLToWorkflow(content)
          const id = _tabId++
          workflows.current[id]  = parsed || newWorkflow()
          undoStacks.current[id] = []
          redoStacks.current[id] = []
          setTabs(prev => [...prev, {
            id,
            projectId: activeProjectId,
            name: file.name,
            modified: false,
            sourcePath: file.name,
          }])
          projectSelections.current[activeProjectId] = id
          setActive(id)
          showToast(`Imported ${file.name}`, 'success')
        }
        reader.readAsText(file)
      })
    }
    input.click()
  }

  const createNewTab = (projectId = activeProjectId) => {
    const id = _tabId++
    workflows.current[id]  = newWorkflow()
    undoStacks.current[id] = []
    redoStacks.current[id] = []
    setTabs(prev => [...prev, {
      id,
      projectId,
      name: '.github/workflows/workflow.yml',
      modified: false,
      sourcePath: '.github/workflows/workflow.yml',
    }])
    projectSelections.current[projectId] = id
    setActiveProjectId(projectId)
    setActive(id)
    setModal(null)
    setPendingNewProjectId(null)
    showToast('New file created', 'info', 1500)
  }

  const handleNewFile = (projectId = activeProjectId) => {
    if (activeTab?.modified) {
      setPendingNewProjectId(projectId)
      setModal('unsaved-new')
      return
    }

    createNewTab(projectId)
  }

  const closeTab = id => {
    const tab = tabs.find(t => t.id === id)
    if (!tab) return

    if (tab?.modified) { setModal(`unsaved-close:${id}`); return }

    const remaining = tabs.filter(item => item.id !== id)
    if (remaining.length === 0) return

    const removesProject = remaining.every(item => item.projectId !== tab.projectId)
    requestConfirmation({
      icon: '🗂',
      title: 'Close File',
      desc: removesProject
        ? `Close ${getBaseName(tab.name)}? This is the last file in "${projects.find(project => project.id === tab.projectId)?.name || 'this project'}", so the project will also be removed from the current workspace.`
        : `Close ${getBaseName(tab.name)} from the current workspace?`,
      confirmLabel: 'Close File',
      confirmClass: 'btn--danger',
      onConfirm: () => doCloseTab(id),
    })
  }

  const doCloseTab = id => {
    const closingTab = tabs.find(tab => tab.id === id)
    if (!closingTab) return

    const remaining = tabs.filter(tab => tab.id !== id)
    if (remaining.length === 0) return

    const remainingInProject = remaining.filter(tab => tab.projectId === closingTab.projectId)
    if (remainingInProject.length === 0) {
      setProjects(prev => prev.filter(project => project.id !== closingTab.projectId))
      delete projectSelections.current[closingTab.projectId]
    }

    if (activeTabId === id) {
      const nextActiveTab = remainingInProject[remainingInProject.length - 1] || remaining[remaining.length - 1]
      projectSelections.current[nextActiveTab.projectId] = nextActiveTab.id
      setActiveProjectId(nextActiveTab.projectId)
      setActive(nextActiveTab.id)
    } else if (activeProjectId === closingTab.projectId && remainingInProject.length === 0) {
      const fallbackTab = remaining[remaining.length - 1]
      projectSelections.current[fallbackTab.projectId] = fallbackTab.id
      setActiveProjectId(fallbackTab.projectId)
      setActive(fallbackTab.id)
    }

    setTabs(remaining)
    setVisualLayouts(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    delete workflows.current[id]
    delete undoStacks.current[id]
    delete redoStacks.current[id]
  }

  /* ---- GitHub ---- */
  const handleGHConnect = async (pat) => {
    const result = await gh.connect(pat)
    if (result) {
      showToast(
        `Connected as ${result.user.login}` +
          (!result.scopes.includes('workflow') ? ' (missing workflow scope)' : ''),
        result.scopes.includes('workflow') ? 'success' : 'warning'
      )
      setModal(null)
      gh.setStatus('')
    }
  }

  const handleGHImport = async (url) => {
    const imported = await gh.importWorkflows(url)
    if (imported) {
      const existingProject = projects.find(project => project.repoKey && project.repoKey === imported.project.repoKey)
      const projectId = existingProject?.id || _projectId++
      const nextProject = existingProject || { ...imported.project, id: projectId }
      const importedTabIds = []

      if (!existingProject) {
        setProjects(prev => [...prev, nextProject])
      }

      setTabs(prev => {
        const nextTabs = [...prev]

        imported.files.forEach(file => {
          const existingTab = nextTabs.find(tab => tab.projectId === projectId && tab.sourcePath === file.path)
          const parsed = parseYAMLToWorkflow(file.content)

          if (existingTab) {
            workflows.current[existingTab.id]  = parsed || newWorkflow()
            undoStacks.current[existingTab.id] = []
            redoStacks.current[existingTab.id] = []

            const tabIndex = nextTabs.findIndex(tab => tab.id === existingTab.id)
            nextTabs[tabIndex] = {
              ...existingTab,
              name: file.path,
              modified: false,
              sourcePath: file.path,
            }
            importedTabIds.push(existingTab.id)
          } else {
            const id = _tabId++
            workflows.current[id]  = parsed || newWorkflow()
            undoStacks.current[id] = []
            redoStacks.current[id] = []
            nextTabs.push({
              id,
              projectId,
              name: file.path,
              modified: false,
              sourcePath: file.path,
            })
            importedTabIds.push(id)
          }
        })

        return nextTabs
      })

      if (importedTabIds.length > 0) {
        projectSelections.current[projectId] = importedTabIds[0]
        setActiveProjectId(projectId)
        setActive(importedTabIds[0])
      }

      setModal(null)
      gh.setStatus('')
      setActiveView('split')
      showToast(
        imported.importMode === 'file'
          ? `Imported ${imported.files[0].name}`
          : `Imported ${imported.files.length} workflow file${imported.files.length !== 1 ? 's' : ''} from ${imported.project.name}`,
        'success'
      )
    }
  }

  const handleGHSave = async ({ repoUrl, commitMsg }) => {
    const ok = await gh.saveWorkflow({
      repoUrl,
      filename: activeTab.name.split('/').pop(),
      content: yamlOutput,
      commitMsg,
    })
    if (ok) {
      setTabs(t => t.map(tab => tab.id === activeTabId ? { ...tab, modified: false } : tab))
      setModal(null)
      gh.setStatus('')
      showToast('Saved to GitHub', 'success')
    } else {
      showToast('Save to GitHub failed', 'error')
    }
  }

  const openRatingForm = useCallback(() => {
    const opened = window.open(RATING_FORM_URL, '_blank', 'noopener,noreferrer')
    if (!opened) {
      showToast('Please allow pop-ups to open the feedback form in a new tab', 'warning')
    }
  }, [showToast])

  /* ---- Quick inserts ---- */
  const quickAddJob = () => {
    updateWorkflow(w => ({
      ...w,
      jobs: [...w.jobs, {
        _key: `j_${Date.now()}`,
        id: `job_${w.jobs.length + 1}`, name: 'New Job',
        runsOn: 'ubuntu-latest', needs: [], condition: '', env: {}, permissions: {},
        timeout: '', continueOnError: false, container: '',
        outputs: {}, services: {}, strategy: null, environment: '',
        collapsed: false, steps: [],
      }],
    }))
    setActiveView('design')
    showToast('Job added', 'info', 1500)
  }

  const quickAddTrigger = () => {
    updateWorkflow(w => ({
      ...w,
      triggers: [...w.triggers, { id: `t_${Date.now()}`, type: 'push', branches: ['main'] }],
    }))
    setActiveView('design')
  }

  const quickAddStepToFirst = (type) => {
    if (!workflow.jobs || workflow.jobs.length === 0) { showToast('Add a job first', 'warning'); return }
    const jobKey = workflow.jobs[0]._key
    updateWorkflow(w => ({
      ...w,
      jobs: w.jobs.map(j => j._key === jobKey ? {
        ...j,
        steps: [...j.steps, {
          _key: `s_${Date.now()}`,
          id: '', name: type === 'uses' ? 'New Action Step' : 'New Run Step',
          uses: type === 'uses' ? 'actions/checkout@v4' : '',
          run: type === 'run' ? 'echo "Hello"' : '',
          shell: type === 'run' ? 'bash' : '', condition: '',
          with: {}, env: {}, timeout: '', continueOnError: false, workingDirectory: '',
        }],
      } : j),
    }))
    setActiveView('design')
  }

  /* ---- Template loading ---- */
  const loadTemplate = (template) => {
    const parsed = parseYAMLToWorkflow(template.yaml)
    const id = _tabId++
    workflows.current[id]  = parsed || newWorkflow()
    undoStacks.current[id] = []
    redoStacks.current[id] = []
    setTabs(prev => [...prev, {
      id,
      projectId: activeProjectId,
      name: `${template.id}.yml`,
      modified: false,
      sourcePath: `${template.id}.yml`,
    }])
    projectSelections.current[activeProjectId] = id
    setActive(id)
    setActiveView('editor')
    showToast(`Template "${template.name}" loaded`, 'success')
  }

  /* ---- Context menu handler ---- */
  const handleContextMenu = (e, lineNum) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, line: lineNum })
  }

  const handleSelectLine = useCallback((lineNum) => {
    setSelectedLine(lineNum)

    const target = getLineTarget(lineNavigation, lineNum)
    if (!target) return

    queueDesignFocus(target)
    setSplitPrimaryView('editor')
    setActiveView(view => view === 'editor' ? 'split' : view)
  }, [lineNavigation, queueDesignFocus])

  const handleVisualSelect = useCallback((target) => {
    if (!target) return

    queueDesignFocus(target)
    setSelectedLine(findLineForNavId(target.navId))
    setSplitPrimaryView('visual')
    setActiveView('split')
  }, [findLineForNavId, queueDesignFocus])

  const currentZoom = activeView === 'visual' || (activeView === 'split' && splitPrimaryView === 'visual')
    ? visualZoom
    : zoom

  const adjustZoom = useCallback((delta) => {
    const update = activeView === 'visual' || (activeView === 'split' && splitPrimaryView === 'visual')
      ? setVisualZoom
      : setZoom

    update(value => Math.max(40, Math.min(value + delta, 200)))
  }, [activeView, splitPrimaryView])

  const resetZoom = useCallback(() => {
    if (activeView === 'visual' || (activeView === 'split' && splitPrimaryView === 'visual')) {
      setVisualZoom(100)
      return
    }

    setZoom(100)
  }, [activeView, splitPrimaryView])

  /* ---- View tabs ---- */
  const VIEW_TABS = [
    { id: 'split',     label: '↔ Split' },
    { id: 'editor',    label: ' Editor' },
    { id: 'design',    label: ' Design' },
    { id: 'visual',    label: ' Visual' },
    { id: 'preview',   label: ' Preview' },
    { id: 'templates', label: ' Templates' },
    { id: 'diff',      label: ' Diff' },
  ]

  // Original YAML for diff view (first undo state)
  const firstUndo = (undoStacks.current[activeTabId] || [])[0]
  const originalYAML = firstUndo ? generateYAML(firstUndo) : null

  /* ---- Modals ---- */
  const renderModal = () => {
    if (!modal) return null

    if (modal === 'github') return (
      <ModalOverlay onClose={() => { setModal(null); gh.setStatus('') }}>
        <GitHubConnectModal
          status={gh.status}
          onConnect={handleGHConnect}
          onClose={() => { setModal(null); gh.setStatus('') }}
        />
      </ModalOverlay>
    )

    if (modal === 'import-gh') return (
      <ModalOverlay onClose={() => { setModal(null); gh.setStatus('') }}>
        <ImportGitHubModal
          githubUser={gh.user}
          status={gh.status}
          onImport={handleGHImport}
          onConnectFirst={() => setModal('github')}
          onClose={() => { setModal(null); gh.setStatus('') }}
        />
      </ModalOverlay>
    )

    if (modal === 'save-gh') return (
      <ModalOverlay onClose={() => { setModal(null); gh.setStatus('') }}>
        <SaveGitHubModal
          githubUser={gh.user}
          filename={activeTab?.name?.split('/').pop()}
          status={gh.status}
          onSave={handleGHSave}
          onClose={() => { setModal(null); gh.setStatus('') }}
        />
      </ModalOverlay>
    )

    if (modal === 'unsaved-new') return (
      <UnsavedModal
        filename={activeTab?.name?.split('/').pop()}
        onSave={async () => {
          const didSave = await saveFile()
          if (didSave) createNewTab(pendingNewProjectId ?? activeProjectId)
        }}
        onDiscard={() => createNewTab(pendingNewProjectId ?? activeProjectId)}
        onClose={() => { setPendingNewProjectId(null); setModal(null) }}
      />
    )

    if (modal?.startsWith('unsaved-close:')) {
      const tabId = Number(modal.split(':')[1])
      const tab = tabs.find(t => t.id === tabId)
      return (
        <UnsavedModal
          filename={tab?.name?.split('/').pop()}
          onSave={async () => {
            const didSave = await saveFile(tabId)
            if (didSave) {
              doCloseTab(tabId)
              setModal(null)
            }
          }}
          onDiscard={() => { doCloseTab(tabId); setModal(null) }}
          onClose={() => setModal(null)}
        />
      )
    }

    return null
  }

    return (
    <div className={theme} style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <TopBar
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        githubUser={gh.user}
        canUndo={canUndo} canRedo={canRedo}
        onUndo={doUndo}   onRedo={doRedo}
        onNewFile={handleNewFile}
        onImport={importFile}
        onSave={handlePrimarySave}
        onCopyYAML={copyYAML}
        onOpenGitHubConnect={() => setModal('github')}
        onImportFromGitHub={() => setModal('import-gh')}
        onSaveToGitHub={() => gh.user ? setModal('save-gh') : setModal('github')}
        onOpenRating={openRatingForm}
        onAddTrigger={quickAddTrigger}
        onAddConcurrency={() => { updateWorkflow(w => ({ ...w, concurrency: { group: '${{ github.workflow }}-${{ github.ref }}', cancelInProgress: true } })); setActiveView('design') }}
        onAddPermissions={() => { updateWorkflow(w => ({ ...w, permissions: { ...w.permissions, contents: 'read' } })); setActiveView('design') }}
        onAddJob={quickAddJob}
        onAddStepToFirst={quickAddStepToFirst}
        onSetView={changeView}
        onToggleAI={() => setAiVisible(v => !v)}
        aiVisible={aiVisible}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <FileSidebar
          projects={projects}
          tabs={tabs}
          activeProjectId={activeProjectId}
          activeTabId={activeTabId}
          onSelectProject={selectProject}
          onSelectTab={selectTab}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          onRenameTab={renameTab}
          onCloseTab={closeTab}
          onNewFile={handleNewFile}
        />

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Main content area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* View tabs */}
            <div className="view-tabs">
              {VIEW_TABS.map(v => (
                <button
                  key={v.id}
                  className={`view-tabs__tab${activeView === v.id ? ' view-tabs__tab--active' : ''}`}
                  onClick={() => changeView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {/* Toolbar */}
            <Toolbar
              canUndo={canUndo} canRedo={canRedo}
              onUndo={doUndo}   onRedo={doRedo}
              zoom={currentZoom}
              onZoomIn={()    => adjustZoom(10)}
              onZoomOut={()   => adjustZoom(-10)}
              onZoomReset={resetZoom}
              onImport={importFile}
              onSave={handlePrimarySave}
              onCopyYAML={copyYAML}
              onAddJob={quickAddJob}
              onAddTrigger={quickAddTrigger}
              onToggleAI={() => setAiVisible(v => !v)}
              aiVisible={aiVisible}
            />

            {/* Split: main view + AI panel */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Active view */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {activeView === 'split' && (
                    <div className="workspace-view split-workspace">
                      <section className="split-pane split-pane--editor">
                        <div className="split-pane__header">
                          <span>{splitPrimaryView === 'visual' ? 'Visual' : 'Editor'}</span>
                          <span>{splitPrimaryView === 'visual' ? `${visualZoom}% zoom` : `${yamlLines.length} lines`}</span>
                        </div>
                        <div className="split-pane__body">
                          {splitPrimaryView === 'visual' ? (
                            <VisualGraph
                              workflow={workflow}
                              zoom={visualZoom}
                              selectedTarget={designFocusTarget}
                              layoutPositions={visualLayouts[activeTabId] || {}}
                              onMoveNode={(nodeId, position) => {
                                setVisualLayouts(prev => ({
                                  ...prev,
                                  [activeTabId]: {
                                    ...(prev[activeTabId] || {}),
                                    [nodeId]: position,
                                  },
                                }))
                              }}
                              onSelectTarget={handleVisualSelect}
                            />
                          ) : (
                            <EditorView
                              yamlLines={yamlLines}
                              zoom={zoom}
                              lintIssues={lintIssues}
                              selectedLine={selectedLine}
                              onSelectLine={handleSelectLine}
                              onContextMenu={handleContextMenu}
                            />
                          )}
                        </div>
                      </section>

                      <section className="split-pane split-pane--design">
                        <div className="split-pane__header">
                          <span>Design</span>
                          <span>Linked to {splitPrimaryView} selection</span>
                        </div>
                        <div className="split-pane__body">
                          <DesignPanel
                            workflow={workflow}
                            onUpdate={updateWorkflow}
                            focusTarget={designFocusTarget}
                            onRequestConfirm={requestConfirmation}
                          />
                        </div>
                      </section>
                    </div>
                  )}
                  {activeView === 'editor' && (
                    <div className="workspace-view">
                      <EditorView
                        yamlLines={yamlLines}
                        zoom={zoom}
                        lintIssues={lintIssues}
                        selectedLine={selectedLine}
                        onSelectLine={handleSelectLine}
                        onContextMenu={handleContextMenu}
                      />
                    </div>
                  )}
                  {activeView === 'design' && (
                    <div className="workspace-view">
                      <DesignPanel
                        workflow={workflow}
                        onUpdate={updateWorkflow}
                        focusTarget={designFocusTarget}
                        onRequestConfirm={requestConfirmation}
                      />
                    </div>
                  )}
                  {activeView === 'visual' && (
                    <div className="workspace-view">
                      <VisualGraph
                        workflow={workflow}
                        zoom={visualZoom}
                        selectedTarget={designFocusTarget}
                        layoutPositions={visualLayouts[activeTabId] || {}}
                        onMoveNode={(nodeId, position) => {
                          setVisualLayouts(prev => ({
                            ...prev,
                            [activeTabId]: {
                              ...(prev[activeTabId] || {}),
                              [nodeId]: position,
                            },
                          }))
                        }}
                        onSelectTarget={handleVisualSelect}
                      />
                    </div>
                  )}
                  {activeView === 'preview' && (
                    <div className="workspace-view">
                      <PreviewView
                        yamlLines={previewLines}
                        format={previewFormat}
                        formats={PREVIEW_FORMATS}
                        noticeMessage={previewNotice}
                        onFormatChange={setPreviewFormat}
                        onCopy={copyPreview}
                        onSave={savePreview}
                      />
                    </div>
                  )}
                  {activeView === 'templates' && (
                    <div className="workspace-view">
                      <TemplatesView onLoad={loadTemplate} />
                    </div>
                  )}
                  {activeView === 'diff' && (
                    <div className="workspace-view">
                      <DiffView
                        originalYAML={originalYAML}
                        currentYAML={yamlOutput}
                      />
                    </div>
                  )}
                </div>

                {/* Lint panel */}
                <LintPanel issues={lintIssues} onSelectLine={handleSelectLine} />
              </div>

              {/* AI Panel — gated behind AI_ASSISTANT_ENABLED, see src/config.js */}
              {AI_ASSISTANT_ENABLED && aiVisible && (
                <AIPanel
                  yamlOutput={yamlOutput}
                  onClose={() => setAiVisible(false)}
                />
              )}
            </div>
          </div>

          <Sidebar
            side="right"
            tab={activeTab}
            workflow={workflow}
            lintIssues={lintIssues}
            activeView={activeView}
            onSetView={changeView}
            onAddJob={quickAddJob}
            lineCount={yamlLines.length}
            onSelectLine={handleSelectLine}
          />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar
        filename={activeTab?.name?.split('/').pop() || 'workflow.yml'}
        lineCount={yamlLines.length}
        jobCount={workflow?.jobs?.length || 0}
        triggerCount={workflow?.triggers?.length || 0}
        lintIssues={lintIssues}
        zoom={currentZoom}
        githubUser={gh.user}
      />

      {/* Context menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <div className="context-menu__item" onClick={() => { copyYAML(); setContextMenu(null) }}>
            📋 Copy YAML
          </div>
          <div className="context-menu__item" onClick={() => { handlePrimarySave(); setContextMenu(null) }}>
            💾 Save File
          </div>
          <div className="context-menu__sep" />
          <div className="context-menu__item" onClick={() => { doUndo(); setContextMenu(null) }}>
            ↩ Undo
          </div>
          <div className="context-menu__item" onClick={() => { doRedo(); setContextMenu(null) }}>
            ↪ Redo
          </div>
          <div className="context-menu__sep" />
          <div className="context-menu__item" onClick={() => { changeView('split'); setContextMenu(null) }}>
            ↔ Open Split View
          </div>
          <div className="context-menu__item" onClick={() => { changeView('design'); setContextMenu(null) }}>
            🎨 Switch to Design View
          </div>
          <div className="context-menu__item" onClick={() => { changeView('visual'); setContextMenu(null) }}>
            🕸 Switch to Visual View
          </div>
          <div className="context-menu__sep" />
          <div className="context-menu__item" onClick={() => setContextMenu(null)}>
            ✕ Close
          </div>
        </div>
      )}

      {/* Modals */}
      {renderModal()}
      {confirmState && (
        <ConfirmModal
          icon={confirmState.icon}
          title={confirmState.title}
          desc={confirmState.desc}
          confirmLabel={confirmState.confirmLabel}
          confirmClass={confirmState.confirmClass}
          onConfirm={() => {
            const action = confirmState.onConfirm
            setConfirmState(null)
            action?.()
          }}
          onClose={() => setConfirmState(null)}
        />
      )}

      {/* Toasts */}
      <Toast toasts={toasts} />
    </div>
  )
}
