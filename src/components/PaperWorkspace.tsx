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
  locator: string
  venue: string
  journalProfile: string
  studyType: string
  domain: string
  crossDomainClues: string
  scholarlyContext: string
  sourceText: string
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
  locator: '',
  venue: '',
  journalProfile: 'adaptive',
  studyType: 'experimental',
  domain: 'EEG emotion recognition / neuroscience',
  crossDomainClues: '',
  scholarlyContext: '',
  sourceText: '',
  goal: '理解论文的因果逻辑，找到可以复现的实验，并形成适合我当前研究的新 idea。',
  module: 'full',
  analysisDepth: 'adversarial',
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
  full: `输出完整报告，严格包含以下部分，任何一项都不能用泛泛摘要替代：
1. 证据边界：已由输入证实、合理推断、待核验三列。
2. 题目逻辑：逐词拆出表型、机制、对象、尺度、方法和因果强度；解释“表型 + 机制”如何压缩全文故事、巧妙在哪里、哪些词由哪组证据支撑、删改哪个词会更诚实。
3. 通讯作者科研轨迹：用提供的学术元数据按年份列出近年问题、模型、变量与技术积累；逐项解释它们如何汇入本文。未被元数据明确标记的通讯作者不得凭末位顺序猜测。
4. Introduction 引文角色图：按“领域事实 -> 主流做法 -> 尚未解释 -> 关键矛盾/技术窗口 -> 交叉切口 -> 科学猜想 -> 可证伪预测”重建选题。每一跳说明为什么作者需要引用这类实验而不是另一类实验，若删掉该前提，选题是否仍成立。
5. 科学猜想卡：写出自变量、因变量、中介、调节、混杂、边界条件、竞争假说和至少两个互斥预测；明确什么结果会推翻作者猜想。
6. 总体强逻辑图：先识别论文自己的逻辑拓扑，再在纯文本代码块中画图，不得预设所有论文都是 E1 -> E2 -> E3。机制论文可用实验/因果节点；理论论文用定义/假设/引理/定理/反例；算法论文用问题诊断/设计选择/基准/消融/泛化；基础模型用语料与统一化/预训练目标/表示质量/适配协议/跨任务迁移/规模与失效；系统论文用约束/架构/部件/性能/失效；观察研究用识别假设/估计/安慰剂/稳健性；综述用检索/纳排/证据综合/偏倚。允许分叉、并行、回环和非线性结构。
7. 逐实验深挖表：每层写“为什么现在必须做这个实验而不是别的实验”、前一层留下的唯一关键缺口、当时至少两个可选路线、作者为何选择当前路线、操纵/方法、对照/基线、观察、允许结论、不能推出的结论、排除的替代解释、仍存竞争解释、如何自然导向下一层。不能只按 Figure 顺序复述。
8. 相关性 -> 因果性证据升级账本：对每个核心结论分别列出共现/预测相关、时间先后、剂量反应、必要性、充分性、特异性、反向操纵、救援/恢复、上下游或上位性、正交测量、负结果、消融/反例、稳健性和跨场景验证。每项标明“论文已完成/部分完成/缺失”、证据改变了哪个后验判断、排除了哪个竞争解释、仍不能排除什么；非机制论文要转换成其原生等价物，例如算法的消融与分布外泛化、理论的反例与边界、观察研究的安慰剂与敏感性分析。缺失时设计一个信息增益最高的决定性实验。
9. 交叉知识桥：按“当前难点 -> 无学科功能抽象 -> 候选领域 -> 可借机制/模型/数学结构/实验工具 -> 变量与尺度映射 -> 转译回本文 -> 最小验证 -> 反证与失效条件”输出。至少比较生物同源、功能类比、数学同构、方法迁移和启发式隐喻。
10. 最强证据与最弱跳跃：逐项区分数据直接支持、统计关联、机制解释和作者叙事；给出能使核心解释失败的反事实，并从苛刻审稿人角度找至少 5 个薄弱点。
11. 复现地图：Paper Figure/Table -> 科学问题 -> 数据 -> 预处理 -> 数据形状 -> 代码文件/类/函数 -> 调用链 -> 配置 -> 命令 -> 预期输出 -> 验收指标 -> 常见失败。解释每个已附代码模块的功能和它对应论文哪一步；未知项明确写“待定位”，不得猜文件名。
12. 新 idea：至少 5 个，覆盖机制、方法、数据/测量、场景和可信跨学科迁移。每个包含来源缺口、核心假设、变量映射、最小关键实验、反向/救援/反例实验、预期结果、失败解释、创新性、可行性、数据/伦理风险与下一步；用二维矩阵排序并推荐一个。
13. 第二遍逻辑审计：重新从结论倒推到前提，指出第一遍最容易忽略的隐含假设、循环论证、尺度错配、选择性报告和可替代解释。
14. 顶刊命中解剖：建立“主张 -> 决定性证据 -> 审稿门槛 -> venue 读者价值”匹配表，分别解释问题重要性、创新的不可替代性、方法与问题的贴合度、证据闭环、普适性/影响面、写作叙事、资源开放和期刊/会议读者匹配为何可能达到顶刊门槛。再做降档反事实：依次删除核心数据、关键干预/消融、救援/反例、外部验证、跨场景泛化或开放资源，判断会从“机制/普适结论”退化成什么层级，并指出真正不可删除的最小证据集。只能基于论文内容与公开审稿信息推断，不能假装知道编辑真实决定。
15. 作者深层创新：区分表面新模块和真正创新动作，分析作者重新定义了什么问题、反转了什么约束、从哪里借了什么结构、放弃了哪些显然方案、用什么最小设计获得最大解释力，以及这些选择为何不是简单堆叠。
16. 初学者行动清单：按先后顺序列出今天、第一周、完整复现三个阶段，每步给出完成标志。`,
  title_author: `聚焦题目与作者：拆解表型、机制、对象、方法和因果强度；判断题目叙事巧妙处与可能夸大。重建通讯作者近年研究问题、实验模型、关键技术和本文之间的积累关系。不能核验的信息必须标注“待核验”，并给出作者主页、ORCID、PubMed/Scholar 检索式。`,
  introduction: `聚焦 Introduction/综述的强逻辑。输出“已知 -> 主流关注 -> 被忽略之处 -> 矛盾/技术窗口 -> 交叉学科转折 -> 科学猜想 -> 可证伪预测”。逐段解释为什么此处需要这一类文献，以及若删除某个前提，选题是否仍成立。特别标出作者何时从另一学科借入概念、模型或测量工具，以及这次转译成立所依赖的假设。比较综合顶刊、机制型生物医学顶刊、临床顶刊、理论和 AI/工程顶刊在立题证据上的不同要求。`,
  causal: `聚焦实验因果链。先画变量与混杂因素的文本因果图，再建立逐实验表格：实验问题、干预、对照、读出、结果、允许的结论、不能推出的结论、下一实验。必须检查时间先后、剂量反应、敲除/抑制、过表达/激活、救援、反向验证、上下游/上位性、正交测量、体内外切换和跨场景验证。最后设计一个能让核心因果解释失败的决定性反证实验。`,
  cross_domain: `聚焦交叉知识迁移与难点求解。先找出最难解释、最难测量、最难优化或现有方法最难突破的 5 个瓶颈，再把它们抽象成无学科功能问题，例如资源/能量配置、激励与博弈、信号传播、时空同步、网络控制、适应与演化、相变、反馈稳定性、稀疏编码、多尺度耦合、因果识别、鲁棒优化或不确定性定价。候选领域必须广泛比较：细胞代谢与线粒体、免疫、草履虫/动物行为、神经生态与演化；控制论、非线性动力学、统计物理、热力学、拓扑与复杂网络；机器学习、机器人、信息论、运筹学；经济学、计量经济学、机制设计、博弈论、市场微观结构与金融风险；材料和工程失效。对每个桥梁输出来源领域、可借知识、原领域变量、目标领域变量、结构对应、尺度与约束、不对应之处、转译步骤、最小实验、反证条件、数据/技术门槛、检索式和失败后学到什么。明确区分生物同源、功能类比、数学同构、因果识别迁移、实验工具迁移和启发式隐喻；淘汰无法操作化、不可证伪或尺度不匹配的类比。最后用“新颖性 x 可验证性 x 数据可得性 x 转译风险”矩阵选出 1 条最值得执行的路线。`,
  reproduce: `聚焦可执行复现。先按论文类型决定复现对象：机制实验复现操纵与读出；理论论文复现命题、模拟与边界；基础模型复现数据清单/统一化、预训练、冻结探测、全量微调、从头训练、少样本、跨数据集与消融；系统论文复现部件、延迟、吞吐和失效。建立 Figure/Table 到代码的逐项矩阵；解释所选本地代码文件中每个可见模块的职责、数据形状、调用顺序和配置来源。给出环境建立、数据获取、预处理、防止受试者/时间/数据集泄漏、训练、评估、绘图、随机种子、算力预算和验收标准的命令级步骤。区分“已有代码可直接运行”“需要补写”“论文未公开”。不得猜测不存在的文件或函数。`,
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

function formatScholarlyContext(context: PaperScholarlyContext) {
  const authors = context.corresponding_authors.length
    ? context.corresponding_authors.map(author => `- ${author.name}${author.institution ? ` | ${author.institution}` : ''}${author.orcid ? ` | ${author.orcid}` : ''}`).join('\n')
    : '- 未被 OpenAlex 明确标注，必须到原文核验。'
  const works = context.recent_works.length
    ? context.recent_works.map(work => `- ${work.year || '年份未知'} | ${work.title} | ${work.venue || '来源未知'} | cited ${work.cited_by_count}${work.doi ? ` | DOI ${work.doi}` : ''}`).join('\n')
    : '- 暂无可核验的近五年论文元数据。'
  return `元数据来源：${context.source}\n匹配论文：${context.matched_title}\n证据说明：${context.evidence_note}\n\n明确标注的通讯作者：\n${authors}\n\n这些通讯作者近五年的相关论文候选：\n${works}`
}

function buildPrompt(draft: PaperDraft, journalLogic: string, webSearch: boolean) {
  const source = draft.sourceText.trim().slice(0, 6000) || '未提供摘要或正文。只能做结构化待办和假设，不得声称掌握论文具体结果。'
  const prompt = `请作为严谨的顶刊论文方法学导师，用中文分析下面的论文。目标不是生成泛泛摘要，而是识别这篇论文所属学科与期刊真正要求的强逻辑，重建作者如何从问题推进到可接受的证据结论，并把论文映射为可复现的研究计划。因果实验只是其中一种逻辑，理论证明、工程验证、计算实验、观察识别和系统综述必须使用各自合适的标准。

论文标题：${draft.title.trim()}
DOI / URL / arXiv：${draft.locator.trim() || '未提供'}
具体期刊 / 会议：${draft.venue.trim() || '未提供，请根据材料判断并标注不确定性'}
目标期刊逻辑：${journalProfiles[draft.journalProfile]?.label || journalProfiles.general.label}
研究设计：${draft.studyType}
研究领域：${draft.domain.trim() || '未指定'}
当前难点或已知交叉线索：${draft.crossDomainClues.trim() || '未提供，请主动识别论文中的知识瓶颈和跨领域机会'}
通讯作者与近年论文元数据：
${draft.scholarlyContext.trim() || '未自动获得。通讯作者身份和近年轨迹必须标为待核验，不得根据作者顺序猜测。'}
我的学习目标：${draft.goal.trim() || '理解并复现论文'}
本次是否允许服务端联网检索：${webSearch ? '是' : '否'}

期刊逻辑要求：
${journalLogic}

证据纪律：
- 第一步必须输出“论文逻辑身份卡”：学科、论文类型、核心贡献类型、目标读者、原生逻辑拓扑、主要证明责任、选用的分析框架、明确拒绝的错误模板。后续所有章节必须服从这张身份卡；若分析中发现类型判断错误，要主动修正。
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

本次任务：
${moduleRequirements[draft.module]}

论文材料：
${source}

格式要求：以一级标题“${draft.title.trim()}：深度阅读与复现报告”开始。使用清晰的 Markdown 标题、因果箭头和表格；结尾必须给出“下一步只做一件事”，适合初学者立即执行。`
  return prompt.slice(0, 22000)
}

function buildAuditPrompt(draft: PaperDraft, firstPass: string) {
  return `你现在是匿名顶刊审稿人、因果推断专家、复现工程师和跨学科方法学家组成的联合审稿组。下面是一份第一轮论文分析。不要为它辩护，也不要只做摘要；请先攻击，再重建为一份更严格、更深入、可复现的最终报告。

论文：${draft.title}
期刊/会议：${draft.venue || '未提供'}
研究领域：${draft.domain || '未提供'}

第二轮必须执行七次检查：
1. 类型与证据审计：先检查第一轮是否识别对了论文类型和逻辑拓扑；若把非线性、并行或混合论证硬改成顺序实验链，必须重新路由。再逐项找到把相关写成因果、把模型表现写成机制、把缺失证据写成事实、把期刊声望当作证据的地方。
2. 反向审计：从最终结论倒推到每个必要前提，找断链、循环论证、未控制混杂、尺度错配和选择性报告。
3. 中断审计：对核心变量设计 loss-of-function/去除/消融/政策冲击/边界反例，并设计反向操纵与救援；按论文类型选合适形式，不能机械套医学术语。
4. 交叉审计：比较生物、计算机、数学物理、工程控制、生态演化、经济学与博弈/计量视角。只有变量、约束、尺度和可观测量能映射的桥梁才保留。
5. 复现审计：逐 Figure/Table 检查数据、预处理、代码文件/函数、配置、随机性、泄漏、命令、预期输出和验收指标；未知内容必须标记，禁止发明。
6. 竞争解释审计：为每个核心主张建立替代解释树，检查第一轮是否真正用证据逐枝排除反向因果、共同原因、测量伪影、选择偏差、过拟合/泄漏与偶然性。没有被排除的必须保留，不能替作者补证据。
7. 顶刊降档审计：把每个主张配到 venue 的公开评价门槛，逐个移除关键干预/消融、救援/反例、外部验证、跨场景泛化和开放资源，判断结论会降到什么层级，找出支撑顶刊贡献的最小不可删除证据集。

最终输出不是审稿意见列表，而是修正后的完整深度报告。必须包含：
- 事实/推断/待核验表；
- 题目“表型 + 机制”逐词证据映射；
- 通讯作者近年轨迹与本文关系图，并标注元数据局限；
- Introduction 的引文角色和科学猜想生成链；
- 纯文本 E1 -> E2 -> ... 正推图，以及结论 -> 必要前提的反推图；
- 每一步为何做此实验、候选路线、选择理由、信息增益、替代方案、对照、允许结论、下一步的逐层表；
- 相关性到因果性的证据升级账本，以及中断、反向、救援、正交、体内外/跨数据集、应用落地的闭环与缺口；
- 核心主张的竞争解释树与逐枝排除证据；
- 至少三个跨领域候选的变量映射、最小实验和淘汰理由；
- Figure/Table 到代码的复现矩阵；
- 至少五个真正可证伪的新 Idea 及排序；
- 作者最深层的创新决策，创新、证据和 venue 评价门槛的匹配表，以及删除关键证据后的降档反事实；
- 最后列“仍不能知道什么”和“下一步只做一件事”。

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
  const [analysisStage, setAnalysisStage] = useState<'grounding' | 'analysis' | 'audit'>('analysis')
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
    setDraft(current => key === 'title' || key === 'locator'
      ? { ...current, [key]: value, scholarlyContext: '' }
      : { ...current, [key]: value })
  }

  async function run(targetDraft: PaperDraft = draft) {
    if (!targetDraft.title.trim() || !status?.configured) return
    setRunning(true); setError(''); setSavedIdeaId(null)
    try {
      let groundedDraft = targetDraft
      if (!groundedDraft.scholarlyContext.trim()) {
        setAnalysisStage('grounding')
        try {
          const params = new URLSearchParams({ title: groundedDraft.title, locator: groundedDraft.locator })
          const scholarlyContext = formatScholarlyContext(await api.paperContext(params))
          groundedDraft = { ...groundedDraft, scholarlyContext }
          setDraft(groundedDraft)
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
      setResult(firstPass)
      if (groundedDraft.analysisDepth === 'adversarial') {
        setAnalysisStage('audit')
        const audited = await api.runAgent({
          prompt: buildAuditPrompt(groundedDraft, firstPass.answer), mode: 'critique',
          scope_type: scope.type, scope_id: scope.type === 'all' ? null : scope.id,
          idea_id: null, model: status.default_model, reasoning_effort: status.reasoning_effort,
          web_search: webSearch, attachment_ids: selectedFileIds,
        })
        setResult(audited)
      }
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
      scholarlyContext: '',
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
          <div className="paper-field-grid"><label>Reasoning profile<select value={draft.journalProfile} onChange={event => update('journalProfile', event.target.value)}>{Object.entries(journalProfiles).map(([id, item]) => <option value={id} key={id}>{item.label}</option>)}</select></label><label>Study design<select value={draft.studyType} onChange={event => update('studyType', event.target.value)}><option value="experimental">Mechanistic experiment</option><option value="observational">Observational / behavioral</option><option value="clinical_trial">Clinical trial</option><option value="foundation_model">Foundation model</option><option value="computational">AI / computational</option><option value="engineering">Engineering / systems</option><option value="theoretical">Theory / methods</option><option value="resource">Dataset / resource</option><option value="review">Review / meta-analysis</option></select></label></div>
          <label>Research domain<input value={draft.domain} onChange={event => update('domain', event.target.value)} placeholder="e.g. EEG emotion recognition"/></label>
          <label>Known bottleneck or cross-field clue<textarea rows={3} value={draft.crossDomainClues} onChange={event => update('crossDomainClues', event.target.value)} placeholder="Optional: e.g. tumor growth may depend on mitochondrial metabolism; BCI dynamics may resemble adaptive behavior in simple organisms."/></label>
          <label>通讯作者与近年研究轨迹<span>运行时由 OpenAlex 自动核验，可修改</span><textarea rows={5} value={draft.scholarlyContext} onChange={event => update('scholarlyContext', event.target.value)} placeholder="留空即可。运行分析时会按 DOI/标题查找明确标注的通讯作者及其近五年论文；未标注时不会按末位作者猜测。"/></label>
          <label>Abstract or key passages<span>{draft.sourceText.length}/6000</span><textarea rows={7} maxLength={6000} value={draft.sourceText} onChange={event => update('sourceText', event.target.value)} placeholder="Paste the abstract, introduction logic, figure legends, or method notes. With title only, unknown facts stay marked for verification."/></label>
          <label>Your goal<textarea rows={3} value={draft.goal} onChange={event => update('goal', event.target.value)} /></label>

          <div className="paper-module-heading"><strong>Analysis route</strong><span>Choose one pass at a time</span></div>
          <nav className="paper-modules" aria-label="Paper analysis route">{modules.map(item => <button className={draft.module === item.id ? 'active' : ''} onClick={() => update('module', item.id)} key={item.id}>{moduleIcon(item.id)}<span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</nav>

          {availableFiles.length > 0 && <details className="paper-files"><summary><Code2 size={14}/> Reproduction files <span>{selectedFileIds.length} selected</span></summary><p>Select text or code files intentionally. PDFs currently contribute metadata only.</p><div>{availableFiles.map(file => <label className={!file.exists ? 'missing' : ''} key={file.id}><input type="checkbox" disabled={!file.exists} checked={selectedFileIds.includes(file.id)} onChange={event => setSelectedFileIds(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))}/><FileText size={14}/><span>{file.display_name}<small>{file.absolute_path}</small></span></label>)}</div></details>}

          {status && <div className={`paper-agent-status ${status.configured ? 'ready' : ''}`}><Sparkles size={15}/><div><strong>{status.configured ? `${status.provider_label} · ${status.default_model}` : 'Agent connection required'}</strong><span>{status.configured ? status.web_search_supported ? 'Provider can verify sources with web search.' : 'No provider web search: author history and exact results will be marked for verification.' : 'Configure a provider before running Paper Lab.'}</span></div>{!status.configured && <button onClick={onOpenAgent}>Configure</button>}</div>}
          {status?.configured && <label className="paper-web-toggle" title={status.web_search_supported ? 'Allow provider-side source lookup' : 'The active provider does not support server-side search'}><input type="checkbox" checked={webSearch} disabled={!status.web_search_supported} onChange={event => setWebSearch(event.target.checked)}/><Globe2 size={14}/> Verify with provider web search</label>}
          <div className="paper-depth"><div><strong>分析严谨度</strong><span>双轮模式会额外调用一次模型</span></div><div><button className={draft.analysisDepth === 'deep' ? 'active' : ''} onClick={() => update('analysisDepth', 'deep')}>单轮深拆</button><button className={draft.analysisDepth === 'adversarial' ? 'active' : ''} onClick={() => update('analysisDepth', 'adversarial')}>双轮对抗审稿</button></div></div>
          <button className="button primary paper-run" disabled={running || !draft.title.trim() || !status?.configured} onClick={() => void run()}>{running ? <><LoaderCircle className="spin" size={17}/>{analysisStage === 'grounding' ? '核验论文与作者…' : analysisStage === 'audit' ? '第二轮对抗审稿…' : '第一轮深度拆解…'}</> : <><Sparkles size={17}/> Run {modules.find(item => item.id === draft.module)?.label}</>}</button>
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
