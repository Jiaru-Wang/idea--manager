import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, Check, Code2, ExternalLink, FileSearch, FileText, FlaskConical, GitFork, Globe2, Lightbulb, LoaderCircle, Network, Save, Search, ShieldAlert, Sparkles, UserRoundSearch, X } from 'lucide-react'
import { api } from '../api'
import { IdeaMarkdown } from './IdeaMarkdown'
import './PaperWorkspace.css'
import type { AgentMode, AgentProposal, AgentRunResult, AgentStatus, Attachment, DiscoveredPaper, Idea, PaperDiscoveryResult, PaperScholarlyContext, Project, ProjectGroup } from '../types'

type Scope = { type: 'all' } | { type: 'project'; id: number } | { type: 'group'; id: number }
type PaperModule = 'full' | 'title_author' | 'introduction' | 'causal' | 'cross_domain' | 'reproduce' | 'ideas'

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

const DRAFT_KEY = 'ideaminer-paper-lab-draft-v1'
const DISCOVERY_KEY = 'ideaminer-paper-discovery-v1'

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
  analysisDepth: 'adversarial',
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
      fromYear: new Date().getFullYear() - 3,
      autoRefresh: true,
    }
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
  let fenced = false
  return markdown.split('\n').flatMap(line => {
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

  requireMatch('论文结构与科研逻辑总图', /论文结构与科研逻辑总图/)
  requireMatch('正向证明路线', /正向(?:证明)?(?:路线|逻辑|图)/)
  requireMatch('反向必要证据图', /反向(?:必要)?(?:证据|路线|逻辑|图)/)
  requireMatch('逻辑断点', /逻辑断点/)
  requireMatch('题目与作者', /题目与作者/)
  requireMatch('通讯作者研究方向总结', /通讯作者研究方向总结/)
  requireMatch('综述逻辑', /综述逻辑/)
  requireMatch('因果实验链', /因果实验链/)
  requireMatch('交叉知识桥', /交叉知识桥/)
  requireMatch('新 Idea 与顶刊理由', /新\s*Idea\s*与顶刊理由/i)
  requireMatch('摘要微逻辑', /摘要[^\n]{0,20}(?:微逻辑|拆解|逻辑)/)
  requireMatch('Introduction/综述微逻辑', /(?:Introduction|引言|综述)[^\n]{0,30}(?:微逻辑|拆解|逻辑)/i)
  requireMatch('方法/实验微逻辑', /(?:方法|实验)[^\n]{0,30}(?:微逻辑|拆解|逻辑|证据)/)
  requireMatch('结果微逻辑', /结果[^\n]{0,30}(?:微逻辑|拆解|逻辑|证据)/)
  requireMatch('讨论/结论微逻辑', /(?:讨论|结论)[^\n]{0,30}(?:微逻辑|拆解|逻辑|边界)/)
  if ((text.match(/本模块小结/g) || []).length < 5) missing.push('五个“本模块小结”')
  return missing
}

function buildCoverageRepairPrompt(draft: PaperDraft, answer: string, missing: string[]) {
  const requiredShape = draft.module === 'reproduce'
    ? `只输出代码复现报告。完整覆盖环境、数据、预处理、训练、评估与图表复现，每个阶段末尾写“阶段小结”，最后写“代码复现总小结”。`
    : `先输出“论文结构与科研逻辑总图”，包含正向证明路线、反向必要证据图和逻辑断点；再严格输出“1. 题目与作者”“2. 综述逻辑”“3. 因果实验链”“4. 交叉知识桥”“5. 新 Idea 与顶刊理由”。通讯作者部分必须单列“通讯作者研究方向总结”，五个模块各自以“本模块小结”收尾。对摘要、Introduction/综述、方法/实验、结果、讨论/结论按本文真实结构分别做微逻辑拆解；没有全文证据时明确写待原文核验，绝不能编造。`
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
- 每个微逻辑步骤写清“原文事实/证据 -> 叙事作用 -> 隐含前提 -> 推理或决策 -> 尚未解决 -> 因此下一步”。结构必须因本文而异，可以分叉、并行、回环或演绎，不得机械套用固定六步。
- 只能使用候选报告与上方元数据已经支持的信息；不知道的内容标成待核验。
- 全文使用简体中文，不使用 Markdown 表格或竖线分隔内容。

候选报告：
${answer.slice(0, 17000)}`.slice(0, 22000)
}

function buildPrompt(draft: PaperDraft, journalLogic: string, webSearch: boolean) {
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
  return prompt.slice(0, 22000)
}

function buildAuditPrompt(draft: PaperDraft, firstPass: string) {
  const auditScope = draft.module === 'reproduce'
    ? `本轮只输出“代码复现”报告，不得混入题目作者、综述逻辑、交叉知识桥或新 Idea。必须覆盖 Figure/Table 到数据、环境、文件/函数、命令、输出和验收指标的映射；环境、数据、预处理、训练、评估和图表复现各阶段末尾都要有“阶段小结”，全文最后有“代码复现总小结”。`
    : `本轮先输出论文结构与科研逻辑总图，再输出五个连续模块：1.题目与作者、2.综述逻辑、3.因果实验链、4.交叉知识桥、5.新 Idea 与顶刊理由。不得插入代码复现章节。总图必须同时包含正向证明路线和反向必要证据图，并标出两图不一致的逻辑断点。摘要、Introduction/综述、方法/实验、结果、讨论/结论都要按真实可见内容拆成微逻辑步骤；材料缺失时写待核验，禁止补写不存在的段落。通讯作者部分必须以“通讯作者研究方向总结”收尾。每个模块末尾必须有“本模块小结”，包含核心结论、直接证据、未解问题和下一模块的必要性。`
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
- 开头先写 200 字摘要、论文原生逻辑身份和一条不超过 12 个节点的主线。
- 每个证据节点都按“上一缺口 -> 为什么做 -> 方法与对照 -> 得到什么 -> 排除什么 -> 还缺什么 -> 下一步”展开。
- 每章开头承接上一章，结尾明确指出下一章为什么必需，最终报告必须像一条连续推理而不是互不相干的问题答案。

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
  const [analysisStage, setAnalysisStage] = useState<'grounding' | 'analysis' | 'audit' | 'repair'>('analysis')
  const [error, setError] = useState('')
  const [saveProjectId, setSaveProjectId] = useState(() => projects.find(project => project.system_key !== 'recycle')?.id ?? 0)
  const [saving, setSaving] = useState(false)
  const [savedIdeaId, setSavedIdeaId] = useState<number | null>(null)
  const [discoveryPreferences, setDiscoveryPreferences] = useState<DiscoveryPreferences>(loadDiscoveryPreferences)
  const [discovery, setDiscovery] = useState<PaperDiscoveryResult | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState('')
  const [paperMetadata, setPaperMetadata] = useState<PaperScholarlyContext | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const autoDiscoveryStarted = useRef(false)
  const metadataLookupKey = useRef('')

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

  async function enrichPaper(targetDraft: PaperDraft = draft, reportError = true) {
    const key = `${targetDraft.title.trim()}|${targetDraft.locator.trim()}|${status?.configured ? 'translate' : 'metadata'}`
    metadataLookupKey.current = key
    setMetadataLoading(true)
    try {
      const params = new URLSearchParams({ title: targetDraft.title, locator: targetDraft.locator })
      const context = await api.paperContext(params)
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
          })
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
    setRunning(true); setError(''); setSavedIdeaId(null)
    try {
      let groundedDraft = targetDraft
      if (!groundedDraft.scholarlyContext.trim() || !groundedDraft.venue.trim() || !groundedDraft.sourceText.trim()) {
        setAnalysisStage('grounding')
        try {
          groundedDraft = await enrichPaper(groundedDraft, false)
        } catch (reason) {
          const note = reason instanceof Error ? reason.message : '学术轨迹元数据暂时不可用。'
          groundedDraft = { ...groundedDraft, scholarlyContext: `自动核验未完成：${note}\n通讯作者与近年研究轨迹必须在原文、作者主页或 ORCID 中人工核验。` }
          setDraft(groundedDraft)
        }
      }
      const mode: AgentMode = groundedDraft.module === 'causal' ? 'critique' : 'synthesize'
      const targetJournal = journalProfiles[groundedDraft.journalProfile] || journalProfiles.general
      setAnalysisStage('analysis')
      const firstPass = await api.runAgent({
        prompt: buildPrompt(groundedDraft, targetJournal.logic, webSearch), mode,
        scope_type: scope.type, scope_id: scope.type === 'all' ? null : scope.id,
        idea_id: null, model: status.default_model, reasoning_effort: status.reasoning_effort,
        web_search: webSearch, attachment_ids: selectedFileIds,
      })
      let finalResult = { ...firstPass, answer: normalizePaperReport(firstPass.answer) }
      setResult(finalResult)
      if (groundedDraft.analysisDepth === 'adversarial') {
        setAnalysisStage('audit')
        const audited = await api.runAgent({
          prompt: buildAuditPrompt(groundedDraft, firstPass.answer), mode: 'critique',
          scope_type: scope.type, scope_id: scope.type === 'all' ? null : scope.id,
          idea_id: null, model: status.default_model, reasoning_effort: status.reasoning_effort,
          web_search: webSearch, attachment_ids: selectedFileIds,
        })
        finalResult = { ...audited, answer: normalizePaperReport(audited.answer) }
        setResult(finalResult)
      }
      const missing = missingPaperSections(finalResult.answer, groundedDraft.module)
      if (missing.length) {
        setAnalysisStage('repair')
        const repaired = await api.runAgent({
          prompt: buildCoverageRepairPrompt(groundedDraft, finalResult.answer, missing), mode: 'critique',
          scope_type: scope.type, scope_id: scope.type === 'all' ? null : scope.id,
          idea_id: null, model: status.default_model, reasoning_effort: status.reasoning_effort,
          web_search: webSearch, attachment_ids: selectedFileIds,
        })
        finalResult = { ...repaired, answer: normalizePaperReport(repaired.answer) }
        setResult(finalResult)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Paper analysis failed')
    } finally {
      setRunning(false)
    }
  }

  async function runModule(module: PaperModule) {
    const nextDraft = { ...draft, module }
    setDraft(nextDraft)
    await run(nextDraft)
  }

  async function searchPapers(preferences: DiscoveryPreferences = discoveryPreferences) {
    if (!preferences.query.trim()) return
    setDiscovering(true); setDiscoveryError('')
    try {
      const params = new URLSearchParams({
        q: preferences.query.trim(),
        venues: '',
        from_year: String(new Date().getFullYear() - 3),
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
      analysisDepth: 'adversarial',
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

  const sourceUrl = paperMetadata?.url || paperHref(draft.locator)
  const pdfUrl = paperMetadata?.pdf_url || ''
  const displayedAbstract = paperMetadata?.abstract || draft.sourceText
  const displayedVenue = paperMetadata?.venue || draft.venue

  return <div className="modal-backdrop paper-lab-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="paper-lab">
      <header className="paper-lab-header"><div><p className="eyebrow">PAPER REASONING WORKSPACE</p><h2><BookOpenText size={25}/> Paper Lab</h2><p>Evidence-first reading, causal reconstruction, code mapping, and idea synthesis.</p></div><button className="icon-button" onClick={onClose} aria-label="Close Paper Lab"><X size={20}/></button></header>
      <div className="paper-lab-body">
        <aside className="paper-lab-inputs">
          <section className="paper-radar">
            <div className="paper-radar-heading"><div><strong>论文雷达</strong><span>自动检索、筛选与补全</span></div><Search size={17}/></div>
            <label>你想跟进的研究主题<input value={discoveryPreferences.query} onChange={event => setDiscoveryPreferences(current => ({ ...current, query: event.target.value }))} placeholder="例如 EEG emotion recognition cross-subject"/></label>
            <div className="paper-topic-suggestions"><span>关键词提示</span><button type="button" onClick={() => setDiscoveryPreferences(current => ({ ...current, query: 'EEG emotion recognition cross-subject generalization' }))}>跨受试者情绪识别</button><button type="button" onClick={() => setDiscoveryPreferences(current => ({ ...current, query: 'brain-computer interface foundation model EEG' }))}>脑机接口基础模型</button><button type="button" onClick={() => setDiscoveryPreferences(current => ({ ...current, query: 'multimodal neural decoding causal mechanism' }))}>多模态神经解码</button></div>
            <label>目标期刊或会议<span>自动识别</span><input readOnly value="系统根据检索结果与论文类型自动匹配"/></label>
            <div className="paper-radar-controls"><label>起始年份<input readOnly type="number" value={new Date().getFullYear() - 3}/></label><label className="paper-radar-auto"><input type="checkbox" checked disabled/> 每次打开自动更新</label></div>
            <p className="paper-auto-note"><Sparkles size={13}/> 系统自动检索近三年论文，并补全题目、期刊、作者、摘要、DOI、原文链接和通讯作者轨迹。</p>
            <button className="button secondary paper-discover" disabled={discovering || !discoveryPreferences.query.trim()} onClick={() => void searchPapers()}>{discovering ? <LoaderCircle className="spin" size={15}/> : <Search size={15}/>} 自动检索论文</button>
            {discoveryError && <p className="paper-radar-error">{discoveryError}</p>}
            {discovery && <div className="paper-discovery-results">
              <div className="paper-discovery-summary"><span>{discovery.papers.length} 篇候选</span><span>{discovery.sources.join(' + ')}</span></div>
              {discovery.warnings.map(warning => <p className="paper-radar-warning" key={warning}>{warning}</p>)}
              {discovery.papers.length === 0 ? <p className="paper-radar-empty">没有找到同时满足关键词、期刊和年份的论文，请放宽期刊或年份。</p> : discovery.papers.map(paper => <article className="paper-candidate" key={paper.id}>
                <div className="paper-candidate-meta"><span>{paper.year || '日期未知'}</span><span>{paper.venue || '期刊未知'}</span><span>{paper.cited_by_count} 引用</span></div>
                <strong>{paper.title}</strong>
                <p>{paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ' 等' : ''}</p>
                <div className="paper-candidate-reasons">{paper.match_reasons.map(reason => <span key={reason}>{reason}</span>)}</div>
                <footer><a href={paper.url} target="_blank" rel="noreferrer" title="打开论文元数据或 DOI"><ExternalLink size={13}/></a><button className="button secondary small" onClick={() => void useDiscoveredPaper(paper, false)}>查看论文</button><button className="button primary small" disabled={running} onClick={() => void useDiscoveredPaper(paper, true)}><Sparkles size={13}/> 自动补全并分析</button></footer>
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
          <div className="paper-depth"><div><strong>分析严谨度</strong><span>双轮模式会额外调用一次模型</span></div><div><button className={draft.analysisDepth === 'deep' ? 'active' : ''} onClick={() => update('analysisDepth', 'deep')}>单轮深拆</button><button className={draft.analysisDepth === 'adversarial' ? 'active' : ''} onClick={() => update('analysisDepth', 'adversarial')}>双轮对抗审稿</button></div></div>
          {running && <div className="paper-running-stage"><LoaderCircle className="spin" size={15}/>{analysisStage === 'grounding' ? '正在核验论文与作者…' : analysisStage === 'audit' ? '正在进行第二轮对抗审稿…' : analysisStage === 'repair' ? '正在补齐缺失模块并重建报告…' : '正在进行第一轮深度拆解…'}</div>}
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
