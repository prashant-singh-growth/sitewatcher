import type { ColdEmailInputs } from './types';

export const SYSTEM_PROMPT = `You are a sales rep who writes cold emails the way a real person types them. You are not a marketing tool. Your emails get replies because they sound like a human wrote them in two minutes after reading about the company.

Return ONLY valid JSON, no markdown, no commentary, in this shape:
{
  "subject_lines": ["", "", ""],
  "email": "",
  "follow_ups": [
    {"day": 3, "message": ""},
    {"day": 7, "message": ""},
    {"day": 14, "message": ""}
  ],
  "personalization_used": ""
}

You will receive some or all of: company name, website content, target person, role, pain points, our offer, sender details, goal, tone, length. Many fields will be empty. Work with what you have. Never invent facts, numbers, funding rounds, news, mutual connections, or compliments you cannot back up from the input. If you don't know something, skip it or use a placeholder like {{first_name}}.

WRITING RULES
- Write like a real person. Short sentences. Plain words. Contractions (I'm, you're, don't).
- Email length: 50 to 110 words. Follow-ups: 20 to 60 words, each shorter than the last.
- Open with something specific to them or their problem, not about us. No "I hope this email finds you well", no "My name is X and I work at Y" as the opener.
- One idea, one ask. The CTA is a low-friction question, like "worth a quick chat?" or "should I send over a short example?"
- Mention the pain point naturally, as an observation, not a lecture.
- Subject lines: 2 to 6 words, lowercase or sentence case, no emojis, no spam words, no fake "Re:" tricks.
- Follow-ups must add something small (a quick thought, a one-line example, a gentle check-in), not just "bumping this up".
- Vary sentence length and structure. Real emails are slightly imperfect.

STRICTLY FORBIDDEN (this is what makes text feel AI-written)
- NEVER use em dashes (—) or en dashes (–). Use commas, periods, or plain hyphens in compound words only.
- No semicolons, no ellipses for effect, no emojis, no exclamation marks (max one in the whole email if the tone is very friendly).
- No bold, bullets, headers, or markdown inside emails.
- Banned words and phrases: delve, leverage, utilize, unlock, elevate, streamline, supercharge, game-changer, cutting-edge, revolutionary, seamless, robust, holistic, synergy, innovative, transform, empower, in today's fast-paced world, in the ever-evolving landscape, I came across, I stumbled upon, I noticed that you, hope you're doing well, reach out, touch base, circle back, quick question (as a subject), I'd love to, thrilled, excited to, as a leader in, take it to the next level, look no further.
- No "not just X, but Y" constructions. No rule-of-three lists used for rhythm. No flattery openers like "Impressive work".
- No generic praise. If you compliment, it must be tied to a real detail from the input.
- Sign off with just the sender's first name (or {{sender_name}}). No "Best regards," "Warm regards," or long signatures.

Tone follows the user's setting. Default: friendly, direct, a little casual.`;

export const MAX_FIELD_LENGTHS: Record<keyof ColdEmailInputs, number> = {
  companyName: 120,
  companyWebsite: 500,
  targetPersonName: 120,
  targetPersonRole: 120,
  painPoints: 2500,
  ourOffer: 2500,
  senderName: 120,
  senderCompany: 120,
  goal: 300,
  tone: 40,
  length: 40,
  extraNotes: 2500
};

/**
 * Validates and trims raw inputs. Throws if all fields are empty or field lengths exceeded.
 */
export function validateAndCleanInputs(raw: any): { inputs: ColdEmailInputs; hasAtLeastOne: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { inputs: {}, hasAtLeastOne: false };
  }

  const clean: ColdEmailInputs = {};
  let count = 0;

  for (const [k, maxLen] of Object.entries(MAX_FIELD_LENGTHS) as [keyof ColdEmailInputs, number][]) {
    const val = raw[k];
    if (val !== undefined && val !== null) {
      const str = String(val).trim();
      if (str.length > 0) {
        clean[k] = str.slice(0, maxLen) as any;
        count++;
      }
    }
  }

  // Ensure default tone and length if not specified
  if (!clean.tone) clean.tone = 'friendly';
  if (!clean.length) clean.length = 'short';

  return { inputs: clean, hasAtLeastOne: count > 0 };
}

/**
 * Builds the user prompt for Claude based on sparse or complete inputs.
 */
export function buildUserPrompt(inputs: ColdEmailInputs, websiteContext?: string | null): string {
  const sections: string[] = [];

  sections.push('Here are the details provided for this cold email outreach:');

  if (inputs.companyName) {
    sections.push(`- Target Company: ${inputs.companyName}`);
  }

  if (inputs.targetPersonName) {
    sections.push(`- Target Person Name: ${inputs.targetPersonName}`);
  }

  if (inputs.targetPersonRole) {
    sections.push(`- Target Person Role/Title: ${inputs.targetPersonRole}`);
  }

  if (websiteContext) {
    sections.push(`- Target Company Website Content (extracted live from ${inputs.companyWebsite || 'website'}):\n"""\n${websiteContext}\n"""`);
  } else if (inputs.companyWebsite) {
    sections.push(`- Target Company Website: ${inputs.companyWebsite} (Website content could not be fetched or was not accessible; do not guess website specifics)`);
  }

  if (inputs.painPoints) {
    sections.push(`- Business Pain Points / Problems They Face:\n"""\n${inputs.painPoints}\n"""`);
  }

  if (inputs.ourOffer) {
    sections.push(`- Our Product / Service Offer:\n"""\n${inputs.ourOffer}\n"""`);
  }

  if (inputs.senderName || inputs.senderCompany) {
    const senderParts = [inputs.senderName, inputs.senderCompany].filter(Boolean).join(' at ');
    sections.push(`- Sender: ${senderParts}`);
  }

  if (inputs.goal) {
    sections.push(`- Desired Goal / Call-to-Action: ${inputs.goal}`);
  }

  if (inputs.tone) {
    sections.push(`- Requested Tone: ${inputs.tone}`);
  }

  if (inputs.length) {
    sections.push(`- Target Length: ${inputs.length === 'medium' ? 'medium (75-110 words)' : 'short (50-75 words)'}`);
  }

  if (inputs.extraNotes) {
    sections.push(`- Additional Instructions / Notes:\n"""\n${inputs.extraNotes}\n"""`);
  }

  // Guidance for sparse input situations
  const onlyCompany = inputs.companyName && !inputs.painPoints && !inputs.ourOffer && !websiteContext && !inputs.targetPersonName;
  const onlyPainPoint = inputs.painPoints && !inputs.companyName && !inputs.companyWebsite && !inputs.targetPersonName;

  if (onlyCompany) {
    sections.push('\n[SPARSE INPUT NOTE]: Only the company name was provided. Write a short, curiosity-based, honest cold email based on general knowledge of that company if confident. Never invent facts, clients, or news. If specific details are unknown, use a clean placeholder like {{first_name}} or keep it general.');
  } else if (onlyPainPoint) {
    sections.push('\n[SPARSE INPUT NOTE]: Only pain points were provided. Write a natural, highly relevant cold email centered on solving that pain point, using placeholders like {{first_name}} and {{company}} for missing company and prospect details.');
  }

  sections.push('\nRemember: return ONLY valid JSON matching the exact schema specified in the system prompt. No markdown, no commentary.');

  return sections.join('\n');
}
