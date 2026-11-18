import { ApiError } from '@/lib/errors';
import type { ColdEmailOutputs } from './types';
import {
  resolveClaudeModel,
  extractJsonFromText,
  validateOutputSchema
} from './sanitizer';

export { resolveClaudeModel, extractJsonFromText, validateOutputSchema };

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Executes a single Anthropic messages API request.
 */
async function callAnthropicApi(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string,
  apiKey: string,
  timeoutMs = 60_000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system: systemPrompt,
        messages
      }),
      signal: controller.signal,
      cache: 'no-store'
    });
//test
    const rawBody = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = {};
    }

    if (!res.ok) {
      console.error('[Claude API Error Response]:', res.status, rawBody);
      const errMsg = String(body?.error?.message || rawBody || `HTTP ${res.status}`)
        .replace(apiKey, '***')
        .slice(0, 300);
      if (res.status === 429) {
        throw new ApiError(429, 'Claude API rate limit reached. Please wait a moment and try again.');
      }
      if (res.status === 401) {
        throw new ApiError(503, 'Invalid Claude API key. Check ANTHROPIC_API_KEY on the server.');
      }
      throw new ApiError(res.status >= 500 ? 502 : 400, `Claude API error (${res.status}): ${errMsg}`);
    }

    // Extract text from content blocks (filter for type === 'text', skipping thinking or tool blocks)
    let text = '';
    if (Array.isArray(body?.content)) {
      const textBlocks = body.content.filter((b: any) => b?.type === 'text' && typeof b?.text === 'string');
      text = textBlocks.map((b: any) => b.text).join('\n').trim();
      if (!text && body.content[0]?.text) {
        text = String(body.content[0].text).trim();
      }
    } else if (typeof body?.text === 'string') {
      text = body.text.trim();
    }

    if (!text) {
      console.error('[Claude API] Empty content text in response. Body was:', JSON.stringify(body).slice(0, 500));
      throw new ApiError(502, 'Claude API returned an empty response.');
    }

    return text;
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new ApiError(504, 'Claude API request timed out after 60 seconds.');
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, String(err?.message || 'Failed to connect to Claude API.').replace(apiKey, '***').slice(0, 300));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls Claude to generate a cold email with automated JSON retry if parsing fails.
 */
export async function callClaudeForColdEmail(
  systemPrompt: string,
  userPrompt: string,
  extraInstructions?: string
): Promise<{ outputs: ColdEmailOutputs; modelUsed: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new ApiError(
      503,
      'Cold Email Generator is not configured: set ANTHROPIC_API_KEY on the server.',
      'claude_not_configured'
    );
  }

  const model = resolveClaudeModel();
  const prompt = extraInstructions
    ? `${userPrompt}\n\nIMPORTANT CORRECTION:\n${extraInstructions}`
    : userPrompt;

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: prompt }
  ];

  let rawResponse: string;
  try {
    rawResponse = await callAnthropicApi(systemPrompt, messages, model, apiKey);
  } catch (err) {
    throw err;
  }

  try {
    const parsed = extractJsonFromText(rawResponse);
    return {
      outputs: validateOutputSchema(parsed),
      modelUsed: model
    };
  } catch (parseError: any) {
    console.warn('[Claude API] First JSON parse attempt failed, retrying once...', parseError?.message);
    // Retry once on JSON parse failure
    const retryMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: prompt },
      { role: 'assistant', content: rawResponse || '{"error": "invalid"}' },
      {
        role: 'user',
        content: 'Your previous response was not valid JSON. Return ONLY the raw JSON object matching the exact schema specified in the system prompt. No markdown, no commentary, no code fences.'
      }
    ];

    try {
      const secondRaw = await callAnthropicApi(systemPrompt, retryMessages, model, apiKey);
      const secondParsed = extractJsonFromText(secondRaw);
      return {
        outputs: validateOutputSchema(secondParsed),
        modelUsed: model
      };
    } catch (secondErr: any) {
      console.error('[Claude API] Retry JSON parse also failed:', secondErr?.message);
      if (secondErr instanceof ApiError) throw secondErr;
      throw new ApiError(502, 'Claude response could not be parsed into valid cold email JSON. Please try again.');
    }
  }
}
