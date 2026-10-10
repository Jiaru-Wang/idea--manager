import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, Check, Code2, Download, ExternalLink, FileSearch, FileText, FlaskConical, GitFork, Globe2, Lightbulb, LoaderCircle, Network, Pencil, Save, Search, ShieldAlert, Sparkles, Square, UserRoundSearch, X } from 'lucide-react'
import { api } from '../api'
import { IdeaMarkdown } from './IdeaMarkdown'
import './PaperWorkspace.css'
import type { AgentMode, AgentProposal, AgentRunResult, AgentStatus, Attachment, DiscoveredPaper, Idea, PaperDiscoveryResult, PaperScholarlyContext, Project, ProjectGroup } from '../types'

type Scope = { type: 'all' } | { type: 'project'; id: number } | { type: 'group'; id: number }
type PaperModule = 'full' | 'title_author' | 'introduction' | 'causal' | 'cross_domain' | 'reproduce' | 'ideas'
type AnalysisStage = 'grounding' | 'analysis' | 'section' | 'synthesis' | 'diagram' | 'audit' | 'repair'

type PaperDraft = {
  title: string
  titleZh: string
  locator: string
  venue: string
  venueZh: string
  journalProfile: string
  studyType: string
  domain: string
  crossDomainClues: string
  scholarlyContext: string
  authorDirectionSummary: string
  sourceText: string
  sourceTextZh: string
  goal: string
  module: PaperModule
  analysisDepth: 'deep' | 'adversarial'
}

type DiscoveryPreferences = {
  query: string
  venues: string
  fromYear: number
  autoRefresh: boolean
}

type PaperStageResult = { heading: string; answer: string; result: AgentRunResult }
type PaperCheckpoint = {
  version: 7
  identity: string
  updatedAt: string
  sections: Record<string, PaperStageResult>
  integrated?: AgentRunResult
}

type DiagramNodeKind = 'premise' | 'mechanism' | 'evidence' | 'outcome' | 'boundary'
type DiagramEdgeKind = 'promotes' | 'inhibits' | 'supports' | 'refutes' | 'constrains' | 'associates'
type DiagramNode = { id: string; label: string; detail: string; kind: DiagramNodeKind }
type DiagramEdge = { source: string; target: string; kind: DiagramEdgeKind; label: string; evidence: string }
type PaperDiagramSpec = { title: string; subtitle: string; conclusion: string; nodes: DiagramNode[]; edges: DiagramEdge[] }
type PaperDiagramArtifact = { version: 1; identity: string; generatedAt: string; spec: PaperDiagramSpec; svg: string }

const DRAFT_KEY = 'ideaminer-paper-lab-draft-v1'
const DISCOVERY_KEY = 'ideaminer-paper-discovery-v1'
const CHECKPOINT_KEY = 'ideaminer-paper-analysis-checkpoint-v7'
const DIAGRAM_KEY = 'ideaminer-paper-inkscape-diagram-v1'
const PAPER_DIAGRAM_TOKEN_PATTERN = /\n*\[\[paper-diagram:([A-Za-z0-9+/=]+)\]\]\s*$/
const LEGACY_CHECKPOINT_KEYS = ['ideaminer-paper-analysis-checkpoint-v1', 'ideaminer-paper-analysis-checkpoint-v2', 'ideaminer-paper-analysis-checkpoint-v3', 'ideaminer-paper-analysis-checkpoint-v4', 'ideaminer-paper-analysis-checkpoint-v5', 'ideaminer-paper-analysis-checkpoint-v6']

const defaultDraft: PaperDraft = {
  title: '',
  titleZh: '',
  locator: '',
  venue: '',
  venueZh: '',
  journalProfile: 'adaptive',
  studyType: 'auto',
  domain: 'EEG emotion recognition / neuroscience',
  crossDomainClues: '',
  scholarlyContext: '',
  authorDirectionSummary: '',
  sourceText: '',
  sourceTextZh: '',
  goal: '理解论文的因果逻辑，找到可以复现的实验，并形成适合我当前研究的新 idea。',
  module: 'full',
  analysisDepth: 'deep',
}

const defaultDiscovery: DiscoveryPreferences = {
  query: 'EEG emotion recognition cross-subject generalization',
  venues: '',
  fromYear: new Date().getFullYear() - 3,
  autoRefresh: true,
}

const modules: { id: PaperModule; label: string; detail: string }[] = [
  { id: 'full', label: '论文深度全链路', detail: '题目与作者 + 综述逻辑 + 因果实验链 + 交叉知识桥 + 新 Idea' },
  { id: 'reproduce', label: '代码复现', detail: 'Figure/Table 到数据、文件、命令和验收指标' },
]

const fullAnalysisSections: { module: Exclude<PaperModule, 'full' | 'reproduce'>; heading: string; label: string }[] = [
  { module: 'title_author', heading: '论文定位与作者背景', label: '确认论文身份与作者积累' },
  { module: 'introduction', heading: '摘要与引言逐句逐段逻辑', label: '重建作者为什么写下每句话' },
  { module: 'causal', heading: '方法、结果与讨论证据链', label: '连接实验选择与结论' },
  { module: 'cross_domain', heading: '突出难点与跨领域知识桥', label: '寻找真正可迁移的外部知识' },
  { module: 'ideas', heading: '全文判断与新 Idea', label: '收束贡献、边界与延伸' },
]

const journalProfiles: Record<string, { label: string; logic: string }> = {
  adaptive: {
    label: '按具体期刊与论文类型自适应',
    logic: '先识别具体期刊/会议、文章类型、核心贡献类型和论文实际采用的逻辑拓扑，再选择或组合合适的证明责任。候选拓扑包括但不限于机制因果、理论演绎、算法设计、基础模型预训练-迁移、工程系统权衡、观察识别、临床试验、资源/基准、定性解释和综述证据综合；允许论文形成自定义混合拓扑。必须说明选择了什么、为什么，以及拒绝套用哪些不适合的框架。',
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
  foundation_model: {
    label: '脑信号 / AI 基础模型',
    logic: '先判断“基础模型”主张是否由预训练数据规模与异质性、统一表示或离散化目标、跨任务迁移、冻结探测/全量微调/从头训练对照、少样本与零样本、跨受试者/设备/范式泛化、规模规律、消融、数据泄漏审计和算力收益共同支撑。不能用单个下游 SOTA 代替基础性与通用性。',
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
  full: `这是一次点击完成的论文深度全链路，不包含代码复现。先识别论文实际具有的章节、研究类型和论证拓扑；不得预设所有论文都遵循同一种“背景—转折—缺口—假说”直线结构。理论论文可能由定义、假设、命题、证明和反例推进；算法论文可能由任务缺陷、设计约束、模块选择、消融和泛化推进；机制论文、观察研究、临床试验、系统论文、资源论文和综述也必须采用各自原生逻辑。

先输出“论文结构与科研逻辑总图”：
- 用 200 字以内中文摘要说明问题、关键动作、核心证据、结论和边界。
- 列出论文真实可见的部分，例如摘要、Introduction/综述、方法/实验、结果、讨论、结论和补充材料；缺少原文时标注“当前只有摘要/元数据，待原文核验”，不得虚构段落或 Figure。
- 为每个可见部分建立“微逻辑链”。从以下角色中只选择该部分真实承担的角色：已有共识、主流关注、转折、局限/遗留问题、异常现象或独特性质、跨领域线索、科学猜想、可证伪预测、设计决策、关键证据、竞争解释、边界条件、应用落地。不得为了凑模板强行包含全部角色。
- 每个微逻辑步骤都按“原文事实/证据 -> 这一句或实验在叙事中的作用 -> 隐含前提 -> 作者作出的推理或决策 -> 尚未解决的问题 -> 因此下一步”拆开。尤其解释作者为什么引用这项工作而不是其他工作、为什么在此处转折、为什么选择当前实验而不是候选路线。
- 画两张纯文本图：正向图“文献背景/观察 -> 问题重定义 -> 假说或设计原则 -> E1 -> E2 -> ... -> 结论”；反向图“最终结论 -> 必要子结论 -> 必要证据 -> 必要对照/假设”。两图不一致处标成“逻辑断点”。
- 本部分末尾写“结构总图小结”，给出论文真正的逻辑发动机、全篇转折点、最强承重证据和最大断点。

然后严格按下列五个二级标题输出，不能拆成互不相干的问答：
## 1. 题目与作者
拆解题目中的表型、机制、对象、方法与因果强度，逐词映射证据；核验通讯作者及其近年研究轨迹，解释本文如何从实验室长期积累中长出来。按年份把近年论文聚类为持续主线、方法积累、对象/场景迁移和新近转向，排除同名作者或明显不相关工作。最后必须单列“通讯作者研究方向总结”：稳定核心问题、常用对象/数据、关键方法平台、近年方向变化、本文在其路线中的位置、下一步可能延伸。不能核验的内容明确标注。
本模块末尾必须写“本模块小结”，用“核心结论 -> 直接证据 -> 仍未解决 -> 为什么进入下一模块”收束。
## 2. 综述逻辑
逐段拆解 Introduction/综述。对真实出现的每一层分别编号，说明文献背景证明了什么、主流研究主要关注什么、转折词改变了哪项判断、局限或遗留问题是什么、哪个现象/特点提供突破口、作者怎样据此决定研究方向、科学猜想如何形成、什么实验或分析可以使猜想失败。你的六步示例只能作为候选角色库，必须按本文实际顺序增删、合并、分叉或回环。逐层解释作者为何引用这一类工作，以及删除某个前提后选题是否仍成立。
本模块末尾必须写“本模块小结”，明确选题成立的最小前提集和下一个证明责任。
## 3. 因果实验链
按论文 Methods/Experiments 和 Results 的真实顺序建立纵向证据节点；如果实验与结果分章书写，要把同一科学问题对应的方法与结果重新配对。每个节点写：承接缺口、为何必须此刻做、候选路线、选择理由、变量/样本/方法、关键对照、观察结果、允许结论、不能推出、排除的竞争解释、信息增益、剩余疑点、因此下一步。再解释 Discussion/Conclusion 如何把结果提升为主张，哪些是数据支持、哪些是合理推断、哪些是越界外推。按论文类型采用机制实验、算法消融、理论反例、识别策略或系统失效测试等原生等价项。
本模块末尾必须写“本模块小结”，总结最强证据、最弱跳跃、尚未排除的替代解释和决定性补强实验。
## 4. 交叉知识桥
把最难的解释、测量或优化瓶颈抽象成无学科功能问题，从至少三个不同领域寻找结构真正对应的机制、数学模型、识别策略或实验工具；逐项说明变量映射、尺度、约束、不对应之处、最小验证和淘汰理由。
本模块末尾必须写“本模块小结”，按新颖性、可验证性、数据可得性和转译风险选出唯一优先桥梁。
## 5. 新 Idea 与顶刊理由
先把问题重要性、不可替代创新、方法贴合度、证据闭环、普适性、叙事、开放资源和 venue 读者价值逐项配对，再执行删除关键证据后的降档反事实。最后从真实证据缺口提出至少五个可证伪新 Idea，每个包含假设、最小实验、反向/救援/反例、预期结果、失败解释、创新性、可行性与风险。
本模块末尾必须写“本模块小结”，给出 Idea 排序、今天可执行的一件事和整篇论文仍不能知道什么。
五个模块之间都必须用“上一结论 -> 当前唯一缺口 -> 下一动作”自然衔接。`,
  title_author: `聚焦题目与作者：拆解表型、机制、对象、方法和因果强度；判断题目叙事巧妙处与可能夸大。重建通讯作者近年研究问题、实验模型、关键技术和本文之间的积累关系。不能核验的信息必须标注“待核验”，并给出作者主页、ORCID、PubMed/Scholar 检索式。`,
  introduction: `聚焦 Introduction/综述的强逻辑。输出“已知 -> 主流关注 -> 被忽略之处 -> 矛盾/技术窗口 -> 交叉学科转折 -> 科学猜想 -> 可证伪预测”。逐段解释为什么此处需要这一类文献，以及若删除某个前提，选题是否仍成立。特别标出作者何时从另一学科借入概念、模型或测量工具，以及这次转译成立所依赖的假设。比较综合顶刊、机制型生物医学顶刊、临床顶刊、理论和 AI/工程顶刊在立题证据上的不同要求。`,
  causal: `聚焦实验因果链。先画变量与混杂因素的文本因果图，再按顺序输出纵向实验卡：实验问题、承接缺口、干预、对照、读出、结果、允许结论、不能推出、排除的竞争解释、下一实验。必须检查时间先后、剂量反应、敲除/抑制、过表达/激活、救援、反向验证、上下游/上位性、正交测量、体内外切换和跨场景验证。最后设计一个能让核心因果解释失败的决定性反证实验。`,
  cross_domain: `聚焦交叉知识迁移与难点求解。先找出最难解释、最难测量、最难优化或现有方法最难突破的 5 个瓶颈，再把它们抽象成无学科功能问题，例如资源/能量配置、激励与博弈、信号传播、时空同步、网络控制、适应与演化、相变、反馈稳定性、稀疏编码、多尺度耦合、因果识别、鲁棒优化或不确定性定价。候选领域必须广泛比较：细胞代谢与线粒体、免疫、草履虫/动物行为、神经生态与演化；控制论、非线性动力学、统计物理、热力学、拓扑与复杂网络；机器学习、机器人、信息论、运筹学；经济学、计量经济学、机制设计、博弈论、市场微观结构与金融风险；材料和工程失效。对每个桥梁输出来源领域、可借知识、原领域变量、目标领域变量、结构对应、尺度与约束、不对应之处、转译步骤、最小实验、反证条件、数据/技术门槛、检索式和失败后学到什么。明确区分生物同源、功能类比、数学同构、因果识别迁移、实验工具迁移和启发式隐喻；淘汰无法操作化、不可证伪或尺度不匹配的类比。最后用“新颖性 x 可验证性 x 数据可得性 x 转译风险”矩阵选出 1 条最值得执行的路线。`,
  reproduce: `聚焦可执行复现，不重复生成题目作者、综述、因果链、交叉桥或新 Idea。先按论文类型决定复现对象：机制实验复现操纵与读出；理论论文复现命题、模拟与边界；基础模型复现数据清单/统一化、预训练、冻结探测、全量微调、从头训练、少样本、跨数据集与消融；系统论文复现部件、延迟、吞吐和失效。建立 Figure/Table 到代码的逐项矩阵；解释所选本地代码文件中每个可见模块的职责、数据形状、调用顺序和配置来源。给出环境建立、数据获取、预处理、防止受试者/时间/数据集泄漏、训练、评估、绘图、随机种子、算力预算和验收标准的命令级步骤。区分“已有代码可直接运行”“需要补写”“论文未公开”。不得猜测不存在的文件或函数。环境、数据、预处理、训练、评估与图表复现每个阶段末尾都写“阶段小结”；报告末尾写“代码复现总小结”，列出已具备、仍缺失、验收标准和下一步唯一动作。`,
  ideas: `聚焦新 idea 推导。先列论文已解决、被作者叙事掩盖和真正未解决的边界，再用“机制缺口 x 外领域知识 x 新方法 x 新测量 x 新场景 x 可获得数据”形成候选矩阵。把难点抽象为功能、因果或数学问题，再从生物、医学、计算机、数学、物理、工程、生态、经济学、计量经济学、博弈论和运筹学寻找可迁移的机制、模型生物、识别策略、测量工具或理论结构。至少提出 5 个可证伪方向，其中至少 2 个有明确变量映射和转译假设的跨领域方向；每个包含一句科学问题、来源逻辑、核心假设、最小实验、反向/救援/反例实验、预期结果、失败解释、创新性、可行性和伦理/数据风险。禁止只换数据集、模型名字或应用场景。最后按新颖性、重要性、可证伪性、数据可得性和一年内可完成性排序。`,
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
    return {
      ...defaultDiscovery,
      query: saved.query || defaultDiscovery.query,
      venues: '',
      fromYear: typeof saved.fromYear === 'number' && saved.fromYear >= 1900 ? saved.fromYear : defaultDiscovery.fromYear,
      autoRefresh: true,
    }
  } catch {
    return defaultDiscovery
  }
}

function checkpointIdentity(draft: PaperDraft) {
  return [draft.title.trim().toLowerCase(), draft.locator.trim().toLowerCase(), draft.module, draft.analysisDepth, draft.sourceText.length].join('|')
}

function loadPaperCheckpoint(draft: PaperDraft): PaperCheckpoint | null {
  try {
    const checkpoint = JSON.parse(window.localStorage.getItem(CHECKPOINT_KEY) || 'null') as PaperCheckpoint | null
    if (!checkpoint || checkpoint.version !== 7 || checkpoint.identity !== checkpointIdentity(draft) || !checkpoint.sections) return null
    return checkpoint
  } catch {
    return null
  }
}

function savePaperCheckpoint(draft: PaperDraft, sections: PaperStageResult[], integrated?: AgentRunResult) {
  const checkpoint: PaperCheckpoint = {
    version: 7,
    identity: checkpointIdentity(draft),
    updatedAt: new Date().toISOString(),
    sections: Object.fromEntries(sections.map(section => [section.heading, section])),
    integrated,
  }
  window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint))
}

function clearPaperCheckpoint(draft: PaperDraft) {
  if (loadPaperCheckpoint(draft)) window.localStorage.removeItem(CHECKPOINT_KEY)
}

function loadPaperDiagram(draft: PaperDraft): PaperDiagramArtifact | null {
  try {
    const artifact = JSON.parse(window.localStorage.getItem(DIAGRAM_KEY) || 'null') as PaperDiagramArtifact | null
    if (artifact?.version !== 1 || artifact.identity !== checkpointIdentity(draft) || !artifact.spec) return null
    return { ...artifact, svg: renderInkscapeSvg(artifact.spec) }
  } catch {
    return null
  }
}

function savePaperDiagram(draft: PaperDraft, artifact: PaperDiagramArtifact) {
  window.localStorage.setItem(DIAGRAM_KEY, JSON.stringify({ ...artifact, identity: checkpointIdentity(draft) }))
}

function encodePaperDiagram(svg: string) {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return window.btoa(binary)
}

function reportContentWithDiagram(markdown: string, artifact: PaperDiagramArtifact | null) {
  const report = markdown.replace(PAPER_DIAGRAM_TOKEN_PATTERN, '').trimEnd()
  return artifact?.svg ? `${report}\n\n[[paper-diagram:${encodePaperDiagram(artifact.svg)}]]` : report
}

function isProviderTimeout(reason: unknown) {
  return reason instanceof Error && /(?:响应超时|timeout|timed out)/i.test(reason.message)
}

function hasSubstantivePaperAnswer(answer: string) {
  const substantive = answer.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').replace(/[\s.…·_-]/g, '')
  return substantive.length >= 80
}

function validPaperSections(checkpoint: PaperCheckpoint | null) {
  if (!checkpoint) return []
  return fullAnalysisSections
    .map(section => checkpoint.sections[section.heading])
    .filter((section): section is PaperStageResult => Boolean(section && hasSubstantivePaperAnswer(section.answer)))
}

function partialStageReport(draft: PaperDraft, sections: PaperStageResult[]) {
  const body = sections.map((section, index) => `## 阶段 ${index + 1}：${section.heading}\n\n${withoutLeadingTitle(section.answer)}`).join('\n\n')
  const nextAction = sections.length >= fullAnalysisSections.length
    ? '五个阶段均已生成并保存；现在可以直接绘制科研逻辑图。'
    : '点击“继续生成下一阶段”后会在此基础上追加，不会重新开始。'
  return `# ${draft.title.trim()}：分阶段阅读记录\n\n> 当前已完成 ${sections.length}/${fullAnalysisSections.length} 个阅读阶段。以下是已经生成并保存的内容；${nextAction}\n\n${body}`
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

function formatScholarlyContext(context: PaperScholarlyContext) {
  const authors = context.corresponding_authors.length
    ? context.corresponding_authors.map(author => `- ${author.name}${author.institution ? ` | ${author.institution}` : ''}${author.orcid ? ` | ${author.orcid}` : ''}`).join('\n')
    : '- 未被 OpenAlex 明确标注，必须到原文核验。'
  const works = context.recent_works.length
    ? context.recent_works.map(work => `- ${work.year || '年份未知'} | ${work.title} | ${work.venue || '来源未知'} | cited ${work.cited_by_count}${work.doi ? ` | DOI ${work.doi}` : ''}`).join('\n')
    : '- 暂无可核验的近五年论文元数据。'
  return `元数据来源：${context.source}\n匹配论文：${context.matched_title}\n证据说明：${context.evidence_note}\n\n明确标注的通讯作者：\n${authors}\n\n这些通讯作者近五年的相关论文候选：\n${works}`
}

function paperHref(locator: string) {
  const value = locator.trim()
  if (/^https?:\/\//i.test(value)) return value
  if (/^10\.\d{4,9}\//i.test(value)) return `https://doi.org/${value}`
  const arxiv = value.match(/(?:arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?/i)
  return arxiv ? `https://arxiv.org/abs/${arxiv[1]}` : ''
}

function normalizePaperReport(markdown: string) {
  let unwrapped = markdown.trim()
  for (let depth = 0; depth < 3; depth += 1) {
    const fenced = unwrapped.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    const candidate = (fenced?.[1] || unwrapped).trim()
    if (!candidate.startsWith('{')) break
    try {
      const parsed = JSON.parse(candidate) as { answer?: unknown }
      if (!parsed || typeof parsed !== 'object' || typeof parsed.answer !== 'string') break
      unwrapped = parsed.answer.trim()
    } catch {
      break
    }
  }
  const visible = unwrapped.replace(/<think\b[^>]*>[\s\S]*?<\/think>\s*/gi, '').replace(/<think\b[^>]*>[\s\S]*$/gi, '').trim()
  let fenced = false
  return visible.split('\n').flatMap(line => {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      return [line]
    }
    if (fenced) return [line]
    const pipes = (line.match(/\|/g) || []).length
    if (pipes < 3) return [line]
    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean)
    if (!cells.length || cells.every(cell => /^:?-{3,}:?$/.test(cell))) return []
    return ['', `**${cells[0]}**`, ...cells.slice(1).map(cell => `- ${cell}`), '']
  }).join('\n').replace(/\n{3,}/g, '\n\n')
}

const diagramNodeKinds = new Set<DiagramNodeKind>(['premise', 'mechanism', 'evidence', 'outcome', 'boundary'])
const diagramEdgeKinds = new Set<DiagramEdgeKind>(['promotes', 'inhibits', 'supports', 'refutes', 'constrains', 'associates'])

function normalizeDiagramTypography(value: string) {
  return value
    .replace(/\b([dDlL])\s*-\s*(\d+)\s*H\s*G\b/g, '$1-$2HG')
    .replace(/IFN\s*[-–]\s*γ/gi, 'IFN-γ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanDiagramText(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === 'string'
    ? normalizeDiagramTypography(value)
    : ''
  return (text || fallback).slice(0, maxLength)
}

function parsePaperDiagramSpec(answer: string, draft: PaperDraft): PaperDiagramSpec {
  const normalized = normalizePaperReport(answer)
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
  const source = (fenced || normalized).trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('绘图模型没有返回可识别的图形数据，请重新绘制。')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error('绘图模型返回的数据格式不完整，请重新绘制。')
  }

  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : []
  const nodes: DiagramNode[] = []
  const ids = new Set<string>()
  rawNodes.slice(0, 10).forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return
    const item = raw as Record<string, unknown>
    let id = cleanDiagramText(item.id, `N${index + 1}`, 24).replace(/[^a-zA-Z0-9_-]/g, '') || `N${index + 1}`
    while (ids.has(id)) id = `${id}-${index + 1}`
    ids.add(id)
    const kind = diagramNodeKinds.has(item.kind as DiagramNodeKind) ? item.kind as DiagramNodeKind : 'mechanism'
    nodes.push({
      id,
      label: cleanDiagramText(item.label, `逻辑节点 ${index + 1}`, 120),
      detail: cleanDiagramText(item.detail, '来自五阶段分析的关键节点', 1200),
      kind,
    })
  })
  if (nodes.length < 3) throw new Error('科研逻辑图至少需要三个有效节点，请重新绘制。')

  const nodeIds = new Set(nodes.map(node => node.id))
  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : []
  const edges: DiagramEdge[] = rawEdges.slice(0, 16).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const sourceId = cleanDiagramText(item.source, '', 24).replace(/[^a-zA-Z0-9_-]/g, '')
    const targetId = cleanDiagramText(item.target, '', 24).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId) || sourceId === targetId) return []
    const kind = diagramEdgeKinds.has(item.kind as DiagramEdgeKind) ? item.kind as DiagramEdgeKind : 'associates'
    return [{
      source: sourceId,
      target: targetId,
      kind,
      label: cleanDiagramText(item.label, kind === 'inhibits' ? '抑制' : '推动', 240),
      evidence: cleanDiagramText(item.evidence, '证据详情待原文核验', 1600),
    }]
  })
  if (edges.length < 2) throw new Error('科研逻辑图缺少有效关系，请重新绘制。')

  return {
    title: cleanDiagramText(parsed.title, draft.titleZh || draft.title, 240),
    subtitle: cleanDiagramText(parsed.subtitle, '论文科研逻辑图', 360),
    conclusion: cleanDiagramText(parsed.conclusion, '图中只保留支撑核心结论的最短充分路径。', 800),
    nodes,
    edges,
  }
}

function buildDiagramPrompt(draft: PaperDraft, sections: PaperStageResult[]) {
  const evidence = sections.map((section, index) => `阶段 ${index + 1}：${section.heading}\n${section.answer}`).join('\n\n')
  return `你是科研图形编辑与方法学专家。请只根据下面已经完成的五阶段论文分析，提炼一张论文专属科研逻辑图的数据。不要重写、压缩或总结五阶段报告，也不要输出任何报告文字；本次唯一产物是供 Inkscape SVG 绘制使用的结构化图数据。

论文英文题目：${draft.title}
论文中文题目：${draft.titleZh || '待核验'}
论文类型：${draft.studyType || '待判断'}

绘图原则：
- 先识别这篇论文自己的逻辑拓扑。机制论文可画变量因果与救援；算法论文画问题约束、设计模块、消融和泛化；理论论文画假设、命题、证明和反例；观察研究画现象、识别策略、混杂排除和稳健性。禁止把示例中的 D-2HG、LDH 或任何固定链条套到别的论文。
- 图必须一眼说明“作者为什么开始 -> 关键转折/机制或设计 -> 核心证据如何排除替代解释 -> 最终结论与边界”。只保留支撑一个核心结论的最短充分路径，同时保留论文真实存在的分支、汇合、抑制、反证或回路。
- 使用 4–9 个节点、3–14 条边。节点名称不超过 12 个汉字，详情解释该节点来自哪项观察、实验、定理或结果。没有证据的关系不得画成因果，使用 associates 或 boundary 节点标明边界。
- 每条边的 label 必须完整说明“怎样影响、凭什么连接”，不得为了排版删词或截断；SVG 会自动将关系说明折成多行。
- 节点 kind 只能是 premise、mechanism、evidence、outcome、boundary。
- 边 kind 只能是 promotes、inhibits、supports、refutes、constrains、associates。
- title 与 subtitle 使用中文；label 简短；evidence 写清该连线的证据依据或“待原文核验”。

只返回一个严格 JSON 对象，不要 Markdown、代码围栏、解释文字或 proposals。结构必须完全如下：
{"title":"图标题","subtitle":"一句话说明图的中心问题","conclusion":"读图后必须记住的核心结论","nodes":[{"id":"N1","label":"节点名称","detail":"证据或含义","kind":"premise"}],"edges":[{"source":"N1","target":"N2","kind":"promotes","label":"关系短语","evidence":"这条关系的证据"}]}

五阶段分析原文：
${evidence}`
}

function escapeSvg(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character] || character))
}

function wrapDiagramLabel(label: string, maxUnits = 10) {
  const words = label.match(/[A-Za-z0-9+./-]+|[\u3400-\u9fff]|[^\s]/g) || [label]
  const lines: string[] = []
  let current = ''
  let currentUnits = 0
  const displayUnits = (value: string) => /^[\x00-\xff]+$/.test(value) ? Math.max(1, value.length * 0.55) : value.length
  words.forEach(word => {
    const separator = current && /^[A-Za-z0-9]/.test(current.slice(-1)) && /^[A-Za-z0-9]/.test(word) ? ' ' : ''
    const nextUnits = currentUnits + (separator ? 0.4 : 0) + displayUnits(word)
    if (nextUnits > maxUnits && current) {
      lines.push(current)
      current = word
      currentUnits = displayUnits(word)
    } else {
      current += separator + word
      currentUnits = nextUnits
    }
  })
  if (current) lines.push(current)
  return lines
}

function renderInkscapeSvg(spec: PaperDiagramSpec) {
  const width = 1600
  const height = 980
  const nodeHeight = 126
  const top = 260
  const bottom = 760
  const incoming = new Map(spec.nodes.map(node => [node.id, 0]))
  const outgoing = new Map(spec.nodes.map(node => [node.id, [] as string[]]))
  spec.edges.forEach(edge => {
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  })
  const layers = new Map<string, number>()
  const queue = spec.nodes.filter(node => (incoming.get(node.id) || 0) === 0).map(node => node.id)
  if (!queue.length) queue.push(spec.nodes[0].id)
  queue.forEach(id => layers.set(id, 0))
  const pending = new Map(incoming)
  while (queue.length) {
    const id = queue.shift()!
    const layer = layers.get(id) || 0
    outgoing.get(id)?.forEach(target => {
      layers.set(target, Math.max(layers.get(target) || 0, layer + 1))
      pending.set(target, (pending.get(target) || 0) - 1)
      if ((pending.get(target) || 0) <= 0) queue.push(target)
    })
  }
  spec.nodes.forEach((node, index) => {
    if (!layers.has(node.id)) layers.set(node.id, Math.min(index, 4))
  })
  const byLayer = new Map<number, DiagramNode[]>()
  spec.nodes.forEach(node => {
    const layer = Math.min(layers.get(node.id) || 0, 6)
    byLayer.set(layer, [...(byLayer.get(layer) || []), node])
  })
  const occupiedLayers = [...byLayer.keys()].sort((a, b) => a - b)
  const layerIndex = new Map(occupiedLayers.map((layer, index) => [layer, index]))
  const layerCount = Math.max(1, occupiedLayers.length)
  const horizontalGap = layerCount >= 6 ? 26 : 46
  const nodeWidth = Math.max(178, Math.min(230, (1448 - horizontalGap * (layerCount - 1)) / layerCount))
  const usableWidth = 1448 - nodeWidth
  const positions = new Map<string, { x: number; y: number }>()
  byLayer.forEach((nodes, layer) => {
    const normalizedLayer = layerIndex.get(layer) || 0
    const x = 76 + (layerCount === 1 ? usableWidth / 2 : (normalizedLayer / (layerCount - 1)) * usableWidth)
    const available = bottom - top
    nodes.forEach((node, index) => {
      const y = nodes.length === 1
        ? top + available / 2 - nodeHeight / 2
        : top + (index * available) / (nodes.length - 1) - nodeHeight / 2
      positions.set(node.id, { x, y })
    })
  })

  const nodePalette: Record<DiagramNodeKind, { fill: string; stroke: string; accent: string }> = {
    premise: { fill: '#f3f0e8', stroke: '#81745d', accent: '#b79d66' },
    mechanism: { fill: '#eef5f1', stroke: '#356f62', accent: '#3f8a78' },
    evidence: { fill: '#edf3f7', stroke: '#3d6c82', accent: '#5d91a8' },
    outcome: { fill: '#fff1e9', stroke: '#a6533f', accent: '#d46b4f' },
    boundary: { fill: '#f3f2f2', stroke: '#747474', accent: '#9a9a9a' },
  }
  const edgePalette: Record<DiagramEdgeKind, { stroke: string; marker: string; dash: string }> = {
    promotes: { stroke: '#c9573d', marker: 'arrow-warm', dash: '' },
    inhibits: { stroke: '#b1443d', marker: 'inhibit', dash: '' },
    supports: { stroke: '#2f786e', marker: 'arrow-teal', dash: '' },
    refutes: { stroke: '#a34f5c', marker: 'arrow-warm', dash: '9 7' },
    constrains: { stroke: '#6b7470', marker: 'arrow-gray', dash: '6 6' },
    associates: { stroke: '#6e858e', marker: 'arrow-gray', dash: '4 7' },
  }
  const routeUse = new Map<string, number>()
  const placedLabelRects: { x: number; y: number; width: number; height: number }[] = []
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  )
  const edgeGraphics = spec.edges.map((edge, index) => {
    const source = positions.get(edge.source)
    const target = positions.get(edge.target)
    if (!source || !target) return { path: '', label: '' }
    const sx = source.x + nodeWidth
    const sy = source.y + nodeHeight / 2
    const tx = target.x
    const ty = target.y + nodeHeight / 2
    const routeKey = `${Math.round(source.x)}-${Math.round(target.x)}`
    const routeIndex = routeUse.get(routeKey) || 0
    routeUse.set(routeKey, routeIndex + 1)
    const direction = ty >= sy ? 1 : -1
    const routeOffset = routeIndex * 34 * direction
    const midX = tx > sx + 10 ? (sx + tx) / 2 : Math.min(width - 58, Math.max(sx, tx) + 58 + routeIndex * 18)
    const midY = (sy + ty) / 2 + routeOffset
    const path = `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`
    const style = edgePalette[edge.kind]
    const edgeLabel = normalizeDiagramTypography(edge.label)
    const labelLines = wrapDiagramLabel(edgeLabel, 10.5)
    const labelFontSize = labelLines.length >= 5 ? 12 : labelLines.length >= 3 ? 14 : 16
    const labelLineHeight = labelFontSize + 6
    const labelWidth = Math.max(88, Math.min(210, 32 + Math.max(...labelLines.map(line => line.length)) * (labelFontSize + 2)))
    const labelHeight = 16 + labelLines.length * labelLineHeight
    const labelX = midX
    const clampLabelY = (center: number) => Math.max(205 + labelHeight / 2, Math.min(812 - labelHeight / 2, center))
    const candidateCenters = [
      Math.min(sy, ty) - nodeHeight / 2 - labelHeight / 2 - 16 - routeIndex * 8,
      Math.max(sy, ty) + nodeHeight / 2 + labelHeight / 2 + 16 + routeIndex * 8,
      midY - labelHeight / 2 - 14,
      midY + labelHeight / 2 + 14,
    ].map(clampLabelY)
    const labelCenterY = candidateCenters
      .map(center => {
        const rect = { x: labelX - labelWidth / 2, y: center - labelHeight / 2, width: labelWidth, height: labelHeight }
        const nodeCollisions = [...positions.values()].filter(position => overlaps(rect, {
          x: position.x - 8,
          y: position.y - 8,
          width: nodeWidth + 16,
          height: nodeHeight + 16,
        })).length
        const labelCollisions = placedLabelRects.filter(placed => overlaps(rect, placed)).length
        return { center, rect, score: nodeCollisions * 1000 + labelCollisions * 500 + Math.abs(center - midY) }
      })
      .sort((a, b) => a.score - b.score)[0]
    placedLabelRects.push(labelCenterY.rect)
    const labelY = labelCenterY.rect.y
    const labelText = labelLines.map((line, lineIndex) => `<tspan x="${labelX}" dy="${lineIndex ? labelLineHeight : 0}">${escapeSvg(line)}</tspan>`).join('')
    return {
      path: `<g id="edge-${index + 1}" inkscape:label="${escapeSvg(edgeLabel)}"><title>${escapeSvg(edge.evidence)}</title><path d="${path}" fill="none" stroke="${style.stroke}" stroke-width="3.5" stroke-linecap="round"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''} marker-end="url(#${style.marker})"/></g>`,
      label: `<g id="edge-label-${index + 1}" inkscape:label="关系说明：${escapeSvg(edgeLabel)}"><rect x="${labelX - labelWidth / 2}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" rx="6" fill="#fffdf9" fill-opacity="0.96" stroke="#d7ddd6"/><text x="${labelX}" y="${labelY + labelFontSize + 6}" text-anchor="middle" class="edge-label" style="font-size:${labelFontSize}px" fill="${style.stroke}">${labelText}</text></g>`,
    }
  })
  const edgePathSvg = edgeGraphics.map(graphic => graphic.path).join('')
  const edgeLabelSvg = edgeGraphics.map(graphic => graphic.label).join('')
  const nodeSvg = spec.nodes.map((node, index) => {
    const position = positions.get(node.id)!
    const palette = nodePalette[node.kind]
    const nodeLabel = normalizeDiagramTypography(node.label)
    const lines = wrapDiagramLabel(nodeLabel, nodeWidth < 190 ? 8.5 : 10.5)
    const nodeFontSize = lines.length >= 4 ? 13 : lines.length === 3 ? 15 : 18
    const nodeLineHeight = nodeFontSize + 5
    const textY = position.y + nodeHeight / 2 - ((lines.length - 1) * nodeLineHeight) / 2 + nodeFontSize * 0.35
    const text = lines.map((line, lineIndex) => `<tspan x="${position.x + nodeWidth / 2}" dy="${lineIndex ? nodeLineHeight : 0}">${escapeSvg(line)}</tspan>`).join('')
    return `<g id="node-${escapeSvg(node.id)}" inkscape:label="${escapeSvg(nodeLabel)}"><title>${escapeSvg(node.detail)}</title><rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="14" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="3"/><rect x="${position.x}" y="${position.y}" width="8" height="${nodeHeight}" rx="4" fill="${palette.accent}"/><circle cx="${position.x + 24}" cy="${position.y + 22}" r="13" fill="${palette.accent}"/><text x="${position.x + 24}" y="${position.y + 27}" text-anchor="middle" class="node-index">${index + 1}</text><text x="${position.x + nodeWidth / 2}" y="${textY}" text-anchor="middle" class="node-label" style="font-size:${nodeFontSize}px">${text}</text></g>`
  }).join('')

  const titleLines = wrapDiagramLabel(normalizeDiagramTypography(spec.title), 38)
  const titleSvg = titleLines.map((line, index) => `<tspan x="76" dy="${index ? 38 : 0}">${escapeSvg(line)}</tspan>`).join('')
  const subtitleY = 92 + (titleLines.length - 1) * 38 + 34
  const subtitleLines = wrapDiagramLabel(normalizeDiagramTypography(spec.subtitle), 70)
  const subtitleSvg = subtitleLines.map((line, index) => `<tspan x="76" dy="${index ? 22 : 0}">${escapeSvg(line)}</tspan>`).join('')
  const dividerY = subtitleY + (subtitleLines.length - 1) * 22 + 22
  const conclusionLines = wrapDiagramLabel(normalizeDiagramTypography(spec.conclusion), 52)
  const conclusionText = conclusionLines.map((line, index) => `<tspan x="700" dy="${index ? 24 : 0}">${escapeSvg(line)}</tspan>`).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" version="1.1" inkscape:version="1.4" id="paper-logic-diagram">
  <sodipodi:namedview id="namedview1" pagecolor="#f4f1e9" bordercolor="#40534a" inkscape:document-units="px" showgrid="false"/>
  <defs>
    <marker id="arrow-warm" markerWidth="12" markerHeight="12" refX="10" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="#c9573d"/></marker>
    <marker id="arrow-teal" markerWidth="12" markerHeight="12" refX="10" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="#2f786e"/></marker>
    <marker id="arrow-gray" markerWidth="12" markerHeight="12" refX="10" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6e858e"/></marker>
    <marker id="inhibit" markerWidth="10" markerHeight="18" refX="2" refY="9" orient="auto" markerUnits="strokeWidth"><path d="M 2 1 L 2 17" fill="none" stroke="#b1443d" stroke-width="3"/></marker>
    <style>.title{font:700 32px Arial,'PingFang SC',sans-serif}.subtitle{font:17px Arial,'PingFang SC',sans-serif}.node-label{font:700 19px Arial,'PingFang SC',sans-serif;fill:#263b32}.node-index{font:700 13px Arial,sans-serif;fill:white}.edge-label{font:700 13px Arial,'PingFang SC',sans-serif}.conclusion{font:600 17px Arial,'PingFang SC',sans-serif;fill:#354b42}</style>
  </defs>
  <g inkscape:groupmode="layer" inkscape:label="背景" id="background"><rect width="${width}" height="${height}" fill="#f4f1e9"/><rect x="42" y="42" width="1516" height="896" rx="18" fill="#fffdf9" stroke="#d7ddd6" stroke-width="2"/></g>
  <g inkscape:groupmode="layer" inkscape:label="标题" id="headings"><text x="76" y="92" class="title" fill="#263b32">${titleSvg}</text><text x="76" y="${subtitleY}" class="subtitle" fill="#63736b">${subtitleSvg}</text><line x1="76" y1="${dividerY}" x2="1524" y2="${dividerY}" stroke="#d9dfd9" stroke-width="2"/></g>
  <g inkscape:groupmode="layer" inkscape:label="逻辑关系" id="edges">${edgePathSvg}</g>
  <g inkscape:groupmode="layer" inkscape:label="逻辑节点" id="nodes">${nodeSvg}</g>
  <g inkscape:groupmode="layer" inkscape:label="关系文字" id="edge-labels">${edgeLabelSvg}</g>
  <g inkscape:groupmode="layer" inkscape:label="核心结论" id="conclusion"><rect x="76" y="838" width="1448" height="78" rx="8" fill="#e9f1ed"/><text x="800" y="868" text-anchor="middle" class="conclusion">${conclusionText}</text></g>
</svg>`
}

function diagramFilename(title: string) {
  const safe = title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'paper-logic'
  return `${safe}-inkscape.svg`
}

function missingPaperSections(markdown: string, module: PaperModule) {
  const text = markdown.replace(/[#*_`]/g, ' ')
  const missing: string[] = []
  const requireMatch = (label: string, pattern: RegExp) => {
    if (!pattern.test(text)) missing.push(label)
  }

  if (module === 'reproduce') {
    requireMatch('环境阶段', /环境/)
    requireMatch('数据阶段', /数据/)
    requireMatch('预处理阶段', /预处理/)
    requireMatch('训练阶段', /训练/)
    requireMatch('评估阶段', /评估/)
    requireMatch('图表复现阶段', /图表复现|Figure|Table/i)
    requireMatch('代码复现总小结', /代码复现总小结/)
    return missing
  }

  requireMatch('论文信息与阅读边界', /论文信息与阅读边界/)
  requireMatch('一句话击穿', /一句话击穿[：:]/)
  requireMatch('一眼看懂全文', /一眼看懂全文/)
  requireMatch('逻辑图节点', /机制节点/)
  requireMatch('逻辑图关系', /机制关系/)
  requireMatch('章节关键推理链', /(?:逻辑路径|关键链条|推理链)/)
  requireMatch('题目分析', /题目分析/)
  requireMatch('题目策略分析', /题目策略分析/)
  requireMatch('显式逻辑连接词', /\*\*(?:但是|因此|随后|由此|反而|最终|这意味着|关键在于)\*\*/)
  requireMatch('通讯作者研究轨迹', /通讯作者研究轨迹/)
  requireMatch('综述为什么这样写', /综述为什么这样写/)
  requireMatch('摘要整体逻辑', /摘要整体逻辑/)
  requireMatch('摘要逐句逻辑', /摘要第(?:[一二三四五六七八九十\d]+)句/)
  requireMatch('写作结构总结', /本部分写作结构总结[：:]/)
  requireMatch('作者怎样一步步证明', /作者怎样一步步证明/)
  requireMatch('最强证据与逻辑缺口', /最强证据与逻辑缺口/)
  requireMatch('真正难点讲解', /真正难点/)
  requireMatch('知识点讲解', /知识(?:点)?讲解/)
  requireMatch('指标或实验选择依据', /为什么(?:想到|选择|测量|采用)/)
  requireMatch('跨领域知识桥', /跨领域知识桥/)
  requireMatch('顶刊证据门槛', /顶刊|顶会|期刊.{0,8}(?:门槛|理由)/)
  requireMatch('逻辑缺口产生的新 Idea', /逻辑缺口.{0,8}新\s*Idea/i)
  requireMatch('可复现边界', /可复现(?:部分|边界)/)
  return missing
}

function buildCoverageRepairPrompt(draft: PaperDraft, answer: string, missing: string[]) {
  if (draft.module === 'reproduce') {
    return `你是代码复现指南的校对者。论文理解与科研逻辑分析已经在另一个独立功能中完成；本轮只能修复复现指南，禁止重新分析题目、作者、摘要、综述、因果链、跨领域知识桥、期刊价值或新 Idea。

论文：${draft.title}
检测到缺失的复现部分：
${missing.map((item, index) => `${index + 1}. ${item}`).join('\n')}

请保留候选指南中正确且可执行的内容，并重写为一份面向零基础读者的完整复现手册。必须依次覆盖：复现边界与目标产物、环境从零搭建、数据获取与校验、预处理、代码目录与调用链、最小冒烟运行、完整训练/实验、评估与 Figure/Table 对齐、常见报错、掌握验收。每个阶段都要写清命令在哪个目录执行、命令每个关键参数的含义、成功时应看到什么、输出保存在哪里、失败时如何定位，并在末尾写“阶段小结”。最后写“代码复现总小结”。

不得猜测不存在的仓库、文件、函数、数据、参数或实验结果。对每项内容标注“材料直接支持”“需要补写”“论文未公开”或“需要湿实验平台”。命令使用代码块；不要输出内部思考、论文深度分析或 Markdown 表格。

候选复现指南：
${answer.slice(0, 17000)}`.slice(0, 22000)
  }
  const requiredShape = `只输出一份连续报告，依次包含“论文信息与阅读边界”“一眼看懂全文”“题目分析”“通讯作者研究轨迹”“综述为什么这样写”“作者怎样一步步证明”“科研逻辑图”“最强证据与逻辑缺口”“真正难点与跨领域知识桥”“为什么达到该期刊/会议证据门槛”“从逻辑缺口产生的新 Idea”“可复现边界”。正文必须包含章节关键推理链、必要知识点讲解，并明确解释关键指标或实验为什么会被想到和选择。不要输出模块答卷、检查清单或思考过程。`
  return `你是论文分析报告的终审编辑。下面候选报告缺少强制结构，必须重写为一份连贯、完整的最终报告，而不是追加补丁或输出检查清单。

论文：${draft.title}
期刊/会议：${draft.venue || '未提供'}
通讯作者证据：
${draft.scholarlyContext || '没有可靠元数据'}
通讯作者研究方向自动总结：
${draft.authorDirectionSummary || '没有可靠总结，必须明确写“证据不足，无法可靠总结”，不得猜测。'}

检测到的缺项：
${missing.map((item, index) => `${index + 1}. ${item}`).join('\n')}

重写要求：
- ${requiredShape}
- 保留候选报告中已有且有证据支持的深度内容，删除重复、散乱、模板化和无依据内容。
- 按原文真实顺序解释每个段落或功能段落组：写了什么、为什么必须写在这里、怎样承接上一段、作者如何把事实推成判断、又为下一段或实验留下什么问题。
- 在每个有原文材料支持的句子解释后加入一行“句子结构小结：语言结构——……；逻辑结构——……；写作意图（合理推断）——……”。每个段落解释后加入“段落结构小结”，每个二级部分结尾加入“本部分写作结构总结”。三类总结必须短而具体，不能重复正文；没有原文时只总结可见材料，禁止臆造句法或段落。
- 每个功能先写连续段落，再输出至多一行“逻辑路径 功能名：A → B → C”；网页会把它压缩成单行“➡️”链，不得放入代码块。关键实验必须说明作者为什么想到当前解释、为什么选择该指标/对照、怎样实施以及结果怎样推动下一步。
- 语义属于同一条论证时必须留在同一段，用 **但是**、**因此**、**随后**、**这意味着** 等加粗逻辑词显出转折和推进；只有互不依赖、需要分别成立的独立论点才另起段落并用 1️⃣、2️⃣、3️⃣ 编号。禁止把一句完整论证拆成许多碎点，也禁止为了排版而编号。
- 至少在首次出现真正理解门槛时加入“知识讲解：概念名称”，用短段落解释定义、关键关系或反应式以及它在当前推理中的作用。
- 只能使用候选报告与上方元数据已经支持的信息；不知道的内容标成待核验。
- 一眼看懂全文中输出 4–8 个“机制节点”和 3–10 条“机制关系”，用于网页绘图；每行必须严格写成“机制节点：唯一ID | 简短中文名称 | 角色”或“机制关系：起点ID | 终点ID | 促进/抑制/支撑/反驳/约束/关联 | 关系说明”。图只服务本文一个最核心结论：一个节点只能表达一个变量、机制、证据功能或结果，节点名称不超过 12 个汉字；主链从左到右，分支和汇合只在原文证据需要时出现。关系说明供点击查看，不得把完整句子塞进图面。图的拓扑必须来自当前论文实际论证，不得套用线性链或任何示例；全文使用简体中文，不使用 Markdown 表格、代码块或 ASCII 图。

候选报告：
${answer.slice(0, 17000)}`.slice(0, 22000)
}

function buildReproductionPrompt(draft: PaperDraft, webSearch: boolean) {
  const source = [
    draft.sourceText.trim() ? `论文材料：\n${draft.sourceText.trim()}` : '',
    draft.sourceTextZh.trim() ? `中文翻译：\n${draft.sourceTextZh.trim()}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 11000) || '没有论文正文或摘要，只能制定待核验的复现准备步骤，不能声称已经确认实验细节。'

  return `你是面向零基础学习者的论文复现导师。本项目的“论文深度全链路”已经是另一个独立功能，本轮只负责复现，绝对不要重新输出题目分析、通讯作者、摘要逐句、综述逻辑、作者科研逻辑、因果证据链、交叉知识桥、顶刊理由或新 Idea。

论文标题：${draft.title.trim()}
DOI / URL / arXiv：${draft.locator.trim() || '未提供'}
期刊 / 会议：${draft.venue.trim() || '未提供'}
研究类型：${draft.studyType || '待根据材料判断'}
学习者水平：第一次复现论文，不熟悉虚拟环境、依赖、命令行、数据目录、训练和结果校验。
允许联网核验公开仓库、数据和官方文档：${webSearch ? '是' : '否'}

复现纪律：
- 先判断这是纯计算、计算与湿实验混合、纯湿实验、理论、临床或系统论文，并据此说明“这次实际能复现到哪里”。这只是划定复现边界，不是再次分析论文。
- 只把论文中需要重做的 Figure、Table、指标、模型输出或实验读出作为复现目标；逐项标注“材料直接支持”“需要补写”“论文未公开”或“需要湿实验平台”。
- 不得猜测仓库地址、文件名、函数名、命令、数据集、样本量、超参数、结果数值或设备要求。没有证据就明确写“待核验”，并给出具体核验位置。
- 若提供了代码附件，必须按真实文件建立入口、配置、数据加载、预处理、模型/实验、训练、评估和绘图调用链；没有代码时只能给出代码骨架与待补文件，不能伪装成原作者代码。
- 所有命令都要说明：在哪个目录执行、每个关键参数是什么、为什么执行、成功时看到什么、生成文件在哪里、常见失败怎样排查。
- 先做最小冒烟测试：环境检查 → 一个样本 → 一个 batch/一次实验 → 一个 epoch/最小流程 → 小规模结果。通过后才允许进入完整复现。
- 结果对齐不能只写“接近论文”。必须说明论文目标、自己的输出、允许误差或趋势标准、随机种子、硬件/软件差异和无法对齐时的排查顺序。
- 对湿实验部分，列出样本、试剂、设备、对照、操作条件、读出、统计和安全/伦理门槛；不能用代码步骤冒充湿实验复现。
- 面向小白解释首次出现的术语，例如终端、工作目录、Python、虚拟环境、依赖、CUDA、随机种子、checkpoint、batch 和数据泄漏，但只在当前操作需要时解释。

严格按下面结构输出：
# ${draft.title.trim()}：可执行复现指南

## 0. 这次复现的边界与最终产物
只说明需要重做哪些 Figure/Table/指标/实验读出、公开材料是否足够、哪些部分不能在当前条件下完成。不要重复论文深度分析。

## 1. 开始前需要认识的工具
用初学者能理解的语言解释本次实际会用到的终端、工作目录、运行时、虚拟环境、依赖、CPU/GPU/CUDA和配置文件，并说明它们之间的关系。

## 2. 从零搭建环境
提供操作系统与硬件检查、创建隔离环境、安装依赖、版本锁定和验证命令。每条命令后解释目的、成功信号、输出位置和失败排查。末尾写“环境阶段小结”。

## 3. 获取并检查数据
说明数据来源、许可/申请、目录结构、文件含义、样本形状与单位、校验方法、训练/验证/测试划分及泄漏风险。先用一个样本验证。末尾写“数据阶段小结”。

## 4. 预处理复现
把原始数据到模型/统计输入的每一步对应到真实代码或待补代码，解释输入输出形状、参数来源和中间产物检查。末尾写“预处理阶段小结”。

## 5. 代码地图与论文实验对应
按真实目录说明入口文件、配置、数据加载、模型/实验模块、损失或统计、训练、评估和绘图之间怎样调用；逐项映射到要复现的 Figure/Table。没有真实代码时明确列出需要创建的最小文件，禁止捏造作者文件。

## 6. 最小冒烟运行
给出最小数据、最少步骤和最短时间的可运行检查，说明期望日志、成功标准、输出文件和常见错误。只有此阶段通过才能继续。

## 7. 完整训练或完整实验
给出从工作目录开始的顺序命令、配置、随机种子、硬件预算、运行时间估计、checkpoint/实验记录和中断恢复。末尾写“训练阶段小结”；非训练论文改成对应的“完整实验阶段小结”。

## 8. 评估与 Figure/Table 复现
逐项说明评估命令、指标定义、绘图命令、目标输出、允许误差或趋势标准，以及如何比较论文和本地结果。末尾分别写“评估阶段小结”和“图表复现阶段小结”。

## 9. 报错与偏差排查
按环境 → 数据 → 维度/单位 → 配置 → 随机性 → 硬件差异 → 论文未公开细节的顺序给出诊断路径，避免只给泛泛建议。

## 10. 真正掌握的验收
给出一项有预测的最小修改：先写为什么改、预期怎样变化、怎样运行、什么结果支持理解、什么结果说明理解错误。再列出学习者能否独立重建环境、解释数据流、定位代码、复现核心结果和诊断错误的验收标准。

## 代码复现总小结
只总结已经具备、仍缺失、当前可达到的复现层级、下一步唯一动作。不要回到论文深度分析。

论文与附件材料：
${source}

格式要求：使用简体中文。命令必须放在带语言标识的代码块中；不要使用 Markdown 表格，不要输出思考过程。所有步骤都要具体到初学者能够照着操作，但不能把未经材料核验的示例写成真实命令。`.slice(0, 23500)
}

function buildPrompt(draft: PaperDraft, journalLogic: string, webSearch: boolean) {
  if (draft.module === 'reproduce') return buildReproductionPrompt(draft, webSearch)
  const source = [
    draft.sourceText.trim() ? `英文原文：\n${draft.sourceText.trim()}` : '',
    draft.sourceTextZh.trim() ? `中文翻译：\n${draft.sourceTextZh.trim()}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 10000) || '未提供摘要或正文。只能做结构化待办和假设，不得声称掌握论文具体结果。'
  const prompt = `请作为严谨的顶刊论文方法学导师，用中文分析下面的论文。目标不是生成泛泛摘要，而是识别这篇论文所属学科与期刊真正要求的强逻辑，重建作者如何从问题推进到可接受的证据结论，并把论文映射为可复现的研究计划。因果实验只是其中一种逻辑，理论证明、工程验证、计算实验、观察识别和系统综述必须使用各自合适的标准。

论文标题：${draft.title.trim()}
论文标题中文翻译：${draft.titleZh.trim() || '待自动翻译'}
DOI / URL / arXiv：${draft.locator.trim() || '未提供'}
具体期刊 / 会议：${draft.venue.trim() || '未提供，请根据材料判断并标注不确定性'}
期刊 / 会议中文翻译：${draft.venueZh.trim() || '待自动翻译'}
目标期刊逻辑：${journalProfiles[draft.journalProfile]?.label || journalProfiles.general.label}
研究设计：${draft.studyType}
研究领域：${draft.domain.trim() || '未指定'}
当前难点或已知交叉线索：${draft.crossDomainClues.trim() || '未提供，请主动识别论文中的知识瓶颈和跨领域机会'}
通讯作者与近年论文元数据：
${draft.scholarlyContext.trim() || '未自动获得。通讯作者身份和近年轨迹必须标为待核验，不得根据作者顺序猜测。'}
通讯作者近年研究方向自动总结：
${draft.authorDirectionSummary.trim() || '未自动获得。报告必须根据上方证据自行总结；证据不足时明确说明。'}
我的学习目标：${draft.goal.trim() || '理解并复现论文'}
本次是否允许服务端联网检索：${webSearch ? '是' : '否'}

期刊逻辑要求：
${journalLogic}

证据纪律：
- 第一步必须输出“自适应分析路由判定”和“论文逻辑身份卡”：学科、论文类型、核心贡献类型、目标读者、原生逻辑拓扑、主要证明责任、选用的分析框架、明确拒绝的错误模板。必须先解释为什么这篇论文应按当前路线分析，以及医学机制、算法消融、理论证明、临床识别、工程系统或综述综合等其他模板为什么不适用。后续所有章节必须服从这张身份卡；若分析中发现类型判断错误，要主动修正。
- 分析框架必须因论文而异。线性论文可用顺序链；存在并行假说、反馈回路、多尺度证据或混合贡献时，必须画分叉、回环与汇合，不得强行压成单线。描述性论文不得伪装成因果实验，方法论文不得把性能提升伪装成机制发现，理论论文不得用实验模板替代假设—命题—证明—反例链。
- 明确区分“输入材料直接支持”“基于学科常识的推断”“需要原文或联网核验”。
- 不得编造作者履历、实验结果、样本量、代码文件、数据集或统计数字。
- 先说明该期刊和论文类型偏好的论证结构，再评价本文是否满足；不能只因为期刊名高就默认逻辑成立。
- 对经验研究，每个因果结论都回答操纵/识别了什么、控制了什么、测量了什么、排除了什么替代解释；相关性证据不能写成因果。
- 每个关键主张都建立“竞争解释树”：至少提出主假说、反向因果、共同原因/混杂、测量伪影、选择偏差、模型容量/数据泄漏和偶然性中适用的候选；逐个说明哪项证据剪掉了哪根分支，禁止用单个显著结果宣称闭环。
- 对理论、方法、工程、资源和综述论文，分别检查证明边界、基准与消融、失效模式、数据质量和检索偏倚等相应证据，不强行要求医学实验。
- 发现跨学科知识时不能停在“很像”：必须说明两个系统在哪些变量、尺度、约束和可观测量上对应，哪些地方不对应，以及怎样用最小实验判断迁移是否有效。
- 至少从生物/医学、计算机/信息、数学/物理、工程/控制、生态/演化、经济学/博弈/计量六组视角中比较三个真正有结构对应的候选；不相关的领域必须说明淘汰理由。
- 每一层实验或论证都写清“上一层留下什么唯一缺口、作者此时面临哪些候选路线、为什么选择当前实验而不是别的实验、该证据带来的信息增益、当前结果又迫使作者做什么下一步”。
- “作者深层逻辑”不是把章节顺序复述一遍，而是重建作者的决策：当时有哪些竞争路线、为何这个约束被重新定义、设计选择牺牲了什么换来了什么、哪个证据承担全篇转折、哪些负空间没有写出来。
- 解释“为什么能投中顶刊/顶会”时，必须把创新与该 venue 的读者、评价标准和证据门槛逐项配对；只能说“从公开内容看可能因为”，不得伪造编辑或审稿人的真实心理。
- 把论文作者的结论和你自己的推断分开。高引用量、顶刊名称和模型复杂度都不能代替因果或证明责任。
- 如果输入不足，仍给出可操作的原文定位问题、检索式和代码定位步骤。
- 禁止使用 Markdown 表格、竖线分隔表或把多个字段挤在同一行。所有复杂信息必须改成纵向“证据节点/实验卡/复现步骤”，每个字段单独一行。
- 报告开头先给出“200 字摘要”和“一条主线”，让初学者先知道全文在讲什么；相邻章节必须用“上一结论 -> 当前缺口 -> 下一动作”衔接，不得像独立问题答案一样跳跃。
- 全文必须使用简体中文。英文题目、摘要和专业术语首次出现时，必须紧跟忠实中文翻译；不得把翻译扩写成原文没有的结论。
- 颗粒度必须细到可以回答“这一段、这一图、这一实验为什么存在”。如果当前材料只有摘要，不得伪装成逐段读过全文；应输出已证实的摘要微逻辑和一份按章节定位原文证据的待核验清单。

本次任务：
${moduleRequirements[draft.module]}

论文材料：
${source}

格式要求：以一级标题“${draft.title.trim()}：深度阅读与复现报告”开始。只使用短段落、标题、编号列表、项目符号和纯文本逻辑箭头，禁止 Markdown 表格与竖线分隔内容；结尾必须给出“下一步只做一件事”，适合初学者立即执行。`
  const narrativeRules = `

最高优先级叙事规则：
- 不要把内部检查清单逐项打印出来。每个章节只保留 3–5 个真正改变论文推理方向的关键转折，其余细节合并进连续短段落。
- 先识别本文独有的核心矛盾和原生逻辑，再决定转折数量与顺序。不得因为提示中列出了候选角色，就强行让本文出现背景、缺口、假说、因果、救援或落地等全部环节。
- 每个功能先写一段完整、连贯的分析，再压缩为一条关键链；不能先列“研究对象、机制、表型”等互不连接的字段。
- 每个关键转折都重建认知来源：作者先看到了什么证据或异常；这个观察为什么会让作者想到当前解释；所依赖的知识原理是什么；为什么选择当前指标、模型、对照或实验而不是其他方案；实验怎样真正落地；结果支持或否定了什么；它为什么迫使作者进入下一步。
- 指标不能只报名称和升降。必须解释该指标与假说之间的反应式、定义、统计关系或机制联系，让初学者明白“为什么测它能够回答当前问题”。
- 知识点只在首次成为理解障碍时插入，用“知识讲解：概念名称”开头写一个短段落，讲清概念、本文中承担的作用以及读者怎样用它继续理解下一步；禁止脱离论文写百科。
- 交叉知识桥必须采用清楚的连续叙事：“本文的具体难点 -> 为什么会联想到该外领域知识 -> 两边变量/结构怎样对应 -> 怎样结合进本文 -> 它能解决什么 -> 最小验证与失效条件”。禁止只罗列学科名词。
- 真正难点必须解释难在哪里、作者跨过难点所需的关键知识和证据，以及仍未解决的代价。随后寻找具有相似因果结构的外领域问题，用变量映射说明对应关系，并从对应关系推出可证伪的新 Idea。
- 不要把一个句子拆成多个孤立分点；优先使用有因果连接词的短段落。只有并列比较、实验步骤或候选方案确实需要时才使用列表。
- 任何框架图都禁止放进代码块。不要输出 Mermaid、ASCII 代码框或带竖线的伪表格。`
  return `${prompt}${narrativeRules}`.slice(0, 23500)
}

function buildSectionPrompt(draft: PaperDraft, journalLogic: string, webSearch: boolean, section: typeof fullAnalysisSections[number]) {
  const source = [
    draft.sourceText.trim() ? `英文材料：\n${draft.sourceText.trim()}` : '',
    draft.sourceTextZh.trim() ? `中文翻译：\n${draft.sourceTextZh.trim()}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 11000) || '没有论文正文或摘要。不得假装读过原文。'
  const focus: Record<Exclude<PaperModule, 'full' | 'reproduce'>, string> = {
    title_author: `先忠实翻译题目，再用一段话解释题目目的、读者仅从题目能获得什么、题目如何把对象—问题—机制/方法—表型/结果串成一句论证，以及标题动词承诺了多强的证据。随后用一条短链压缩题目逻辑。通讯作者部分也先写连续研究轨迹，再压缩为“早期积累 → 中间转向 → 本文位置 → 后续方向”；只保留与理解本文有关的可靠轨迹。`,
    introduction: `按材料真实顺序阅读，但必须先讲整体、再拆句。先以“摘要整体逻辑”写一个连续段落，完整讲清摘要从起点问题、旧认识、关键转折、作者动作到结论边界为什么这样排列；随后用一条“逻辑路径 摘要总链：A → B → C”压缩整段。读者先理解全貌后，再把摘要拆成“摘要第1句、摘要第2句……”，不得跳过任何一句；每句先给忠实中文意译，再用一个连续段落讲透作者为什么必须在这里写它、想法来自哪项已知事实/前文证据/领域矛盾、承接上一句什么、新增哪一步论证、又怎样迫使下一句或实验出现。每句解释后必须补一行“句子结构小结”，分别概括原句的语言组织、逻辑动作与作者写作意图（合理推断）；摘要整体结束后补“段落结构小结”。若材料包含 Introduction，每一段也先写“引言第N段整体逻辑”，再解释段内每个可见句子并逐句小结，段末总结该段的起承转合，最后重建段落之间的总链；并指出引用某类文献承担的是建立共识、制造转折、暴露缺口还是限定边界。若当前只有摘要，只分析摘要并明确正文待核验，绝不能补造 Introduction 段落。`,
    causal: `把方法、实验、结果和讨论按同一研究问题重新配对。每个关键实验先用连续段落解释“观察到了什么 → 为什么想到当前机制/方法 → 需要掌握什么知识 → 为什么选择这个指标、对照或实验 → 怎样落地 → 结果怎样改变判断 → 为什么还需要下一实验”。不能只复述步骤或指标升降。论文若不是机制研究，就使用其原生等价逻辑，例如算法设计—基准—消融—泛化或假设—命题—证明—反例。`,
    cross_domain: `先用连续段落讲透本文最突出的 2–3 个真正难点，再逐个说明为什么会联想到某个领域外知识，而不是罗列领域名称。每条桥形成“本文难点 → 外领域解决的同构问题 → 两边变量和约束如何对应 → 哪些地方不对应 → 如何嵌入本文 → 能产生什么新解释或方案 → 最小验证与失败条件”。只保留能推动新 Idea 的桥。`,
    ideas: `从全文主线连续解释论文最突出的贡献、最难完成的环节、最强证据、最弱跳跃和可能达到该期刊门槛的原因。再从尚未闭合的逻辑断点出发，结合前述跨领域对应推出少量可证伪新 Idea；必须把“断点怎样产生新假说、怎样落地、什么结果会否定它”讲成连续推理。`,
  }
  return `你正在为 Paper Lab 做幕后证据阅读，最终读者不会看到本轮原始输出。只能分析下方明确给出的这一篇论文；不得引入、比较或总结 Paper Lab 中的其他论文、旧报告或研究想法。禁止输出思考过程、<think>、任务复述、自适应路由清单、通用模板和大段领域百科。

论文：${draft.title}
期刊/会议：${draft.venue || '待核验'}
研究类型线索：${draft.studyType}
研究领域：${draft.domain}
期刊方法学要求：${journalLogic}
联网核验：${webSearch ? '允许' : '不允许'}
通讯作者可靠信息：
${draft.scholarlyContext || '无可靠信息，必须标为待核验'}

本轮焦点：${section.heading}
${focus[section.module]}

共同规则：
- 输出第一行必须是“一句话击穿：……”：只用一句话指出本阶段最改变读者理解的认知转折，不写空泛重要性。第二行必须是“逻辑路径 本阶段主线：A → B → C”，让读者先看见本阶段的起点、转折和落点，再阅读详细解释。
- 本阶段结尾必须输出一行“本部分写作结构总结：语言结构——……；逻辑结构——……；作者写作策略（合理推断）——……；在全文中的作用——……”。只总结当前实际读到的材料；不得把作者意图写成已证实事实。
- 紧接着只追加一次“可模仿结构框架：适用场景——……；写作骨架——[功能槽位A] → [功能槽位B] → [功能槽位C]；仿写句式——‘……’；避免照搬——……”。必须像用户示例一样具体：写作骨架提炼当前部分真实采用的推进方式，仿写句式保留可以替换的对象，避免照搬说明该框架何时不成立。它只是正文之后的学习附录，不能为了填写模板而缩短、改写或降低前面分析的深度。
- 先从本文材料判断它自己的科研逻辑，绝不能把医学机制链套给算法、理论、观察、资源或系统论文。
- 每个判断标清“材料直接支持”“合理推断”或“待全文核验”，但不要把标签堆成清单。
- 除“摘要与引言逐句逐段逻辑”必须覆盖当前材料中的每一句外，其他阶段只保留 3–6 个真正推动本文逻辑的关键证据笔记。每条用连贯短段落解释前因后果；关键实验必须解释指标选择依据和所需知识点。
- 不写完整报告，不重复其他阶段，不使用 Markdown 表格，不得输出“本阶段核验清单”或任何自检结果，控制在 1400 个中文字以内。

当前可用论文材料：
${source}`.slice(0, 22000)
}

function buildIntegrationPrompt(draft: PaperDraft, sections: { heading: string; answer: string }[]) {
  const evidence = sections.map(section => `### ${section.heading}证据笔记\n${section.answer.slice(0, 3400)}`).join('\n\n')
  const auditInstruction = draft.analysisDepth === 'adversarial'
    ? '在幕后完成反方审查，删除相关冒充因果、模板套用、尺度错配和没有证据的结论；不要把审查清单打印给读者。'
    : '检查证据边界和相互依赖，不能添加阶段证据之外的新事实。'
  return `你是 Paper Lab 的论文逻辑编辑。五轮证据笔记全部属于下方标题所指的同一篇论文；不得加入、比较或总结任何其他论文。现在只输出一份从头到尾连续、没有重复的中文全文分析。读者最想知道的是：作者为什么写下每一段、怎样一步步把问题推到实验与结论，以及本文独有的突出点和难点。

论文：${draft.title}
期刊/会议：${draft.venue || '未提供'}
研究设计：${draft.studyType}
研究领域：${draft.domain}

${auditInstruction}

严格使用下面十二个二级标题。每个功能先写一段完整推理，再用一条“逻辑路径 功能名：A → B → C”压缩关键链。逻辑路径属于网页绘图数据，不放进代码块，正文渲染时会自动隐藏原始行并显示为紧凑的“A ➡️ B ➡️ C”，不能生成占据大面积的步骤卡片。

标题之后、第一节之前必须先输出两行：第一行“一句话击穿：……”，用一句话讲清本文推翻、补足或重新连接了什么既有认识，以及决定性证据为什么改变判断；第二行“逻辑路径 20秒主线：核心矛盾 → 作者转向 → 决定性证据 → 新解释 → 结论边界”。这里追求认知清晰，不使用“重大、首次、颠覆”等没有证据的宣传词。

全文必须遵守“语义分组”而不是“句子分点”：同一因果论证中的背景、转折、推断和下一步写在同一段，并把 **但是**、**因此**、**随后**、**由此**、**反而**、**最终** 等真正承担逻辑作用的连接词单独加粗，网页会显示为红色粗体下划线；不要加粗普通术语。只有两个观点逻辑上彼此独立、必须分别讨论时，才用 1️⃣、2️⃣、3️⃣ 开头分段。每个编号下面仍然必须是一段完整推理，不能变成字段清单。

## 1. 论文信息与阅读边界
给出题目、忠实中文译名、期刊/会议、年份、DOI、通讯作者、原文与代码/数据链接，并说明实际读到了全文、摘要、图表、补充材料还是仅元数据。缺失内容明确标为待核验，禁止用猜测填空。

## 2. 一眼看懂全文
先回答“读完这篇论文，读者原来的哪一个认识必须改变”，再用一个连续短段落讲清“核心矛盾是什么 → 旧解释为什么不够 → 哪项观察让作者转向 → 做了什么关键动作 → 哪项证据真正改变判断 → 得到什么 → 结论边界”。随后输出本文专属的机器绘图数据。图的结构由论文类型决定：机制论文画变量因果；算法论文画约束、设计、消融与泛化；理论论文画假设、命题、证明与反例；观察研究画现象、识别、混杂排除与稳健性；其他类型使用自己的结构。

绘图数据每行严格采用以下格式，不放入代码块：
机制节点：唯一ID | 简短中文名称 | 角色
机制关系：起点ID | 终点ID | 促进/抑制/支撑/反驳/约束/关联 | 关系说明
使用 4–8 个节点和 3–10 条边，只表达支撑一个核心结论的最短充分路径。名称不超过 12 个汉字；主链从左到右，分支上下展开；关系说明作为点击连线后的证据详情。材料不足时宁可标“待核验”，不可编造。

## 3. 题目分析
先忠实翻译题目。随后写“题目策略分析”：默认使用一段连续论证，解释标题想解决什么、仅从题目能知道什么、作者怎样把研究对象、问题、靶对象、机制/方法与表型/结果串成一句话，关键词怎样借用领域共识建立背景，限定词怎样收窄研究边界，以及 alters、impairs、predicts、associates、enables 等动词分别承诺了多强证据。若题目确实同时采用多个彼此独立的命名策略，才用 1️⃣、2️⃣、3️⃣ 分段；若它们共同服务同一策略，则留在一段并用加粗逻辑词串联。最后用一条逻辑路径压缩题目，不能列“研究对象/机制/表型”等孤立字段。

## 4. 通讯作者研究轨迹
用可靠资料把“早期核心问题 → 方法或模型积累 → 研究方向转折 → 本文怎样长出来 → 后续延伸”讲成连续研究故事，最后总结稳定研究方向。只保留与理解本文有关的轨迹，同名、猜测和无来源内容不得写成事实。

## 5. 综述为什么这样写
严格沿摘要和 Introduction 的真实顺序分析，并执行“整体优先、逐句证明、重新合流”。先用“摘要整体逻辑”写一个连续段落，让读者一次看懂这一整段为什么从当前起点推进到当前结论；紧接一条“逻辑路径 摘要总链：A → B → C”。然后使用“摘要第1句（中文意译）”“摘要第2句（中文意译）”这样的短标题逐句覆盖；每句下面只写一个连贯段落，突出解释作者为什么在这里写它、想法来自哪项已知事实/文献/矛盾、承接上一句什么、新增了哪一步判断、怎样引出下一句或实验，以及这句话是材料直接支持、合理推断还是待正文核验。每句后追加“句子结构小结：语言结构——……；逻辑结构——……；写作意图（合理推断）——……”，摘要末尾追加“段落结构小结”。若拿到了 Introduction，则每段先给“引言第N段整体逻辑”，再解释段内每个可见句子并逐句小结，段末写“段落结构小结”，最后用一个连续段落讲清各段怎样合成全文选题逻辑；并说明所引文献为什么是当前论证必需而非普通背景堆砌。若只拿到摘要，必须明确写“当前未读取 Introduction 正文”，不能编造段落。用户给出的“背景—转折—缺口—特点—方向—猜想”只是一种可能，必须按本文实际情况增删、分叉或回环。

## 6. 作者怎样一步步证明
这是全文核心。沿 Methods/Experiments、Results 与 Discussion 的真实顺序写连续段落。每个关键实验都要讲清“先看到什么 → 为什么想到当前解释 → 所需知识是什么 → 为什么选择该指标、对照或方法 → 怎样落地实施 → 若假说成立应看到什么 → 实际结果是什么 → 排除了什么 → 还不能推出什么 → 为什么进入下一步”。不能把这些问题拆成字段清单。

遇到 NAD+/NADH、损失函数、识别变量、定理条件、消融、置信区间等真正影响理解的概念时，紧跟一个引用块：
> **知识讲解：概念名称**
> 用初学者能理解的语言说明定义、关键关系或反应式、本文为何需要它，以及理解它后怎样继续跟上作者的推理。只讲当前链条需要的知识，不写百科。

## 7. 科研逻辑图
用一段话指出全篇最短充分证明链是什么、哪里分叉、哪里通过反向或救援重新汇合。不要输出 ASCII、Mermaid 或代码图；只复用第 2 节的绘图数据，由网页生成成图。

## 8. 最强证据与逻辑缺口
用连续论证解释哪些证据把相关性推进为因果、证明或工程可信性，并做删除证据的反事实：删掉哪项实验后结论会降级。随后指出必要性、充分性、反向因果、混杂、测量伪影、数据泄漏、尺度迁移或外部效度中仍未闭合的部分。

## 9. 真正难点与跨领域知识桥
先讲透 2–3 个本文独有难点：为什么难、作者需要跨过什么认知或技术障碍、用了什么知识与证据、付出什么代价。然后只选 1–3 个具有相似因果结构的外领域对应，连续讲清“本文难点 → 为什么联想到该领域 → 两边变量/约束如何对应 → 哪里不能对应 → 怎样结合 → 能产生什么新解释或方案 → 最小验证与失败条件”。禁止只罗列学科名称。

## 10. 为什么达到该期刊或会议的证据门槛
把问题重要性、概念转折、不可替代证据、跨尺度验证和读者价值连成一段论证。必须写“从公开内容看可能因为”，不能虚构编辑或审稿人的心理；并说明删除哪一层证据后论文为何会降档。

## 11. 从逻辑缺口产生的新 Idea
最多给出 3 个 Idea。每个先用一段话解释“论文哪个断点 → 为什么想到新解释 → 借用了什么知识 → 怎样落地 → 什么结果支持或否定 → 失败能学到什么”，再附一条逻辑路径。不能只换数据集、模型名或应用场景；涉及最新颖性时标明仍需检索。

## 12. 可复现边界
用一段话说明公开数据、代码、权重和实验条件允许复现到哪一步，什么需要实验平台或作者资源。这里只给复现入口和边界；命令、文件、函数和 Figure/Table 验收步骤留给独立“代码复现”功能。

完成上述正文后，只在全文最末输出一次“可模仿结构框架：适用场景——……；写作骨架——[可替换槽位A] → [可替换槽位B] → [可替换槽位C]；仿写句式——‘……’；避免照搬——……”。它是学习迁移附录，不得反过来压缩、改写或模板化前面的论文分析；框架必须来自本文真实写法，并随论文类型变化。

排版纪律：不输出 <think>、任务复述、检查清单、Markdown 表格、代码块、ASCII 图或阶段小结；允许并要求“句子结构小结”“段落结构小结”“本部分写作结构总结”，全文最后只允许出现一次“可模仿结构框架”。不重复同一结论；主要使用连贯短段落。同一论证不拆点，独立论点才用 1️⃣、2️⃣、3️⃣；每节最多附一条逻辑路径，只有并列实验或 Idea 确实需要时才使用列表。

五个阶段的证据摘要：
${evidence}`.slice(0, 23500)
}

function withoutLeadingTitle(markdown: string) {
  return normalizePaperReport(markdown).replace(/^#\s+[^\n]+\n+/, '').trim()
}

function assembleFullReport(draft: PaperDraft, sections: { heading: string; answer: string }[]) {
  const body = sections
    .map((section, index) => `## 阶段 ${index + 1}：${section.heading}\n\n${withoutLeadingTitle(section.answer)}`)
    .join('\n\n---\n\n')
  return `# ${draft.title.trim()}：论文科研逻辑完整报告\n\n${body}`
}

function buildAuditPrompt(draft: PaperDraft, firstPass: string) {
  const auditScope = draft.module === 'reproduce'
    ? `本轮只输出“代码复现”报告，不得混入题目作者、综述逻辑、交叉知识桥或新 Idea。必须覆盖 Figure/Table 到数据、环境、文件/函数、命令、输出和验收指标的映射；环境、数据、预处理、训练、评估和图表复现各阶段末尾都要有“阶段小结”，全文最后有“代码复现总小结”。`
    : `本轮必须保留第一轮的十二部分叙事结构：论文信息与阅读边界、一眼看懂全文、题目分析、通讯作者研究轨迹、综述为什么这样写、作者怎样一步步证明、科研逻辑图、最强证据与逻辑缺口、真正难点与跨领域知识桥、期刊/会议证据门槛、新 Idea、可复现边界。每部分先写一段连续推理，再附至多一条关键链；不得改回字段清单、审稿清单或代码格式。同一论证必须留在同一段，用加粗逻辑词标出转折和推进；只有独立观点才用 1️⃣、2️⃣、3️⃣ 分段。每个关键实验必须解释观察如何产生想法、知识依据、指标选择、落地方式和下一步。保留有证据价值的“本部分写作结构总结”；可模仿框架只在全文末尾出现一次，不能支配或压缩正文。代码命令与逐文件复现仍由独立“代码复现”功能负责。`
  return `你现在是匿名顶刊审稿人、因果推断专家、复现工程师和跨学科方法学家组成的联合审稿组。下面是一份第一轮论文分析。不要为它辩护，也不要只做摘要；请先攻击，再重建为一份更严格、更深入、可复现的最终报告。

论文：${draft.title}
期刊/会议：${draft.venue || '未提供'}
研究领域：${draft.domain || '未提供'}

本次审稿范围：
${auditScope}

第二轮必须执行九次检查：
1. 类型与证据审计：先检查第一轮是否识别对了论文类型和逻辑拓扑；若把非线性、并行或混合论证硬改成顺序实验链，必须重新路由。再逐项找到把相关写成因果、把模型表现写成机制、把缺失证据写成事实、把期刊声望当作证据的地方。
2. 反向审计：从最终结论倒推到每个必要前提，找断链、循环论证、未控制混杂、尺度错配和选择性报告。
3. 中断审计：对核心变量设计 loss-of-function/去除/消融/政策冲击/边界反例，并设计反向操纵与救援；按论文类型选合适形式，不能机械套医学术语。
4. 交叉审计：比较生物、计算机、数学物理、工程控制、生态演化、经济学与博弈/计量视角。只有变量、约束、尺度和可观测量能映射的桥梁才保留。
5. 复现审计：逐 Figure/Table 检查数据、预处理、代码文件/函数、配置、随机性、泄漏、命令、预期输出和验收指标；未知内容必须标记，禁止发明。
6. 竞争解释审计：为每个核心主张建立替代解释树，检查第一轮是否真正用证据逐枝排除反向因果、共同原因、测量伪影、选择偏差、过拟合/泄漏与偶然性。没有被排除的必须保留，不能替作者补证据。
7. 顶刊降档审计：把每个主张配到 venue 的公开评价门槛，逐个移除关键干预/消融、救援/反例、外部验证、跨场景泛化和开放资源，判断结论会降到什么层级，找出支撑顶刊贡献的最小不可删除证据集。
8. 章节微逻辑审计：检查摘要、Introduction/综述、方法/实验、结果、讨论/结论是否分别回答了它们应承担的问题；逐项找出“有事实无推理”“有结论无证据”“有转折无前提”“有实验但不减少不确定性”的断点。
9. 模板污染审计：逐段检查是否把用户示例或常见顶刊套路硬套到本文。凡是与本文研究类型、证据形态或章节功能不匹配的分析都必须删除，并按论文自己的分叉、并行、回环或演绎结构重建。

最终输出不是审稿意见列表，而是严格服从上述审稿范围的修正版完整报告。第一轮中不属于本次范围的内容必须删除，不能为了显得全面重新混在一起。

排版与叙事硬约束：
- 禁止 Markdown 表格和任何竖线分隔表；把所有表格改写成纵向证据卡。
- 开头先写 200 字以内的“一眼看懂全文”，并给出论文原生逻辑身份和一条不超过 12 个节点的主线。
- 每个关键转折用连续段落解释“观察证据 -> 为什么想到 -> 必要知识 -> 为什么选该指标/方法 -> 如何落地 -> 得到什么 -> 排除什么 -> 还缺什么 -> 下一步”，禁止把这些词打印成字段清单。
- 同一推理中的句子不得拆成多个项目符号；用 **但是**、**因此**、**随后**、**这意味着** 等加粗逻辑词标出关系。只有相互独立的观点才用 1️⃣、2️⃣、3️⃣ 分段；关键链在网页中以紧凑的 ➡️ 单行显示。
- 每章开头承接上一章，结尾自然制造下一章必须回答的问题；最终报告必须像一条连续推理而不是互不相干的问题答案。
- 保留机器可解析的“机制节点/机制关系”和“逻辑路径 功能名：A → B → C”行，但不得放进代码块，网页会把它们转换为图形。

第一轮分析如下：
${firstPass.slice(0, 16000)}`.slice(0, 22000)
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
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>('analysis')
  const [analysisProgress, setAnalysisProgress] = useState('')
  const [checkpointProgress, setCheckpointProgress] = useState('')
  const [error, setError] = useState('')
  const [saveProjectId, setSaveProjectId] = useState(() => projects.find(project => project.system_key !== 'recycle')?.id ?? 0)
  const [saving, setSaving] = useState(false)
  const [savedIdeaId, setSavedIdeaId] = useState<number | null>(null)
  const [savedIdeaVersion, setSavedIdeaVersion] = useState('')
  const [reportDirty, setReportDirty] = useState(false)
  const [editingReport, setEditingReport] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [discoveryPreferences, setDiscoveryPreferences] = useState<DiscoveryPreferences>(loadDiscoveryPreferences)
  const [discovery, setDiscovery] = useState<PaperDiscoveryResult | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState('')
  const [paperMetadata, setPaperMetadata] = useState<PaperScholarlyContext | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [diagram, setDiagram] = useState<PaperDiagramArtifact | null>(() => loadPaperDiagram(loadDraft()))
  const [diagramUrl, setDiagramUrl] = useState('')
  const autoDiscoveryStarted = useRef(false)
  const metadataLookupKey = useRef('')
  const activeRunId = useRef('')
  const activeRunController = useRef<AbortController | null>(null)

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
    setDiagram(loadPaperDiagram(draft))
  }, [draft.title, draft.locator, draft.analysisDepth, draft.sourceText.length])

  useEffect(() => {
    if (!diagram?.svg) {
      setDiagramUrl('')
      return
    }
    const url = URL.createObjectURL(new Blob([diagram.svg], { type: 'image/svg+xml;charset=utf-8' }))
    setDiagramUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [diagram?.svg])

  useEffect(() => {
    const hasLegacyCheckpoint = LEGACY_CHECKPOINT_KEYS.some(key => Boolean(window.localStorage.getItem(key)))
    if (!hasLegacyCheckpoint) return
    LEGACY_CHECKPOINT_KEYS.forEach(key => window.localStorage.removeItem(key))
    setResult(null)
    setCheckpointProgress('已清除旧版阅读阶段；请按“先整体、后逐句”的新结构重新生成当前论文。')
  }, [])

  useEffect(() => {
    const checkpoint = loadPaperCheckpoint(draft)
    const sections = validPaperSections(checkpoint)
    const completed = sections.length
    const nextStage = fullAnalysisSections.findIndex(section => !sections.some(saved => saved.heading === section.heading))
    setCheckpointProgress(completed
      ? completed < fullAnalysisSections.length
        ? `已保存 ${completed}/${fullAnalysisSections.length} 个有效阅读阶段；可以继续生成阶段 ${nextStage + 1}。`
        : diagram
          ? '五个阅读阶段已经完成；科研逻辑图已生成，可以重新绘制。'
          : '五个阅读阶段已经完成；可以直接绘制科研逻辑图。'
      : '')
    if (checkpoint && completed > 0 && !result) {
      const latest = sections.at(-1)
      if (latest) setResult({
        ...latest.result,
        answer: partialStageReport(draft, sections),
        proposals: sections.flatMap(section => section.result.proposals),
      })
    }
  }, [draft.title, draft.locator, draft.analysisDepth, draft.sourceText.length, diagram])

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
    api.attachments(params).then(files => {
      setAvailableFiles(files)
      setSelectedFileIds(files.filter(file => file.exists).map(file => file.id))
    }).catch(() => setAvailableFiles([]))
  }, [scope])

  useEffect(() => {
    if (!activeProjects.some(project => project.id === saveProjectId)) setSaveProjectId(activeProjects[0]?.id ?? 0)
  }, [activeProjects, saveProjectId])

  useEffect(() => {
    if (autoDiscoveryStarted.current || !discoveryPreferences.autoRefresh || !discoveryPreferences.query.trim()) return
    autoDiscoveryStarted.current = true
    void searchPapers(discoveryPreferences)
  }, [discoveryPreferences])

  useEffect(() => {
    const needsTranslation = Boolean(
      status?.configured
      && (!draft.titleZh.trim() || !draft.authorDirectionSummary.trim() || (draft.sourceText.trim() && !draft.sourceTextZh.trim()))
    )
    const key = `${draft.title.trim()}|${draft.locator.trim()}|${needsTranslation ? 'translate' : 'metadata'}`
    if (draft.title.trim().length < 8 || metadataLookupKey.current === key) return
    if (draft.venue.trim() && draft.sourceText.trim() && draft.scholarlyContext.trim() && draft.authorDirectionSummary.trim() && !needsTranslation) return
    const timer = window.setTimeout(() => {
      void enrichPaper(draft, false).catch(() => undefined)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [draft.title, draft.locator, draft.sourceText, draft.sourceTextZh, draft.titleZh, draft.authorDirectionSummary, status?.configured])

  function update<K extends keyof PaperDraft>(key: K, value: PaperDraft[K]) {
    if (key === 'title' || key === 'locator') {
      metadataLookupKey.current = ''
      setPaperMetadata(null)
    }
    setDraft(current => key === 'title' || key === 'locator' ? { ...current, [key]: value, scholarlyContext: '', authorDirectionSummary: '' } : { ...current, [key]: value })
  }

  async function enrichPaper(targetDraft: PaperDraft = draft, reportError = true, signal?: AbortSignal) {
    const key = `${targetDraft.title.trim()}|${targetDraft.locator.trim()}|${status?.configured ? 'translate' : 'metadata'}`
    metadataLookupKey.current = key
    setMetadataLoading(true)
    try {
      const params = new URLSearchParams({ title: targetDraft.title, locator: targetDraft.locator })
      const context = await api.paperContext(params, signal)
      const scholarlyContext = formatScholarlyContext(context)
      let enriched: PaperDraft = {
        ...targetDraft,
        title: context.matched_title || targetDraft.title,
        titleZh: '',
        locator: targetDraft.locator || context.url || (context.doi ? `https://doi.org/${context.doi}` : ''),
        venue: targetDraft.venue || context.venue,
        venueZh: '',
        sourceText: targetDraft.sourceText || context.abstract,
        sourceTextZh: '',
        scholarlyContext,
        authorDirectionSummary: '',
      }
      if (status?.configured) {
        try {
          const automatic = await api.enrichPaper({
            title: enriched.title,
            venue: enriched.venue,
            abstract: enriched.sourceText,
            topic: discoveryPreferences.query,
            scholarly_context: scholarlyContext,
          }, signal)
          enriched = {
            ...enriched,
            titleZh: automatic.title_zh,
            venueZh: automatic.venue_zh,
            sourceTextZh: automatic.abstract_zh,
            studyType: automatic.study_type || 'auto',
            domain: automatic.domain_zh || discoveryPreferences.query,
            crossDomainClues: automatic.cross_domain_clues_zh,
            goal: automatic.goal_zh || defaultDraft.goal,
            journalProfile: journalProfiles[automatic.journal_profile] ? automatic.journal_profile : 'adaptive',
            authorDirectionSummary: automatic.author_direction_summary_zh,
          }
        } catch (translationError) {
          if (reportError) setError(translationError instanceof Error ? translationError.message : '论文中文翻译暂时无法生成。')
        }
      }
      setPaperMetadata(context)
      setDraft(enriched)
      return enriched
    } catch (reason) {
      if (reportError) setError(reason instanceof Error ? reason.message : '论文元数据暂时无法获取。')
      throw reason
    } finally {
      setMetadataLoading(false)
    }
  }

  async function run(targetDraft: PaperDraft = draft) {
    if (!targetDraft.title.trim() || !status?.configured) return
    const requestId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `paper-${Date.now()}`
    const controller = new AbortController()
    let completedStageCount = 0
    activeRunId.current = requestId
    activeRunController.current = controller
    setRunning(true); setStopping(false); setError(''); setSavedIdeaId(null); setSavedIdeaVersion(''); setReportDirty(false); setEditingReport(false)
    try {
      let groundedDraft = targetDraft
      const needsGrounding = groundedDraft.module === 'reproduce'
        ? !groundedDraft.venue.trim() || !groundedDraft.sourceText.trim()
        : !groundedDraft.scholarlyContext.trim() || !groundedDraft.venue.trim() || !groundedDraft.sourceText.trim()
      if (needsGrounding) {
        setAnalysisStage('grounding')
        try {
          groundedDraft = await enrichPaper(groundedDraft, false, controller.signal)
        } catch (reason) {
          if (controller.signal.aborted) throw reason
          const note = reason instanceof Error ? reason.message : '学术轨迹元数据暂时不可用。'
          groundedDraft = { ...groundedDraft, scholarlyContext: `自动核验未完成：${note}\n通讯作者与近年研究轨迹必须在原文、作者主页或 ORCID 中人工核验。` }
          setDraft(groundedDraft)
        }
      }
      const mode: AgentMode = groundedDraft.module === 'causal' ? 'critique' : 'synthesize'
      const targetJournal = journalProfiles[groundedDraft.journalProfile] || journalProfiles.general
      const execute = (prompt: string, requestMode: AgentMode = mode, maxOutputTokens = 8192) => api.runAgent({
        request_id: requestId,
        prompt, mode: requestMode,
        scope_type: scope.type, scope_id: scope.type === 'all' ? null : scope.id,
        idea_id: null, model: status.default_model, reasoning_effort: status.reasoning_effort,
        max_output_tokens: maxOutputTokens,
        include_library_context: false,
        web_search: webSearch, attachment_ids: selectedFileIds,
      }, controller.signal)
      const executeWithRetry = async (prompt: string, requestMode: AgentMode, maxOutputTokens: number, label: string) => {
        try {
          return await execute(prompt, requestMode, maxOutputTokens)
        } catch (reason) {
          if (controller.signal.aborted || !isProviderTimeout(reason)) throw reason
          setAnalysisProgress(`${label}超时，正在自动压缩并重试一次…`)
          const compactPrompt = `${prompt}\n\n这是超时后的自动压缩重试。保留关键证据与完整逻辑衔接，删除重复解释；阅读阶段控制在 900 个中文字以内，最终汇总只保留必要内容。不要输出思考过程。`.slice(0, 23900)
          const compactLimit = Math.max(2048, Math.floor(maxOutputTokens * 0.7))
          return execute(compactPrompt, requestMode, compactLimit)
        }
      }

      let finalResult: AgentRunResult
      if (groundedDraft.module === 'full') {
        const checkpoint = loadPaperCheckpoint(groundedDraft)
        const sectionResults = validPaperSections(checkpoint)
        completedStageCount = sectionResults.length

        if (sectionResults.length < fullAnalysisSections.length) {
          const index = fullAnalysisSections.findIndex(section => !sectionResults.some(saved => saved.heading === section.heading))
          const section = fullAnalysisSections[index]
          setAnalysisStage('section')
          setAnalysisProgress(`正在分阶段阅读 ${index + 1}/${fullAnalysisSections.length}：${section.label}`)
          const sectionResult = await executeWithRetry(
            buildSectionPrompt(groundedDraft, targetJournal.logic, webSearch, section),
            section.module === 'causal' ? 'critique' : 'synthesize',
            4096,
            `第 ${index + 1} 阶段“${section.label}”`,
          )
          const normalizedSectionResult = { ...sectionResult, answer: normalizePaperReport(sectionResult.answer) }
          if (!hasSubstantivePaperAnswer(normalizedSectionResult.answer)) {
            throw new Error(`第 ${index + 1} 阶段没有返回有效正文，未计入完成进度；请重试当前阶段。`)
          }
          sectionResults.push({ heading: section.heading, answer: normalizedSectionResult.answer, result: normalizedSectionResult })
          sectionResults.sort((left, right) => fullAnalysisSections.findIndex(section => section.heading === left.heading) - fullAnalysisSections.findIndex(section => section.heading === right.heading))
          completedStageCount = sectionResults.length
          savePaperCheckpoint(groundedDraft, sectionResults)
          setCheckpointProgress(completedStageCount < fullAnalysisSections.length
            ? `已保存 ${completedStageCount}/${fullAnalysisSections.length} 个阅读阶段；请查看输出，再决定是否继续。`
            : '五个阅读阶段已经保存；可以直接绘制科研逻辑图。')
          setResult({
            ...normalizedSectionResult,
            answer: partialStageReport(groundedDraft, sectionResults),
            proposals: sectionResults.flatMap(item => item.result.proposals),
          })
          return
        }

        const latest = sectionResults.at(-1)!.result
        finalResult = {
          ...latest,
          answer: partialStageReport(groundedDraft, sectionResults),
          proposals: sectionResults.flatMap(section => section.result.proposals),
        }
        setResult(finalResult)
        setCheckpointProgress('五个阅读阶段已经完成；可以直接绘制科研逻辑图。')
        return
      } else {
        setAnalysisStage('analysis')
        setAnalysisProgress(groundedDraft.module === 'reproduce' ? '正在生成独立的可执行复现指南…' : '正在进行第一轮深度拆解…')
        const firstPass = await executeWithRetry(buildPrompt(groundedDraft, targetJournal.logic, webSearch), mode, 8192, '第一轮分析')
        finalResult = { ...firstPass, answer: normalizePaperReport(firstPass.answer) }
        setResult(finalResult)
        if (groundedDraft.module !== 'reproduce' && groundedDraft.analysisDepth === 'adversarial') {
          setAnalysisStage('audit')
          setAnalysisProgress('正在进行第二轮对抗审稿…')
          const audited = await executeWithRetry(buildAuditPrompt(groundedDraft, firstPass.answer), 'critique', 8192, '第二轮对抗审稿')
          finalResult = { ...audited, answer: normalizePaperReport(audited.answer) }
          setResult(finalResult)
        }
        const missing = missingPaperSections(finalResult.answer, groundedDraft.module)
        if (missing.length) {
          setAnalysisStage('repair')
          setAnalysisProgress('正在补齐缺失模块并重建报告…')
          const repaired = await executeWithRetry(buildCoverageRepairPrompt(groundedDraft, finalResult.answer, missing), 'critique', 8192, '报告补全')
          finalResult = { ...repaired, answer: normalizePaperReport(repaired.answer) }
          setResult(finalResult)
        }
      }
    } catch (reason) {
      if (controller.signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) {
        setError('已停止本次分析。论文信息、旧报告和已经保存的内容均已保留。')
      } else {
        const message = reason instanceof Error ? reason.message : 'Paper analysis failed'
        setError(targetDraft.module === 'full' && completedStageCount
          ? `${message} 已保存 ${completedStageCount}/${fullAnalysisSections.length} 个阅读阶段；再次点击继续时不会重新生成前面的内容。`
          : message)
      }
    } finally {
      if (activeRunId.current === requestId) {
        activeRunId.current = ''
        activeRunController.current = null
        setRunning(false)
        setStopping(false)
        setAnalysisProgress('')
      }
    }
  }

  async function drawResearchLogicDiagram() {
    const checkpoint = loadPaperCheckpoint(draft)
    const sections = validPaperSections(checkpoint)
    if (sections.length !== fullAnalysisSections.length) {
      setError('请先完成五个论文分析阶段，再绘制科研逻辑图。')
      return
    }
    if (!status?.configured) {
      setError('请先配置 Agent 模型，再绘制科研逻辑图。')
      return
    }
    const requestId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `paper-diagram-${Date.now()}`
    const controller = new AbortController()
    activeRunId.current = requestId
    activeRunController.current = controller
    setRunning(true); setStopping(false); setError(''); setAnalysisStage('diagram'); setAnalysisProgress('正在提取论文专属逻辑并绘制 Inkscape 矢量图…')
    try {
      const response = await api.runAgent({
        request_id: requestId,
        prompt: buildDiagramPrompt(draft, sections),
        mode: 'synthesize',
        scope_type: scope.type,
        scope_id: scope.type === 'all' ? null : scope.id,
        idea_id: null,
        model: status.default_model,
        reasoning_effort: status.reasoning_effort,
        max_output_tokens: 4096,
        include_library_context: false,
        web_search: false,
        attachment_ids: [],
      }, controller.signal)
      const spec = parsePaperDiagramSpec(response.answer, draft)
      const artifact: PaperDiagramArtifact = {
        version: 1,
        identity: checkpointIdentity(draft),
        generatedAt: new Date().toISOString(),
        spec,
        svg: renderInkscapeSvg(spec),
      }
      savePaperDiagram(draft, artifact)
      setDiagram(artifact)
      if (savedIdeaId) setReportDirty(true)
      setCheckpointProgress('五个阅读阶段已经完成；科研逻辑图已生成，可以重新绘制。')
    } catch (reason) {
      if (controller.signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) {
        setError('已停止绘图；五个阶段的分析内容仍完整保留。')
      } else {
        setError(reason instanceof Error ? reason.message : '科研逻辑图生成失败，请重试。')
      }
    } finally {
      if (activeRunId.current === requestId) {
        activeRunId.current = ''
        activeRunController.current = null
        setRunning(false)
        setStopping(false)
        setAnalysisProgress('')
      }
    }
  }

  function downloadResearchLogicDiagram() {
    if (!diagram?.svg) return
    const url = URL.createObjectURL(new Blob([diagram.svg], { type: 'image/svg+xml;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = diagramFilename(draft.titleZh || draft.title)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function stopAnalysis() {
    if (!running || stopping) return
    setStopping(true)
    const requestId = activeRunId.current
    const cancellation = requestId ? api.cancelAgentRun(requestId) : Promise.resolve({ cancelled: false })
    activeRunController.current?.abort()
    await cancellation.catch(() => undefined)
  }

  async function runModule(module: PaperModule) {
    if (module === 'full' && validPaperSections(loadPaperCheckpoint(draft)).length === fullAnalysisSections.length) {
      if (!diagram) await drawResearchLogicDiagram()
      return
    }
    const nextDraft = { ...draft, module }
    setDraft(nextDraft)
    await run(nextDraft)
  }

  async function searchPapers(preferences: DiscoveryPreferences = discoveryPreferences) {
    if (!preferences.query.trim()) return
    setDiscovering(true); setDiscoveryError('')
    try {
      const fromYear = Math.min(new Date().getFullYear() + 1, Math.max(1900, preferences.fromYear || defaultDiscovery.fromYear))
      const params = new URLSearchParams({
        q: preferences.query.trim(),
        venues: '',
        from_year: String(fromYear),
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
      titleZh: '',
      locator: paper.doi ? `https://doi.org/${paper.doi}` : paper.url,
      venue: paper.venue,
      venueZh: '',
      journalProfile: 'adaptive',
      studyType: 'auto',
      domain: discoveryPreferences.query,
      crossDomainClues: '',
      sourceText: paper.abstract,
      sourceTextZh: '',
      scholarlyContext: '',
      authorDirectionSummary: '',
      goal: defaultDraft.goal,
      module: 'full',
      analysisDepth: 'deep',
    }
    setPaperMetadata({
      paper_id: paper.id,
      matched_title: paper.title,
      publication_year: paper.year,
      publication_date: paper.publication_date,
      venue: paper.venue,
      abstract: paper.abstract,
      doi: paper.doi,
      url: paper.url,
      pdf_url: '',
      authors: paper.authors,
      corresponding_authors: [],
      recent_works: [],
      evidence_note: '候选论文元数据来自论文雷达；通讯作者信息将在运行分析时单独核验。',
      source: paper.metadata_sources.join(' + '),
    })
    metadataLookupKey.current = ''
    setDraft(nextDraft)
    setSavedIdeaId(null)
    setSavedIdeaVersion('')
    setReportDirty(false)
    setEditingReport(false)
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
      const title = `${draft.module === 'reproduce' ? 'Paper reproduction' : 'Paper reading'}: ${draft.title.trim()}`.slice(0, 240)
      const tags = draft.module === 'reproduce'
        ? ['paper-reproduction', 'reproduction']
        : ['paper-reading', draft.module === 'cross_domain' ? 'cross-disciplinary' : 'research-logic', 'literature']
      const content = reportContentWithDiagram(result.answer, draft.module === 'reproduce' ? null : diagram)
      const saved = savedIdeaId
        ? await api.updateIdea(savedIdeaId, {
          title, content, status: 'exploring', tags,
          expected_updated_at: savedIdeaVersion || undefined,
        })
        : await api.createIdea({
          title,
          content,
          raw_text: [draft.title, draft.locator, draft.sourceText].filter(Boolean).join('\n\n'),
          status: 'exploring',
          tags,
          project_id: saveProjectId,
        })
      setSavedIdeaId(saved.id)
      setSavedIdeaVersion(saved.updated_at)
      setReportDirty(false)
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

  const sourceUrl = paperMetadata?.url || paperHref(draft.locator)
  const pdfUrl = paperMetadata?.pdf_url || ''
  const displayedAbstract = paperMetadata?.abstract || draft.sourceText
  const displayedVenue = paperMetadata?.venue || draft.venue
  const activeCheckpoint = loadPaperCheckpoint(draft)
  const activeSections = validPaperSections(activeCheckpoint)
  const completedCheckpointStages = activeSections.length
  const nextCheckpointStage = fullAnalysisSections.findIndex(section => !activeSections.some(saved => saved.heading === section.heading))
  const continueLabel = completedCheckpointStages >= fullAnalysisSections.length
      ? diagram ? '' : '使用 Inkscape 绘制科研逻辑图'
      : completedCheckpointStages
        ? `继续生成阶段 ${nextCheckpointStage + 1}`
        : ''

  return <div className="modal-backdrop paper-lab-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="paper-lab">
      <header className="paper-lab-header"><div><p className="eyebrow">PAPER REASONING WORKSPACE</p><h2><BookOpenText size={25}/> Paper Lab</h2><p>Evidence-first reading, causal reconstruction, code mapping, and idea synthesis.</p></div><button className="icon-button" onClick={onClose} aria-label="Close Paper Lab"><X size={20}/></button></header>
      <div className="paper-lab-body">
        <aside className="paper-lab-inputs">
          <section className="paper-radar">
            <div className="paper-radar-heading"><div><strong>Hugging Face 论文雷达</strong><span>搜索 Papers，并自动筛选与补全</span></div><a href="https://huggingface.co/papers/trending" target="_blank" rel="noreferrer" title="打开 Hugging Face Trending Papers"><ExternalLink size={17}/></a></div>
            <label>你想跟进的研究主题<input value={discoveryPreferences.query} onChange={event => setDiscoveryPreferences(current => ({ ...current, query: event.target.value }))} placeholder="直接搜索 Hugging Face Papers，例如 brain-computer interface foundation model"/></label>
            <div className="paper-topic-suggestions"><span>关键词提示</span><button type="button" onClick={() => setDiscoveryPreferences(current => ({ ...current, query: 'EEG emotion recognition cross-subject generalization' }))}>跨受试者情绪识别</button><button type="button" onClick={() => setDiscoveryPreferences(current => ({ ...current, query: 'brain-computer interface foundation model EEG' }))}>脑机接口基础模型</button><button type="button" onClick={() => setDiscoveryPreferences(current => ({ ...current, query: 'multimodal neural decoding causal mechanism' }))}>多模态神经解码</button></div>
            <label>目标期刊或会议<span>自动识别</span><input readOnly value="系统根据检索结果与论文类型自动匹配"/></label>
            <div className="paper-radar-controls"><label>起始年份<span>可手动调整</span><input type="number" min="1900" max={new Date().getFullYear() + 1} value={discoveryPreferences.fromYear || ''} onChange={event => setDiscoveryPreferences(current => ({ ...current, fromYear: event.target.value === '' ? 0 : Number(event.target.value) }))} onBlur={() => setDiscoveryPreferences(current => ({ ...current, fromYear: Math.min(new Date().getFullYear() + 1, Math.max(1900, current.fromYear || defaultDiscovery.fromYear)) }))}/></label><label className="paper-radar-auto"><input type="checkbox" checked disabled/> 每次打开自动更新</label></div>
            <p className="paper-auto-note"><Sparkles size={13}/> 优先搜索 Hugging Face Papers，并补全题目、作者、摘要、热度、代码、原文链接和通讯作者轨迹；网络不可用时自动切换学术元数据源。</p>
            <button className="button secondary paper-discover" disabled={discovering || !discoveryPreferences.query.trim()} onClick={() => void searchPapers()}>{discovering ? <LoaderCircle className="spin" size={15}/> : <Search size={15}/>} 搜索 Hugging Face Papers</button>
            {discoveryError && <p className="paper-radar-error">{discoveryError}</p>}
            {discovery && <div className="paper-discovery-results">
              <div className="paper-discovery-summary"><span>{discovery.papers.length} 篇候选</span><span>{discovery.sources.join(' + ')}</span></div>
              {discovery.warnings.map(warning => <p className="paper-radar-warning" key={warning}>{warning}</p>)}
              {discovery.papers.length === 0 ? <p className="paper-radar-empty">没有找到同时满足关键词、期刊和年份的论文，请放宽期刊或年份。</p> : discovery.papers.map(paper => <article className="paper-candidate" key={paper.id}>
                <div className="paper-candidate-meta"><span>{paper.year || '日期未知'}</span><span>{paper.venue || '期刊待核验'}</span>{paper.upvotes > 0 && <span>HF {paper.upvotes} 赞</span>}<span>{paper.cited_by_count} 引用</span></div>
                <strong>{paper.title}</strong>
                <p>{paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ' 等' : ''}</p>
                <div className="paper-candidate-reasons">{paper.match_reasons.map(reason => <span key={reason}>{reason}</span>)}</div>
                <footer><a href={paper.url} target="_blank" rel="noreferrer" title="打开 Hugging Face 论文页或原文"><ExternalLink size={13}/></a>{paper.github_url && <a href={paper.github_url} target="_blank" rel="noreferrer" title="打开论文代码"><Code2 size={13}/></a>}{paper.project_url && <a href={paper.project_url} target="_blank" rel="noreferrer" title="打开论文项目页"><Globe2 size={13}/></a>}<button className="button secondary small" onClick={() => void useDiscoveredPaper(paper, false)}>查看论文</button><button className="button primary small" disabled={running} onClick={() => void useDiscoveredPaper(paper, true)}><Sparkles size={13}/> 自动补全并单轮深拆</button></footer>
              </article>)}
            </div>}
          </section>
          <div className="paper-source-heading"><strong>自动补全状态</strong><div><span>{scopeName}</span>{metadataLoading && <LoaderCircle className="spin" size={12}/>}</div></div>
          <label>Paper title（英文原题）<input readOnly value={draft.title} placeholder="选择论文后自动获取"/></label>
          <label>论文标题（自动中文翻译）<input readOnly value={draft.titleZh} placeholder={metadataLoading ? '正在翻译…' : '选择论文后自动翻译'}/></label>
          <label>DOI, URL, or arXiv ID<input readOnly value={draft.locator} placeholder="选择论文后自动获取"/></label>
          <label>Exact journal or conference<input readOnly value={[draft.venue, draft.venueZh].filter(Boolean).join(' / ')} placeholder="选择论文后自动获取并翻译"/></label>
          <div className="paper-field-grid"><label>Reasoning profile<select disabled value={draft.journalProfile}>{Object.entries(journalProfiles).map(([id, item]) => <option value={id} key={id}>{item.label}</option>)}</select></label><label>Study design<input readOnly value={draft.studyType === 'auto' ? '系统将按论文自动识别' : draft.studyType}/></label></div>
          <label>Research domain<input readOnly value={draft.domain} placeholder="根据主题与论文自动识别"/></label>
          <label>Known bottleneck or cross-field clue<textarea readOnly rows={3} value={draft.crossDomainClues} placeholder="系统根据所选论文自动识别难点与跨领域线索"/></label>
          <label>通讯作者与近年研究轨迹<span>OpenAlex 自动核验</span><textarea readOnly rows={5} value={draft.scholarlyContext} placeholder="选择论文后自动获取；未明确标注时不会按作者顺序猜测"/></label>
          <label>通讯作者研究方向总结<span>基于近年论文自动归纳</span><textarea readOnly rows={5} value={draft.authorDirectionSummary} placeholder={metadataLoading ? '正在归纳研究主线…' : '选择论文后自动总结稳定问题、方法演变、本文位置与可能延伸'}/></label>
          <label>Abstract / 摘要<span>英文后自动附中文翻译</span><textarea readOnly rows={10} value={[
            draft.sourceText ? `English\n${draft.sourceText}` : '',
            draft.sourceTextZh ? `中文翻译\n${draft.sourceTextZh}` : '',
          ].filter(Boolean).join('\n\n')} placeholder={metadataLoading ? '正在获取并翻译摘要…' : '选择论文后自动获取真实摘要并翻译'}/></label>
          <label>Your goal / 分析目标<textarea readOnly rows={3} value={draft.goal}/></label>

          <div className="paper-module-heading"><strong>一键分析</strong><span>深度分析与代码复现分开运行</span></div>
          <nav className="paper-modules paper-action-modules" aria-label="Paper analysis route">{modules.map(item => <button className={draft.module === item.id ? 'active' : ''} disabled={running || !draft.title.trim() || !status?.configured} onClick={() => void runModule(item.id)} key={item.id}>{running && draft.module === item.id ? <LoaderCircle className="spin" size={16}/> : moduleIcon(item.id)}<span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</nav>

          {availableFiles.length > 0 && <details className="paper-files"><summary><Code2 size={14}/> Reproduction files <span>{selectedFileIds.length} selected</span></summary><p>Select text or code files intentionally. PDFs currently contribute metadata only.</p><div>{availableFiles.map(file => <label className={!file.exists ? 'missing' : ''} key={file.id}><input type="checkbox" disabled={!file.exists} checked={selectedFileIds.includes(file.id)} onChange={event => setSelectedFileIds(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))}/><FileText size={14}/><span>{file.display_name}<small>{file.absolute_path}</small></span></label>)}</div></details>}

          {status && <div className={`paper-agent-status ${status.configured ? 'ready' : ''}`}><Sparkles size={15}/><div><strong>{status.configured ? `${status.provider_label} · ${status.default_model}` : 'Agent connection required'}</strong><span>{status.configured ? status.web_search_supported ? 'Provider can verify sources with web search.' : 'No provider web search: author history and exact results will be marked for verification.' : 'Configure a provider before running Paper Lab.'}</span></div>{!status.configured && <button onClick={onOpenAgent}>Configure</button>}</div>}
          {status?.configured && <label className="paper-web-toggle" title="由系统根据模型能力自动设置"><input type="checkbox" checked={webSearch} disabled/><Globe2 size={14}/> {status.web_search_supported ? '模型联网核验已自动开启' : '当前模型不支持联网搜索；未核验内容会明确标注'}</label>}
          {draft.module === 'reproduce'
            ? <div className="paper-depth"><div><strong>独立复现模式</strong><span>只生成环境、数据、代码、运行、对齐和排错步骤，不重复论文深度分析</span></div><div><button className="active" disabled>复现执行</button></div></div>
            : <div className="paper-depth"><div><strong>分析严谨度</strong><span>全链路会分阶段阅读；双轮模式在最终汇总时追加对抗审稿</span></div><div><button className={draft.analysisDepth === 'deep' ? 'active' : ''} onClick={() => update('analysisDepth', 'deep')}>单轮深拆</button><button className={draft.analysisDepth === 'adversarial' ? 'active' : ''} onClick={() => update('analysisDepth', 'adversarial')}>双轮对抗审稿</button></div></div>}
          {running && <div className="paper-running-stage"><span><LoaderCircle className="spin" size={15}/>{analysisProgress || (analysisStage === 'grounding' ? '正在核验论文与作者…' : '正在分析论文…')}</span><button type="button" disabled={stopping} onClick={() => void stopAnalysis()} title="停止当前分析" aria-label="停止当前分析"><Square size={11} fill="currentColor"/>{stopping ? '正在停止' : '停止'}</button></div>}
          {checkpointProgress && <div className="paper-checkpoint-status"><span><Save size={13}/>{checkpointProgress}</span>{continueLabel && !running && <button className="button primary small" type="button" onClick={() => completedCheckpointStages >= fullAnalysisSections.length ? void drawResearchLogicDiagram() : void run(draft)}>{completedCheckpointStages >= fullAnalysisSections.length ? <Network size={13}/> : <Sparkles size={13}/>} {continueLabel}</button>}</div>}
        </aside>

        <section className="paper-lab-output">
          {error && <div className="error-banner">{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
          {draft.title.trim() && <section className="paper-source-card">
            <div className="paper-source-card-icon"><BookOpenText size={20}/></div>
            <div className="paper-source-card-body">
              <span className="paper-source-card-label">当前论文</span>
              <h3>{draft.title}</h3>
              {draft.titleZh && <p className="paper-source-title-zh">{draft.titleZh}</p>}
              <div className="paper-source-card-meta">
                {displayedVenue && <span>{displayedVenue}</span>}
                {paperMetadata?.publication_year ? <span>{paperMetadata.publication_year}</span> : null}
                {paperMetadata?.authors.length ? <span>{paperMetadata.authors.slice(0, 4).join(', ')}{paperMetadata.authors.length > 4 ? ' 等' : ''}</span> : null}
                {paperMetadata?.source && <span>元数据：{paperMetadata.source}</span>}
              </div>
              {displayedAbstract ? <details open><summary>摘要 / Abstract</summary><div className="paper-bilingual-abstract"><section><strong>English</strong><p>{displayedAbstract}</p></section>{draft.sourceTextZh && <section><strong>中文翻译</strong><p>{draft.sourceTextZh}</p></section>}</div></details> : <p className="paper-source-missing">暂未从所选论文的公开元数据源获取摘要；系统不会编造摘要。</p>}
            </div>
            <div className="paper-source-card-actions">
              {sourceUrl && <a className="button primary small" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/> 查看论文原文</a>}
              {pdfUrl && pdfUrl !== sourceUrl && <a className="button secondary small" href={pdfUrl} target="_blank" rel="noreferrer"><FileText size={14}/> 打开 PDF</a>}
            </div>
          </section>}
          {!result ? <div className="paper-empty"><ShieldAlert size={28}/><h3>Build the evidence chain before trusting the story</h3><ol><li><strong>Ground</strong><span>Add the exact title and as much source text as you have.</span></li><li><strong>Reconstruct</strong><span>Match the paper's claims to the proof standard of its field and venue.</span></li><li><strong>Challenge</strong><span>Find the counterfactual, failure case, or competing explanation.</span></li><li><strong>Bridge</strong><span>Abstract the bottleneck and test knowledge transfers from other fields.</span></li><li><strong>Reproduce</strong><span>Map figures to data, code, commands, outputs, and acceptance checks.</span></li><li><strong>Extend</strong><span>Turn unresolved boundaries into testable ideas for your own work.</span></li></ol></div> : <>
            <div className="paper-result-head"><div><span>Current report</span><strong>{modules.find(item => item.id === draft.module)?.label}</strong></div><div><span>{result.provider}</span><span>{result.model}</span><span>{result.context_summary.files} files</span><button className="paper-edit-toggle" type="button" onClick={() => setEditingReport(current => !current)}><Pencil size={12}/>{editingReport ? '完成编辑' : '编辑报告'}</button></div></div>
            {running && <div className="paper-refreshing"><span><LoaderCircle className="spin" size={14}/> 新分析正在运行，旧报告会继续保留。</span><button type="button" disabled={stopping} onClick={() => void stopAnalysis()}><Square size={11} fill="currentColor"/>{stopping ? '正在停止' : '停止'}</button></div>}
            {diagram && diagramUrl && <section className="paper-inkscape-diagram"><header><div><span>INKSCAPE SVG</span><strong>{diagram.spec.title}</strong><p>{diagram.spec.subtitle}</p></div><button className="button secondary small" type="button" onClick={downloadResearchLogicDiagram}><Download size={14}/> 下载 SVG</button></header><figure><img src={diagramUrl} alt={`${diagram.spec.title}科研逻辑图`}/><figcaption>{diagram.spec.conclusion}</figcaption></figure></section>}
            <section className="paper-save"><div><strong>{savedIdeaId ? reportDirty ? '报告有尚未保存的修改' : '这篇论文分析已保存' : '保存这篇论文分析'}</strong><span>{savedIdeaId ? reportDirty ? '点击更新，将手动补充保存回同一条 Paper Lab 记录。' : '下次从 Paper Lab 的 ideas 列表直接打开，不需要重新调用模型。' : '选择一个项目后保存完整报告，关闭电脑后仍会保留在本地数据库。'}</span></div><div>{!savedIdeaId && <select value={saveProjectId} onChange={event => setSaveProjectId(Number(event.target.value))}>{activeProjects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select>}{savedIdeaId && <button className="button secondary small" onClick={() => onIdeaSelect(savedIdeaId)}><Check size={14}/> 打开已保存分析</button>}{(!savedIdeaId || reportDirty) && <button className="button primary small" disabled={saving || !saveProjectId} onClick={() => void saveReport()}>{saving ? <LoaderCircle className="spin" size={14}/> : <Save size={14}/>} {savedIdeaId ? '更新保存' : '保存到 Paper Lab'}</button>}</div></section>
            {editingReport ? <section className="paper-report-editor"><label htmlFor="paper-report-source">编辑 Markdown 报告</label><textarea id="paper-report-source" value={result.answer} onChange={event => { setResult(current => current ? { ...current, answer: event.target.value } : current); setReportDirty(true) }} spellCheck={false}/><p>修改后点击“完成编辑”预览；已经保存过的报告需要再点“更新保存”。</p></section> : <article className="markdown paper-report"><IdeaMarkdown content={result.answer} ideas={ideas} attachments={availableFiles} onIdeaSelect={onIdeaSelect} onFileOpen={id => void api.openAttachment(id)}/></article>}
            {result.proposals.length > 0 && <section className="paper-proposals"><header><strong>Candidate ideas</strong><span>Nothing changes until you approve it.</span></header>{result.proposals.map(proposal => <article className={`agent-proposal ${proposal.status}`} key={proposal.id}><div><span>{proposal.action_type.replaceAll('_', ' ')}</span><strong>{proposal.title}</strong><p>{proposal.rationale}</p><small>{proposalPreview(proposal)}</small></div>{proposal.status === 'pending' ? <aside><button className="button secondary small" onClick={() => void resolve(proposal, 'dismiss')}>Dismiss</button><button className="button primary small" onClick={() => void resolve(proposal, 'apply')}><Check size={14}/> Apply</button></aside> : <em>{proposal.status}</em>}</article>)}</section>}
          </>}
        </section>
      </div>
    </section>
  </div>
}
