import { AiError, httpJson, providerError } from './types';
import type { AiAdapter, AiModelInfo } from './types';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiModel {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

/** The key travels in a header, never in the URL. */
function headers(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

export const geminiAdapter: AiAdapter = {
  async listModels({ apiKey }) {
    const models: AiModelInfo[] = [];
    let pageToken = '';
    do {
      const url = `${GEMINI_URL}/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const { status, body } = await httpJson(url, { headers: headers(apiKey) }, 30_000);
      if (status !== 200) throw providerError(status, body);
      const page = (body ?? {}) as { models?: GeminiModel[]; nextPageToken?: string };
      for (const model of page.models ?? []) {
        if (!model.name || !model.supportedGenerationMethods?.includes('generateContent')) continue;
        const id = model.name.replace(/^models\//, '');
        models.push({ id, name: model.displayName ?? id, vision: null });
      }
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return models;
  },

  async complete({ apiKey }, req) {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: req.text },
            ...req.images.map((image) => ({ inlineData: { mimeType: image.mime, data: image.base64 } })),
          ],
        },
      ],
      ...(req.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    };
    const url = `${GEMINI_URL}/models/${encodeURIComponent(req.model)}:generateContent`;
    const result = await httpJson(url, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) }, 120_000);
    if (result.status !== 200) throw providerError(result.status, result.body);

    const candidates = (result.body as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null)?.candidates;
    const text = (candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
    if (!text) throw new AiError('El modelo no devolvió texto. Puede haber bloqueado el contenido.');
    return text;
  },
};
