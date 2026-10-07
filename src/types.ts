export type Status = 'seed' | 'exploring' | 'promising' | 'parked'

export interface Idea {
  id: number
  title: string
  content: string
  raw_text: string
  status: Status
  tags: string[]
  created_at: string
  updated_at: string
  project_id: number
  attachments?: Attachment[]
}

export interface Attachment {
  id: number
  project_id: number
  display_name: string
  storage_mode: 'linked' | 'managed'
  mime_type: string
  size_bytes: number
  content_hash: string
  created_at: string
  absolute_path: string
  exists: boolean
}

export interface ProjectGroup {
  id: number
  name: string
  project_count: number
  idea_count: number
}

export interface Project {
  id: number
  name: string
  description: string
  group_id: number | null
  group_name: string | null
  system_key: 'random_chat' | 'recycle' | null
  idea_count: number
  workspace_mode: 'library' | 'linked' | 'managed'
  workspace_path: string
}

export interface Relation {
  id: number
  source_id: number
  target_id: number
  relation_type: string
  note: string
  source_title?: string
  target_title?: string
}

export interface Suggestion extends Idea {
  score: number
  reason: string
}

export interface TagInfo {
  name: string
  count: number
  group_name: string
  is_hidden?: boolean
}

export interface TagMapData {
  nodes: TagInfo[]
  edges: { source: string; target: string; weight: number }[]
}

export type AgentMode = 'explore' | 'elaborate' | 'critique' | 'connect' | 'synthesize'
export type AgentProvider = 'openai' | 'anthropic' | 'deepseek' | 'qwen' | 'minimax' | 'local'
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AgentProviderOption {
  id: AgentProvider
  label: string
  configured: boolean
  configuration_source: 'session' | 'secure_storage' | 'environment' | 'none'
  credential_stored: boolean
  model: string
  base_url: string
  reasoning_effort: ReasoningEffort
  models: string[]
  reasoning_efforts: ReasoningEffort[]
  default_model: string
  default_base_url: string
  api_key_required: boolean
  web_search_supported: boolean
}

export interface AgentStatus {
  provider: AgentProvider
  provider_label: string
  configured: boolean
  configuration_source: 'session' | 'secure_storage' | 'environment' | 'none'
  default_model: string
  base_url: string
  reasoning_effort: ReasoningEffort
  web_search_supported: boolean
  providers: AgentProviderOption[]
  credential_store_available: boolean
  capabilities: string[]
  privacy: string
}

export interface AgentProposal {
  id: number
  run_id: number
  action_type: 'create_idea' | 'update_idea' | 'create_relation'
  title: string
  rationale: string
  payload: Record<string, unknown>
  status: 'pending' | 'applied' | 'dismissed'
}

export interface AgentRunResult {
  id: number
  provider: string
  model: string
  answer: string
  proposals: AgentProposal[]
  context_summary: { ideas: number; relations: number; files: number; raw_text_shared: boolean }
}

export interface AgentRunSaveResult {
  action: 'update_original' | 'create_child'
  idea: Idea
  parent_id: number
  relation_id: number | null
}

export interface DiscoveredPaper {
  id: string
  title: string
  abstract: string
  publication_date: string
  year: number
  venue: string
  authors: string[]
  doi: string
  url: string
  cited_by_count: number
  open_access: boolean
  metadata_sources: string[]
  match_reasons: string[]
}

export interface PaperDiscoveryResult {
  query: string
  venues: string[]
  from_year: number
  papers: DiscoveredPaper[]
  warnings: string[]
  sources: string[]
}

export interface PaperScholarlyContext {
  paper_id: string
  matched_title: string
  publication_year: number
  publication_date: string
  venue: string
  abstract: string
  doi: string
  url: string
  pdf_url: string
  authors: string[]
  corresponding_authors: { id: string; name: string; orcid: string; institution: string }[]
  recent_works: { title: string; year: number; venue: string; doi: string; cited_by_count: number }[]
  evidence_note: string
  source: string
}

export interface PaperAutoEnrichment {
  title_zh: string
  venue_zh: string
  abstract_zh: string
  study_type: string
  domain_zh: string
  cross_domain_clues_zh: string
  goal_zh: string
  journal_profile: string
  author_direction_summary_zh: string
}

export interface SemanticStatus {
  ready: boolean
  model: string
  dimensions: number
  indexed_ideas: number
  created_at: string | null
}

export interface SemanticOpportunity {
  source_id: number
  source_title: string
  target_id: number
  target_title: string
  score: number
  reason: string
}

export interface ReviewProposal extends AgentProposal {
  provider: string
  model: string
  created_at: string
  run_created_at: string
}

export interface ReviewData {
  summary: { active_ideas: number; new_captures: number; unlinked: number; stale_seeds: number; pending_proposals: number; semantic_opportunities: number }
  new_captures: Idea[]
  unlinked: Idea[]
  stale_seeds: Idea[]
  pending_proposals: ReviewProposal[]
  semantic_opportunities: SemanticOpportunity[]
}
