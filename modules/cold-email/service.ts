import { db, rows } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { rateLimit } from '@/lib/ratelimit';
import type { ColdEmailInputs, ColdEmailOutputs, ColdEmailRecord } from './types';
import { SYSTEM_PROMPT, validateAndCleanInputs, buildUserPrompt } from './prompt';
import { sanitizeColdEmailOutputs } from './sanitizer';
import { fetchWebsiteContext } from './website';
import { callClaudeForColdEmail } from './client';

const DEFAULT_HOURLY_LIMIT = 30;

/**
 * Generates personalized cold emails, subject lines, and follow-ups with Claude.
 * Automatically enforces sparse input rules, SSRF-protected website scraping,
 * post-generation sanitization, banned-phrase auto-regeneration, rate limiting, and 7-day retention.
 */
export async function generateColdEmail(
  userId: number,
  rawInputs: any
): Promise<ColdEmailRecord> {
  const { inputs, hasAtLeastOne } = validateAndCleanInputs(rawInputs);
  if (!hasAtLeastOne) {
    throw new ApiError(400, 'Please fill in at least one field to generate a cold email.');
  }

  // Per-user rate limiting (configurable via env var)
  const hourlyLimit = Number(process.env.COLD_EMAIL_RATE_LIMIT_PER_HOUR) || DEFAULT_HOURLY_LIMIT;
  const rl = await rateLimit(`cold_email:user:${userId}`, hourlyLimit, 3600);
  if (!rl.allowed) {
    throw new ApiError(
      429,
      `Rate limit exceeded: You have reached the maximum of ${hourlyLimit} cold email generations per hour. Please try again in ${rl.retryAfter} seconds.`
    );
  }

  // 1. Fetch website context if a website URL is provided (SSRF-protected, safe failure)
  let websiteContext: string | null = null;
  if (inputs.companyWebsite) {
    websiteContext = await fetchWebsiteContext(inputs.companyWebsite);
  }

  // 2. Build user prompt reflecting sparse inputs
  const userPrompt = buildUserPrompt(inputs, websiteContext);

  // 3. Call Claude
  const { outputs: firstOutputs, modelUsed } = await callClaudeForColdEmail(
    SYSTEM_PROMPT,
    userPrompt
  );

  // 4. Code-level post-processing sanitizer (em dash removal, markdown stripping, emoji stripping)
  let { sanitized: finalOutputs, bannedFound } = sanitizeColdEmailOutputs(firstOutputs);

  // 5. If banned phrases remain, automatically regenerate ONCE with added instruction
  if (bannedFound.length > 0) {
    const correctionNotice = `The previous response contained forbidden phrases: [${bannedFound.join(', ')}]. Rewrite the entire output in full according to the instructions without using any of these banned words or phrases.`;
    try {
      const { outputs: retryOutputs } = await callClaudeForColdEmail(
        SYSTEM_PROMPT,
        userPrompt,
        correctionNotice
      );
      const secondSanitized = sanitizeColdEmailOutputs(retryOutputs);
      finalOutputs = secondSanitized.sanitized;
    } catch {
      // If regeneration fails, keep the sanitized first output
    }
  }

  // 6. Store in database with 7-day expiration
  const [insertRes] = await db.query<any>(
    `INSERT INTO cold_email_generations (
       user_id, inputs, outputs, model_used, created_at, expires_at
     ) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY))`,
    [
      userId,
      JSON.stringify(inputs),
      JSON.stringify(finalOutputs),
      modelUsed
    ]
  );

  const generationId = insertRes.insertId;

  // Retrieve stored record
  const saved = await getColdEmailGeneration(userId, generationId);
  if (!saved) {
    throw new ApiError(500, 'Failed to retrieve saved cold email generation.');
  }

  return saved;
}

/**
 * Returns a paginated list of non-expired cold email generations for the given user.
 */
export async function listColdEmailGenerations(
  userId: number,
  page = 1,
  limit = 10
): Promise<{ items: ColdEmailRecord[]; total: number; page: number; totalPages: number }> {
  const p = Math.max(1, page);
  const l = Math.min(50, Math.max(1, limit));
  const offset = (p - 1) * l;

  const countRows = await rows<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM cold_email_generations
     WHERE user_id = ? AND expires_at > UTC_TIMESTAMP(3)`,
    [userId]
  );
  const total = Number(countRows[0]?.cnt || 0);

  const r = await rows<any>(
    `SELECT id, user_id, inputs, outputs, model_used, created_at, expires_at
     FROM cold_email_generations
     WHERE user_id = ? AND expires_at > UTC_TIMESTAMP(3)
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, l, offset]
  );

  const items: ColdEmailRecord[] = r.map(mapRowToRecord);

  return {
    items,
    total,
    page: p,
    totalPages: Math.ceil(total / l) || 1
  };
}

/**
 * Retrieves a single non-expired cold email generation by ID belonging to the user.
 */
export async function getColdEmailGeneration(
  userId: number,
  id: number
): Promise<ColdEmailRecord | null> {
  const r = await rows<any>(
    `SELECT id, user_id, inputs, outputs, model_used, created_at, expires_at
     FROM cold_email_generations
     WHERE id = ? AND user_id = ? AND expires_at > UTC_TIMESTAMP(3)`,
    [id, userId]
  );

  if (!r[0]) return null;
  return mapRowToRecord(r[0]);
}

/**
 * Deletes a single cold email generation belonging to the user.
 */
export async function deleteColdEmailGeneration(
  userId: number,
  id: number
): Promise<boolean> {
  const [res] = await db.query<any>(
    'DELETE FROM cold_email_generations WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return (res.affectedRows || 0) > 0;
}

/**
 * Clears all cold email generations for the given user.
 */
export async function clearAllColdEmailGenerations(userId: number): Promise<number> {
  const [res] = await db.query<any>(
    'DELETE FROM cold_email_generations WHERE user_id = ?',
    [userId]
  );
  return Number(res.affectedRows || 0);
}

/**
 * Housekeeping job: deletes records older than 7 days.
 * Called automatically from the minute cron check.
 */
export async function purgeExpiredColdEmails(): Promise<number> {
  const [res] = await db.query<any>(
    'DELETE FROM cold_email_generations WHERE expires_at <= UTC_TIMESTAMP(3)'
  );
  return Number(res.affectedRows || 0);
}

function mapRowToRecord(row: any): ColdEmailRecord {
  let inputs: ColdEmailInputs = {};
  let outputs: ColdEmailOutputs = {
    subject_lines: [],
    email: '',
    follow_ups: [],
    personalization_used: ''
  };

  try {
    inputs = typeof row.inputs === 'string' ? JSON.parse(row.inputs) : row.inputs || {};
  } catch {
    inputs = {};
  }

  try {
    outputs = typeof row.outputs === 'string' ? JSON.parse(row.outputs) : row.outputs || {};
  } catch {
    outputs = {
      subject_lines: [],
      email: '',
      follow_ups: [],
      personalization_used: ''
    };
  }

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    inputs,
    outputs,
    modelUsed: String(row.model_used || ''),
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString()
  };
}
