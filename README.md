# README · 单词猎手 v0.1

游戏化背单词 App。**零依赖、零构建、双击即用、完全离线**。
本文件是交付说明：怎么打开、目录怎么读、想改数值改哪里、词库从哪来、已知限制是什么。

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
│       │   ├── balance.js       XP / 金币 / 血量 / 连击 / 等级曲线 / SRS / 商店 / 题数
│       │   ├── questions.js     5 种题型定义、权重、干扰项首字规则
│       │   └── achievements.js  11 个徽章定义与进度口径
│       ├── core/                通用工具
│       │   ├── util.js          转义、本地日期、随机、克隆、编辑距离
│       │   ├── bus.js           发布订阅
│       │   ├── audio.js         WebAudio 音效 + TTS 发音
│       │   └── router.js        hash 路由与 404 兜底
│       ├── store/               状态与持久化（**全项目唯一能碰 localStorage 的地方**）
│       │   ├── save.js          存档默认值、版本迁移、结构补全
│       │   ├── persist.js       4 个键读写、损坏备份、配额裁剪、写失败不抛异常
│       │   ├── state.js         单例 store + 派生量 + 唯一变更入口 commit()
│       │   └── log.js           本地事件日志（环形缓冲 2000 条）
│       ├── game/                纯逻辑（不碰 DOM / localStorage / Math.random）
│       │   ├── level.js         等级曲线与升级结算
│       │   ├── srs.js           词进度与掌握判定
│       │   ├── streak.js        连续天数与冰冻卡/回补卡
│       │   ├── questionEngine.js 抽题型、生成干扰项、拼写判定、挖空
│       │   ├── questionPool.js  每局选词（优先级 100/80/60/20）
│       │   ├── achievements.js  徽章判定与精确进度
│       │   ├── shop.js          商店限购与待生效道具
│       │   ├── balance.js       单题判定、连击档位、结算落库（幂等）
│       │   └── flow.js          开局 / 逐题判定 / 结算的编排
│       ├── ui/                  渲染与事件委托
│       │   ├── shell.js         整页渲染 + #app 上的事件委托 + HUD
│       │   ├── toast.js / overlay.js / anim.js
│       │   ├── selfcheck.js     自检断言集（浏览器与 Node 共用同一套）
│       │   └── pages/           boot / home / battle / result / growth / shop / settings / selfcheck
│       └── main.js              启动编排
└── dev/                         开发期工具（删掉不影响页面运行）
    ├── check-words.mjs          词库校验 + 生成 words.js/words.json
    ├── selfcheck.mjs            在 Node 里跑同一套数值断言
    ├── dom-e2e.mjs              用极简 DOM 在 Node 里跑 73 条端到端验收
    ├── domshim.mjs              极简 DOM + 虚拟时钟实现
    ├── e2e.mjs                  真实浏览器 CDP 端到端脚本（需可用的 headless 浏览器）
    └── run-e2e.ps1              启动 headless Edge 并调用 e2e.mjs
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
| 题型权重 | `config/questions.js` 各题型的 `weight` | 合计 1.00；Q4 不可用时按比例分摊给其余 4 种 |
| 徽章奖励与条件 | `config/achievements.js` | 每条含 `condition`（纯函数）与 `progress`（进度口径） |
| 配色 / 圆角 / 动效时长 | `styles/tokens.css` | 全站唯一来源；`docs/02` §5 的 token 已全量落地 |
| 字号档位 | `styles/tokens.css` 的 `data-fontsize` 段 | 设置页可切标准/大/特大 |

**改完怎么验证**：浏览器打开 `#/selfcheck` 点「运行全部」，或在 `english-rpg/` 下执行
`node dev/selfcheck.mjs`（走的是同一套断言）。

---

## 4. 词库

- 规模：**200 词**，字段照 `docs/01` §5.2 的 12 项：`id / word / phonetic / pos / meaning_cn / meaning_en / example / example_cn / collins / frq / tags / audio_url`。
- 词性分布：`v.` 111 / `n.` 47 / `adj.` 22 / `adv.` 20（保证干扰项能凑出同词性候选）。
- 质量约束（由 `dev/check-words.mjs` 机器校验，全绿才算合格）：
  - `word / phonetic / meaning_cn / example` 非空率 100%；
  - 单词、id、例句均不重复；
  - 每条例句**恰好包含目标词 1 次**（Q5 挖空据此出题）；
  - 中文释义 ≤ 20 字，且不含「见 / 同上 / 参见」这类空释义；
  - 干扰项可生成率：Q1 100%、Q2 100%（要求 ≥ 95%）。
- 词库**不预存干扰项**（`docs/03` §0 裁决）：干扰项在运行时按「同词性优先 + 首字/首字母必须不同 + 同局不重复」生成，
  因此词库增删不会让干扰项失效。
- 授权与来源：仅自用学习，**不分发词库数据文件**；若将来上架必须替换为已授权词库。
- 重新生成数据文件：`node dev/check-words.mjs --write`。

---

## 5. 已知限制

1. **没有 PWA / Service Worker**：`file://` 下浏览器不允许注册 Service Worker（硬限制），与「双击即用」不可兼得。断网可玩这条本来就满足——整个 App 零网络请求。需要安装能力时在 `english-rpg/` 下起一个静态服务器即可（`python -m http.server`），代码不用改。
2. **`file://` 下的浏览器差异**：个别浏览器对 `file://` 的 `localStorage` 有更严格的策略；若写入失败，App 顶部会出现「本次进度未保存」提示条，游戏仍可继续，但刷新会丢进度。换用静态服务器或换浏览器可解决。
3. **语音依赖系统语音包**：发音走 `speechSynthesis`，中文系统上英文语音可能缺失或音质一般；听音辨词题（Q4）在检测不到 TTS 时会自动从本局题型中移除，权重按比例分给其他题型，不影响开局。
4. **只有深色主题**：`tokens.css` 里保留了浅色主题变量，但 v0.1 没有主题切换开关。
5. **视觉验收是人工完成的**：本机沙箱内无法启动 headless 浏览器（进程间命名管道被拒），所以自动验收覆盖的是"逻辑 + DOM 结构 + 交互"，**CSS 布局与绘制需要在真浏览器里肉眼确认**。docs/05 里列出了需要人工核对的具体几条。
6. **词库是人工录入的**：释义与例句逐条核验过机器规则，但不是从权威词库导入，个别词的语感可能不完美；发现可疑词条直接改 `app/data/words.json` 后重跑 `node dev/check-words.mjs --write`。
7. **未做多标签页写入合并**：检测到其他标签页写存档时只提示一句，等本局结束后才重新读档，不做实时合并。

---

## 6. v0.2 待办

- PWA 安装能力（`manifest.json` + Service Worker，需要静态服务器形态）。
- 浅色主题开关。
- 词库扩到 500+ 词并接入发音音频文件（替代系统 TTS）。
- 错题本「只打错词」的冷却策略细化、统计页时间范围切换。
- 存档导入/导出（`docs/03` §4.12 的 checksum 方案）。
