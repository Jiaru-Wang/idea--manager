import { CircleAlert, FileText, Link2, Network } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import type { Attachment, Idea } from '../types'

const referencePattern = /\[\[idea:(\d+)(?:\|[^\]]*)?\]\]|\bIdea\s+#(\d+)\b/gi
const fileReferencePattern = /\[\[file:(\d+)(?:\|([^\]]*))?\]\]/gi
const paperDiagramPattern = /\n*\[\[paper-diagram:([A-Za-z0-9+/=]+)\]\]\s*$/
type LogicPath = { label: string; nodes: string[] }
type ImpactSummary = { label: string; statement: string }
type WritingSummary = { label: string; statement: string }
type ImitationFramework = { statement: string }
type MechanismNode = { id: string; label: string; role: string }
type MechanismEdge = { source: string; target: string; kind: string; label: string }

function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\\[\]])/g, '\\$1')
}

export function resolveIdeaReferenceText(markdown: string, ideas: Idea[], attachments: Attachment[] = []) {
  const byId = new Map(ideas.map(idea => [idea.id, idea]))
  const filesById = new Map(attachments.map(file => [file.id, file]))
  let fenced = false
  return markdown.split('\n').map(line => {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      return line
    }
    if (fenced) return line
    const ideasResolved = line.replace(referencePattern, (_match, tokenId: string | undefined, legacyId: string | undefined) => {
      const id = Number(tokenId ?? legacyId)
      const title = byId.get(id)?.title ?? `Unavailable idea #${id}`
      return `[${escapeMarkdownLabel(title)}](#ideaminer-idea-${id})`
    })
    return ideasResolved.replace(fileReferencePattern, (_match, tokenId: string, label: string | undefined) => {
      const id = Number(tokenId)
      const name = label?.trim() || filesById.get(id)?.display_name || `Unavailable file #${id}`
      return `[${escapeMarkdownLabel(name)}](#ideaminer-file-${id})`
    })
  }).join('\n')
}

export function resolveIdeaReferencePlainText(text: string, ideas: Idea[]) {
  const byId = new Map(ideas.map(idea => [idea.id, idea]))
  return text.replace(paperDiagramPattern, '').replace(referencePattern, (_match, tokenId: string | undefined, legacyId: string | undefined) => {
    const id = Number(tokenId ?? legacyId)
    return byId.get(id)?.title ?? `Unavailable idea #${id}`
  })
}

function extractPaperDiagram(markdown: string) {
  const match = markdown.match(paperDiagramPattern)
  if (!match) return { markdown, source: '' }

  const withoutDiagram = markdown.replace(paperDiagramPattern, '')
  if (match[1].length > 1_500_000) return { markdown: withoutDiagram, source: '' }

  try {
    const bytes = Uint8Array.from(window.atob(match[1]), character => character.charCodeAt(0))
    const svg = new TextDecoder().decode(bytes)
    const unsafe = /<(?:script|foreignObject)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)/i.test(svg)
    const isSvg = /^\s*(?:<\?xml[\s\S]*?)?<svg\b/i.test(svg)
    return isSvg && !unsafe
      ? { markdown: withoutDiagram, source: `data:image/svg+xml;base64,${match[1]}` }
      : { markdown: withoutDiagram, source: '' }
  } catch {
    return { markdown: withoutDiagram, source: '' }
  }
}

function parseLogicPath(text: string): LogicPath | null {
  const match = text.match(/^\s*(?:[-*]\s*)?(?:逻辑路径|关键链条|推理链)([^：:\n]*)[：:]\s*(.+)$/)
  if (!match) return null
  const nodes = match[2].split(/\s*(?:→|➡️?|->|⇒)\s*/).map(node => node.trim()).filter(Boolean)
  if (nodes.length < 2) return null
  return { label: match[1].trim() || '关键链条', nodes: nodes.slice(0, 9) }
}

function parseImpactSummary(text: string): ImpactSummary | null {
  const match = text.match(/^\s*(?:[-*]\s*)?(一句话击穿|本阶段一句话结论|20秒先看懂)[：:]\s*(.+)$/)
  if (!match) return null
  return { label: match[1], statement: match[2].trim() }
}

function parseWritingSummary(text: string): WritingSummary | null {
  const match = text.match(/^\s*(?:[-*]\s*)?(句子结构小结|段落结构小结|本部分写作结构总结)[：:]\s*(.+)$/)
  if (!match) return null
  return { label: match[1], statement: match[2].trim() }
}

function parseImitationFramework(text: string): ImitationFramework | null {
  const match = text.match(/^\s*(?:[-*]\s*)?可模仿结构框架[：:]\s*(.+)$/)
  if (!match) return null
  return { statement: match[1].trim() }
}

function removeStageChecklist(markdown: string) {
  let inChecklist = false
  return markdown.split('\n').map(line => {
    if (/^\s*(?:#{1,6}\s*)?(?:\*\*)?本阶段核验清单(?:\*\*)?\s*$/.test(line)) {
      inChecklist = true
      return ''
    }
    if (!inChecklist) return line
    if (line.trim() === '' || /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return ''
    inChecklist = false
    return line
  }).join('\n').replace(/\n{3,}/g, '\n\n')
}

const logicWordPattern = /^(?:首先|其次|随后|接着|但|但是|然而|不过|因此|所以|因而|由此|于是|反而|同时|进一步|最终|换言之|这意味着|关键在于|正因为|为了|从而|相较之下|尽管|既然|如果|若|否则|结果是|问题在于|突破口是)[：:，,。！!？?\s]*$/

function isLogicWord(children: unknown) {
  const text = Array.isArray(children) ? children.filter(child => typeof child === 'string').join('') : children
  return typeof text === 'string' && logicWordPattern.test(text.trim())
}

function extractMechanismGraph(markdown: string) {
  const nodes: MechanismNode[] = []
  const edges: MechanismEdge[] = []
  const kept: string[] = []
  for (const line of markdown.split('\n')) {
    const node = line.match(/^\s*(?:[-*]\s*)?机制节点[：:]\s*([^|｜]+)[|｜]\s*([^|｜]+)[|｜]\s*(.+?)\s*$/)
    if (node) {
      nodes.push({ id: node[1].trim(), label: node[2].trim(), role: node[3].trim() })
      continue
    }
    const edge = line.match(/^\s*(?:[-*]\s*)?机制关系[：:]\s*([^|｜]+)[|｜]\s*([^|｜]+)[|｜]\s*([^|｜]+)[|｜]\s*(.+?)\s*$/)
    if (edge) {
      edges.push({ source: edge[1].trim(), target: edge[2].trim(), kind: edge[3].trim(), label: edge[4].trim() })
      continue
    }
    kept.push(line)
  }
  const ids = new Set(nodes.map(node => node.id))
  return {
    nodes: nodes.slice(0, 10),
    edges: edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).slice(0, 12),
    markdown: kept.join('\n'),
  }
}

function graphPositions(nodes: MechanismNode[], edges: MechanismEdge[]) {
  const incoming = new Map(nodes.map(node => [node.id, 0]))
  const outgoing = new Map(nodes.map(node => [node.id, [] as string[]]))
  edges.forEach(edge => {
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  })
  const level = new Map<string, number>()
  const queue = nodes.filter(node => !incoming.get(node.id)).map(node => node.id)
  queue.forEach(id => level.set(id, 0))
  while (queue.length) {
    const current = queue.shift()!
    for (const target of outgoing.get(current) || []) {
      level.set(target, Math.max(level.get(target) || 0, (level.get(current) || 0) + 1))
      incoming.set(target, (incoming.get(target) || 1) - 1)
      if (incoming.get(target) === 0) queue.push(target)
    }
  }
  nodes.forEach((node, index) => { if (!level.has(node.id)) level.set(node.id, index) })
  const columns = new Map<number, MechanismNode[]>()
  nodes.forEach(node => columns.set(level.get(node.id) || 0, [...(columns.get(level.get(node.id) || 0) || []), node]))
  const positions = new Map<string, { x: number; y: number }>()
  const orderedColumns = [...columns.entries()].sort(([left], [right]) => left - right)
  orderedColumns.forEach(([columnLevel, column]) => column.forEach((node, rowIndex) => {
    const centeredRow = rowIndex - (column.length - 1) / 2
    positions.set(node.id, { x: 90 + columnLevel * 160, y: 205 + centeredRow * 112 })
  }))
  return positions
}

function MechanismDiagram({ nodes, edges }: { nodes: MechanismNode[]; edges: MechanismEdge[] }) {
  const container = useRef<HTMLDivElement>(null)
  const [activeEdge, setActiveEdge] = useState<MechanismEdge | null>(null)
  const signature = JSON.stringify({ nodes, edges })
  useEffect(() => {
    if (!container.current) return
    const positions = graphPositions(nodes, edges)
    const graph = cytoscape({
      container: container.current,
      elements: [
        ...nodes.map(node => ({ data: {
          ...node,
          terminal: edges.some(edge => edge.target === node.id) ? edges.some(edge => edge.source === node.id) ? 'middle' : 'outcome' : 'source',
        }, position: positions.get(node.id) })),
        ...edges.map((edge, index) => ({ data: {
          id: `edge-${index}`,
          ...edge,
          displayLabel: ['抑制', '反驳', '约束', '关联'].includes(edge.kind) ? edge.kind : '',
        } })),
      ],
      layout: { name: 'preset', fit: true, padding: 46 },
      style: [
        { selector: 'node', style: { label: 'data(label)', width: 116, height: 50, shape: 'round-rectangle', 'background-color': '#fffdf9', 'border-color': '#aab8b1', 'border-width': 1.3, color: '#293a33', 'font-size': 12, 'font-weight': 'bold', 'text-wrap': 'wrap', 'text-max-width': '102px', 'text-valign': 'center', 'text-halign': 'center', 'overlay-opacity': 0 } },
        { selector: 'node[terminal = "source"]', style: { 'background-color': '#fff3e5', 'border-color': '#d98535', 'border-width': 2, color: '#a75520' } },
        { selector: 'node[role = "变量"], node[role = "机制"]', style: { 'background-color': '#fff7f0', 'border-color': '#dc8a54', color: '#9e4b28' } },
        { selector: 'node[role = "方法"], node[role = "证据"]', style: { 'background-color': '#edf6f4', 'border-color': '#6d9c91', color: '#315f56' } },
        { selector: 'node[role = "问题"], node[role = "观察"]', style: { 'background-color': '#f6f1e8', 'border-color': '#b99a72' } },
        { selector: 'node[terminal = "outcome"], node[role = "结果"]', style: { 'background-color': '#e8f3ee', 'border-color': '#3f816d', 'border-width': 2.4, color: '#245c4b' } },
        { selector: 'node[role = "边界"]', style: { 'background-color': '#f4e9e7', 'border-color': '#b8786e', 'border-style': 'dashed' } },
        { selector: 'edge', style: { width: 2.8, 'line-color': '#4f7468', 'target-arrow-color': '#4f7468', 'target-arrow-shape': 'triangle', 'arrow-scale': 1.05, 'curve-style': 'bezier', label: 'data(displayLabel)', color: '#8a4d43', 'font-size': 9, 'font-weight': 'bold', 'text-background-color': '#fffdf9', 'text-background-opacity': .96, 'text-background-padding': '3px', 'text-rotation': 'autorotate', 'overlay-opacity': 0 } },
        { selector: 'edge[kind = "抑制"], edge[kind = "反驳"]', style: { 'line-color': '#b65d50', 'target-arrow-color': '#b65d50', 'target-arrow-shape': 'tee' } },
        { selector: 'edge[kind = "关联"]', style: { 'line-style': 'dashed', 'line-color': '#8b9690', 'target-arrow-color': '#8b9690' } },
        { selector: 'edge[kind = "约束"]', style: { 'line-style': 'dashed', 'line-color': '#9b7a50', 'target-arrow-color': '#9b7a50' } },
      ],
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autoungrabify: true,
    })
    graph.on('tap', 'edge', event => {
      const edge = edges[Number(String(event.target.id()).replace('edge-', ''))]
      if (edge) setActiveEdge(edge)
    })
    graph.on('tap', event => { if (event.target === graph) setActiveEdge(null) })
    return () => graph.destroy()
  }, [signature])
  const labels = new Map(nodes.map(node => [node.id, node.label]))
  return <section className="mechanism-diagram" aria-label="论文原生科研逻辑图">
    <header><Network size={17}/><div><strong>论文内部科研逻辑图</strong><span>主链从左到右，分支上下展开；这里只画完成核心结论所必需的关系</span></div></header>
    <div className="mechanism-canvas" ref={container}/>
    {activeEdge && <div className="mechanism-edge-detail"><strong>{labels.get(activeEdge.source)} → {labels.get(activeEdge.target)}</strong><span>{activeEdge.kind}：{activeEdge.label}</span></div>}
    <footer><em>点击连线查看依据</em><span><i className="promote"/>促进/支撑</span><span><i className="inhibit"/>抑制/反驳</span><span><i className="uncertain"/>关联/待核验</span></footer>
  </section>
}

function InlineLogicPath({ path }: { path: LogicPath }) {
  return <aside className="inline-logic-path" aria-label={`${path.label}关键推理链`}>
    <strong>{path.label}：</strong>
    <span className="inline-logic-chain">{path.nodes.map((node, nodeIndex) => <span className="inline-logic-node" key={`${node}-${nodeIndex}`}><span>{node}</span>{nodeIndex < path.nodes.length - 1 && <b aria-hidden="true">➡️</b>}</span>)}</span>
  </aside>
}

function PaperImpactSummary({ summary }: { summary: ImpactSummary }) {
  return <aside className="paper-impact-summary" aria-label={summary.label}>
    <span>{summary.label}</span>
    <strong>{summary.statement}</strong>
  </aside>
}

function PaperWritingSummary({ summary }: { summary: WritingSummary }) {
  return <aside className="paper-writing-summary" aria-label={summary.label}>
    <span>{summary.label}</span>
    <p>{summary.statement}</p>
  </aside>
}

function PaperImitationFramework({ framework }: { framework: ImitationFramework }) {
  return <aside className="paper-imitation-framework" aria-label="可模仿结构框架">
    <span>可模仿结构框架</span>
    <p>{framework.statement}</p>
  </aside>
}

export function IdeaMarkdown({ content, ideas, attachments = [], onIdeaSelect, onFileOpen }: { content: string; ideas: Idea[]; attachments?: Attachment[]; onIdeaSelect?: (id: number) => void; onFileOpen?: (id: number) => void }) {
  const byId = new Map(ideas.map(idea => [idea.id, idea]))
  const filesById = new Map(attachments.map(file => [file.id, file]))
  const paperDiagram = extractPaperDiagram(content)
  const visible = removeStageChecklist(paperDiagram.markdown.replace(/<think\b[^>]*>[\s\S]*?<\/think>\s*/gi, '').replace(/<think\b[^>]*>[\s\S]*$/gi, ''))
    .replace(/(\*\*[^*\n]+[：:]\*\*)(?=\S)/g, '$1 ')
  const mechanism = extractMechanismGraph(resolveIdeaReferenceText(visible, ideas, attachments))
  return <>{mechanism.nodes.length >= 2 && mechanism.edges.length > 0 && <MechanismDiagram nodes={mechanism.nodes} edges={mechanism.edges}/>}<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{
    p: ({ children }) => {
      const text = typeof children === 'string'
        ? children
        : Array.isArray(children) && children.every(child => typeof child === 'string')
          ? children.join('')
          : ''
      const path = parseLogicPath(text)
      const impact = parseImpactSummary(text)
      const writing = parseWritingSummary(text)
      const framework = parseImitationFramework(text)
      if (impact) return <PaperImpactSummary summary={impact}/>
      if (writing) return <PaperWritingSummary summary={writing}/>
      if (framework) return <PaperImitationFramework framework={framework}/>
      return path ? <InlineLogicPath path={path}/> : <p>{children}</p>
    },
    strong: ({ children }) => <strong className={isLogicWord(children) ? 'logic-word' : undefined}>{children}</strong>,
    a: ({ href, children }) => {
      const fileMatch = href?.match(/^#ideaminer-file-(\d+)$/)
      if (fileMatch) {
        const id = Number(fileMatch[1]); const file = filesById.get(id)
        return <button type="button" className={`idea-reference file-reference ${file?.exists ? '' : 'missing'}`} disabled={!file?.exists} title={file?.exists ? `Open ${file.absolute_path}` : 'This attached file is unavailable'} onClick={() => file?.exists && onFileOpen?.(id)}><FileText size={12}/><span>{children}</span></button>
      }
      const match = href?.match(/^#ideaminer-idea-(\d+)$/)
      if (!match) return <a href={href}>{children}</a>
      const id = Number(match[1])
      const idea = byId.get(id)
      return <button type="button" className={`idea-reference ${idea ? '' : 'missing'}`} disabled={!idea} title={idea ? `Open “${idea.title}”` : 'This idea may be recycled or permanently deleted'} onClick={() => idea && onIdeaSelect?.(id)}>
        {idea ? <Link2 size={12}/> : <CircleAlert size={12}/>}<span>{children}</span>
      </button>
    },
  }}>{mechanism.markdown}</ReactMarkdown>{paperDiagram.source && <figure className="saved-paper-diagram">
    <figcaption>科研逻辑图</figcaption>
    <img src={paperDiagram.source} alt="该论文的科研逻辑图"/>
  </figure>}</>
}
