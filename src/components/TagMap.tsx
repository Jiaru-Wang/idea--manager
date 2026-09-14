import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import { Filter, Maximize2, RefreshCw } from 'lucide-react'
import { api } from '../api'
import { tagColors, tagGroupStyle } from '../tagColors'
import type { TagMapData } from '../types'

type Scope = { type: 'all' } | { type: 'project'; id: number } | { type: 'group'; id: number }

const spreadLayout = (nodeCount: number): cytoscape.LayoutOptions => ({
  name: 'grid', animate: false, fit: true, padding: 72,
  avoidOverlap: true, avoidOverlapPadding: 24, condense: false,
  cols: Math.max(1, Math.ceil(Math.sqrt(nodeCount * 1.35))),
} as cytoscape.LayoutOptions)

export function TagMap({ scope, reloadToken, onFilterTag }: { scope: Scope; reloadToken: number; onFilterTag: (name: string) => void }) {
  const canvas = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [data, setData] = useState<TagMapData>({ nodes: [], edges: [] })
  const [minimumWeight, setMinimumWeight] = useState(2)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams({ limit: '50' })
    if (scope.type === 'project') params.set('project_id', String(scope.id))
    if (scope.type === 'group') params.set('group_id', String(scope.id))
    setError('')
    api.tagMap(params).then(setData).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load the tag map'))
  }, [reloadToken, scope])

  const visibleEdges = useMemo(() => data.edges.filter(edge => edge.weight >= minimumWeight), [data.edges, minimumWeight])
  const groups = useMemo(() => [...new Set(data.nodes.map(node => node.group_name || 'General'))].sort(), [data.nodes])

  useEffect(() => {
    if (!canvas.current || !data.nodes.length) return
    const maximumCount = Math.max(...data.nodes.map(node => node.count), 1)
    const maximumWeight = Math.max(...visibleEdges.map(edge => edge.weight), 1)
    const cy = cytoscape({
      container: canvas.current,
      elements: [
        ...data.nodes.map(node => {
          const colors = tagColors(node.name, node.group_name)
          return { data: { id: node.name, label: `#${node.name}\n${node.count}`, count: node.count, background: colors.background, border: colors.border, text: colors.text } }
        }),
        ...visibleEdges.map((edge, index) => ({ data: { id: `tag-edge-${index}`, source: edge.source, target: edge.target, weight: edge.weight } })),
      ],
      layout: spreadLayout(data.nodes.length),
      minZoom: .3,
      maxZoom: 2.5,
      wheelSensitivity: .18,
      style: [
        { selector: 'node', style: { width: `mapData(count, 1, ${maximumCount}, 40, 70)`, height: `mapData(count, 1, ${maximumCount}, 40, 70)`, 'background-color': 'data(background)', 'border-color': 'data(border)', 'border-width': 2, color: 'data(text)', label: 'data(label)', 'font-family': 'DM Sans, sans-serif', 'font-size': 9, 'font-weight': 650, 'text-wrap': 'wrap', 'text-max-width': '82px', 'text-valign': 'center', 'text-halign': 'center', 'overlay-opacity': 0 } },
        { selector: 'node:selected', style: { 'border-width': 4, 'border-color': '#315f50', 'overlay-color': '#315f50', 'overlay-opacity': .08, 'overlay-padding': 7 } },
        { selector: 'edge', style: { width: `mapData(weight, 1, ${maximumWeight}, 1, 5)`, 'line-color': '#aeb8b2', opacity: .48, 'curve-style': 'bezier', 'overlay-opacity': 0 } },
      ] as cytoscape.Stylesheet[],
    })
    cyRef.current = cy
    cy.on('tap', 'node', event => setSelected(event.target.id()))
    return () => { cyRef.current = null; cy.destroy() }
  }, [data, onFilterTag, visibleEdges])

  if (error) return <div className="tag-map-empty">{error}</div>
  if (!data.nodes.length) return <div className="tag-map-empty">No visible tags in this scope yet.</div>
  return <section className="tag-map-panel">
    <header><div><strong>{data.nodes.length} tags · {visibleEdges.length} shared contexts</strong><span>Lines connect tags used on the same ideas. Ungrouped tags have individual colors.</span></div><div><label>Minimum overlap<select value={minimumWeight} onChange={event => setMinimumWeight(Number(event.target.value))}><option value={1}>1 idea</option><option value={2}>2 ideas</option><option value={3}>3 ideas</option><option value={5}>5 ideas</option></select></label><button onClick={() => cyRef.current?.fit(undefined, 70)}><Maximize2 size={13}/> Fit</button><button onClick={() => cyRef.current?.layout(spreadLayout(data.nodes.length)).run()}><RefreshCw size={13}/> Spread</button></div></header>
    <div className="tag-map-canvas" ref={canvas}/>
    <footer><div className="tag-map-legend">{groups.map(group => <span key={group} style={tagGroupStyle(group)}><i/>{group === 'General' ? 'Ungrouped · individual colors' : group}</span>)}</div>{selected && <button className="button secondary small" onClick={() => onFilterTag(selected)}><Filter size={13}/> Show ideas tagged #{selected}</button>}</footer>
  </section>
}
