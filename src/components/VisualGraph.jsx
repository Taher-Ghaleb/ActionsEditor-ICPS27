import { useEffect, useRef, useState } from 'react'
const START_NODE_WIDTH = 250
const JOB_NODE_WIDTH = 320
const COLUMN_GAP = 150
const ROW_GAP = 56
const CANVAS_PADDING_X = 56
const CANVAS_PADDING_Y = 72
const START_ROW_HEIGHT = 34
const JOB_BASE_HEIGHT = 112
const JOB_STEP_HEIGHT = 38
const JOB_META_HEIGHT = 28

export default function VisualGraph({
  workflow,
  zoom = 100,
  selectedTarget,
  layoutPositions = {},
  onMoveNode,
  onSelectTarget,
}) {
  const [dragState, setDragState] = useState(null)
  const [panState, setPanState] = useState(null)
  const dragMovedRef = useRef(false)
  const viewportRef = useRef(null)
  const graph = buildGraph(workflow, layoutPositions)
  const zoomScale = zoom / 100

  useEffect(() => {
    if (!dragState) return undefined

    const handlePointerMove = event => {
      event.preventDefault()

      const deltaX = (event.clientX - dragState.pointer.x) / zoomScale
      const deltaY = (event.clientY - dragState.pointer.y) / zoomScale

      if (!dragMovedRef.current && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
        dragMovedRef.current = true
      }

      const nextX = Math.max(
        24,
        dragState.origin.x + deltaX
      )
      const nextY = Math.max(
        24,
        dragState.origin.y + deltaY
      )

      onMoveNode(dragState.nodeId, { x: nextX, y: nextY })
    }

    const handlePointerUp = () => {
      if (!dragMovedRef.current && dragState.selectTarget) {
        onSelectTarget(dragState.selectTarget)
      }

      setDragState(null)
    }
    const previousUserSelect = document.body.style.userSelect

    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)

    return () => {
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }
  }, [dragState, onMoveNode, onSelectTarget, zoomScale])

  useEffect(() => {
    if (!panState) return undefined

    const handlePointerMove = event => {
      if (!viewportRef.current) return

      event.preventDefault()
      viewportRef.current.scrollLeft = panState.scroll.left - (event.clientX - panState.pointer.x)
      viewportRef.current.scrollTop = panState.scroll.top - (event.clientY - panState.pointer.y)
    }

    const handlePointerUp = () => setPanState(null)
    const previousUserSelect = document.body.style.userSelect

    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)

    return () => {
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }
  }, [panState])

  const startDrag = (event, nodeId, position, selectTarget) => {
    event.preventDefault()
    event.stopPropagation()
    dragMovedRef.current = false

    setDragState({
      nodeId,
      origin: position,
      pointer: { x: event.clientX, y: event.clientY },
      selectTarget,
    })
  }

  const startPan = event => {
    if (!viewportRef.current) return
    if (event.target instanceof Element && event.target.closest('.visual-start-node, .visual-job-node')) return

    event.preventDefault()

    setPanState({
      pointer: { x: event.clientX, y: event.clientY },
      scroll: {
        left: viewportRef.current.scrollLeft,
        top: viewportRef.current.scrollTop,
      },
    })
  }

  const selectedNavId = selectedTarget?.navId || null
  const triggerCardSelected = selectedTarget?.sectionId === 'triggers'
  const firstTriggerTarget = workflow.triggers?.[0]
    ? {
        sectionId: 'triggers',
        navId: `nav-trigger-${workflow.triggers[0].id}`,
        triggerId: workflow.triggers[0].id,
      }
    : {
        sectionId: 'triggers',
        navId: 'nav-section-triggers',
      }

  return (
    <div className="visual-graph">
      <div
        ref={viewportRef}
        className={`visual-graph__viewport${panState ? ' visual-graph__viewport--panning' : ''}`}
        onMouseDown={startPan}
      >
        <div
          className="visual-graph__scaled"
          style={{
            width: graph.canvasWidth * zoomScale,
            height: graph.canvasHeight * zoomScale,
          }}
        >
          <div
            className="visual-graph__canvas"
            style={{
              width: graph.canvasWidth,
              height: graph.canvasHeight,
              transform: `scale(${zoomScale})`,
            }}
          >
            <svg className="visual-graph__edges" viewBox={`0 0 ${graph.canvasWidth} ${graph.canvasHeight}`}>
              <defs>
                <linearGradient id="visual-edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="var(--visual-edge-start)" />
                  <stop offset="100%" stopColor="var(--visual-edge-end)" />
                </linearGradient>
                <marker
                  id="visual-edge-arrow"
                  markerWidth="10"
                  markerHeight="10"
                  refX="8"
                  refY="5"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill="var(--visual-edge-end)" />
                </marker>
              </defs>

              {graph.edges.map(edge => (
                <path
                  key={edge.id}
                  d={buildEdgePath(edge.from, edge.to)}
                  className="visual-graph__edge"
                  markerEnd="url(#visual-edge-arrow)"
                />
              ))}
            </svg>

            <div
              className={`visual-start-node${triggerCardSelected ? ' visual-node--selected' : ''}`}
              style={{
                left: graph.startNode.x,
                top: graph.startNode.y,
                width: graph.startNode.width,
                minHeight: graph.startNode.height,
              }}
            >
              <div
                className="visual-start-node__top"
                onMouseDown={event => startDrag(event, 'start', { x: graph.startNode.x, y: graph.startNode.y }, firstTriggerTarget)}
              >
                <div className="visual-start-node__label">Start</div>
                <button
                  type="button"
                  className="visual-node__handle"
                  onClick={event => event.stopPropagation()}
                  title="Move trigger node"
                >
                  Move
                </button>
              </div>
              <div className="visual-start-node__title">
                {workflow.name || 'Untitled workflow'}
              </div>
              <div className="visual-start-node__meta">
                {(workflow.triggers || []).length || 0} trigger{(workflow.triggers || []).length === 1 ? '' : 's'}
              </div>

              <div className="visual-start-node__list">
                {(workflow.triggers || []).length > 0 ? (
                  workflow.triggers.map(trigger => (
                    <button
                      key={trigger.id}
                      type="button"
                      className={`visual-start-node__item${selectedNavId === `nav-trigger-${trigger.id}` ? ' visual-start-node__item--selected' : ''}`}
                      onClick={event => {
                        event.stopPropagation()
                        onSelectTarget({
                          sectionId: 'triggers',
                          navId: `nav-trigger-${trigger.id}`,
                          triggerId: trigger.id,
                        })
                      }}
                    >
                      <span className="visual-start-node__item-name">{trigger.type}</span>
                      <span className="visual-start-node__item-desc">{describeTrigger(trigger)}</span>
                    </button>
                  ))
                ) : (
                  <div className="visual-start-node__empty">Add a trigger to start the workflow.</div>
                )}
              </div>
            </div>

            {graph.jobs.map(node => (
              <article
                key={node.nodeId}
                className={`visual-job-node${selectedTarget?.jobKey === node.job._key ? ' visual-node--selected' : ''}`}
                style={{
                  left: node.position.x,
                  top: node.position.y,
                  width: node.width,
                  minHeight: node.height,
                }}
              >
                <div
                  className="visual-job-node__header"
                  onMouseDown={event => startDrag(event, node.nodeId, node.position, node.target)}
                >
                  <div className="visual-job-node__headline">
                    <span className="visual-job-node__badge">Job</span>
                    <h3 className="visual-job-node__title">{node.job.name || node.job.id}</h3>
                  </div>

                  <button
                    type="button"
                    className="visual-node__handle"
                    onClick={event => event.stopPropagation()}
                    title="Drag job card"
                  >
                    Move
                  </button>
                </div>

                <button
                  type="button"
                  className="visual-job-node__summary"
                  onClick={() => onSelectTarget(node.target)}
                >
                  <span className="visual-job-node__id">{node.job.id}</span>
                  <span className="visual-job-node__runner">{node.job.runsOn || 'runner not set'}</span>
                </button>

                {node.job.needs?.length > 0 && (
                  <div className="visual-job-node__meta-row">
                    <span>Depends on</span>
                    <span>{node.job.needs.join(', ')}</span>
                  </div>
                )}

                <div className="visual-job-node__steps">
                  {node.previewSteps.length > 0 ? (
                    node.previewSteps.map(step => (
                      <button
                        key={step._key}
                        type="button"
                        className={`visual-job-node__step${selectedNavId === `nav-step-${node.job._key}-${step._key}` ? ' visual-job-node__step--selected' : ''}`}
                        onClick={() => onSelectTarget({
                          sectionId: 'jobs',
                          navId: `nav-step-${node.job._key}-${step._key}`,
                          jobKey: node.job._key,
                          stepKey: step._key,
                        })}
                      >
                        <span className={`visual-job-node__step-type visual-job-node__step-type--${step.uses ? 'uses' : 'run'}`}>
                          {step.uses ? 'uses' : 'run'}
                        </span>
                        <span className="visual-job-node__step-name">{getStepLabel(step)}</span>
                      </button>
                    ))
                  ) : (
                    <div className="visual-job-node__empty">No steps yet</div>
                  )}

                  {node.hiddenStepCount > 0 && (
                    <div className="visual-job-node__more">
                      +{node.hiddenStepCount} more step{node.hiddenStepCount === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function buildGraph(workflow, layoutPositions) {
  const jobs = workflow.jobs || []
  const jobMap = new Map(jobs.map(job => [job.id, job]))
  const levelCache = new Map()
  const positions = []

  const getJobLevel = (job, trail = new Set()) => {
    if (levelCache.has(job._key)) return levelCache.get(job._key)
    if (trail.has(job._key)) return 1

    const nextTrail = new Set(trail)
    nextTrail.add(job._key)

    const level = Math.max(
      1,
      ...(job.needs || [])
        .map(needId => jobMap.get(needId))
        .filter(Boolean)
        .map(needJob => getJobLevel(needJob, nextTrail) + 1)
    )

    levelCache.set(job._key, level)
    return level
  }

  const columns = new Map()
  jobs.forEach(job => {
    const level = getJobLevel(job)
    if (!columns.has(level)) columns.set(level, [])
    columns.get(level).push(job)
  })

  const sortedLevels = Array.from(columns.keys()).sort((a, b) => a - b)
  const jobRects = new Map()

  sortedLevels.forEach(level => {
    const columnJobs = columns.get(level) || []
    const x = CANVAS_PADDING_X + START_NODE_WIDTH + COLUMN_GAP + (level - 1) * (JOB_NODE_WIDTH + COLUMN_GAP)
    let cursorY = CANVAS_PADDING_Y + 12

    columnJobs.forEach(job => {
      const height = estimateJobHeight(job)
      const upstream = (job.needs || [])
        .map(needId => jobMap.get(needId))
        .filter(Boolean)
        .map(needJob => jobRects.get(needJob._key))
        .filter(Boolean)

      const preferredY = upstream.length > 0
        ? upstream.reduce((sum, rect) => sum + rect.y + rect.height / 2, 0) / upstream.length - height / 2
        : cursorY

      const basePosition = {
        x,
        y: Math.max(cursorY, preferredY),
      }

      const savedPosition = layoutPositions[`job:${job._key}`]
      const position = savedPosition || basePosition

      const node = {
        nodeId: `job:${job._key}`,
        target: {
          sectionId: 'jobs',
          navId: `nav-job-${job._key}`,
          jobKey: job._key,
        },
        job,
        width: JOB_NODE_WIDTH,
        height,
        position,
        previewSteps: (job.steps || []).slice(0, 4),
        hiddenStepCount: Math.max(0, (job.steps || []).length - 4),
      }

      positions.push(node)
      jobRects.set(job._key, {
        x: position.x,
        y: position.y,
        width: JOB_NODE_WIDTH,
        height,
      })

      cursorY = Math.max(cursorY, position.y) + height + ROW_GAP
    })
  })

  const startHeight = Math.max(
    114,
    90 + Math.max(1, (workflow.triggers || []).length) * START_ROW_HEIGHT
  )
  const startBasePosition = {
    x: CANVAS_PADDING_X,
    y: CANVAS_PADDING_Y + 48,
  }
  const startPosition = layoutPositions.start || startBasePosition
  const startNode = {
    x: startPosition.x,
    y: startPosition.y,
    width: START_NODE_WIDTH,
    height: startHeight,
  }

  const edges = []

  positions.forEach(node => {
    if (!node.job.needs || node.job.needs.length === 0) {
      edges.push({
        id: `start-${node.job._key}`,
        from: {
          x: startNode.x + startNode.width,
          y: startNode.y + startNode.height / 2,
        },
        to: {
          x: node.position.x,
          y: node.position.y + node.height / 2,
        },
      })
    }

    node.job.needs.forEach(needId => {
      const dependency = jobs.find(job => job.id === needId)
      if (!dependency) return

      const fromRect = jobRects.get(dependency._key)
      if (!fromRect) return

      edges.push({
        id: `${dependency._key}-${node.job._key}`,
        from: {
          x: fromRect.x + fromRect.width,
          y: fromRect.y + fromRect.height / 2,
        },
        to: {
          x: node.position.x,
          y: node.position.y + node.height / 2,
        },
      })
    })
  })

  const jobMaxX = positions.length > 0
    ? Math.max(...positions.map(node => node.position.x + node.width))
    : startNode.x + startNode.width
  const jobMaxY = positions.length > 0
    ? Math.max(...positions.map(node => node.position.y + node.height))
    : startNode.y + startNode.height

  return {
    startNode,
    jobs: positions,
    edges,
    canvasWidth: Math.max(980, jobMaxX + CANVAS_PADDING_X),
    canvasHeight: Math.max(560, Math.max(jobMaxY, startNode.y + startNode.height) + CANVAS_PADDING_Y),
  }
}

function buildEdgePath(from, to) {
  const direction = to.x >= from.x ? 1 : -1
  const curve = Math.max(42, Math.abs(to.x - from.x) * 0.42)

  return [
    `M ${from.x} ${from.y}`,
    `C ${from.x + curve * direction} ${from.y},`,
    `${to.x - curve * direction} ${to.y},`,
    `${to.x} ${to.y}`,
  ].join(' ')
}

function estimateJobHeight(job) {
  const previewSteps = Math.min((job.steps || []).length, 4)
  const hiddenRows = (job.steps || []).length > 4 ? 1 : 0
  const contentRows = Math.max(1, previewSteps + hiddenRows)
  const metaRows = job.needs?.length > 0 ? 1 : 0

  return JOB_BASE_HEIGHT + contentRows * JOB_STEP_HEIGHT + metaRows * JOB_META_HEIGHT
}

function getStepLabel(step) {
  if (step.name) return step.name
  if (step.uses) return step.uses
  if (step.run) return step.run.split('\n')[0]
  return 'Unnamed step'
}

function describeTrigger(trigger) {
  if (trigger.schedule) return trigger.schedule
  if (trigger.branches?.length) return `branches: ${trigger.branches.join(', ')}`
  if (trigger.tags?.length) return `tags: ${trigger.tags.join(', ')}`
  if (trigger.types?.length) return `types: ${trigger.types.join(', ')}`
  return 'default trigger'
}
