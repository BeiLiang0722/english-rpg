# README · 单词猎手 v0.3

游戏化背单词 App。**零依赖、零构建、双击即用、完全离线**。
本文件是交付说明：怎么打开、目录怎么读、想改数值改哪里、词库从哪来、已知限制是什么。

> **v0.3 新增（本轮）：词库从 200 词扩到 5802 词（CET-4/6 全量）。**
> 词表与释义来自 **ECDICT**，音标换成 **ipa-dict 的标准 IPA**（带重音标记），
> 例句与中文翻译来自 **Tatoeba 的人工维护英中句对**（不够时用 **WikiMatrix** 自动对齐语料补空缺，来源已逐条标注）。
> 同时：词库总览页改为「搜索 + 每页 100 条」（5800+ 词不能整册渲染）、
> `main.js` 的词库校验从「逐条必填」放宽为「覆盖率门槛」（`example` 允许个别缺失）。
> 数据来源与许可见 §4，构建链路见 §7。

> **v0.2**：每日任务 + 随机宝箱（跨天正确结算，全部落 localStorage）、错题本「重练」冷却、
> 徽章详情弹层、结算页「距下一级还差 X XP」、统计页近 7/30 天答题曲线 + 各词库进度、升级/得分/连击动效与
> 纯 WebAudio 合成音效、360px 移动端适配。同时修掉 v0.1 验收报告里最高优先级的三项缺陷
> （D1 对局中刷新丢收益 / D2 中途退出被当成完成局 / D3 多标签页互相覆盖），并顺带修掉 D4/D5/D6/D7/D8/D9/D16/D21。
> 细节见 `docs/03-PRD.md` §5.9 与 `docs/07-v0.2-变更与验收.md`。

---

## 1. 怎么打开

1. 打开文件管理器，进入 `english-rpg/app/`。
2. **双击 `index.html`**（或右键 → 用浏览器打开：Chrome / Edge / Firefox 均可）。
3. 看到深色过场后自动进入营地，点「开始一局」即可答题。

- 不需要安装 Node、不需要命令行、不需要联网、不需要服务器。
- 数据全部存在**当前浏览器**的 `localStorage` 里（键名 `wordquest.*`），换浏览器或清浏览器数据会重新开始。
- 手机上也能用：把 `app/` 整个目录拷到手机（或用任意静态服务器托管），浏览器打开 `index.html` 即可，布局按手机竖屏优先设计。

> 为什么词库不在 `app/data/words.json` 里读？
> `file://` 协议下浏览器禁止 `fetch()` 读本地文件（CORS 限制），所以运行时用 `<script src="src/data/words.js">` 直接加载同一份数据；
> `app/data/words.json` 是**同一份数据的 JSON 副本**，仅供人工核对与校验脚本使用，页面不加载它。

---

## 2. 目录结构

```
english-rpg/
├── app/                         ← 交付物：整个 App
│   ├── index.html               唯一入口（双击这个文件）
│   ├── styles/
│   │   ├── tokens.css           设计 token：配色、字体、字号、圆角、间距、阴影、动效时长
│   │   ├── base.css             重置、排版、焦点、动效降级、工具类
│   │   ├── components.css       卡片/按钮/进度条/选项/心形/连击/反馈条/覆盖层/Toast
│   │   └── pages.css            各页布局 + 320/640/1024/1440px 响应式覆盖
│   ├── data/
│   │   └── words.json           200 词（JSON 副本，仅核对与校验用）
│   └── src/
│       ├── config/              数值唯一出口（无逻辑分支）
│       │   ├── balance.js       XP / 金币 / 血量 / 连击 / 等级曲线 / SRS / 商店 / 每日任务 / 宝箱
│       │   ├── questions.js     5 种题型定义、权重、干扰项首字规则
│       │   └── achievements.js  14 个徽章定义与进度口径（v0.1 的 11 个 + v0.2 的 3 个）
│       ├── core/                通用工具
│       │   ├── util.js          转义、本地日期、随机、克隆、编辑距离
│       │   ├── bus.js           发布订阅
│       │   ├── audio.js         WebAudio 合成音效（含首次手势解锁）+ TTS 发音
│       │   └── router.js        hash 路由与 404 兜底
│       ├── store/               状态与持久化（**全项目唯一承载存档读写的目录**）
│       │   ├── save.js          存档默认值、版本迁移（含高版本拒绝加载）、结构补全、多标签合并
│       │   ├── persist.js       4 个键读写、损坏备份、配额裁剪、写盘前一致性预检、写失败不抛异常
│       │   ├── state.js         单例 store + 派生量 + 唯一变更入口 commit()
│       │   └── log.js           本地事件日志（环形缓冲 2000 条）
│       ├── game/                纯逻辑（不碰 DOM / localStorage / Math.random）
│       │   ├── level.js         等级曲线与升级结算
│       │   ├── srs.js           词进度与掌握判定
│       │   ├── streak.js        连续天数与冰冻卡/回补卡
│       │   ├── questionEngine.js 抽题型、生成干扰项、拼写判定、挖空
│       │   ├── questionPool.js  每局选词（优先级 100/80/60/20）+ 侦查之眼排除项
│       │   ├── achievements.js  徽章判定与精确进度（支持"只判定白名单"与"延后发奖"两种模式）
│       │   ├── shop.js          商店限购与待生效道具
│       │   ├── chest.js         v0.2 随机宝箱：碎片结算、档位掷点、开箱幂等
│       │   ├── quest.js         v0.2 每日任务：跨天结算、进度推进、统一发奖
│       │   ├── balance.js       单题判定、连击档位、结算落库（幂等、单点写账）
│       │   └── flow.js          开局 / 逐题判定 / 结算 / 中断恢复的编排
│       ├── ui/                  渲染与事件委托
│       │   ├── shell.js         整页渲染 + #app 上的事件委托 + HUD
│       │   ├── toast.js / overlay.js / anim.js
│       │   ├── selfcheck.js     自检断言集（浏览器与 Node 共用同一套，67 条）
│       │   └── pages/           boot / home / battle / result / growth / shop / settings / selfcheck
│       └── main.js              启动编排（读档 → 拒绝高版本 → 恢复中断局 → 路由）
└── dev/                         开发期工具（删掉不影响页面运行）
    ├── check-words.mjs          词库校验 + 生成 words.js/words.json
    ├── selfcheck.mjs            在 Node 里跑同一套数值断言（69 条）
    ├── sim-economy.mjs          v0.2 新增：30 天经济模拟（A8 四条区间 + 2 条入账链路断言）
    ├── check-mobile.mjs         v0.2 新增：移动端静态检查（viewport / 断点 / border-box / 断行 / 触控目标）
    ├── verify-crossday.mjs      v0.2 新增：跨天结算 + 存档往返主线（写盘后按生产读档路径读回）
    ├── dom-e2e.mjs              用极简 DOM 在 Node 里跑 105 条端到端验收
    ├── domshim.mjs              极简 DOM + 虚拟时钟 + 可注入的 localStorage 故障（写失败/配额/静默丢写/多标签事件）
    ├── e2e.mjs                  真实浏览器 CDP 端到端脚本（需可用的 headless 浏览器）
    ├── run-e2e.ps1              启动 headless Edge 并调用 e2e.mjs
    │
    │  ── 以下为 v0.3 词库构建链路（一次性跑，产物不入库；详见 §7）──
    ├── fetch-corpus.mjs         下载 ECDICT / ipa-dict / Tatoeba 语料（带完整性校验）
    ├── build-cet-words.mjs      ECDICT → CET-4/6 词表（词性解析、多义项合并）
    ├── build-deck.mjs           匹配英语例句 + 内容过滤 + 词性对齐 + 每词留备选
    ├── build-examples-tatoeba.mjs  用 Tatoeba 人工英中句对给词配例句（最可靠的一层）
    ├── build-examples-wm.mjs    用 OPUS WikiMatrix 补空缺（自动对齐，质量次于上一层）
    ├── fetch-translations.mjs   Tatoeba API 兜底取中文（命中率低，仅作补充）
    ├── merge-deck.mjs           三层合并 + 去重 + 挖空校验 → deck-final.json
    ├── emit-deck.mjs            产出 app/data/words.json 与 app/src/data/words.js
    ├── sample-deck.mjs          抽样报告（人工复核用）
    ├── sample-final.mjs         成品抽样（按来源分层看）
    ├── audit-deck.mjs           质量审计（词性冲突/漏网内容/音标形态/干扰项可生成性）
    ├── audit-rules.mjs          按 check-words 的规则体检
    ├── audit-wm-align.mjs       估 WikiMatrix 对齐错误率（数字一致性抽样）
    └── list-leaks.mjs           列出内容过滤的漏网例句
```

**代码分层约定**（照 `docs/04` §2.1）：

| 目录 | 只允许做什么 | 禁止什么 |
| --- | --- | --- |
| `src/config/` | 常量与数据表 | `document`、`localStorage`、随机数 |
| `src/core/` | 通用工具 | 读业务状态 |
| `src/store/` | 状态与持久化 | 渲染、业务判定 |
| `src/game/` | 纯函数：入参 → 新状态片段 | `document`、`localStorage`、`Math.random()` |
| `src/ui/` | 渲染 + 事件委托，只经 `WQ.actions.*` 改状态 | 直接改 `save` 字段 |

---

## 3. 调参指南（改哪个文件的哪个常量）

所有数值集中在 `app/src/config/balance.js`，业务代码里没有魔法数字。

| 想改什么 | 改哪里 | 效果 |
| --- | --- | --- |
| 每局题数 | `balance.round.questionCount` | 进度条、结算题数、完美局判定一起变 |
| 血量上限 | `balance.hp.max` | 营地/对局的颗数；护心符在它基础上 +1 |
| 答对给多少 XP | `balance.xp.baseQ1/Q2/Q3/Q4/Q5` | 选择题与拼写题分别计分 |
| 新词 / 击败新词奖励 | `balance.xp.firstSeenCorrect`、`balance.xp.defeatNewWord` | 两者可叠加 |
| 连击奖励 | `balance.xp.combo`（键是档位） | 档位制，每档每局只给一次 |
| 每日首局 / 完美局 | `balance.xp.dailyFirstXp`、`balance.xp.perfect` 与 `balance.coins.*` | 每日首局 +20 XP / +15 金币；完美局 +30 XP / +20 金币 |
| 升级曲线 | `balance.level.needXpBase/needXpStep` 与 `titles` | 公式 `needXp(level)=60+10×level`；改完记得同步 `level.cumulativeXpForLevel` 的断言 |
| 答对金币 / 结算金币 | `balance.coins.perCorrect`、`balance.coins.roundEnd` | 单局金币上限 `8×2+10+15+20=71` |
| SRS 复习间隔 | `balance.srsIntervals` | 依次为 1/3/7/16/35 天 |
| 出题优先级 | `balance.priority.*` | 错词复活 100 / SRS 到期 80 / 新词 60 / 巩固 20 |
| 错词复活冷却 | `balance.priority.wrongCooldownMs` | 默认 6 小时 |
| 商店价格与限购 | `balance.shop.*` | 每件的 `price` 与 `limit`、`limitPeriod` |
| 冰冻卡/回补卡额度 | `balance.streak.*` | 月初 2 张冰冻卡、单月合计最多保护 4 天 |
| 每日任务条数与奖励 | `balance.daily.*` | 常驻 2 条 + 轮换 1 条；`quests[]` 每条含 `kind/target/xp/coins` |
| 宝箱碎片与档位 | `balance.chest.*` | 每 3 次连对 1 枚碎片、单日上限 3 枚、3 枚开箱；`tiers[]` 的 `weight/coins/xp` |
| 错题本重练冷却 | `balance.reclaim.*` | `maxDays=7`：错 N 次 → N 天后可重练 |
| 题型权重 | `config/questions.js` 各题型的 `weight` | 合计 1.00；Q4 不可用时按比例分摊给其余 4 种 |
| 徽章奖励与条件 | `config/achievements.js` | 每条含 `condition`（纯函数）与 `progress`（进度口径）；`checkOn` 决定在哪个事务里判定 |
| 配色 / 圆角 / 动效时长 | `styles/tokens.css` | 全站唯一来源；`docs/02` §5 的 token 已全量落地 |
| 字号档位 | `styles/tokens.css` 的 `data-fontsize` 段 | 设置页可切标准/大/特大 |

**改完怎么验证**：浏览器打开 `#/selfcheck` 点「运行全部」，或在 `english-rpg/` 下执行下面四条（全部零依赖）：

```powershell
node dev/check-words.mjs      # 词库校验：期望「错误 0 / 结论: 通过」
node dev/selfcheck.mjs        # 数值与状态机断言：期望「67/67 PASS」
node dev/dom-e2e.mjs          # DOM 端到端：期望「99/99 通过，失败 0」
node dev/sim-economy.mjs      # 30 天经济模拟（A8 四条区间 + 2 条入账链路）：详见输出末尾的断言汇总
node dev/check-mobile.mjs     # 移动端静态检查（360px 不溢出/不缩放/点击区 ≥44px）：期望「通过（9 项）」
node dev/verify-crossday.mjs  # 跨天结算 + 存档往返主线（3 个自然日 + 跨月）：期望「29/29 PASS」
```

> `sim-economy.mjs` 默认同时跑两套口径：`--scope=full`（当前生产路径，含每日任务/宝箱）与
> `--scope=legacy`（把 v0.2 留存收益置 0，与 docs/03 §5.5 的 v0.1 推导对齐）。
> 可用 `--days=`、`--acc=`、`--seed=` 覆盖默认的 30 天 / 75% 命中 / 固定种子。
>
> `check-mobile.mjs` 只做**静态**判定（解析 4 个 CSS 文件与 `index.html` 的 viewport），
> 能证明「声明层面」达标，**不能**证明真机渲染后没有横向滚动条 —— 后者仍须人眼在 360px 设备模拟器里复核（见 §5 已知限制第 5 条）。
>
> `verify-crossday.mjs` 是「新增机制落进 localStorage 并跨天正确结算」这条要求的直接证据：
> 它逐日注入本地日期，每天结束把存档写盘再按生产读档路径读回，断言跨天重建/归零/幂等/碎片携带/
> 错题本冷却/跨月边界/字段确实落盘。注意：跨天是**注入日期**模拟的，不是真的等了一天。

---

## 4. 词库

- 规模：**5802 词**（CET-4 3846 + 仅 CET-6 1956），字段：
  `id / word / phonetic / pos / meaning_cn / meaning_en / example / example_cn / example_src / collins / frq / tags`。
- 覆盖率（`dev/check-words.mjs` 实测）：
  - `word` 100%、`meaning_cn` **100%**、`pos` 99.7%（一个词有多个不同词性时按设计留空，不猜）、
  - `phonetic` 99.1%、`example` 99.5%、`example_cn` 95.6%；
  - 单词 / id / 例句均不重复；每条例句**恰好包含目标词 1 次**（用词边界并排除连字符，Q5 挖空据此出题）；
  - 干扰项可生成率：Q1 **100%**、Q2 **100%**（要求 ≥ 95%）。
- **数据来源与许可**（每一条都可追溯到权威源，不是人工凭记忆生成）：

  | 内容 | 来源 | 许可 |
  | --- | --- | --- |
  | 词表、中文/英文释义、词频 `frq`、四六级标签 `tags`、柯林斯星级 `collins` | [ECDICT](https://github.com/skywind3000/ECDICT) | MIT |
  | 音标 `phonetic`（标准 IPA，带重音） | [ipa-dict](https://github.com/open-dict-data/ipa-dict) 的 `en_US` | MIT |
  | 例句与中文翻译（主力） | [Tatoeba](https://tatoeba.org) 的人工维护英中句对 | CC BY 2.0 FR |
  | 例句与中文翻译（补空缺） | [WikiMatrix](https://opus.nlpl.eu/WikiMatrix)（OPUS），源自维基百科 | 维基百科内容 CC BY-SA |

  > **出处逐条可查**：每条词条的 `example_src` 标注了例句来自哪一层 ——
  > `tatoeba-pair`（人工句对，最可靠）/ `tatoeba-links` / `tatoeba-api` / `wikimatrix`（自动对齐）/ `tatoeba-en-only`（只有英文）。
  > **`wikimatrix` 是自动对齐语料，约 8~12% 的中英配对可能不严格对应**（例如数字对不上）。
  > 做题时以**英文例句为主**：它与目标词的用法一致；中文仅作辅助理解，遇到明显不符的以英文为准。
- 词库**不预存干扰项**（`docs/03` §0 裁决）：干扰项在运行时按「同词性优先 + 首字/首字母必须不同 + 同局不重复」生成，
  因此词库增删不会让干扰项失效。
- **仅自用学习**，不分发词库数据文件；若将来上架必须复核各源的署名与许可证要求（见上表）。
- 重新生成数据文件：`node dev/emit-deck.mjs`（从构建产物）或 `node dev/check-words.mjs --write`（从 `app/data/words.json`）。

### 4.1 词库为什么长这样（两次踩坑的记录）

1. **音标**：ECDICT 的 `phonetic` 是老式 ASCII 转写（`steit`、`'sistәm`，缺重音与长音符），
   22.4% 的词没有重音标记。现改用 ipa-dict 的标准 IPA（`/ˈsteɪt/`、`/kənˈsɪdɝ/`），原值留在构建产物里备查。
2. **词性**：ECDICT 的 `pos` 列在 CET 词上**100% 为空**，只能从 `translation` 的词性前缀解析；
   且**义项顺序不按常用度排**（`superior` 的第一条是「长者」而不是「更好的」）。
   现策略：只在「全篇只有一个词性」时落定，多词性一律留空——宁可让干扰项退化到跨词性，也不给错标。
3. **例句与释义的对齐**：同一个词的释义与例句可能不在同一词性上（`state` 标名词「州；状态」，
   却配到动词例句 `does it state that...`）。现在按词性做形态筛选，并专门挡掉「助动词 + 动词原形」的用法。
4. **内容过滤**：Tatoeba/WikiMatrix 都是真人语料，含不适合学习 App 的句子。过滤器分两级：
   色情/脏话/自残类一律丢；`war` / `death` / `cancer` / `gun` 这类**本身是 CET 词**的严肃词汇保留中性例句。
   （第一版过滤过头，把 `shellfish` 里的 `hell`、`Hellebrandt` 里的 `hell` 都当脏词误杀了。）

---

## 5. 已知限制

1. **没有 PWA / Service Worker**：`file://` 下浏览器不允许注册 Service Worker（硬限制），与「双击即用」不可兼得。断网可玩这条本来就满足——整个 App 零网络请求。需要安装能力时在 `english-rpg/` 下起一个静态服务器即可（`python -m http.server`），代码不用改。
2. **`file://` 下的浏览器差异**：个别浏览器对 `file://` 的 `localStorage` 有更严格的策略；若写入失败，App 顶部会出现「本次进度未保存」提示条，游戏仍可继续，但刷新会丢进度。换用静态服务器或换浏览器可解决。
3. **语音依赖系统语音包**：发音走 `speechSynthesis`，中文系统上英文语音可能缺失或音质一般；听音辨词题（Q4）在检测不到 TTS 时会自动从本局题型中移除，权重按比例分给其他题型，不影响开局。
4. **只有深色主题**：`tokens.css` 里保留了浅色主题变量（含 v0.2 新增的 `--gold-text` / `--success-text` 对照），但还没有主题切换开关。
5. **视觉验收是人工完成的**：本机沙箱内无法启动 headless 浏览器（进程间命名管道被拒），所以自动验收覆盖的是"逻辑 + DOM 结构 + 交互"，**CSS 布局与绘制需要在真浏览器里肉眼确认**——包括 360px 下的不溢出与点击区尺寸。可执行的部分已尽量交给脚本：`node dev/check-mobile.mjs` 静态断言「viewport 不缩放 / 全局 border-box / 断行兜底 / xs 断点存在 / 页面级没有用 `overflow-x:hidden` 掩盖溢出 / 4 类触控目标 ≥44px」（当前通过 9 项，并做过 3 次变异测试确认它不是橡皮图章）；**渲染后是否真的没有横向滚动条仍须人眼复核**。
6. **词库有 224 条词只有英文例句、29 条词完全没有例句**：这些词在权威语料里找不到合格例句，或其最佳候选句被内容过滤挡掉（例如 `suicide` / `naked` 这类词本身）。它们仍可出选择题（Q1/Q2），只是不出例句填空（Q5）。`dev/check-words.mjs` 只把它们记为提醒，并设了覆盖率门槛（音标 ≥95%、例句 ≥90%）。
7. **部分例句的中文来自自动对齐语料**：`example_src=wikimatrix` 的 2042 条（占 35%）来自 OPUS WikiMatrix，是机器对齐的维基百科句对，**约 8~12% 可能中英不严格对应**（用数字一致性抽样估出）。英文例句本身与目标词用法一致，做题以英文为准；中文仅供辅助理解。想要 100% 可靠的中文，可只看 `example_src=tatoeba-pair` 的 3366 条。
8. **个别歧义词的释义与例句可能不同义项**：例如 `might` 标的是名词义（力量；权力），但语料里的 `might` 多为情态动词。这类词（`might` / `may` / `can` 等）在 ECDICT 里的义项顺序本身不按常用度排，自动判定无法完全消解。释义本身正确，遇到可疑词条可直接改 `app/data/words.json`。
9. **多标签页是"合并"而不是"实时同步"**：写盘前会读盘合并双方进度（徽章取并集、累计量取最大、roundId 去重），
   因此两边都不会丢；但界面上的数字要等下一次渲染才会反映对方的进度，不做逐秒同步。
10. **音效需要一次用户手势**：浏览器自动播放策略要求 AudioContext 在用户交互后才能发声，
    App 在首次 `pointerdown` / `keydown` / `touchstart` 时解锁（只解锁一次，之后不摘监听器）。
11. **词库总览页按页渲染**：5800+ 词的册子一次性塞进 DOM 会明显卡顿，所以改成「搜索 + 每组每页 100 条 + 加载更多」。
    搜索匹配拼写、释义与音标；分页状态不持久化（刷新回到第一页）。

---

## 6. v0.3 待办

- 把 `wikimatrix` 那 2042 条自动对齐的中文例句换成人工维护来源（Tatoeba 的英中句对已被榨干 3507 条，需要新语料源）。
- 补上 224 条只有英文例句的词的中文翻译。
- PWA 安装能力（`manifest.json` + Service Worker，需要静态服务器形态）。
- 浅色主题开关（变量已就绪）。
- 接入发音音频文件（替代系统 TTS）。
- 统计页的时间范围已支持近 7 / 30 天；下一步可加「全部」与按题型维度聚合。
- 存档导入/导出（`docs/03` §4.12 的 checksum 方案）。
- 每日任务的「任务池」抽换权重可配置化（当前是纯日期确定性轮换）。

---

## 7. 词库构建链路（v0.3 新增，可完整复现）

一次性跑，产物落在系统临时目录（`%TEMP%\wq-corpus`），**只有最后一步写进仓库**。
全部脚本零依赖，只用 Node 内置模块（`fetch` / `fs` / `zlib`）+ 本机的 7-Zip（解 bz2）。

```powershell
# 0. 词库草稿（CET 词表 + 英语例句候选）
node dev/build-cet-words.mjs      # ECDICT → 5802 个 CET 词（首次会下载 63MB 的 ecdict.csv）
node dev/fetch-corpus.mjs eng     # Tatoeba 英语句子（23.7MB，下完用 7z 解压）
node dev/fetch-corpus.mjs ipa     # ipa-dict 标准音标（2.5MB）
node dev/build-deck.mjs --match   # 匹配例句 + 内容过滤 + 词性对齐 → deck-draft.json

# 1. 中文例句（三层，质量从高到低）
node dev/fetch-corpus.mjs links   # Tatoeba 句对索引（143MB，双层压缩，解两次）
node dev/fetch-corpus.mjs cmn     # Tatoeba 中文句子（1.2MB）
node dev/merge-deck.mjs --links   # 捞出全部「英语↔中文」人工句对（约 21.5 万对）
node dev/build-examples-tatoeba.mjs   # ① 用人工句对配例句（覆盖 68%）
node dev/fetch-opus.mjs wikimatrix    # OPUS WikiMatrix（99MB）
node dev/build-examples-wm.mjs        # ② 自动对齐语料补空缺（覆盖 96%）

# 2. 合成与产出
node dev/merge-deck.mjs --apply   # 三层合并 + 去重 + 挖空校验 → deck-final.json
node dev/emit-deck.mjs            # 写 app/data/words.json 与 app/src/data/words.js

# 3. 复核（可选，给人看）
node dev/sample-final.mjs         # 按来源分层抽样
node dev/audit-deck.mjs           # 质量审计
node dev/audit-wm-align.mjs       # 估 WikiMatrix 对齐错误率
node dev/check-words.mjs          # 正式校验（必须「通过」）
```

> **踩过的坑都写在脚本注释里**，例如：Tatoeba 的 TSV 是三列（`id / lang / 句子`）不是两列；
> `links.tar.bz2` 是双层压缩要解两次；Tatoeba 的中文语料只有 8.9 万条，所以「英语句找中文」的命中率天然很低，
> 必须反过来用「先把人工句对全部捞出来，再拿去匹配 CET 词」才能把可靠中文覆盖率从 5% 提到 60%。
> 部分探针脚本（`probe-*.mjs` / `peek-*.mjs` / `diag-*.mjs`）用完已移出仓库，留在临时目录备查。
