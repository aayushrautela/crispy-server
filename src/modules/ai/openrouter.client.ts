import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterClient {
  async generateJson(args: {
    apiKey: string;
    model: string;
    systemPrompt?: string;
    userPrompt: string;
  }): Promise<Record<string, unknown>> {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'HTTP-Referer': env.openrouterHttpReferer,
        'X-Title': env.openrouterTitle,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          ...(args.systemPrompt
            ? [{ role: 'system', content: args.systemPrompt }]
            : []),
          { role: 'user', content: args.userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new HttpError(502, extractProviderMessage(rawBody) ?? 'OpenRouter request failed.', {
        provider: 'openrouter',
        providerStatus: response.status,
        responseBody: rawBody.slice(0, 500),
      });
    }

    let payload: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      payload = isRecord(parsed) ? parsed : null;
    } catch {
      payload = null;
    }

    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    const first = isRecord(choices[0]) ? choices[0] : null;
    const message = isRecord(first?.message) ? first?.message : null;
    const content = typeof message?.content === 'string' ? message.content : '';
    if (!content.trim()) {
      throw new HttpError(502, 'OpenRouter returned empty data.', {
        provider: 'openrouter',
        providerStatus: response.status,
      });
    }

    try {
      const parsedContent = JSON.parse(extractJsonObject(content)) as unknown;
      if (!isRecord(parsedContent)) {
        throw new Error('OpenRouter response was not a JSON object.');
      }
      return parsedContent;
    } catch {
      throw new HttpError(502, 'OpenRouter returned invalid data.', {
        provider: 'openrouter',
        providerStatus: response.status,
      });
    }
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

function extractProviderMessage(rawBody: string): string | null {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) {
      const error = isRecord(parsed.error) ? parsed.error : null;
      if (typeof error?.message === 'string' && error.message.trim()) {
        return error.message.trim();
      }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
