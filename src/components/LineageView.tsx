import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import { GitBranch, Merge, Route, RotateCcw } from 'lucide-react'
import type { Idea, Relation } from '../types'

const LINEAGE_TYPE = 'develops-into'

function traceLineage(focusId: number, relations: Relation[]) {
  const ancestors = new Set<number>([focusId])
  const descendants = new Set<number>([focusId])
  const ancestorQueue = [focusId]
  const descendantQueue = [focusId]
  while (ancestorQueue.length) {
    const target = ancestorQueue.pop()!
    for (const relation of relations) {
      if (relation.target_id === target && !ancestors.has(relation.source_id)) {
        ancestors.add(relation.source_id)
        ancestorQueue.push(relation.source_id)
      }
    }
  }
  while (descendantQueue.length) {
    const source = descendantQueue.pop()!
    for (const relation of relations) {
      if (relation.source_id === source && !descendants.has(relation.target_id)) {
        descendants.add(relation.target_id)
        descendantQueue.push(relation.target_id)
      }
    }
  }
  return new Set([...ancestors, ...descendants])
}

export function LineageView({ ideas, relations, onSelect }: { ideas: Idea[]; relations: Relation[]; onSelect: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [focusId, setFocusId] = useState<number | null>(null)
  const ideaIds = useMemo(() => new Set(ideas.map(idea => idea.id)), [ideas])
  const lineageRelations = useMemo(
    () => relations.filter(relation => relation.relation_type === LINEAGE_TYPE && ideaIds.has(relation.source_id) && ideaIds.has(relation.target_id)),
    [ideaIds, relations],
  )
  const visibleIds = useMemo(() => focusId === null ? ideaIds : traceLineage(focusId, lineageRelations), [focusId, ideaIds, lineageRelations])
  const visibleIdeas = useMemo(() => ideas.filter(idea => visibleIds.has(idea.id)), [ideas, visibleIds])
  const visibleRelations = useMemo(() => lineageRelations.filter(relation => visibleIds.has(relation.source_id) && visibleIds.has(relation.target_id)), [lineageRelations, visibleIds])
  const incoming = useMemo(() => new Map(visibleIdeas.map(idea => [idea.id, visibleRelations.filter(relation => relation.target_id === idea.id).length])), [visibleIdeas, visibleRelations])
  const outgoing = useMemo(() => new Map(visibleIdeas.map(idea => [idea.id, visibleRelations.filter(relation => relation.source_id === idea.id).length])), [visibleIdeas, visibleRelations])
  const roots = useMemo(() => visibleIdeas.filter(idea => (incoming.get(idea.id) ?? 0) === 0), [incoming, visibleIdeas])
  const branchCount = visibleIdeas.filter(idea => (outgoing.get(idea.id) ?? 0) > 1).length
  const mergeCount = visibleIdeas.filter(idea => (incoming.get(idea.id) ?? 0) > 1).length

  useEffect(() => {
    if (!ref.current) return
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...visibleIdeas.map(idea => ({ data: {
          id: String(idea.id), label: idea.title, status: idea.status,
          root: (incoming.get(idea.id) ?? 0) === 0 ? 'yes' : 'no',
          merge: (incoming.get(idea.id) ?? 0) > 1 ? 'yes' : 'no',
          focused: idea.id === focusId ? 'yes' : 'no',
        } })),
        ...visibleRelations.map(relation => ({ data: { id: `lineage-${relation.id}`, source: String(relation.source_id), target: String(relation.target_id), note: relation.note } })),
      ],
      layout: {
        name: 'breadthfirst', directed: true, roots: roots.map(idea => String(idea.id)),
        spacingFactor: 1.35, padding: 55, avoidOverlap: true,
        transform: (_node: unknown, position: { x: number; y: number }) => ({ x: position.y, y: position.x }),
      } as cytoscape.LayoutOptions,
      style: [
        { selector: 'node', style: { shape: 'round-rectangle', width: 150, height: 52, 'background-color': '#fffdf8', 'border-width': 2, 'border-color': '#86aa9e', label: 'data(label)', color: '#26322d', 'font-size': 10, 'font-family': 'DM Sans, sans-serif', 'font-weight': 600, 'text-wrap': 'wrap', 'text-max-width': '128px', 'text-valign': 'center', 'text-halign': 'center', 'overlay-opacity': 0 } },
        { selector: 'node[root="yes"]', style: { 'background-color': '#e3f0ea', 'border-color': '#1e6b57', 'border-width': 3 } },
        { selector: 'node[merge="yes"]', style: { 'border-color': '#7a5a96', 'border-style': 'double', 'border-width': 5 } },
        { selector: 'node[focused="yes"]', style: { 'background-color': '#eee7f5', 'border-color': '#6b4d85', 'border-width': 4 } },
        { selector: 'node[status="promising"]', style: { 'background-color': '#f8ead8', 'border-color': '#d48131' } },
        { selector: 'node[status="parked"]', style: { opacity: .65, 'border-color': '#9a9e9b' } },
        { selector: 'edge', style: { width: 2.5, 'line-color': '#7b668f', 'target-arrow-color': '#7b668f', 'target-arrow-shape': 'triangle', 'curve-style': 'taxi', 'taxi-direction': 'rightward', 'taxi-turn': 24, 'arrow-scale': .9, label: 'data(note)', 'font-size': 8, color: '#766f7a', 'text-background-color': '#faf9f5', 'text-background-opacity': .9, 'text-background-padding': '3px', 'text-wrap': 'wrap', 'text-max-width': '100px' } },
      ],
    })
    cy.on('tap', 'node', event => onSelect(Number(event.target.id())))
    return () => cy.destroy()
  }, [focusId, incoming, onSelect, roots, visibleIdeas, visibleRelations])

  return <div className="lineage-view">
    <header className="lineage-toolbar">
      <div className="lineage-stats"><span><Route size={14}/>{roots.length} {roots.length === 1 ? 'root' : 'roots'}</span><span><GitBranch size={14}/>{branchCount} {branchCount === 1 ? 'branch point' : 'branch points'}</span><span><Merge size={14}/>{mergeCount} {mergeCount === 1 ? 'merge' : 'merges'}</span></div>
      <label>Focus track<select value={focusId ?? ''} onChange={event => setFocusId(event.target.value ? Number(event.target.value) : null)}><option value="">All tracks</option>{ideas.map(idea => <option value={idea.id} key={idea.id}>{idea.title}</option>)}</select></label>
      {focusId !== null && <button className="lineage-reset" onClick={() => setFocusId(null)}><RotateCcw size={13}/> Show all</button>}
    </header>
    <div className="lineage-canvas" ref={ref}/>
    {lineageRelations.length === 0 && <div className="lineage-empty"><GitBranch size={25}/><strong>No lineage links yet</strong><span>Open an idea, then connect it to a descendant with <b>develops-into</b>.</span></div>}
    <footer><span className="lineage-root-swatch"/> Root idea <span className="lineage-focus-swatch"/> Focused idea <span className="lineage-merge-swatch"/> Merge</footer>
  </div>
}
