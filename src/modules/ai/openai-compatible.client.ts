import { HttpError } from '../../lib/errors.js';
import type { AiProviderFailureDetails, AiResolvedProviderConfig } from './ai.types.js';

export class OpenAiCompatibleClient {
  async generateJson(args: {
    provider: AiResolvedProviderConfig;
    apiKey: string;
    model: string;
    systemPrompt?: string;
    userPrompt: string;
  }): Promise<Record<string, unknown>> {
    const attempt = await this.sendChatCompletion(args);

    if (!attempt.response.ok) {
      const parsedError = extractProviderError(attempt.rawBody);
      throw new HttpError(502, parsedError.message ?? 'AI provider request failed.', {
        provider: args.provider.id,
        providerStatus: attempt.response.status,
        responseBody: attempt.rawBody.slice(0, 500),
        providerErrorCode: parsedError.code,
        providerErrorParam: parsedError.param,
        retryAfterSeconds: parseRetryAfterSeconds(attempt.response.headers.get('retry-after')),
        failureKind: 'provider_response',
      } satisfies AiProviderFailureDetails);
    }

    let payload: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(attempt.rawBody) as unknown;
      payload = isRecord(parsed) ? parsed : null;
    } catch {
      payload = null;
    }

    const content = extractChoiceContent(payload);
    if (!content.trim()) {
      throw new HttpError(502, 'AI provider returned empty data.', {
        provider: args.provider.id,
        providerStatus: attempt.response.status,
        failureKind: 'invalid_response',
      });
    }

    try {
      const parsedContent = JSON.parse(extractJsonObject(content)) as unknown;
      if (!isRecord(parsedContent)) {
        throw new Error('AI provider response was not a JSON object.');
      }
      return parsedContent;
    } catch {
      throw new HttpError(502, 'AI provider returned invalid data.', {
        provider: args.provider.id,
        providerStatus: attempt.response.status,
        failureKind: 'invalid_response',
      });
    }
  }

  private async sendChatCompletion(
    args: {
      provider: AiResolvedProviderConfig;
      apiKey: string;
      model: string;
      systemPrompt?: string;
      userPrompt: string;
    },
  ): Promise<{ response: Response; rawBody: string }> {
    let response: Response;
    try {
      response = await fetch(args.provider.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(args.provider.httpReferer ? { 'HTTP-Referer': args.provider.httpReferer } : {}),
          ...(args.provider.title ? { 'X-Title': args.provider.title } : {}),
        },
        body: JSON.stringify({
          model: args.model,
          messages: [
            ...(args.systemPrompt
              ? [{ role: 'system', content: args.systemPrompt }]
              : []),
            { role: 'user', content: args.userPrompt },
          ],
        }),
      });
    } catch (error) {
      throw new HttpError(502, 'AI provider request failed.', {
        provider: args.provider.id,
        failureKind: 'network',
        errorMessage: error instanceof Error ? error.message : 'Unknown network error',
      } satisfies AiProviderFailureDetails);
    }

    return {
      response,
      rawBody: await response.text(),
    };
  }
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

function extractChoiceContent(payload: Record<string, unknown> | null): string {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : null;
  const message = isRecord(first?.message) ? first?.message : null;
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => extractContentPartText(part))
    .filter((value): value is string => value.length > 0)
    .join('\n');
}

function extractContentPartText(part: unknown): string {
  if (!isRecord(part)) {
    return '';
  }

  if (typeof part.text === 'string') {
    return part.text;
  }

  if (isRecord(part.text) && typeof part.text.value === 'string') {
    return part.text.value;
  }

  return '';
}

function extractProviderError(rawBody: string): { message: string | null; code?: string; param?: string } {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return { message: null };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) {
      const error = isRecord(parsed.error) ? parsed.error : null;
      if (typeof error?.message === 'string' && error.message.trim()) {
        return {
          message: error.message.trim(),
          code: typeof error.code === 'string' ? error.code.trim() || undefined : undefined,
          param: typeof error.param === 'string' ? error.param.trim() || undefined : undefined,
        };
      }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return {
          message: parsed.message.trim(),
          code: typeof parsed.code === 'string' ? parsed.code.trim() || undefined : undefined,
          param: typeof parsed.param === 'string' ? parsed.param.trim() || undefined : undefined,
        };
      }
    }
  } catch {
    return { message: trimmed };
  }

  return { message: trimmed };
}


function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }

  const retryDate = Date.parse(trimmed);
  if (!Number.isNaN(retryDate)) {
    const diffMs = retryDate - Date.now();
    return diffMs > 0 ? Math.ceil(diffMs / 1000) : undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
