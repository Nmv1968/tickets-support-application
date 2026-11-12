import Anthropic from '@anthropic-ai/sdk';
import { AiError } from './types';
import type { AiAdapter, AiModelInfo } from './types';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const DEFAULT_MAX_TOKENS = 16_000;

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError('Anthropic rechazó la API key.');
  }
  if (error instanceof Anthropic.NotFoundError) return new AiError('Anthropic no encontró el modelo seleccionado.');
  if (error instanceof Anthropic.RateLimitError) return new AiError('Límite de uso alcanzado en Anthropic. Intenta más tarde.');
  if (error instanceof Anthropic.APIConnectionError) return new AiError('No se pudo conectar con Anthropic.');
  if (error instanceof Anthropic.APIError) return new AiError(`Anthropic respondió HTTP ${error.status}: ${error.message}`);
  return new AiError('Error inesperado al llamar a Anthropic.');
}

export const anthropicAdapter: AiAdapter = {
  async listModels({ apiKey }) {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 });
    try {
      const models: AiModelInfo[] = [];
      for await (const model of client.models.list()) {
        // `capabilities` is an untyped tree with `supported` at each leaf.
        const capabilities = (model as { capabilities?: { image_input?: { supported?: boolean } } }).capabilities;
        models.push({ id: model.id, name: model.display_name, vision: capabilities?.image_input?.supported ?? null });
      }
      return models;
    } catch (error) {
      throw toAiError(error);
    }
  },

  async complete({ apiKey }, req) {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
    try {
      // The user picks any model the key offers; older ones allow fewer output tokens than the default.
      let maxTokens = DEFAULT_MAX_TOKENS;
      try {
        const limit = ((await client.models.retrieve(req.model)) as { max_tokens?: number | null }).max_tokens;
        if (limit) maxTokens = Math.min(maxTokens, limit);
      } catch {
        // Keep the default; the request below reports a wrong model or key.
      }

      const response = await client.messages.create({
        model: req.model,
        max_tokens: maxTokens,
        system: req.system,
        messages: [
          {
            role: 'user',
            content: [
              ...req.images.map((image) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: image.mime as ImageMediaType, data: image.base64 },
              })),
              { type: 'text' as const, text: req.text },
            ],
          },
        ],
      });

      if (response.stop_reason === 'refusal') throw new AiError('El modelo se negó a procesar este contenido.');
      if (response.stop_reason === 'max_tokens') throw new AiError('La respuesta del modelo quedó incompleta.');

      let text = '';
      for (const block of response.content) {
        if (block.type === 'text') text += block.text;
      }
      return text;
    } catch (error) {
      throw toAiError(error);
    }
  },
};
