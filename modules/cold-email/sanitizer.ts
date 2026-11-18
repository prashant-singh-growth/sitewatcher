import type { ColdEmailOutputs } from './types';

export const BANNED_PHRASES = [
  'delve',
  'leverage',
  'utilize',
  'unlock',
  'elevate',
  'streamline',
  'supercharge',
  'game-changer',
  'cutting-edge',
  'revolutionary',
  'seamless',
  'robust',
  'holistic',
  'synergy',
  'innovative',
  'transform',
  'empower',
  "in today's fast-paced world",
  'in the ever-evolving landscape',
  'i came across',
  'i stumbled upon',
  'i noticed that you',
  "hope you're doing well",
  'reach out',
  'touch base',
  'circle back',
  'quick question',
  "i'd love to",
  'thrilled',
  'excited to',
  'as a leader in',
  'take it to the next level',
  'look no further'
];

// Regex matching common emojis
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{200D}\u{FE0F}]/gu;

/**
 * Sanitizes an email string to enforce human-like, non-AI styling:
 * - Replaces em dashes (—) and en dashes (–)
 * - Strips emojis and markdown symbols
 * - Normalizes line breaks and whitespace
 * - Replaces semicolons and ellipses
 */
export function sanitizeEmailText(text: string): string {
  if (!text) return '';

  let s = String(text);

  // 1. Strip emojis
  s = s.replace(EMOJI_REGEX, '');

  // 2. Replace em dash (—) and en dash (–)
  // Number/date range e.g. 2–3 -> 2-3
  s = s.replace(/(\d+)\s*[–—]\s*(\d+)/g, '$1-$2');
  // Word — Word with spaces -> replace with comma
  s = s.replace(/\s+[—–]\s+/g, ', ');
  // Word—Word without spaces -> replace with comma + space
  s = s.replace(/([a-zA-Z0-9])\s*[—–]\s*([a-zA-Z0-9])/g, '$1, $2');
  // Any leftover dashes
  s = s.replace(/[—–]/g, '-');

  // 3. Remove semicolons (replace with comma or period)
  s = s.replace(/;\s*/g, ', ');

  // 4. Remove ellipses (... or …) -> single period
  s = s.replace(/\.{2,}/g, '.');
  s = s.replace(/…/g, '.');

  // 5. Strip markdown bold (**text** or __text__), italics (*text*), headers (# Header), backticks (`code`)
  s = s.replace(/\*\*(.*?)\*\*/g, '$1');
  s = s.replace(/__(.*?)__/g, '$1');
  s = s.replace(/\*([^\s*][^*]*[^\s*])\*/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  // Strip bullet markers at start of line
  s = s.replace(/^[-*•]\s+/gm, '');

  // 6. Normalize punctuation artifacts (e.g. ",,", ", .", ". ,")
  s = s.replace(/,\s*,/g, ',');
  s = s.replace(/,\s*\./g, '.');
  s = s.replace(/\.\s*,/g, '.');
  s = s.replace(/\s{2,}/g, ' ');

  // 7. Normalize line breaks (keep paragraph breaks, remove triple+ breaks)
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

// Precompiled regexes supporting stems, inflections, and punctuation variants
const BANNED_PATTERNS: Record<string, RegExp> = {
  'delve': /\bdelv(?:e|es|ed|ing)\b/i,
  'leverage': /\bleverag(?:e|es|ed|ing)\b/i,
  'utilize': /\butiliz(?:e|es|ed|ing)\b/i,
  'unlock': /\bunlock(?:s|ed|ing)?\b/i,
  'elevate': /\belevat(?:e|es|ed|ing)\b/i,
  'streamline': /\bstreamlin(?:e|es|ed|ing)\b/i,
  'supercharge': /\bsupercharg(?:e|es|ed|ing)\b/i,
  'game-changer': /\bgame[- ]chang(?:er|ers|ing)\b/i,
  'cutting-edge': /\bcutting[- ]edge\b/i,
  'revolutionary': /\brevolutionary\b/i,
  'seamless': /\bseamless(?:ly)?\b/i,
  'robust': /\brobust(?:ly)?\b/i,
  'holistic': /\bholistic(?:ally)?\b/i,
  'synergy': /\bsynerg(?:y|ies)\b/i,
  'innovative': /\binnovat(?:ive|ively|e|es|ed|ing)\b/i,
  'transform': /\btransform(?:s|ed|ing|ation|ative)?\b/i,
  'empower': /\bempower(?:s|ed|ing|ment)?\b/i,
  "in today's fast-paced world": /\bin today['’]s fast[- ]paced world\b/i,
  'in the ever-evolving landscape': /\bin the ever[- ]evolving landscape\b/i,
  'i came across': /\bi came across\b/i,
  'i stumbled upon': /\bi stumbled upon\b/i,
  'i noticed that you': /\bi noticed that you\b/i,
  "hope you're doing well": /\bhope you['’]re doing well\b/i,
  'reach out': /\breach(?:es|ed|ing)?\s+out\b/i,
  'touch base': /\btouch(?:es|ed|ing)?\s+base\b/i,
  'circle back': /\bcircl(?:e|es|ed|ing)\s+back\b/i,
  'quick question': /\bquick\s+question\b/i,
  "i'd love to": /\b(?:i['’]?d|i\s+would)\s+love\s+to\b/i,
  'thrilled': /\bthrill(?:ed|ing|s)?\b/i,
  'excited to': /\bexcit(?:ed|ing)\s+to\b/i,
  'as a leader in': /\bas\s+a\s+leader\s+in\b/i,
  'take it to the next level': /\btake\s+it\s+to\s+the\s+next\s+level\b/i,
  'look no further': /\blook\s+no\s+further\b/i
};

/**
 * Searches for any banned phrases in the provided text.
 * Returns a list of found banned phrases (returns the canonical phrase from BANNED_PHRASES).
 */
export function findBannedPhrases(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found: string[] = [];

  for (const phrase of BANNED_PHRASES) {
    const regex =
      BANNED_PATTERNS[phrase] ||
      new RegExp(`\\b${escapeRegExp(phrase).replace(/['’]/g, "['’]").replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (regex.test(lower)) {
      found.push(phrase);
    }
  }

  return found;
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scans an entire ColdEmailOutputs object for banned phrases across all fields.
 */
export function checkOutputsForBannedPhrases(outputs: ColdEmailOutputs): string[] {
  const allTexts: string[] = [
    outputs.email || '',
    ...(outputs.subject_lines || []),
    ...(outputs.follow_ups || []).map(f => f.message || '')
  ];

  const combined = allTexts.join(' ');
  return findBannedPhrases(combined);
}

/**
 * Sanitizes all text fields within a ColdEmailOutputs object and checks for banned phrases.
 */
export function sanitizeColdEmailOutputs(outputs: ColdEmailOutputs): {
  sanitized: ColdEmailOutputs;
  bannedFound: string[];
} {
  const sanitized: ColdEmailOutputs = {
    subject_lines: Array.isArray(outputs.subject_lines)
      ? outputs.subject_lines.map(s => sanitizeEmailText(s).replace(/\.$/, ''))
      : [],
    email: sanitizeEmailText(outputs.email || ''),
    follow_ups: Array.isArray(outputs.follow_ups)
      ? outputs.follow_ups.map(f => ({
          day: Number(f.day) || 3,
          message: sanitizeEmailText(f.message || '')
        }))
      : [],
    personalization_used: sanitizeEmailText(outputs.personalization_used || '')
  };

  const bannedFound = checkOutputsForBannedPhrases(sanitized);

  return { sanitized, bannedFound };
}

/**
 * Resolves model name from env var or friendly aliases to official Anthropic model IDs.
 */
/**
 * Resolves the Claude model ID, translating friendly or alias names to valid Anthropic model IDs.
 */
export function resolveClaudeModel(requested?: string): string {
  const raw = requested || (typeof process !== 'undefined' ? process.env?.CLAUDE_COLD_EMAIL_MODEL : '') || 'claude-opus-5-5';
  const clean = raw.trim().replace(/^["']|["']$/g, '');
  const lower = clean.toLowerCase();

  if (
    lower === 'claude-opus-5-5' ||
    lower === 'claude-opus' ||
    lower === 'claude-3-opus'
  ) {
    return 'claude-opus-5-5';
  }

  // If sonnet 20241022 or unconfigured, default to working model claude-opus-5-5
  if (lower === 'claude-3-5-sonnet-20241022' || !clean) {
    return 'claude-opus-5-5';
  }

  return clean;
}

/**
 * Extracts and parses JSON from model response text, stripping markdown code fences,
 * repairing literal unescaped newlines/trailing commas, and offering regex fallback.
 */
export function extractJsonFromText(raw: string): any {
  let cleaned = String(raw || '').trim();

  // Strip code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // If there is any surrounding text outside the JSON object, extract outermost { ... }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // 1. First attempt: standard JSON.parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue to repair attempts
  }

  // 2. Second attempt: strip trailing commas before closing braces/brackets
  try {
    const noTrailingCommas = cleaned.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(noTrailingCommas);
  } catch {
    // Continue
  }

  // 3. Third attempt: escape literal unescaped control characters (newlines, carriage returns, tabs) inside string literals
  try {
    let inString = false;
    let escaped = false;
    let repaired = '';
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) {
        repaired += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        repaired += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        repaired += ch;
        continue;
      }
      if (inString) {
        if (ch === '\n') {
          repaired += '\\n';
        } else if (ch === '\r') {
          repaired += '\\r';
        } else if (ch === '\t') {
          repaired += '\\t';
        } else {
          repaired += ch;
        }
      } else {
        repaired += ch;
      }
    }
    const noTrailing = repaired.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(noTrailing);
  } catch {
    // Continue to regex fallback
  }

  // 4. Fourth attempt: regex extraction for standard schema fields if JSON syntax is damaged
  try {
    const emailMatch = /"email"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(cleaned);
    const subMatch = /"subject_lines"\s*:\s*\[([\s\S]*?)\]/.exec(cleaned);
    const fuMatch = /"follow_ups"\s*:\s*\[([\s\S]*?)\]/.exec(cleaned);
    const persMatch = /"personalization_used"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(cleaned);

    if (emailMatch) {
      const email = emailMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      let subjectLines: string[] = [];
      if (subMatch) {
        const lines = subMatch[1].match(/"((?:\\.|[^"\\])*)"/g);
        if (lines) {
          subjectLines = lines.map(s => s.slice(1, -1).replace(/\\"/g, '"'));
        }
      }

      let followUps: any[] = [];
      if (fuMatch) {
        try {
          followUps = JSON.parse(`[${fuMatch[1].replace(/,\s*([}\]])/g, '$1')}]`);
        } catch {
          const msgs = fuMatch[1].match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/g);
          if (msgs) {
            followUps = msgs.map((m, idx) => ({
              day: idx === 0 ? 3 : idx === 1 ? 7 : 14,
              message: m.replace(/^"message"\s*:\s*"/, '').replace(/"$/, '').replace(/\\n/g, '\n')
            }));
          }
        }
      }

      return {
        subject_lines: subjectLines,
        email,
        follow_ups: followUps,
        personalization_used: persMatch ? persMatch[1] : ''
      };
    }
  } catch {
    // Fall through to original JSON.parse to throw accurate SyntaxError
  }

  return JSON.parse(cleaned);
}

/**
 * Validates that the parsed JSON conforms to ColdEmailOutputs.
 */
export function validateOutputSchema(data: any): ColdEmailOutputs {
  if (!data || typeof data !== 'object') {
    throw new Error('Model did not return a JSON object.');
  }

  const subjectLines = Array.isArray(data.subject_lines)
    ? data.subject_lines.map((s: any) => String(s || '').trim()).filter(Boolean)
    : [];

  const email = String(data.email || '').trim();

  const followUps = Array.isArray(data.follow_ups)
    ? data.follow_ups.map((f: any, idx: number) => ({
        day: Number(f?.day) || (idx === 0 ? 3 : idx === 1 ? 7 : 14),
        message: String(f?.message || '').trim()
      }))
    : [];

  const personalizationUsed = String(data.personalization_used || '').trim();

  if (!email) {
    throw new Error('Model output missing "email" body.');
  }

  return {
    subject_lines: subjectLines.length > 0 ? subjectLines : ['Quick note', 'Question for you', 'Introduction'],
    email,
    follow_ups: followUps.length > 0 ? followUps : [
      { day: 3, message: 'Just following up on my previous note. Worth connecting?' },
      { day: 7, message: 'Any thoughts on this? Happy to share more details if helpful.' },
      { day: 14, message: 'Final check-in. Should I keep in touch or hold off for now?' }
    ],
    personalization_used: personalizationUsed || 'Personalized based on provided outreach details'
  };
}

/**
 * Strips HTML tags and decodes basic entities.
 */
function cleanHtml(raw: string): string {
  let text = raw;

  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  text = text.replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');

  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'");

  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n');
  return text.trim();
}

/**
 * Extracts visible high-signal text from an HTML document.
 */
export function extractPageSummary(html: string): string {
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const title = titleMatch ? cleanHtml(titleMatch[1]) : '';

  let metaDesc = '';
  const descMatch = /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)
    || /<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html)
    || /<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i.exec(html);
  if (descMatch) {
    metaDesc = cleanHtml(descMatch[1]);
  }

  const headings: string[] = [];
  const headingRegex = /<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 6) {
    const cleaned = cleanHtml(hMatch[1]);
    if (cleaned && cleaned.length > 3 && !headings.includes(cleaned)) {
      headings.push(cleaned);
    }
  }

  const bodyText = cleanHtml(html);

  const parts: string[] = [];
  if (title) parts.push(`Site Title: ${title}`);
  if (metaDesc) parts.push(`Meta Description: ${metaDesc}`);
  if (headings.length > 0) parts.push(`Key Headings: ${headings.join(' | ')}`);

  if (bodyText) {
    const bodySnippet = bodyText.slice(0, 1500).replace(/\s+/g, ' ');
    parts.push(`Page Copy Snippet: ${bodySnippet}`);
  }

  const combined = parts.join('\n\n');
  return combined.slice(0, 2500);
}
