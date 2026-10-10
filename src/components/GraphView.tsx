import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import { Maximize2, RefreshCw } from 'lucide-react'
import type { Idea, Relation } from '../types'

type Position = { x: number; y: number }

// Keep manually arranged and computed positions while switching views or opening a drawer.
const positionCache = new Map<string, Position>()

function rememberPositions(cy: cytoscape.Core) {
  cy.nodes().forEach(node => { positionCache.set(node.id(), { ...node.position() }) })
}

export function GraphView({ ideas, relations, onSelect }: { ideas: Idea[]; relations: Relation[]; onSelect: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const onSelectRef = useRef(onSelect)
  const [focusId, setFocusId] = useState<number | null>(null)
  const [depth, setDepth] = useState(2)
  onSelectRef.current = onSelect

  const scopeRelations = useMemo(() => {
    const ideaIds = new Set(ideas.map(idea => idea.id))
    return relations.filter(relation => ideaIds.has(relation.source_id) && ideaIds.has(relation.target_id))
  }, [ideas, relations])
  const visibleIds = useMemo(() => {
    if (focusId === null) return new Set(ideas.map(idea => idea.id))
    const adjacency = new Map<number, Set<number>>()
    for (const relation of scopeRelations) {
      if (!adjacency.has(relation.source_id)) adjacency.set(relation.source_id, new Set())
      if (!adjacency.has(relation.target_id)) adjacency.set(relation.target_id, new Set())
      adjacency.get(relation.source_id)!.add(relation.target_id)
      adjacency.get(relation.target_id)!.add(relation.source_id)
    }
    const found = new Set<number>([focusId])
    let frontier = new Set<number>([focusId])
    for (let step = 0; step < depth; step += 1) {
      const next = new Set<number>()
      frontier.forEach(id => adjacency.get(id)?.forEach(neighbor => {
        if (!found.has(neighbor)) { found.add(neighbor); next.add(neighbor) }
      }))
      frontier = next
      if (!frontier.size) break
    }
    return found
  }, [depth, focusId, ideas, scopeRelations])
  const visibleIdeas = useMemo(() => ideas.filter(idea => visibleIds.has(idea.id)), [ideas, visibleIds])
  const visibleRelations = useMemo(() => scopeRelations.filter(relation => visibleIds.has(relation.source_id) && visibleIds.has(relation.target_id)), [scopeRelations, visibleIds])

  useEffect(() => {
    if (focusId !== null && !ideas.some(idea => idea.id === focusId)) setFocusId(null)
  }, [focusId, ideas])

  useEffect(() => {
    if (!ref.current) return
    const hasSavedLayout = visibleIdeas.length > 0 && visibleIdeas.every(idea => positionCache.has(String(idea.id)))
    const layout = hasSavedLayout
      ? {
          name: 'preset', padding: 55, fit: true,
          positions: (node: cytoscape.NodeSingular) => positionCache.get(node.id())!,
        }
      : {
          name: 'cose', animate: false, padding: 65, randomize: true,
          idealEdgeLength: 155, nodeRepulsion: 9000, componentSpacing: 130,
        }
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...visibleIdeas.map(idea => ({ data: { id: String(idea.id), label: idea.title, status: idea.status, focused: idea.id === focusId ? 'yes' : 'no' } })),
        ...visibleRelations.map(relation => ({ data: {
          id: `r${relation.id}`, source: String(relation.source_id), target: String(relation.target_id),
          label: relation.relation_type, relationType: relation.relation_type,
        } })),
      ],
      layout: layout as cytoscape.LayoutOptions,
      minZoom: .25,
      maxZoom: 2.2,
      wheelSensitivity: .18,
      style: [
        { selector: 'node', style: { shape: 'round-rectangle', width: 152, height: 48, 'background-color': '#fffdf8', 'border-width': 2.5, 'border-color': '#4f8a78', label: 'data(label)', color: '#26322d', 'font-size': 10, 'font-family': 'DM Sans, sans-serif', 'font-weight': 600, 'text-wrap': 'wrap', 'text-max-width': '132px', 'text-valign': 'center', 'text-halign': 'center', 'overlay-opacity': 0 } },
        { selector: 'node[status="seed"]', style: { 'background-color': '#eef5f1', 'border-color': '#4f8a78' } },
        { selector: 'node[status="exploring"]', style: { 'background-color': '#edf4f8', 'border-color': '#5884a2' } },
        { selector: 'node[status="promising"]', style: { 'background-color': '#fbefdf', 'border-color': '#d48131', 'border-width': 3 } },
        { selector: 'node[status="parked"]', style: { 'background-color': '#f0f0ed', 'border-color': '#999e9b', opacity: .7 } },
        { selector: 'node[focused="yes"]', style: { 'border-width': 4, 'border-color': '#6b4d85', 'background-color': '#eee7f5' } },
        { selector: 'node.hovered', style: { 'border-width': 4, 'overlay-color': '#1f6f5c', 'overlay-opacity': .08, 'overlay-padding': 8 } },
        { selector: 'edge', style: { width: 2, 'line-color': '#a8b5ae', 'target-arrow-color': '#a8b5ae', 'target-arrow-shape': 'triangle', 'arrow-scale': .8, 'curve-style': 'bezier', label: 'data(label)', 'font-size': 8, color: '#67736d', 'text-background-color': '#faf9f5', 'text-background-opacity': .92, 'text-background-padding': '3px', 'text-rotation': 'autorotate' } },
        { selector: 'edge[relationType="develops-into"]', style: { width: 3, 'line-color': '#765a8f', 'target-arrow-color': '#765a8f' } },
        { selector: 'edge[relationType="contradicts"]', style: { 'line-style': 'dashed', 'line-color': '#b66b55', 'target-arrow-color': '#b66b55' } },
        { selector: 'edge[relationType="evidence-for"]', style: { 'line-color': '#4c8d69', 'target-arrow-color': '#4c8d69' } },
        { selector: 'edge[relationType="combines-with"]', style: { 'line-color': '#56849c', 'target-arrow-color': '#56849c' } },
        { selector: 'node:selected', style: { 'border-width': 4, 'border-color': '#1f6f5c', 'overlay-color': '#1f6f5c', 'overlay-opacity': .12, 'overlay-padding': 9 } },
      ],
    })
    cyRef.current = cy
    rememberPositions(cy)
    cy.on('tap', 'node', event => onSelectRef.current(Number(event.target.id())))
    cy.on('mouseover', 'node', event => event.target.addClass('hovered'))
    cy.on('mouseout', 'node', event => event.target.removeClass('hovered'))
    cy.on('free', 'node', () => rememberPositions(cy))
    return () => {
      rememberPositions(cy)
      cyRef.current = null
      cy.destroy()
    }
  }, [focusId, visibleIdeas, visibleRelations])

  function fitGraph() {
    const cy = cyRef.current
    if (cy) cy.animate({ fit: { eles: cy.elements(), padding: 55 }, duration: 250 })
  }

  function relayoutGraph() {
    const cy = cyRef.current
    if (!cy) return
    cy.one('layoutstop', () => {
      rememberPositions(cy)
      cy.fit(undefined, 55)
    })
    cy.layout({ name: 'cose', animate: false, padding: 65, randomize: true, idealEdgeLength: 155, nodeRepulsion: 9000, componentSpacing: 130 } as cytoscape.LayoutOptions).run()
  }

  return <div className="graph-view">
    <div className="graph-scope-note"><strong>知识库关系图</strong><span>这里展示整篇论文或想法之间的联系；单篇论文内部的科研逻辑图请在 Focus 中打开该论文分析。</span></div>
    <header className="graph-toolbar">
      <span>{visibleIdeas.length}{focusId !== null ? ` of ${ideas.length}` : ''} {visibleIdeas.length === 1 ? 'idea' : 'ideas'} · {visibleRelations.length} {visibleRelations.length === 1 ? 'connection' : 'connections'} <small>Drag nodes to arrange · scroll to zoom</small></span>
      <div className="graph-tools"><label>Focus<select value={focusId ?? ''} onChange={event => setFocusId(event.target.value ? Number(event.target.value) : null)}><option value="">Entire scope</option>{ideas.map(idea => <option value={idea.id} key={idea.id}>{idea.title}</option>)}</select></label>{focusId !== null && <label>Depth<select value={depth} onChange={event => setDepth(Number(event.target.value))}><option value={1}>1 hop</option><option value={2}>2 hops</option><option value={3}>3 hops</option></select></label>}<button onClick={fitGraph} title="Fit all visible ideas in the window"><Maximize2 size={13}/> Fit</button><button onClick={relayoutGraph} title="Calculate a new layout"><RefreshCw size={13}/> Re-layout</button></div>
    </header>
    <div className="graph-canvas" ref={ref}/>
    <footer className="graph-legend"><span className="graph-line lineage"/> develops-into <span className="graph-line evidence"/> evidence-for <span className="graph-line contradiction"/> contradicts</footer>
  </div>
}
