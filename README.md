# 🚆 agenttrain · 轨道调度

> 一个 **TypeScript + HTML5 Canvas + Vite** 写的 Mini Metro 风火车调度小游戏。
> 画线连接站点，让列车把形状各异的乘客送到对应终点站；别让任何一个站点堵爆。

## ✨ 特性

- **纯 Canvas 渲染**：零运行时依赖，浏览器打开即玩。
- **逻辑/渲染分离**：`simulation.ts` 是纯函数式状态步进，不碰 DOM，可单测。
- **固定步长主循环**：累加器模式按 `FIXED_STEP` 推进逻辑，高/低刷新率屏幕速度一致。
- **可复现随机**：mulberry32 带种子，方便确定性测试与调试。
- **完整的 Mini Metro 玩法**：拖拽建线、端点延伸、右键/双击删除、过载判负、难度递增。
- **8 倍大地图 + 摄像机**：3840×1200 世界，滚轮缩放、拖拽/方向键平移，开局自动 fit 到屏幕。
- **6 种道具 + 连击计分**：⚡加速/🧹清站/📦急送/🧲磁铁/🛡️护盾/✨双倍；连续送达累加倍率。
- **特殊站点**：🔀换乘站（任意乘客可上车）、💎奖励站（送达 ×2）。
- **难度档 + 最高分**：简单/普通/困难/专家四档，按难度分别记录 localStorage 最高分。
- **新手教程 + 暂停菜单**：首次进入 4 步交互引导；暂停可继续/重开/切难度/切 AI。
- **音效系统**：零依赖 Web Audio 合成，8 种游戏音效；`S` 键静音。
- **迷你地图**：左下角实时显示整个世界 + 站点/线路/摄像机视口框。
- **成就系统**：22 个成就（送达里程碑/连击/难度/道具/生存/挑战），localStorage 持久化。
- **本局统计**：结算面板汇总送达/存活时长(mm:ss)/平均效率(人/分钟)/线路数/最高连击。
- **视口剔除**：跳过摄像机视口外的站点/线路/列车/道具绘制，优化大地图性能。
- **插件化架构**：道具(`powerupRegistry.ts`)、事件(`eventRegistry.ts`)、成就(`achievements.ts`)全部注册表驱动，加新内容只需追加一个对象，不改核心代码。

## 🎮 玩法

1. **画线**：从一个站点按住鼠标拖到另一个站点 → 建立一条线路（自动配一列列车）。
2. **延伸**：按住一条线路的**端点站**拖到新站点 → 把这条线延长到那里。
3. **删除**：右键或双击一条线路 → 整条删除。
4. **运送**：列车沿线自动运行，到站时把去往「该站形状」的乘客送达（+1 分），
   并接走站台上「本线路能到达其目标形状」的乘客。
5. **别堵爆**：每个站点最多容纳 6 名乘客；**满载持续 6 秒**即线路瘫痪、Game Over。
6. **节奏**：随时间推移，新乘客/新站点出现得更快，并逐步解锁更稀有的站点形状。

**操作速查**

| 操作                  | 效果               |
| --------------------- | ------------------ |
| 从站点拖到另一站点    | 新建线路           |
| 拖线路端点站到新站    | 延伸该线路         |
| 右键 / 双击线路       | 删除该线路         |
| <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>/<kbd>4</kbd> | 开局选难度 |
| <kbd>R</kbd>          | 重新开始           |
| <kbd>P</kbd>          | 暂停 / 继续        |
| <kbd>A</kbd>          | 策略顾问（要建议） |
| <kbd>M</kbd>          | 自动 / 手动切换    |
| <kbd>N</kbd>          | 生成新剧本         |
| <kbd>S</kbd>          | 静音切换           |
| 任意键 / 点击（开局） | 开始游戏           |

## 🎚️ 难度档

四档由易到难，参数差异化（站点容量越小、宽限越短、乘客越快刷出、列车越慢 = 越难）：

| 档位   | 容量 | 满载宽限 | 乘客间隔 | 列车速度 |
| ------ | ---- | -------- | -------- | -------- |
| 简单   | 8    | 9s       | 7.0s     | 0.50 段/s |
| 普通   | 6    | 6s       | 5.5s     | 0.45 段/s |
| 困难   | 5    | 4s       | 4.0s     | 0.40 段/s |
| 专家   | 4    | 3s       | 3.2s     | 0.38 段/s |

最高分按难度档分别记录在 localStorage（升级到专家档后旧的三档存档自动兼容）。

## 🧲 道具

列车经过地图上的道具会自动拾取进背包（每种最多 3 个），按对应数字键使用：

| 道具 | 键 | 效果                                                 |
| ---- | -- | ---------------------------------------------------- |
| ⚡ 加速  | 1  | 8 秒内列车速度 ×2                                    |
| 🧹 清站  | 2  | 立即清空当前最堵的站点                               |
| 📦 急送  | 3  | 立即结算所有列车上的乘客                             |
| 🧲 磁铁  | 4  | 8 秒内列车上车忽略「目标形状可达」检查（任意可上车） |
| 🛡️ 护盾 | 5  | 清零所有满载站点的过载计时器（救场）                 |
| ✨ 双倍 | 6  | 10 秒内送达得分 ×2                                   |

连续送达会累加连击倍率（每 5 连 +0.5 倍），与双倍道具叠乘。

## 🏆 成就

22 个成就，Game Over 时按本局表现检测并解锁，localStorage 持久化：

| 成就         | 条件                       |
| ------------ | -------------------------- |
| 🌱 初出茅庐  | 单局送达 10 名乘客         |
| 🌿 渐入佳境  | 单局送达 50 名乘客         |
| 🌳 运输能手  | 单局送达 100 名乘客        |
| 🏔️ 调度大师  | 单局送达 200 名乘客        |
| 🔥 连击新手  | 达成 10 连击               |
| ⚡ 连击高手  | 达成 25 连击               |
| 💫 连击狂魔  | 达成 50 连击               |
| 🌀 极限连击  | 达成 100 连击              |
| ⚔️ 挑战者    | 困难难度下通关             |
| 💀 硬核调度  | 困难难度下单局送达 200     |
| 🏆 极限挑战  | 专家难度下通关             |
| 👑 调度之神  | 专家难度下单局送达 200     |
| 😊 简单也认真 | 简单难度下达成送达目标     |
| 👍 稳中求胜  | 普通难度下达成送达目标     |
| 🎖️ 全难通    | 四个难度都达成过送达目标   |
| 🧰 道具达人  | 单局使用 5 次道具          |
| 🚫 纯粹调度  | 单局不用任何道具且送达 50+ |
| 🕸️ 线路编织者 | 单局建立 10 条线路         |
| ⏰ 持久战    | 单局存活 5 分钟            |
| 🕐 马拉松    | 单局存活 10 分钟           |
| ⚡ 闪电通关  | 3 分钟内送达 50+           |

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（浏览器自动打开 localhost:5173）
npm run dev

# 3. 构建生产产物到 dist/
npm run build && npm run preview
```

> 需要 Node ≥ 20.19（建议 22）。

## 🤖 AI 模式（剧本生成 + 策略顾问 + 自动驾驶）

游戏内置三种 AI 增强，**全部可选、离线自动降级**——不配 key 也能完整玩，
AI 模块走本地启发式（Mock），HUD 会提示「AI 离线」。

### 架构（key 永不进浏览器）

```
浏览器 (Vite :5173) ──POST /api/chat──▶ 本地代理 (:5174, server/)
                                          │ 注入 Bearer key（来自 server/.env）
                                          ▼
                                   智谱 GLM / OpenAI / DeepSeek
```

代理用原生 `http` + 手写 `.env` loader（搬自 `agentresearch`），零新框架。
开发期 Vite 把 `/api` 代理到 5174，前端只调同源 `/api/chat`。

### 三个功能

| 功能         | 触发                            | 做什么                                                                      | 流量      |
| ------------ | ------------------------------- | --------------------------------------------------------------------------- | --------- |
| **剧本生成** | 开局 / 按 <kbd>N</kbd> 换新剧本 | LLM 生成城市名、速度倍率、事件（罢工/减速/高峰）、送达目标，注入运行参数    | 每局 1 次 |
| **策略顾问** | 每 30s 自动 / 按 <kbd>A</kbd>   | 把当前局势喂 LLM，返回一句话点评 + 一条建议（底部气泡，**只建议不代操作**） | 30s 一次  |
| **自动驾驶** | 按 <kbd>M</kbd> 切换            | 自动模式下 LLM 用 `create_line`/`extend_line`/`remove_line` 工具自主调度    | 5s 一次   |

### 接入真实 LLM

```bash
# 1. 复制环境模板
cp server/.env.example server/.env

# 2. 填入 key（智谱 / OpenAI / DeepSeek 任一 OpenAI 兼容服务）
#    AGENTTRAIN_LLM_BASE_URL=...
#    AGENTTRAIN_LLM_API_KEY=你的key
#    AGENTTRAIN_LLM_MODEL=glm-4-flash

# 3. 同时启动前端 + 代理（一条命令）
npm run dev:all
```

或分两个终端：`npm run dev` 和 `npm run server`。
没配 key 时代理对 `/api/chat` 返回 503，前端自动回退到 Mock，游戏照常可玩。

### AI 命令一览

| 命令                             | 说明                                |
| -------------------------------- | ----------------------------------- |
| `npm run dev:all`                | 同时跑前端（5173）+ AI 代理（5174） |
| `npm run server`                 | 单独跑 AI 代理（watch 模式）        |
| `curl localhost:5174/api/health` | 查看代理是否在线、是否配了 key      |

游戏内：<kbd>A</kbd> 顾问 · <kbd>M</kbd> 自动/手动切换 · <kbd>N</kbd> 生成新剧本。

## 📁 项目结构

```
agenttrain/
├─ src/
│  ├─ main.ts            # Vite 入口：主循环 + 输入 + AI 三模块装配
│  ├─ style.css          # 页面样式
│  ├─ input.ts           # 鼠标/键盘事件 → 结构操作（建线/延伸/删除意图）
│  ├─ render.ts          # Canvas 绘制：站点/线路/列车/乘客/HUD/顾问气泡/遮罩
│  ├─ utils/
│  │  └─ rng.ts          # mulberry32 带种子随机
│  ├─ game/
│  │  ├─ types.ts        # GameState / Station / Line / Train / Scenario / Event 类型
│  │  ├─ config.ts       # 可调常量（容量、速度、间隔、画布尺寸…）
│  │  ├─ state.ts        # 初始状态构造 + 站点/乘客生成 + 默认剧本
│  │  ├─ geometry.ts     # 线路几何：沿线定位、距离、命中
│  │  ├─ events.ts       # 剧本事件调度（罢工/减速/高峰）
│  │  ├─ simulation.ts   # ★ 核心纯函数步进 + 线路/列车结构操作
│  │  ├─ powerups.ts     # 道具系统（6 种）+ 连击计分
│  │  ├─ powerupRegistry.ts  # ★ 道具插件注册表（加新道具只需追加一项）
│  │  ├─ events.ts       # 剧本事件调度（罢工/减速/高峰）
│  │  ├─ eventRegistry.ts    # ★ 事件类型插件注册表
│  │  ├─ camera.ts       # 摄像机（缩放/平移大地图）
│  │  ├─ difficulty.ts   # 难度档（简单/普通/困难/专家）参数表
│  │  ├─ highscore.ts    # localStorage 最高分（按难度档，四档）
│  │  ├─ achievements.ts # ★ 成就系统（22 个）+ 注册表
│  │  ├─ stats.ts        # 本局统计汇总（效率/最长线路/完成度）
│  │  ├─ audio.ts        # 零依赖 Web Audio 音效合成（8 种）
│  │  ├─ shapes.ts       # 形状 → 展示字符（统一映射）
│  │  ├─ persist.ts      # 游戏进度存档（刷新可续局）
│  │  └─ tutorial.ts     # 新手教程 + 暂停菜单布局
│  └─ ai/
│     ├─ types.ts        # AIClient / Message / ToolDef 契约（对齐 agentresearch）
│     ├─ client.ts       # fetch /api/chat + 超时 + MockLLM 回退
│     ├─ scenario.ts     # AI 剧本生成 + JSON 解析校验
│     ├─ advisor.ts      # 策略顾问：局势快照 + 建议解析
│     ├─ tools.ts        # 把 simulation 函数包成 ToolDef（自动驾驶用）
│     └─ autopilot.ts    # 自动驾驶：function-calling 自主调度
├─ server/               # 本地 AI 代理（key 不进浏览器）
│  ├─ index.ts           # 原生 http，/api/chat → 注入 key 转发
│  ├─ env.ts             # 零依赖 .env loader（搬自 agentresearch）
│  ├─ retry.ts           # 指数退避重试（搬自 agentresearch）
│  └─ .env.example       # AGENTTRAIN_LLM_BASE_URL/API_KEY/MODEL
├─ test/                 # node:test 单测（rng / geometry / simulation / events / scenario / advisor）
├─ index.html            # <canvas> + 引入 /src/main.ts
├─ vite.config.ts        # 开发期把 /api 代理到 :5174
├─ package.json
├─ tsconfig.json
├─ eslint.config.js
└─ .github/workflows/ci.yml
```

## 🧩 关键设计

- **`simulation.ts` 是唯一会改 `GameState` 的逻辑层**，且完全纯函数化（`step(state, dt, rng) → state`），
  不 import 任何 DOM/Canvas。这使得整套游戏规则可以用 `node --test` 离线单测。
- **`render.ts` 只读 `GameState`**，负责一切绘制；它和 `input.ts` 都不直接驱动时间，
  时间只由 `main.ts` 的累加器主循环按 `FIXED_STEP` 喂给 `step`。
- **`input.ts` 只做「意图解析」**：把原始事件翻译成对线路/列车的结构变更（调用 simulation 导出的
  `createLine`/`extendLine`/`removeLine`），保持 UI 与逻辑解耦。

## 🔧 如何调整游戏平衡

所有可调参数集中在 `src/game/config.ts`，例如：

| 常量                 | 含义                           |
| -------------------- | ------------------------------ |
| `STATION_CAPACITY`   | 站点最大乘客数（越大众越容易） |
| `OVERLOAD_GRACE`     | 满载后宽限秒数                 |
| `TRAIN_SPEED`        | 列车速度（段/秒）              |
| `PASSENGER_INTERVAL` | 新乘客基础生成间隔             |
| `STATION_INTERVAL`   | 新站点生成间隔                 |

## 🧪 测试与质量

```bash
npm test           # node:test 单测（rng / geometry / simulation）
npm run type-check # TypeScript 严格类型检查
npm run lint       # ESLint
npm run format     # Prettier 格式化
```

测试覆盖（316 用例）：随机数可复现与区间、沿线定位/点段距离、建线/延伸/删除、装卸客加分、
过载判负精确帧数与多站点同时满载、满载-清空-再满载恢复、剧本事件调度与同时刻多触发、
surge 事件乘客翻倍、稀有形状解锁时机（30s/60s）、6 种道具效果/持续/刷新叠加/冲突、
四档难度差异化与升降档、22 个成就解锁边界与注册表完整性、本局统计派生与格式化、
AI 剧本解析容错、顾问建议映射、自动驾驶工具包装。

## 📜 命令一览

| 命令                              | 说明                                  |
| --------------------------------- | ------------------------------------- |
| `npm run dev`                     | 启动 Vite 开发服务器（前端，5173）    |
| `npm run dev:all`                 | 同时启动前端（5173）+ AI 代理（5174） |
| `npm run server`                  | 单独启动 AI 代理（watch 模式，5174）  |
| `npm run build`                   | 类型检查 + 生产构建到 `dist/`         |
| `npm run preview`                 | 预览生产构建                          |
| `npm run type-check`              | `tsc --noEmit`                        |
| `npm test`                        | 运行单元测试（316 个）                |
| `npm run lint` / `lint:fix`       | ESLint 检查 / 自动修复                |
| `npm run format` / `format:check` | Prettier 格式化 / 检查                |

## 📄 许可

私有项目，仅用于个人学习与娱乐。
