import { AiError, cleanBaseUrl, httpJson, providerError } from './types';
import type { AiAdapter, AiCredentials, AiRequest, HttpResult } from './types';

const OPENAI_URL = 'https://api.openai.com/v1';

/** Model families of api.openai.com that are not chat models. */
const NOT_CHAT = /embedding|whisper|tts|dall-e|moderation|audio|realtime|transcribe|image|babbage|davinci|sora|search/i;

/**
 * Where the requests go. OpenAI has one address and its key must not go anywhere else, so a
 * base URL in the credentials is not read for it. Only the compatible servers have their own
 * address, and without one there is nowhere to send their key.
 */
function baseUrl(cred: AiCredentials, isOpenAi: boolean): string {
  if (isOpenAi) return OPENAI_URL;
  const url = cleanBaseUrl(cred.baseUrl);
  if (!url) throw new AiError('Falta la URL del servidor.');
  if (!/^https?:\/\//i.test(url)) throw new AiError('La URL del servidor debe empezar con http:// o https://');
  return url;
}

function headers(cred: AiCredentials): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(cred.apiKey ? { Authorization: `Bearer ${cred.apiKey}` } : {}),
  };
}

function chat(url: string, cred: AiCredentials, req: AiRequest, jsonMode: boolean): Promise<HttpResult> {
  const body = {
    model: req.model,
    messages: [
      { role: 'system', content: req.system },
      {
        role: 'user',
        content: [
          { type: 'text', text: req.text },
          ...req.images.map((image) => ({
            type: 'image_url',
            image_url: { url: `data:${image.mime};base64,${image.base64}` },
          })),
        ],
      },
    ],
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  return httpJson(`${url}/chat/completions`, { method: 'POST', headers: headers(cred), body: JSON.stringify(body) }, 120_000);
}

/**
 * Chat Completions API. Serves api.openai.com and every server that copies its
 * shape (OpenRouter, Groq, Ollama, LM Studio…) through a custom base URL.
 */
export function openAiAdapter(isOpenAi: boolean): AiAdapter {
  return {
    async listModels(cred) {
      const { status, body } = await httpJson(`${baseUrl(cred, isOpenAi)}/models`, { headers: headers(cred) }, 30_000);
      if (status !== 200) throw providerError(status, body);
      // A compatible server is any address a user typed, and it can answer 200 with any JSON.
      // Only an object with a text id is a model; the rest is skipped.
      const data: unknown = (body as { data?: unknown } | null)?.data;
      const entries: unknown[] = Array.isArray(data) ? data : [];
      return entries
        .map((entry) => (entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined))
        .filter((id): id is string => typeof id === 'string' && id !== '' && (!isOpenAi || !NOT_CHAT.test(id)))
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id, name: id, vision: null }));
    },

    async complete(cred, req) {
      const url = baseUrl(cred, isOpenAi);
      let result = await chat(url, cred, req, req.json);
      // Some compatible servers reject `response_format`. The prompt already asks for JSON.
      if (req.json && result.status === 400) result = await chat(url, cred, req, false);
      if (result.status !== 200) throw providerError(result.status, result.body);

      const choices = (result.body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices;
      const content = choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content) throw new AiError('El modelo no devolvió texto.');
      return content;
    },
  };
}
