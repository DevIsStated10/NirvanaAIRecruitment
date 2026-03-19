/**
 * ollamaService.ts
 * Optimised Ollama client for the recruitment platform.
 */

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen'; // Defaulting to qwen as requested

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaOptions {
  model?: string;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  num_ctx?: number;
  stop?: string[];
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 3.5);
}

function trimHistory(messages: Message[], maxTokens = 2000) {
  let totalTokens = 0;
  const trimmed: Message[] = [];
  const systemMsg = messages.find(m => m.role === 'system');

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'system') continue;
    const tokens = estimateTokens(msg.content);
    if (totalTokens + tokens > maxTokens) break;
    trimmed.unshift(msg);
    totalTokens += tokens;
  }

  return systemMsg ? [systemMsg, ...trimmed] : trimmed;
}

export async function* streamChat(messages: Message[], options: OllamaOptions = {}) {
  const payload = {
    model: options.model || DEFAULT_MODEL,
    messages: trimHistory(messages),
    stream: true,
    options: {
      temperature: options.temperature ?? 0.3,
      top_k: options.top_k ?? 30,
      top_p: options.top_p ?? 0.9,
      num_ctx: options.num_ctx ?? 4096,
      stop: options.stop || ['</s>', '<|im_end|>', '\n\n\n'],
    },
  };

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    }

    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            yield json.message.content;
          }
          if (json.done) return;
        } catch (e) {
          // Partial JSON
        }
      }
    }
  } catch (err) {
    console.error('Ollama stream error:', err);
    throw err;
  }
}

export async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.models;
  } catch {
    return false;
  }
}

export async function getModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.models || [];
  } catch {
    return [];
  }
}
