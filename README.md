# README · 单词猎手 v0.2

游戏化背单词 App。**零依赖、零构建、双击即用、完全离线**。
本文件是交付说明：怎么打开、目录怎么读、想改数值改哪里、词库从哪来、已知限制是什么。

> **v0.2 新增（本轮）**：每日任务 + 随机宝箱（跨天正确结算，全部落 localStorage）、错题本「重练」冷却、
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
    ├── selfcheck.mjs            在 Node 里跑同一套数值断言（67 条）
    ├── sim-economy.mjs          v0.2 新增：30 天经济模拟（docs/01 A8 的四条区间断言）
    ├── dom-e2e.mjs              用极简 DOM 在 Node 里跑 99 条端到端验收
    ├── domshim.mjs              极简 DOM + 虚拟时钟 + 可注入的 localStorage 故障（写失败/配额/静默丢写/多标签事件）
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
node dev/sim-economy.mjs      # 30 天经济模拟（A8 四条区间）：详见输出末尾的断言汇总
```

> `sim-economy.mjs` 默认同时跑两套口径：`--scope=full`（当前生产路径，含每日任务/宝箱）与
> `--scope=legacy`（把 v0.2 留存收益置 0，与 docs/03 §5.5 的 v0.1 推导对齐）。
> 可用 `--days=`、`--acc=`、`--seed=` 覆盖默认的 30 天 / 75% 命中 / 固定种子。

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
4. **只有深色主题**：`tokens.css` 里保留了浅色主题变量（含 v0.2 新增的 `--gold-text` / `--success-text` 对照），但还没有主题切换开关。
5. **视觉验收是人工完成的**：本机沙箱内无法启动 headless 浏览器（进程间命名管道被拒），所以自动验收覆盖的是"逻辑 + DOM 结构 + 交互"，**CSS 布局与绘制需要在真浏览器里肉眼确认**——包括 360px 下的不溢出与点击区尺寸（本轮做了静态推导 + 尺寸断言，但没做像素级渲染实测）。
6. **词库是人工录入的**：释义与例句逐条核验过机器规则，但不是从权威词库导入，个别词的语感可能不完美；发现可疑词条直接改 `app/data/words.json` 后重跑 `node dev/check-words.mjs --write`。
7. **多标签页是"合并"而不是"实时同步"**：写盘前会读盘合并双方进度（徽章取并集、累计量取最大、roundId 去重），
   因此两边都不会丢；但界面上的数字要等下一次渲染才会反映对方的进度，不做逐秒同步。
8. **音效需要一次用户手势**：浏览器自动播放策略要求 AudioContext 在用户交互后才能发声，
   App 在首次 `pointerdown` / `keydown` / `touchstart` 时解锁（只解锁一次，之后不摘监听器）。

---

## 6. v0.3 待办

- PWA 安装能力（`manifest.json` + Service Worker，需要静态服务器形态）。
- 浅色主题开关（变量已就绪）。
- 词库扩到 500+ 词并接入发音音频文件（替代系统 TTS）。
- 统计页的时间范围已支持近 7 / 30 天；下一步可加「全部」与按关卡维度聚合。
- 存档导入/导出（`docs/03` §4.12 的 checksum 方案）。
- 每日任务的「任务池」抽换权重可配置化（当前是纯日期确定性轮换）。
