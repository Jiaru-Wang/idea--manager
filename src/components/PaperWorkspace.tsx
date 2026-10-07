import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, Check, Code2, ExternalLink, FileSearch, FileText, FlaskConical, GitFork, Globe2, Lightbulb, LoaderCircle, Network, Save, Search, ShieldAlert, Sparkles, UserRoundSearch, X } from 'lucide-react'
import { api } from '../api'
import { IdeaMarkdown } from './IdeaMarkdown'
import './PaperWorkspace.css'
import type { AgentMode, AgentProposal, AgentRunResult, AgentStatus, Attachment, DiscoveredPaper, Idea, PaperDiscoveryResult, Project, ProjectGroup } from '../types'

type Scope = { type: 'all' } | { type: 'project'; id: number } | { type: 'group'; id: number }
type PaperModule = 'full' | 'title_author' | 'introduction' | 'causal' | 'cross_domain' | 'reproduce' | 'ideas'

type PaperDraft = {
  title: string
  locator: string
  venue: string
  journalProfile: string
  studyType: string
  domain: string
  crossDomainClues: string
  sourceText: string
  goal: string
  module: PaperModule
}

type DiscoveryPreferences = {
  query: string
  venues: string
  fromYear: number
  autoRefresh: boolean
}

const DRAFT_KEY = 'ideaminer-paper-lab-draft-v1'
const DISCOVERY_KEY = 'ideaminer-paper-discovery-v1'

const defaultDraft: PaperDraft = {
  title: '',
  locator: '',
  venue: '',
  journalProfile: 'adaptive',
  studyType: 'experimental',
  domain: 'EEG emotion recognition / neuroscience',
  crossDomainClues: '',
  sourceText: '',
  goal: '理解论文的因果逻辑，找到可以复现的实验，并形成适合我当前研究的新 idea。',
  module: 'full',
}

const defaultDiscovery: DiscoveryPreferences = {
  query: 'EEG emotion recognition cross-subject generalization',
  venues: '',
  fromYear: new Date().getFullYear() - 3,
  autoRefresh: false,
}

const modules: { id: PaperModule; label: string; detail: string }[] = [
  { id: 'full', label: '全链路', detail: '标题、作者、强逻辑、交叉知识、复现与新 idea' },
  { id: 'title_author', label: '题目与作者', detail: '表型 + 机制与实验室研究轨迹' },
  { id: 'introduction', label: '综述逻辑', detail: '已知、未知、矛盾、机会与科学猜想' },
  { id: 'causal', label: '因果实验链', detail: '相关、干预、救援、反证与场景迁移' },
  { id: 'cross_domain', label: '交叉知识桥', detail: '把难点抽象后跨领域寻找机制、模型与工具' },
  { id: 'reproduce', label: '代码复现', detail: 'Figure 到数据、文件、命令和验收指标' },
  { id: 'ideas', label: '新 Idea', detail: '从证据缺口推导可检验的新方向' },
]

const journalProfiles: Record<string, { label: string; logic: string }> = {
  adaptive: {
    label: '按具体期刊与论文类型自适应',
    logic: '先识别具体期刊、文章类型和学科共同决定的证明责任，再选择合适的强逻辑框架。不得把生物医学的救援实验、AI 的消融实验或临床的随机化要求机械套到不相干的论文上。',
  },
  nature_science: {
    label: 'Nature / Science 综合突破',
    logic: '优先检查概念新颖性、跨尺度证据、领域普适性、正交验证和能否改变既有解释框架。',
  },
  cell_mechanism: {
    label: 'Cell / 生物医学机制',
    logic: '优先检查表型到机制的层层下钻、必要性与充分性、敲除/过表达、救援实验、上下游顺序、体内外闭环和 STAR Methods 式可复现资源。',
  },
  clinical: {
    label: '临床 / 医学顶刊',
    logic: '优先检查队列来源、终点、混杂、随机化或因果识别、统计功效、外部验证、安全性与临床可迁移性，并匹配 CONSORT/STROBE/TRIPOD/PRISMA 等研究设计规范。',
  },
  ai_engineering: {
    label: 'AI / 工程顶刊',
    logic: '优先检查问题定义、数据泄漏、基线公平性、消融、跨数据集与跨受试者泛化、稳健性、算力成本、开源完整性和可重复实验。',
  },
  theory_methods: {
    label: '理论 / 方法学顶刊',
    logic: '优先检查定义与假设是否清楚、命题和证明链是否完备、边界条件与反例、相对已有方法的严格增量、复杂度，以及模拟和现实数据是否真正检验理论预言。',
  },
  engineering_systems: {
    label: '工程 / 材料 / 系统顶刊',
    logic: '优先检查设计约束、机制或工程原理、关键部件贡献、性能基准、极端条件与失效模式、可制造性、规模化和真实场景验证。',
  },
  behavioral_observational: {
    label: '行为 / 社会 / 观察研究顶刊',
    logic: '优先检查构念与测量、采样代表性、混杂与选择偏差、识别策略、替代模型、稳健性、异质性、外部效度和可重复性；不把观察关联写成干预因果。',
  },
  resource_review: {
    label: '资源 / 数据集 / 综述顶刊',
    logic: '优先检查检索或采集覆盖面、纳排标准、标注与质量控制、偏倚评估、资源独特性、复用价值、版本与许可，以及结论是否超出证据覆盖范围。',
  },
  general: {
    label: '通用科研逻辑',
    logic: '根据论文自己的研究设计判断证据强度，不用期刊名替代方法学审查。',
  },
}

const moduleRequirements: Record<PaperModule, string> = {
  full: `输出完整报告，严格包含以下部分：
1. 证据边界：已由输入证实、合理推断、待核验三列。
2. 题目拆解：表型、机制、对象、方法、因果动词；解释题目为什么成立以及是否夸大。
3. 通讯作者轨迹：近年相关问题、模型与技术路线，以及这些积累如何汇入本文。没有联网证据时列出核验清单，禁止编造。
4. 综述/Introduction 推理链：别人已知什么、主要关注什么、少关注什么、矛盾或方法缺口、交叉领域机会、作者的科学猜想。逐步说明为什么引用该类证据，而不是泛泛罗列。
5. 总体论证图：按论文类型选择因果图、定理依赖图、系统设计链、识别策略图或证据综合图；标出前提、混杂/边界条件和可替代解释。
6. 证据链逐层表：每层写问题、方法或操纵、对照/基线、观察、允许的结论、排除的替代解释、为什么自然导向下一层。只在适用时检查干预、救援、消融、反例、稳健性、极端条件、体内外或跨场景验证，不机械套用医学模板。
7. 交叉知识桥：识别本文已经借用或可能借用的外领域知识。按“当前难点 -> 功能抽象 -> 候选领域 -> 可借机制/模型/数学结构/实验工具 -> 转译回本文 -> 最小验证 -> 失效条件”输出。至少区分同源机制、功能类比、数学同构和仅仅词语相似。
8. 最强证据与最弱跳跃：区分数据直接支持和作者叙事越界；提出能使核心解释失败的反事实。
9. 复现地图：Paper Figure/Table -> 数据 -> 预处理 -> 代码文件/函数 -> 配置 -> 命令 -> 预期输出 -> 验收指标 -> 常见失败。未知项明确写“待定位”。
10. 新 idea：至少 3 个，其中至少 1 个来自可信的跨学科迁移。每个包含来源缺口、核心假设、最小关键实验、反证实验、创新性、可行性、风险与下一步；推荐其中一个。
11. 初学者行动清单：按先后顺序列出今天、第一周、完整复现三个阶段。`,
  title_author: `聚焦题目与作者：拆解表型、机制、对象、方法和因果强度；判断题目叙事巧妙处与可能夸大。重建通讯作者近年研究问题、实验模型、关键技术和本文之间的积累关系。不能核验的信息必须标注“待核验”，并给出作者主页、ORCID、PubMed/Scholar 检索式。`,
  introduction: `聚焦 Introduction/综述的强逻辑。输出“已知 -> 主流关注 -> 被忽略之处 -> 矛盾/技术窗口 -> 交叉学科转折 -> 科学猜想 -> 可证伪预测”。逐段解释为什么此处需要这一类文献，以及若删除某个前提，选题是否仍成立。特别标出作者何时从另一学科借入概念、模型或测量工具，以及这次转译成立所依赖的假设。比较综合顶刊、机制型生物医学顶刊、临床顶刊、理论和 AI/工程顶刊在立题证据上的不同要求。`,
  causal: `聚焦实验因果链。先画变量与混杂因素的文本因果图，再建立逐实验表格：实验问题、干预、对照、读出、结果、允许的结论、不能推出的结论、下一实验。必须检查时间先后、剂量反应、敲除/抑制、过表达/激活、救援、反向验证、上下游/上位性、正交测量、体内外切换和跨场景验证。最后设计一个能让核心因果解释失败的决定性反证实验。`,
  cross_domain: `聚焦交叉知识迁移与难点求解。先从论文中找出最难解释、最难测量或现有方法最难突破的 3 个瓶颈，再把每个瓶颈抽象为与学科无关的功能问题，例如能量分配、信号传播、时空同步、网络控制、适应、相变、反馈稳定性、稀疏编码或多尺度耦合。随后跨领域寻找候选来源，包括但不限于细胞代谢与线粒体、免疫、动物或单细胞生物行为、神经生态、控制论、非线性动力学、统计物理、材料、机器人和信息论。对每个候选桥梁输出：来源领域、可借知识点、与当前问题的结构对应、不是表面类比的理由、转译步骤、需要改变的变量、最小实验、反证条件、数据/技术门槛和检索式。明确区分生物同源、功能类比、数学同构和启发式隐喻；淘汰无法验证或尺度不匹配的类比。最后推荐 1 条最有价值且可执行的交叉路线。`,
  reproduce: `聚焦可执行复现。建立 Figure/Table 到代码的逐项矩阵；解释所选本地代码文件中每个可见模块的职责、数据形状、调用顺序和配置来源。给出环境建立、数据获取、预处理、防止泄漏、训练、评估、绘图、随机种子和验收标准的命令级步骤。区分“已有代码可直接运行”“需要补写”“论文未公开”。不得猜测不存在的文件或函数。`,
  ideas: `聚焦新 idea 推导。先列论文已解决与仍未解决的边界，再用“机制缺口 x 外领域知识 x 新方法 x 新场景 x 可获得数据”形成候选矩阵。先把难点抽象为功能或数学问题，再跨领域寻找可迁移的机制、模型生物、测量工具或理论结构。至少提出 3 个可证伪方向，其中至少 1 个是有明确转译假设的交叉方向；每个包含一句科学问题、来源逻辑、核心假设、最小实验、反向/救援或反例实验、预期结果、失败解释、创新性、可行性和伦理/数据风险。最后给出适合当前 EEG 情绪识别基础的优先级。`,
}

function loadDraft(): PaperDraft {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || '{}') as Partial<PaperDraft>
    return { ...defaultDraft, ...saved, module: modules.some(item => item.id === saved.module) ? saved.module as PaperModule : defaultDraft.module }
  } catch {
    return defaultDraft
  }
}

function loadDiscoveryPreferences(): DiscoveryPreferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DISCOVERY_KEY) || '{}') as Partial<DiscoveryPreferences>
    return { ...defaultDiscovery, ...saved }
  } catch {
    return defaultDiscovery
  }
}

function moduleIcon(id: PaperModule) {
  if (id === 'title_author') return <UserRoundSearch size={16}/>
  if (id === 'introduction') return <FileSearch size={16}/>
  if (id === 'causal') return <Network size={16}/>
  if (id === 'cross_domain') return <GitFork size={16}/>
  if (id === 'reproduce') return <Code2 size={16}/>
  if (id === 'ideas') return <Lightbulb size={16}/>
  return <FlaskConical size={16}/>
}

function proposalPreview(proposal: AgentProposal) {
  if (proposal.action_type === 'create_relation') return `${String(proposal.payload.source_id)} -> ${String(proposal.payload.target_id)}`
  const tags = Array.isArray(proposal.payload.tags) ? proposal.payload.tags.join(', ') : ''
  return [String(proposal.payload.idea_title || ''), tags].filter(Boolean).join(' · ')
}

function buildPrompt(draft: PaperDraft, journalLogic: string, webSearch: boolean) {
  const source = draft.sourceText.trim().slice(0, 3600) || '未提供摘要或正文。只能做结构化待办和假设，不得声称掌握论文具体结果。'
  const prompt = `请作为严谨的顶刊论文方法学导师，用中文分析下面的论文。目标不是生成泛泛摘要，而是识别这篇论文所属学科与期刊真正要求的强逻辑，重建作者如何从问题推进到可接受的证据结论，并把论文映射为可复现的研究计划。因果实验只是其中一种逻辑，理论证明、工程验证、计算实验、观察识别和系统综述必须使用各自合适的标准。

论文标题：${draft.title.trim()}
DOI / URL / arXiv：${draft.locator.trim() || '未提供'}
具体期刊 / 会议：${draft.venue.trim() || '未提供，请根据材料判断并标注不确定性'}
目标期刊逻辑：${journalProfiles[draft.journalProfile]?.label || journalProfiles.general.label}
研究设计：${draft.studyType}
研究领域：${draft.domain.trim() || '未指定'}
当前难点或已知交叉线索：${draft.crossDomainClues.trim() || '未提供，请主动识别论文中的知识瓶颈和跨领域机会'}
我的学习目标：${draft.goal.trim() || '理解并复现论文'}
本次是否允许服务端联网检索：${webSearch ? '是' : '否'}

期刊逻辑要求：
${journalLogic}

证据纪律：
- 明确区分“输入材料直接支持”“基于学科常识的推断”“需要原文或联网核验”。
- 不得编造作者履历、实验结果、样本量、代码文件、数据集或统计数字。
- 先说明该期刊和论文类型偏好的论证结构，再评价本文是否满足；不能只因为期刊名高就默认逻辑成立。
- 对经验研究，每个因果结论都回答操纵/识别了什么、控制了什么、测量了什么、排除了什么替代解释；相关性证据不能写成因果。
- 对理论、方法、工程、资源和综述论文，分别检查证明边界、基准与消融、失效模式、数据质量和检索偏倚等相应证据，不强行要求医学实验。
- 发现跨学科知识时不能停在“很像”：必须说明两个系统在哪些变量、尺度、约束和可观测量上对应，哪些地方不对应，以及怎样用最小实验判断迁移是否有效。
- 如果输入不足，仍给出可操作的原文定位问题、检索式和代码定位步骤。

本次任务：
${moduleRequirements[draft.module]}

论文材料：
${source}

格式要求：以一级标题“${draft.title.trim()}：深度阅读与复现报告”开始。使用清晰的 Markdown 标题、因果箭头和表格；结尾必须给出“下一步只做一件事”，适合初学者立即执行。`
  return prompt.slice(0, 7900)
}

export function PaperWorkspace({ scope, ideas, projects, groups, onClose, onChanged, onOpenAgent, onIdeaSelect }: {
  scope: Scope
  ideas: Idea[]
  projects: Project[]
  groups: ProjectGroup[]
  onClose: () => void
  onChanged: () => Promise<void>
  onOpenAgent: () => void
  onIdeaSelect: (id: number) => void
}) {
  const [draft, setDraft] = useState<PaperDraft>(loadDraft)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [availableFiles, setAvailableFiles] = useState<Attachment[]>([])
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([])
  const [webSearch, setWebSearch] = useState(false)
  const [result, setResult] = useState<AgentRunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [saveProjectId, setSaveProjectId] = useState(() => projects.find(project => project.system_key !== 'recycle')?.id ?? 0)
  const [saving, setSaving] = useState(false)
  const [savedIdeaId, setSavedIdeaId] = useState<number | null>(null)
  const [discoveryPreferences, setDiscoveryPreferences] = useState<DiscoveryPreferences>(loadDiscoveryPreferences)
  const [discovery, setDiscovery] = useState<PaperDiscoveryResult | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState('')
  const autoDiscoveryStarted = useRef(false)

  const activeProjects = projects.filter(project => project.system_key !== 'recycle')
  const scopeName = useMemo(() => {
    if (scope.type === 'project') return projects.find(project => project.id === scope.id)?.name || 'Unknown project'
    if (scope.type === 'group') return groups.find(group => group.id === scope.id)?.name || 'Unknown group'
    return 'All active ideas'
  }, [groups, projects, scope])

  useEffect(() => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  }, [draft])

  useEffect(() => {
    window.localStorage.setItem(DISCOVERY_KEY, JSON.stringify(discoveryPreferences))
  }, [discoveryPreferences])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  useEffect(() => {
    api.agentStatus().then(value => {
      setStatus(value)
      setWebSearch(value.web_search_supported)
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not inspect agent configuration'))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    if (scope.type === 'project') params.set('project_id', String(scope.id))
    else if (scope.type === 'group') params.set('group_id', String(scope.id))
    api.attachments(params).then(files => setAvailableFiles(files)).catch(() => setAvailableFiles([]))
  }, [scope])

  useEffect(() => {
    if (!activeProjects.some(project => project.id === saveProjectId)) setSaveProjectId(activeProjects[0]?.id ?? 0)
  }, [activeProjects, saveProjectId])

  useEffect(() => {
    if (autoDiscoveryStarted.current || !discoveryPreferences.autoRefresh || !discoveryPreferences.query.trim()) return
    autoDiscoveryStarted.current = true
    void searchPapers(discoveryPreferences)
  }, [discoveryPreferences])

  function update<K extends keyof PaperDraft>(key: K, value: PaperDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  async function run(targetDraft: PaperDraft = draft) {
    if (!targetDraft.title.trim() || !status?.configured) return
    setRunning(true); setError(''); setSavedIdeaId(null)
    try {
      const mode: AgentMode = targetDraft.module === 'causal' ? 'critique' : 'synthesize'
      const targetJournal = journalProfiles[targetDraft.journalProfile] || journalProfiles.general
      const next = await api.runAgent({
        prompt: buildPrompt(targetDraft, targetJournal.logic, webSearch), mode,
        scope_type: scope.type, scope_id: scope.type === 'all' ? null : scope.id,
        idea_id: null, model: status.default_model, reasoning_effort: status.reasoning_effort,
        web_search: webSearch, attachment_ids: selectedFileIds,
      })
      setResult(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Paper analysis failed')
    } finally {
      setRunning(false)
    }
  }

  async function searchPapers(preferences: DiscoveryPreferences = discoveryPreferences) {
    if (!preferences.query.trim()) return
    setDiscovering(true); setDiscoveryError('')
    try {
      const params = new URLSearchParams({
        q: preferences.query.trim(),
        venues: preferences.venues.trim(),
        from_year: String(preferences.fromYear),
        limit: '12',
      })
      setDiscovery(await api.discoverPapers(params))
    } catch (reason) {
      setDiscoveryError(reason instanceof Error ? reason.message : '论文检索失败')
    } finally {
      setDiscovering(false)
    }
  }

  async function useDiscoveredPaper(paper: DiscoveredPaper, analyze: boolean) {
    const nextDraft: PaperDraft = {
      ...draft,
      title: paper.title,
      locator: paper.doi ? `https://doi.org/${paper.doi}` : paper.url,
      venue: paper.venue,
      journalProfile: 'adaptive',
      domain: discoveryPreferences.query,
      sourceText: paper.abstract,
      module: 'full',
    }
    setDraft(nextDraft)
    setSavedIdeaId(null)
    if (analyze) {
      if (!status?.configured) {
        setError('请先配置 Agent 模型，再运行论文全链路分析。')
        return
      }
      await run(nextDraft)
    }
  }

  async function saveReport() {
    if (!result || !saveProjectId) return
    setSaving(true); setError('')
    try {
      const saved = await api.createIdea({
        title: `Paper reading: ${draft.title.trim()}`.slice(0, 240),
        content: result.answer,
        raw_text: [draft.title, draft.locator, draft.sourceText].filter(Boolean).join('\n\n'),
        status: 'exploring',
        tags: ['paper-reading', draft.module === 'cross_domain' ? 'cross-disciplinary' : 'research-logic', draft.module === 'reproduce' ? 'reproduction' : 'literature'],
        project_id: saveProjectId,
      })
      setSavedIdeaId(saved.id)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the report')
    } finally {
      setSaving(false)
    }
  }

  async function resolve(proposal: AgentProposal, action: 'apply' | 'dismiss') {
    try {
      await api.resolveAgentProposal(proposal.id, action)
      setResult(current => current ? { ...current, proposals: current.proposals.map(item => item.id === proposal.id ? { ...item, status: action === 'apply' ? 'applied' : 'dismissed' } : item) } : current)
      if (action === 'apply') await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not resolve the suggested idea')
    }
  }

  return <div className="modal-backdrop paper-lab-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="paper-lab">
      <header className="paper-lab-header"><div><p className="eyebrow">PAPER REASONING WORKSPACE</p><h2><BookOpenText size={25}/> Paper Lab</h2><p>Evidence-first reading, causal reconstruction, code mapping, and idea synthesis.</p></div><button className="icon-button" onClick={onClose} aria-label="Close Paper Lab"><X size={20}/></button></header>
      <div className="paper-lab-body">
        <aside className="paper-lab-inputs">
          <section className="paper-radar">
            <div className="paper-radar-heading"><div><strong>论文雷达</strong><span>OpenAlex + Crossref</span></div><Search size={17}/></div>
            <label>你想跟进的研究主题<input value={discoveryPreferences.query} onChange={event => setDiscoveryPreferences(current => ({ ...current, query: event.target.value }))} placeholder="例如 EEG emotion recognition cross-subject"/></label>
            <label>目标期刊或会议<span>可用逗号分隔</span><input value={discoveryPreferences.venues} onChange={event => setDiscoveryPreferences(current => ({ ...current, venues: event.target.value }))} placeholder="例如 TPAMI, Nature Human Behaviour, NeurIPS"/></label>
            <div className="paper-radar-controls"><label>起始年份<input type="number" min="1900" max={new Date().getFullYear() + 1} value={discoveryPreferences.fromYear} onChange={event => setDiscoveryPreferences(current => ({ ...current, fromYear: Number(event.target.value) }))}/></label><label className="paper-radar-auto"><input type="checkbox" checked={discoveryPreferences.autoRefresh} onChange={event => setDiscoveryPreferences(current => ({ ...current, autoRefresh: event.target.checked }))}/> 每次打开自动更新</label></div>
            <button className="button secondary paper-discover" disabled={discovering || !discoveryPreferences.query.trim()} onClick={() => void searchPapers()}>{discovering ? <LoaderCircle className="spin" size={15}/> : <Search size={15}/>} 搜索近期论文</button>
            {discoveryError && <p className="paper-radar-error">{discoveryError}</p>}
            {discovery && <div className="paper-discovery-results">
              <div className="paper-discovery-summary"><span>{discovery.papers.length} 篇候选</span><span>{discovery.sources.join(' + ')}</span></div>
              {discovery.warnings.map(warning => <p className="paper-radar-warning" key={warning}>{warning}</p>)}
              {discovery.papers.length === 0 ? <p className="paper-radar-empty">没有找到同时满足关键词、期刊和年份的论文，请放宽期刊或年份。</p> : discovery.papers.map(paper => <article className="paper-candidate" key={paper.id}>
                <div className="paper-candidate-meta"><span>{paper.year || '日期未知'}</span><span>{paper.venue || '期刊未知'}</span><span>{paper.cited_by_count} 引用</span></div>
                <strong>{paper.title}</strong>
                <p>{paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ' 等' : ''}</p>
                <div className="paper-candidate-reasons">{paper.match_reasons.map(reason => <span key={reason}>{reason}</span>)}</div>
                <footer><a href={paper.url} target="_blank" rel="noreferrer" title="打开论文元数据或 DOI"><ExternalLink size={13}/></a><button className="button secondary small" onClick={() => void useDiscoveredPaper(paper, false)}>填入</button><button className="button primary small" disabled={running} onClick={() => void useDiscoveredPaper(paper, true)}><Sparkles size={13}/> 直接分析</button></footer>
              </article>)}
            </div>}
          </section>
          <div className="paper-source-heading"><strong>Paper source</strong><span>{scopeName}</span></div>
          <label>Paper title<input value={draft.title} onChange={event => update('title', event.target.value)} placeholder="Paste the exact paper title"/></label>
          <label>DOI, URL, or arXiv ID<input value={draft.locator} onChange={event => update('locator', event.target.value)} placeholder="Optional, but important for verification"/></label>
          <label>Exact journal or conference<input value={draft.venue} onChange={event => update('venue', event.target.value)} placeholder="e.g. Nature Human Behaviour, TPAMI, NeurIPS"/></label>
          <div className="paper-field-grid"><label>Reasoning profile<select value={draft.journalProfile} onChange={event => update('journalProfile', event.target.value)}>{Object.entries(journalProfiles).map(([id, item]) => <option value={id} key={id}>{item.label}</option>)}</select></label><label>Study design<select value={draft.studyType} onChange={event => update('studyType', event.target.value)}><option value="experimental">Mechanistic experiment</option><option value="observational">Observational / behavioral</option><option value="clinical_trial">Clinical trial</option><option value="computational">AI / computational</option><option value="engineering">Engineering / systems</option><option value="theoretical">Theory / methods</option><option value="resource">Dataset / resource</option><option value="review">Review / meta-analysis</option></select></label></div>
          <label>Research domain<input value={draft.domain} onChange={event => update('domain', event.target.value)} placeholder="e.g. EEG emotion recognition"/></label>
          <label>Known bottleneck or cross-field clue<textarea rows={3} value={draft.crossDomainClues} onChange={event => update('crossDomainClues', event.target.value)} placeholder="Optional: e.g. tumor growth may depend on mitochondrial metabolism; BCI dynamics may resemble adaptive behavior in simple organisms."/></label>
          <label>Abstract or key passages<span>{draft.sourceText.length}/6000</span><textarea rows={7} maxLength={6000} value={draft.sourceText} onChange={event => update('sourceText', event.target.value)} placeholder="Paste the abstract, introduction logic, figure legends, or method notes. With title only, unknown facts stay marked for verification."/></label>
          <label>Your goal<textarea rows={3} value={draft.goal} onChange={event => update('goal', event.target.value)} /></label>

          <div className="paper-module-heading"><strong>Analysis route</strong><span>Choose one pass at a time</span></div>
          <nav className="paper-modules" aria-label="Paper analysis route">{modules.map(item => <button className={draft.module === item.id ? 'active' : ''} onClick={() => update('module', item.id)} key={item.id}>{moduleIcon(item.id)}<span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</nav>

          {availableFiles.length > 0 && <details className="paper-files"><summary><Code2 size={14}/> Reproduction files <span>{selectedFileIds.length} selected</span></summary><p>Select text or code files intentionally. PDFs currently contribute metadata only.</p><div>{availableFiles.map(file => <label className={!file.exists ? 'missing' : ''} key={file.id}><input type="checkbox" disabled={!file.exists} checked={selectedFileIds.includes(file.id)} onChange={event => setSelectedFileIds(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))}/><FileText size={14}/><span>{file.display_name}<small>{file.absolute_path}</small></span></label>)}</div></details>}

          {status && <div className={`paper-agent-status ${status.configured ? 'ready' : ''}`}><Sparkles size={15}/><div><strong>{status.configured ? `${status.provider_label} · ${status.default_model}` : 'Agent connection required'}</strong><span>{status.configured ? status.web_search_supported ? 'Provider can verify sources with web search.' : 'No provider web search: author history and exact results will be marked for verification.' : 'Configure a provider before running Paper Lab.'}</span></div>{!status.configured && <button onClick={onOpenAgent}>Configure</button>}</div>}
          {status?.configured && <label className="paper-web-toggle" title={status.web_search_supported ? 'Allow provider-side source lookup' : 'The active provider does not support server-side search'}><input type="checkbox" checked={webSearch} disabled={!status.web_search_supported} onChange={event => setWebSearch(event.target.checked)}/><Globe2 size={14}/> Verify with provider web search</label>}
          <button className="button primary paper-run" disabled={running || !draft.title.trim() || !status?.configured} onClick={() => void run()}>{running ? <><LoaderCircle className="spin" size={17}/> Analyzing…</> : <><Sparkles size={17}/> Run {modules.find(item => item.id === draft.module)?.label}</>}</button>
        </aside>

        <section className="paper-lab-output">
          {error && <div className="error-banner">{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
          {!result ? <div className="paper-empty"><ShieldAlert size={28}/><h3>Build the evidence chain before trusting the story</h3><ol><li><strong>Ground</strong><span>Add the exact title and as much source text as you have.</span></li><li><strong>Reconstruct</strong><span>Match the paper's claims to the proof standard of its field and venue.</span></li><li><strong>Challenge</strong><span>Find the counterfactual, failure case, or competing explanation.</span></li><li><strong>Bridge</strong><span>Abstract the bottleneck and test knowledge transfers from other fields.</span></li><li><strong>Reproduce</strong><span>Map figures to data, code, commands, outputs, and acceptance checks.</span></li><li><strong>Extend</strong><span>Turn unresolved boundaries into testable ideas for your own work.</span></li></ol></div> : <>
            <div className="paper-result-head"><div><span>Current report</span><strong>{modules.find(item => item.id === draft.module)?.label}</strong></div><div><span>{result.provider}</span><span>{result.model}</span><span>{result.context_summary.files} files</span></div></div>
            {running && <div className="paper-refreshing"><LoaderCircle className="spin" size={14}/> A new analysis is running; the previous report stays visible.</div>}
            <article className="markdown paper-report"><IdeaMarkdown content={result.answer} ideas={ideas} attachments={availableFiles} onIdeaSelect={onIdeaSelect} onFileOpen={id => void api.openAttachment(id)}/></article>
            <section className="paper-save"><div><strong>{savedIdeaId ? 'Report saved to IdeaMiner' : 'Keep this report'}</strong><span>{savedIdeaId ? 'It is now searchable and can be connected to other ideas.' : 'Save the complete report as an exploring idea in one of your projects.'}</span></div>{savedIdeaId ? <button className="button secondary small" onClick={() => onIdeaSelect(savedIdeaId)}><Check size={14}/> Open saved idea</button> : <div><select value={saveProjectId} onChange={event => setSaveProjectId(Number(event.target.value))}>{activeProjects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select><button className="button primary small" disabled={saving || !saveProjectId} onClick={() => void saveReport()}>{saving ? <LoaderCircle className="spin" size={14}/> : <Save size={14}/>} Save report</button></div>}</section>
            {result.proposals.length > 0 && <section className="paper-proposals"><header><strong>Candidate ideas</strong><span>Nothing changes until you approve it.</span></header>{result.proposals.map(proposal => <article className={`agent-proposal ${proposal.status}`} key={proposal.id}><div><span>{proposal.action_type.replaceAll('_', ' ')}</span><strong>{proposal.title}</strong><p>{proposal.rationale}</p><small>{proposalPreview(proposal)}</small></div>{proposal.status === 'pending' ? <aside><button className="button secondary small" onClick={() => void resolve(proposal, 'dismiss')}>Dismiss</button><button className="button primary small" onClick={() => void resolve(proposal, 'apply')}><Check size={14}/> Apply</button></aside> : <em>{proposal.status}</em>}</article>)}</section>}
          </>}
        </section>
      </div>
    </section>
  </div>
}
