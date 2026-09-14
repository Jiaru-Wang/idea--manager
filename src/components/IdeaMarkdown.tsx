import { CircleAlert, FileText, Link2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import type { Attachment, Idea } from '../types'

const referencePattern = /\[\[idea:(\d+)(?:\|[^\]]*)?\]\]|\bIdea\s+#(\d+)\b/gi
const fileReferencePattern = /\[\[file:(\d+)(?:\|([^\]]*))?\]\]/gi

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
  return text.replace(referencePattern, (_match, tokenId: string | undefined, legacyId: string | undefined) => {
    const id = Number(tokenId ?? legacyId)
    return byId.get(id)?.title ?? `Unavailable idea #${id}`
  })
}

export function IdeaMarkdown({ content, ideas, attachments = [], onIdeaSelect, onFileOpen }: { content: string; ideas: Idea[]; attachments?: Attachment[]; onIdeaSelect?: (id: number) => void; onFileOpen?: (id: number) => void }) {
  const byId = new Map(ideas.map(idea => [idea.id, idea]))
  const filesById = new Map(attachments.map(file => [file.id, file]))
  return <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{
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
  }}>{resolveIdeaReferenceText(content, ideas, attachments)}</ReactMarkdown>
}
