import { useState } from 'react'
import type { Idea } from '../types'

export function RelationForm({ idea, ideas, types, onCreate }: { idea: Idea; ideas: Idea[]; types: string[]; onCreate: (target: number, type: string, note: string) => Promise<void> }) {
  const others = ideas.filter(i => i.id !== idea.id)
  const [target, setTarget] = useState(others[0]?.id ?? 0)
  const [type, setType] = useState('related-to')
  const [note, setNote] = useState('')
  if (!others.length) return <p className="empty-small">Add another idea to start making connections.</p>
  return <form className="relation-form" onSubmit={async e => { e.preventDefault(); await onCreate(target, type, note); setNote('') }}>
    <div><select value={type} onChange={e => setType(e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select><select value={target} onChange={e => setTarget(Number(e.target.value))}>{others.map(i => <option value={i.id} key={i.id}>{i.title}</option>)}</select></div>
    {type === 'develops-into' && <p className="lineage-hint"><strong>{idea.title}</strong> develops into <strong>{others.find(item => item.id === target)?.title}</strong>. This direction will appear in Lineage view.</p>}
    <div><input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note"/><button className="button small">Connect</button></div>
  </form>
}
