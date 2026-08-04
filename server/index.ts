/**
 * 本地代理服务端。
 *
 * 浏览器（agenttrain 前端）只与本服务通信：POST /api/chat，
 * 由本服务注入 API Key 后转发到 OpenAI 兼容的 chat completions 接口。
 *
 * 这样 API Key 永不进入浏览器，也不出现在前端构建产物里。
 *
 * 环境变量（见 .env.example）：
 *   AGENTTRAIN_LLM_BASE_URL   服务地址（OpenAI 兼容）
 *   AGENTTRAIN_LLM_API_KEY    API Key（空 → 返回 503，前端据此回退到离线模式）
 *   AGENTTRAIN_LLM_MODEL      模型名
 *   AGENTTRAIN_LLM_RETRIES    重试次数
 *   AGENTTRAIN_PORT           本服务监听端口（默认 5174）
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { env, loadEnv } from './env.ts';
import { isRetryableStatus, withRetry } from './retry.ts';

loadEnv();

const PORT = Number(env('AGENTTRAIN_PORT', '5174'));
const BASE_URL = env('AGENTTRAIN_LLM_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4').replace(
  /\/$/,
  '',
);
const API_KEY = env('AGENTTRAIN_LLM_API_KEY');
const MODEL = env('AGENTTRAIN_LLM_MODEL', 'glm-4-flash');
const RETRIES = Number(env('AGENTTRAIN_LLM_RETRIES', '3')) || 3;

/** 浏览器发来的请求体。tools 为可选的 OpenAI 风格工具描述数组。 */
interface ChatRequestBody {
  messages: unknown[];
  tools?: unknown[];
}

/** 健康检查：返回服务状态（是否配置了 key）。 */
function handleHealth(res: ServerResponse): void {
  sendJson(res, 200, {
    ok: true,
    configured: Boolean(API_KEY),
    model: MODEL,
  });
}

/** 主路由：转发到 LLM。 */
async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  let parsed: ChatRequestBody;
  try {
    parsed = JSON.parse(body) as ChatRequestBody;
  } catch {
    sendJson(res, 400, { error: '请求体不是合法 JSON。' });
    return;
  }
  if (!parsed.messages || !Array.isArray(parsed.messages)) {
    sendJson(res, 400, { error: '缺少 messages 字段。' });
    return;
  }

  if (!API_KEY) {
    // 请求合法但服务端未配 key：明确返回 503，让前端回退到 MockLLM
    sendJson(res, 503, {
      error: 'AGENTTRAIN_LLM_API_KEY 未配置，请在 server/.env 中设置。',
    });
    return;
  }

  const url = `${BASE_URL}/chat/completions`;
  const payload: Record<string, unknown> = {
    model: MODEL,
    messages: parsed.messages,
  };
  if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
    payload.tools = parsed.tools;
  }

  try {
    const data = await withRetry(
      async () => {
        const llmResp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify(payload),
        });

        if (!llmResp.ok) {
          const text = await llmResp.text().catch(() => '');
          const err = new Error(`LLM 请求失败 ${llmResp.status}: ${text || llmResp.statusText}`);
          if (!isRetryableStatus(llmResp.status)) throw err; // 4xx 直接抛
          throw err; // 可重试状态码交给 withRetry
        }
        return (await llmResp.json()) as unknown;
      },
      {
        retries: RETRIES,
        retryOn: (e) => {
          const msg = e instanceof Error ? e.message : '';
          return /LLM 请求失败 (429|5\d\d)/.test(msg) || !msg.includes('LLM 请求失败 4');
        },
      },
    );

    sendJson(res, 200, { ok: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, 502, { error: `LLM 调用失败：${msg}` });
  }
}

/** 读取请求体（限定最大 1MB，防滥用）。 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveRead, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('请求体过大（>1MB）'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveRead(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const json = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

const server = createServer((req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = req.url ?? '';
  if (req.method === 'GET' && (url === '/' || url === '/api/health')) {
    handleHealth(res);
    return;
  }
  if (req.method === 'POST' && url === '/api/chat') {
    handleChat(req, res).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 500, { error: `服务器内部错误：${msg}` });
    });
    return;
  }
  sendJson(res, 404, { error: 'Not Found' });
});

// 只在直接运行时启动监听（被 import 时不 listen，便于单测）
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(PORT, () => {
    console.log(`🤖 agenttrain AI 代理已启动: http://localhost:${PORT}`);
    console.log(`   模型: ${MODEL}   key 已配置: ${API_KEY ? '是' : '否（将走离线 Mock）'}`);
  });
}
