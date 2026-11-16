export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'compatible';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** The user must enter the server URL (OpenAI-compatible servers). */
  needsBaseUrl: boolean;
  /** Local servers such as Ollama accept requests without a key. */
  keyOptional: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', needsBaseUrl: false, keyOptional: false },
  { id: 'openai', label: 'OpenAI', needsBaseUrl: false, keyOptional: false },
  { id: 'gemini', label: 'Google Gemini', needsBaseUrl: false, keyOptional: false },
  { id: 'compatible', label: 'Compatible con OpenAI (OpenRouter, Groq, Ollama…)', needsBaseUrl: true, keyOptional: true },
];

export function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.some((p) => p.id === value);
}

export interface AiCredentials {
  apiKey: string;
  baseUrl?: string | null;
}

/**
 * The one spelling of a server URL: trimmed, without trailing slashes, null when empty. It is
 * stored, compared and called in this form, so two URLs that compare equal send their requests
 * to the same address. Nothing else is normalised on purpose: the same server written another
 * way counts as another URL, which only costs typing the key again.
 */
export function cleanBaseUrl(value: string | null | undefined): string | null {
  return value?.trim().replace(/\/+$/, '') || null;
}

/** What the user reads when a provider that needs the URL of its server (`needsBaseUrl`) has none. */
export const NO_BASE_URL = 'Falta la URL del servidor.';

export interface AiModelInfo {
  id: string;
  name: string;
  /** Whether the model reads images. Null when the provider does not say. */
  vision: boolean | null;
}

export interface AiImage {
  mime: string;
  base64: string;
}

export interface AiRequest {
  model: string;
  system: string;
  text: string;
  images: AiImage[];
  /** True when the answer must be a JSON object; adapters turn on the provider's JSON mode where it exists. */
  json: boolean;
}

export interface AiAdapter {
  listModels(cred: AiCredentials): Promise<AiModelInfo[]>;
  /** Returns the model's text answer. When `req.json` is set the caller also asks for JSON in the prompt and parses it. */
  complete(cred: AiCredentials, req: AiRequest): Promise<string>;
}

/** Error whose message is written for the end user (Spanish) and safe to show. */
export class AiError extends Error {}

export interface HttpResult {
  status: number;
  /** The parsed JSON of the response, or null when the server did not answer with JSON. */
  body: unknown;
}

/**
 * JSON request for the fetch-based adapters. Network failures become AiError, before the response
 * starts or in the middle of it.
 *
 * A body that is not JSON is dropped, not handed back as text. The URL can be any server a user
 * typed, including one that only this machine reaches, and what such a server answers must not
 * travel back to that user inside an error message.
 */
export async function httpJson(url: string, init: RequestInit, timeoutMs: number): Promise<HttpResult> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    // The body is read in here too: the timeout or a dropped connection can also come after the
    // headers, while the body is still arriving.
    text = await res.text();
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'tiempo de espera agotado' : 'sin conexión';
    throw new AiError(`No se pudo conectar con el proveedor de IA (${reason}).`);
  }
  try {
    return { status: res.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: res.status, body: null };
  }
}

/**
 * The provider's own error message: `error.message` (OpenAI, Gemini), `error` or `message` of a
 * JSON object. It is the only part of a response that reaches the user in an error.
 */
function errorDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as { error?: unknown; message?: unknown };
  if (typeof record.error === 'string') return record.error.slice(0, 300);
  if (record.error && typeof record.error === 'object') {
    const message = (record.error as { message?: unknown }).message;
    if (typeof message === 'string') return message.slice(0, 300);
  }
  if (typeof record.message === 'string') return record.message.slice(0, 300);
  return '';
}

export function providerError(status: number, body: unknown): AiError {
  const detail = errorDetail(body);
  const suffix = detail ? ` Detalle: ${detail}` : '';
  if (status === 401 || status === 403) return new AiError(`El proveedor rechazó la API key (HTTP ${status}).${suffix}`);
  if (status === 404) return new AiError(`El proveedor no encontró el modelo o la URL (HTTP 404).${suffix}`);
  if (status === 429) return new AiError(`Límite de uso alcanzado en el proveedor (HTTP 429).${suffix}`);
  return new AiError(`El proveedor de IA respondió HTTP ${status}.${suffix}`);
}
