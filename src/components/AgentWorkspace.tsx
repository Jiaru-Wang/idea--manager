import { useEffect, useMemo, useState } from 'react'
import { Check, FileText, GitBranch, Globe2, KeyRound, LoaderCircle, Paperclip, Save, ShieldCheck, Sparkles, X } from 'lucide-react'
import { api } from '../api'
import { IdeaMarkdown } from './IdeaMarkdown'
import type { AgentMode, AgentProposal, AgentProvider, AgentRunResult, AgentRunSaveResult, AgentStatus, Attachment, Idea, Project, ProjectGroup } from '../types'

type Scope = { type: 'all' } | { type: 'project'; id: number } | { type: 'group'; id: number }

const modes: { id: AgentMode; label: string; prompt: string }[] = [
  { id: 'explore', label: 'Explore', prompt: 'Explore these ideas. Surface promising directions, important unknowns, and the next questions worth investigating.' },
  { id: 'elaborate', label: 'Elaborate', prompt: 'Develop the selected material into a clearer research idea with motivation, method, evidence needs, and next steps.' },
  { id: 'critique', label: 'Critique', prompt: 'Stress-test these ideas. Identify weak assumptions, plausible counterarguments, risks, and missing evidence.' },
  { id: 'connect', label: 'Connect', prompt: 'Look for meaningful, non-obvious connections among these ideas. Explain each connection and propose useful typed relations.' },
  { id: 'synthesize', label: 'Synthesize', prompt: 'Synthesize these ideas into a coherent research direction while preserving important tensions and alternatives.' },
]

function payloadPreview(proposal: AgentProposal) {
  const data = proposal.payload
  if (proposal.action_type === 'create_relation') return `${String(data.source_id)} → ${String(data.target_id)} · ${String(data.relation_type || 'related-to')}`
  const tags = Array.isArray(data.tags) ? data.tags.join(', ') : ''
  return [String(data.idea_title || ''), String(data.status || ''), tags && `#${tags.replaceAll(', ', ' #')}`].filter(Boolean).join(' · ')
}

export function AgentWorkspace({ scope, contextIdea, ideas, projects, groups, onClose, onChanged, onIdeaSelect }: {
  scope: Scope
  contextIdea: Idea | null
  ideas: Idea[]
  projects: Project[]
  groups: ProjectGroup[]
  onClose: () => void
  onChanged: () => Promise<void>
  onIdeaSelect: (id: number) => void
}) {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [mode, setMode] = useState<AgentMode>(contextIdea ? 'elaborate' : 'explore')
  const [prompt, setPrompt] = useState(contextIdea ? modes[1].prompt : modes[0].prompt)
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState<AgentProvider>('openai')
  const [connectionModel, setConnectionModel] = useState('gpt-5.4-mini')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [editingConnection, setEditingConnection] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AgentRunResult | null>(null)
  const [resultMode, setResultMode] = useState<AgentMode | null>(null)
  const [savingResult, setSavingResult] = useState<'update_original' | 'create_child' | null>(null)
  const [savedResult, setSavedResult] = useState<AgentRunSaveResult | null>(null)
  const [availableFiles, setAvailableFiles] = useState<Attachment[]>([])
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([])

  useEffect(() => {
    api.agentStatus().then(value => {
      setStatus(value); setProvider(value.provider); setModel(value.default_model)
      setConnectionModel(value.default_model); setBaseUrl(value.base_url)
    }).catch(error => setError(error instanceof Error ? error.message : 'Could not inspect agent configuration'))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    if (contextIdea) params.set('idea_id', String(contextIdea.id))
    else if (scope.type === 'project') params.set('project_id', String(scope.id))
    else if (scope.type === 'group') params.set('group_id', String(scope.id))
    api.attachments(params).then(files => { setAvailableFiles(files); setSelectedFileIds([]) }).catch(() => setAvailableFiles([]))
  }, [contextIdea?.id, scope.type, scope.type === 'all' ? null : scope.id])

  const contextName = useMemo(() => {
    if (contextIdea) return `Idea: ${contextIdea.title}`
    if (scope.type === 'project') return `Project: ${projects.find(item => item.id === scope.id)?.name ?? 'Unknown'}`
    if (scope.type === 'group') return `Group: ${groups.find(item => item.id === scope.id)?.name ?? 'Unknown'}`
    return 'All active ideas (up to 40 recent ideas)'
  }, [contextIdea, groups, projects, scope])

  function chooseMode(next: AgentMode) {
    setMode(next)
    setPrompt(modes.find(item => item.id === next)?.prompt ?? '')
  }

  function chooseProvider(next: AgentProvider) {
    setProvider(next)
    const option = status?.providers.find(item => item.id === next)
    if (option) {
      setConnectionModel(option.default_model)
      setBaseUrl(option.default_base_url)
      if (!option.web_search_supported) setWebSearch(false)
    }
    setApiKey('')
  }

  async function run() {
    if (!prompt.trim()) return
    setRunning(true); setError(''); setResult(null); setSavedResult(null); setResultMode(null)
    try {
      const next = await api.runAgent({
        prompt, mode, scope_type: scope.type, scope_id: scope.type === 'all' ? null : scope.id,
        idea_id: contextIdea?.id ?? null, model, web_search: webSearch, attachment_ids: selectedFileIds,
      })
      setResult(next); setResultMode(mode)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The agent could not complete this request')
    } finally { setRunning(false) }
  }

  async function connect() {
    if ((provider !== 'custom' && !apiKey.trim()) || !connectionModel.trim() || !baseUrl.trim()) return
    setConnecting(true); setError('')
    try {
      const next = await api.configureAgent({ provider, api_key: apiKey, model: connectionModel, base_url: baseUrl })
      setApiKey(''); setStatus(next); setProvider(next.provider); setModel(next.default_model); setBaseUrl(next.base_url); setEditingConnection(false)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save the connection for this session') }
    finally { setConnecting(false) }
  }

  async function forgetConnection() {
    try {
      const next = await api.clearAgentConfig()
      setStatus(next); setEditingConnection(!next.configured)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not clear the session connection') }
  }

  async function resolve(proposal: AgentProposal, action: 'apply' | 'dismiss') {
    try {
      await api.resolveAgentProposal(proposal.id, action)
      setResult(current => current ? { ...current, proposals: current.proposals.map(item => item.id === proposal.id ? { ...item, status: action === 'apply' ? 'applied' : 'dismissed' } : item) } : current)
      if (action === 'apply') await onChanged()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not resolve that proposal') }
  }

  async function saveElaboration(action: 'update_original' | 'create_child') {
    if (!result || !contextIdea) return
    setSavingResult(action); setError('')
    try {
      const saved = await api.saveAgentResult(result.id, action)
      setSavedResult(saved)
      await onChanged()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save the elaboration') }
    finally { setSavingResult(null) }
  }

  return <div className="modal-backdrop agent-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="agent-workspace">
      <header><div><p className="eyebrow">RESEARCH AGENT</p><h2><Sparkles size={25}/> Agent Workspace</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></header>
      {!status ? <div className="agent-loading"><LoaderCircle className="spin" size={20}/> Checking provider…</div> : <>
        {(!status.configured || editingConnection) ? <div className="agent-setup agent-connection-form">
          <KeyRound size={22}/><div><strong>Connect an AI provider</strong><p>Choose a preset or enter a Responses-compatible endpoint. Credentials are held only in the local backend's memory until IdeaMiner stops.</p>
            <label>Provider<select value={provider} onChange={event => chooseProvider(event.target.value as AgentProvider)}>{status.providers.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            <label>API key {provider === 'custom' && <span>optional</span>}<input type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={provider === 'deepseek' ? 'DeepSeek API key' : provider === 'custom' ? 'Bearer token, if required' : 'OpenAI API key'}/></label>
            <label>Model<input value={connectionModel} onChange={event => setConnectionModel(event.target.value)} placeholder="gpt-5.4-mini"/></label>
            <label>Base URL<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://provider.example/v1"/></label>
            <p className="agent-provider-note">IdeaMiner appends <code>/responses</code> unless the URL already ends with it. DeepSeek and OpenAI presets support structured proposals and web search.</p>
            <div className="agent-connect-actions">{status.configured && <button className="button secondary small" onClick={() => setEditingConnection(false)}>Cancel</button>}<button className="button primary small" disabled={connecting || (provider !== 'custom' && !apiKey.trim()) || !connectionModel.trim() || !baseUrl.trim()} onClick={connect}>{connecting ? <LoaderCircle className="spin" size={15}/> : <KeyRound size={15}/>} Use for this session</button></div>
            <small><ShieldCheck size={13}/> Not saved to SQLite, browser storage, files, or exports. The first agent run verifies the credentials with the selected provider.</small>
            <details><summary>Optional persistent setup</summary><code>{provider === 'deepseek' ? 'setx IDEAMINER_AGENT_PROVIDER "deepseek"\nsetx DEEPSEEK_API_KEY "your-api-key"' : provider === 'custom' ? 'setx IDEAMINER_AGENT_PROVIDER "custom"\nsetx IDEAMINER_AGENT_BASE_URL "https://your-endpoint/v1"\nsetx IDEAMINER_AGENT_MODEL "your-model"' : 'setx IDEAMINER_AGENT_PROVIDER "openai"\nsetx OPENAI_API_KEY "your-api-key"'}</code><p>Restart IdeaMiner after setting environment variables.</p></details>
          </div></div> : <div className="agent-connected"><ShieldCheck size={18}/><div><strong>{status.provider_label} connected</strong><span>{status.default_model} · {status.configuration_source === 'session' ? 'this session only' : 'environment variable'}</span><small>{status.base_url}</small></div><button onClick={() => setEditingConnection(true)}>Change</button>{status.configuration_source === 'session' && <button onClick={forgetConnection}>Forget</button>}</div>}
        {status.configured && <>
        <div className="agent-context"><span>Context</span><strong>{contextName}</strong><small>{status.privacy}</small></div>
        <div className="agent-modes">{modes.map(item => <button key={item.id} className={mode === item.id ? 'active' : ''} onClick={() => chooseMode(item.id)}>{item.label}</button>)}</div>
        {availableFiles.length > 0 && <details className="agent-files"><summary><Paperclip size={14}/> Include local files <span>{selectedFileIds.length ? `${selectedFileIds.length} selected` : 'none selected'}</span></summary><p>Only checked text files are sent to the provider for this run. Their stable ID and local path are included; binary files contribute metadata only.</p><div>{availableFiles.map(file => <label className={file.exists ? '' : 'missing'} key={file.id}><input type="checkbox" disabled={!file.exists} checked={selectedFileIds.includes(file.id)} onChange={event => setSelectedFileIds(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))}/><FileText size={14}/><span>{file.display_name}<small title={file.absolute_path}>{file.absolute_path}</small><small>{file.storage_mode === 'managed' ? 'managed copy' : 'linked original'}{!file.exists && ' · missing'}</small></span></label>)}</div></details>}
        <textarea className="agent-prompt" rows={5} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="What should the research agent investigate?"/>
        <div className="agent-options"><label title={status.web_search_supported ? `Use ${status.provider_label}'s server-side web search` : 'This provider preset does not advertise web search'}><input type="checkbox" checked={webSearch} disabled={!status.web_search_supported} onChange={event => setWebSearch(event.target.checked)}/><Globe2 size={15}/> Allow {status.provider_label} web search</label><label>Model <input value={model} onChange={event => setModel(event.target.value)} /></label></div>
        <button className="button primary agent-run" disabled={running || !prompt.trim()} onClick={run}>{running ? <><LoaderCircle className="spin" size={17}/> Researching…</> : <><Sparkles size={17}/> Run agent</>}</button>
        </>}
      </>}
      {error && <div className="error-banner agent-error">{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
      {result && <div className="agent-result">
        <div className="agent-result-meta"><span>{result.provider}</span><span>{result.model}</span><span>{result.context_summary.ideas} ideas · {result.context_summary.relations} relations · {result.context_summary.files} files</span><span>Raw captures not shared</span></div>
        <div className="markdown"><IdeaMarkdown content={result.answer} ideas={ideas} attachments={availableFiles} onIdeaSelect={onIdeaSelect} onFileOpen={id => void api.openAttachment(id)}/></div>
        {contextIdea && resultMode === 'elaborate' && <section className={`agent-save-result ${savedResult ? 'saved' : ''}`}>
          {savedResult ? <><Check size={18}/><div><strong>{savedResult.action === 'create_child' ? 'Saved as a descendant' : 'Original idea updated'}</strong><span>{savedResult.idea.title}</span></div></> : <><div><strong>Save this elaboration</strong><span>Update the current idea, or create a linked child while keeping the original unchanged.</span></div><aside><button className="button secondary small" disabled={savingResult !== null} onClick={() => saveElaboration('update_original')}>{savingResult === 'update_original' ? <LoaderCircle className="spin" size={14}/> : <Save size={14}/>} Update original</button><button className="button primary small" disabled={savingResult !== null} onClick={() => saveElaboration('create_child')}>{savingResult === 'create_child' ? <LoaderCircle className="spin" size={14}/> : <GitBranch size={14}/>} Save as descendant</button></aside></>}
        </section>}
        {result.proposals.length > 0 && <section className="agent-proposals"><h3>Suggested changes <span>Review before applying</span></h3>{result.proposals.map(proposal => <article key={proposal.id} className={`agent-proposal ${proposal.status}`}>
          <div><span>{proposal.action_type.replaceAll('_', ' ')}</span><strong>{proposal.title}</strong><p>{proposal.rationale}</p><small>{payloadPreview(proposal)}</small></div>
          {proposal.status === 'pending' ? <aside><button className="button secondary small" onClick={() => resolve(proposal, 'dismiss')}>Dismiss</button><button className="button primary small" onClick={() => resolve(proposal, 'apply')}><Check size={14}/> Apply</button></aside> : <em>{proposal.status === 'applied' ? 'Applied' : 'Dismissed'}</em>}
        </article>)}</section>}
      </div>}
    </section>
  </div>
}
