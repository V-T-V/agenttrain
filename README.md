# 🚆 agenttrain · 轨道调度

> 一个 **TypeScript + HTML5 Canvas + Vite** 写的 Mini Metro 风火车调度小游戏。
> 画线连接站点，让列车把形状各异的乘客送到对应终点站；别让任何一个站点堵爆。

## ✨ 特性

- **纯 Canvas 渲染**：零运行时依赖，浏览器打开即玩。
- **逻辑/渲染分离**：`simulation.ts` 是纯函数式状态步进，不碰 DOM，可单测。
- **固定步长主循环**：累加器模式按 `FIXED_STEP` 推进逻辑，高/低刷新率屏幕速度一致。
- **可复现随机**：mulberry32 带种子，方便确定性测试与调试。
- **完整的 Mini Metro 玩法**：拖拽建线、端点延伸、右键/双击删除、过载判负、难度递增。

## 🎮 玩法

1. **画线**：从一个站点按住鼠标拖到另一个站点 → 建立一条线路（自动配一列列车）。
2. **延伸**：按住一条线路的**端点站**拖到新站点 → 把这条线延长到那里。
3. **删除**：右键或双击一条线路 → 整条删除。
4. **运送**：列车沿线自动运行，到站时把去往「该站形状」的乘客送达（+1 分），
   并接走站台上「本线路能到达其目标形状」的乘客。
5. **别堵爆**：每个站点最多容纳 6 名乘客；**满载持续 6 秒**即线路瘫痪、Game Over。
6. **节奏**：随时间推移，新乘客/新站点出现得更快，并逐步解锁更稀有的站点形状。

**操作速查**

| 操作 | 效果 |
|------|------|
| 从站点拖到另一站点 | 新建线路 |
| 拖线路端点站到新站 | 延伸该线路 |
| 右键 / 双击线路 | 删除该线路 |
| <kbd>R</kbd> | 重新开始 |
| <kbd>P</kbd> | 暂停 / 继续 |
| 任意键 / 点击（开局） | 开始游戏 |

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

| 功能 | 触发 | 做什么 | 流量 |
|------|------|--------|------|
| **剧本生成** | 开局 / 按 <kbd>N</kbd> 换新剧本 | LLM 生成城市名、速度倍率、事件（罢工/减速/高峰）、送达目标，注入运行参数 | 每局 1 次 |
| **策略顾问** | 每 30s 自动 / 按 <kbd>A</kbd> | 把当前局势喂 LLM，返回一句话点评 + 一条建议（底部气泡，**只建议不代操作**） | 30s 一次 |
| **自动驾驶** | 按 <kbd>M</kbd> 切换 | 自动模式下 LLM 用 `create_line`/`extend_line`/`remove_line` 工具自主调度 | 5s 一次 |

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

| 命令 | 说明 |
|------|------|
| `npm run dev:all` | 同时跑前端（5173）+ AI 代理（5174） |
| `npm run server` | 单独跑 AI 代理（watch 模式） |
| `curl localhost:5174/api/health` | 查看代理是否在线、是否配了 key |

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
│  │  └─ simulation.ts   # ★ 核心纯函数步进 + 线路/列车结构操作
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

| 常量 | 含义 |
|------|------|
| `STATION_CAPACITY` | 站点最大乘客数（越大众越容易） |
| `OVERLOAD_GRACE` | 满载后宽限秒数 |
| `TRAIN_SPEED` | 列车速度（段/秒） |
| `PASSENGER_INTERVAL` | 新乘客基础生成间隔 |
| `STATION_INTERVAL` | 新站点生成间隔 |

## 🧪 测试与质量

```bash
npm test           # node:test 单测（rng / geometry / simulation）
npm run type-check # TypeScript 严格类型检查
npm run lint       # ESLint
npm run format     # Prettier 格式化
```

测试覆盖：随机数可复现与区间、沿线定位/点段距离、建线/延伸/删除、装卸客加分、
过载触发 Game Over、非运行阶段不推进、剧本事件调度、
AI 剧本解析容错、顾问建议映射、自动驾驶工具包装。

## 📜 命令一览

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（前端，5173） |
| `npm run dev:all` | 同时启动前端（5173）+ AI 代理（5174） |
| `npm run server` | 单独启动 AI 代理（watch 模式，5174） |
| `npm run build` | 类型检查 + 生产构建到 `dist/` |
| `npm run preview` | 预览生产构建 |
| `npm run type-check` | `tsc --noEmit` |
| `npm test` | 运行单元测试（60 个） |
| `npm run lint` / `lint:fix` | ESLint 检查 / 自动修复 |
| `npm run format` / `format:check` | Prettier 格式化 / 检查 |

## 📄 许可

私有项目，仅用于个人学习与娱乐。
