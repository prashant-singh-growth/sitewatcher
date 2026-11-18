// Comprehensive automated test suite for AI Cold Email Generator
import assert from 'node:assert';
import { validateAndCleanInputs, buildUserPrompt, SYSTEM_PROMPT } from '../modules/cold-email/prompt.ts';
import {
  sanitizeEmailText,
  findBannedPhrases,
  checkOutputsForBannedPhrases,
  sanitizeColdEmailOutputs,
  BANNED_PHRASES,
  extractJsonFromText,
  validateOutputSchema,
  resolveClaudeModel,
  extractPageSummary
} from '../modules/cold-email/sanitizer.ts';

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('--- Running SiteWatch AI Cold Email Generator Test Suite ---\n');

// 1. Sparse Input Validation (At least one field required)
test('1. Input validation with sparse and complete combinations', () => {
  // Empty object
  const emptyRes = validateAndCleanInputs({});
  assert.strictEqual(emptyRes.hasAtLeastOne, false);

  // Whitespace only
  const whiteRes = validateAndCleanInputs({
    companyName: '   ',
    targetPersonName: '\n\t  ',
    painPoints: ''
  });
  assert.strictEqual(whiteRes.hasAtLeastOne, false);

  // Only company name
  const companyOnly = validateAndCleanInputs({ companyName: 'Acme Corp' });
  assert.strictEqual(companyOnly.hasAtLeastOne, true);
  assert.strictEqual(companyOnly.inputs.companyName, 'Acme Corp');
  assert.strictEqual(companyOnly.inputs.companyWebsite, undefined);

  // Only website URL
  const websiteOnly = validateAndCleanInputs({ companyWebsite: 'https://example.com' });
  assert.strictEqual(websiteOnly.hasAtLeastOne, true);
  assert.strictEqual(websiteOnly.inputs.companyWebsite, 'https://example.com');

  // Only pain points
  const painOnly = validateAndCleanInputs({ painPoints: 'High bounce rate on signup forms' });
  assert.strictEqual(painOnly.hasAtLeastOne, true);
  assert.strictEqual(painOnly.inputs.painPoints, 'High bounce rate on signup forms');

  // Only our offer
  const offerOnly = validateAndCleanInputs({ ourOffer: 'Automated 24/7 uptime monitoring' });
  assert.strictEqual(offerOnly.hasAtLeastOne, true);
  assert.strictEqual(offerOnly.inputs.ourOffer, 'Automated 24/7 uptime monitoring');

  // Everything filled
  const allFilled = validateAndCleanInputs({
    companyName: 'Stripe',
    companyWebsite: 'https://stripe.com',
    targetPersonName: 'Patrick Collison',
    targetPersonRole: 'CEO',
    painPoints: 'Handling global cross-border payments compliance',
    ourOffer: 'Automated global merchant tax calculations',
    senderName: 'Alex',
    senderCompany: 'TaxCloud',
    goal: '15-minute introductory call',
    tone: 'casual',
    length: 'short',
    extraNotes: 'Keep it conversational'
  });
  assert.strictEqual(allFilled.hasAtLeastOne, true);
  assert.strictEqual(allFilled.inputs.companyName, 'Stripe');
  assert.strictEqual(allFilled.inputs.senderCompany, 'TaxCloud');
  assert.strictEqual(allFilled.inputs.tone, 'casual');
});

// 2. Prompt Generation & Guidance for Sparse Inputs
test('2. User prompt generation adapts to sparse inputs without inventing facts', () => {
  // Only company name
  const promptCompany = buildUserPrompt({ companyName: 'Notion' });
  assert.ok(promptCompany.includes('Target Company: Notion'));
  assert.ok(promptCompany.includes('[SPARSE INPUT NOTE]: Only the company name was provided'));
  assert.ok(promptCompany.includes('Never invent facts'));

  // Only pain points
  const promptPain = buildUserPrompt({ painPoints: 'Leads falling through the cracks in CRM' });
  assert.ok(promptPain.includes('Leads falling through the cracks in CRM'));
  assert.ok(promptPain.includes('{{first_name}} and {{company}}'));

  // Target person and role
  const promptTarget = buildUserPrompt({ targetPersonName: 'Sarah Connor', targetPersonRole: 'VP Engineering' });
  assert.ok(promptTarget.includes('Target Person Name: Sarah Connor'));
  assert.ok(promptTarget.includes('Target Person Role/Title: VP Engineering'));

  // Website context included
  const promptWithWeb = buildUserPrompt(
    { companyName: 'Vercel', companyWebsite: 'https://vercel.com' },
    'Site Title: Vercel Frontend Cloud\nPage Copy Snippet: Build and deploy modern web apps.'
  );
  assert.ok(promptWithWeb.includes('Vercel Frontend Cloud'));
  assert.ok(promptWithWeb.includes('Target Company Website Content'));
});

// 3. Sanitizer: Dash Removal (En dash & Em dash)
test('3. Sanitizer replaces em dashes and en dashes with human punctuation', () => {
  // Spaced em dash -> comma
  const input1 = 'We help teams — like yours — increase reply rates.';
  const sanitized1 = sanitizeEmailText(input1);
  assert.strictEqual(sanitized1, 'We help teams, like yours, increase reply rates.');

  // Unspaced em dash -> comma
  const input2 = 'Quick thought—noticed your website is down.';
  const sanitized2 = sanitizeEmailText(input2);
  assert.strictEqual(sanitized2, 'Quick thought, noticed your website is down.');

  // En dash in number range -> hyphen
  const input3 = 'Takes 3–5 minutes to set up.';
  const sanitized3 = sanitizeEmailText(input3);
  assert.strictEqual(sanitized3, 'Takes 3-5 minutes to set up.');
});

// 4. Sanitizer: Markdown, Emojis, and Punctuation Cleaning
test('4. Sanitizer strips markdown, emojis, semicolons, and ellipses', () => {
  const input = 'Hey Sarah! 🚀 **Quick note** about *SiteWatch*.\n\nWe monitor uptime; alerts trigger fast...\n- Fast alerts\n- Easy setup';
  const sanitized = sanitizeEmailText(input);

  // No emojis
  assert.strictEqual(sanitized.includes('🚀'), false);
  // No bold markdown
  assert.strictEqual(sanitized.includes('**'), false);
  // No italic markdown
  assert.strictEqual(sanitized.includes('*SiteWatch*'), false);
  // Semicolon replaced
  assert.strictEqual(sanitized.includes(';'), false);
  // Ellipses replaced
  assert.strictEqual(sanitized.includes('...'), false);
  // Bullets stripped
  assert.strictEqual(sanitized.includes('- Fast alerts'), false);
  assert.ok(sanitized.includes('Fast alerts'));
});

// 5. Sanitizer: Banned Phrases Detection
test('5. Banned phrases detection catches corporate and AI buzzwords', () => {
  const buzzwordText = 'We delve into your data to leverage synergies and seamlessly streamline your workflow. In today’s fast-paced world, this is a game-changer!';
  const found = findBannedPhrases(buzzwordText);

  assert.ok(found.includes('delve'));
  assert.ok(found.includes('leverage'));
  assert.ok(found.includes('seamless'));
  assert.ok(found.includes('streamline'));
  assert.ok(found.includes('game-changer'));

  const cleanText = 'Saw your post on hiring engineers. We built a tool that checks server health in under a minute.';
  const cleanFound = findBannedPhrases(cleanText);
  assert.strictEqual(cleanFound.length, 0);

  // Check structured outputs
  const sampleOutputs = {
    subject_lines: ['quick question', 'Idea for Acme', 'Server monitoring'],
    email: 'I noticed that you recently launched. I’d love to connect.',
    follow_ups: [
      { day: 3, message: 'Just circling back on my note.' },
      { day: 7, message: 'Thought I would touch base.' },
      { day: 14, message: 'Final check-in.' }
    ],
    personalization_used: 'Company name'
  };

  const outputBanned = checkOutputsForBannedPhrases(sampleOutputs);
  assert.ok(outputBanned.includes('quick question'));
  assert.ok(outputBanned.includes('i noticed that you'));
  assert.ok(outputBanned.includes("i'd love to"));
  assert.ok(outputBanned.includes('circle back'));
  assert.ok(outputBanned.includes('touch base'));
});

// 6. JSON Extraction and Schema Validation
test('6. JSON extraction strips code fences and validates ColdEmailOutputs shape', () => {
  const jsonWithFences = '```json\n{\n  "subject_lines": ["idea for you", "uptime check", "quick thought"],\n  "email": "Hey Sarah, saw your website. Worth a quick chat?\\n\\nAlex",\n  "follow_ups": [\n    {"day": 3, "message": "Quick bump. Any thoughts?"},\n    {"day": 7, "message": "One short idea on this."},\n    {"day": 14, "message": "Final follow up."}\n  ],\n  "personalization_used": "Company website and target role"\n}\n```';

  const extracted = extractJsonFromText(jsonWithFences);
  const validated = validateOutputSchema(extracted);

  assert.strictEqual(validated.subject_lines.length, 3);
  assert.strictEqual(validated.subject_lines[0], 'idea for you');
  assert.ok(validated.email.includes('Worth a quick chat?'));
  assert.strictEqual(validated.follow_ups.length, 3);
  assert.strictEqual(validated.follow_ups[0].day, 3);
  assert.strictEqual(validated.personalization_used, 'Company website and target role');

  // JSON with unescaped literal newlines in strings and trailing commas
  const jsonWithLiteralNewlines = '{\n  "subject_lines": ["idea one", "idea two",],\n  "email": "Hey Sarah,\n\nSaw your website.\n\nAlex",\n  "follow_ups": [\n    {"day": 3, "message": "Quick bump."},\n  ],\n  "personalization_used": "Website",\n}';
  const extractedRepaired = extractJsonFromText(jsonWithLiteralNewlines);
  const validatedRepaired = validateOutputSchema(extractedRepaired);
  assert.strictEqual(validatedRepaired.subject_lines.length, 2);
  assert.ok(validatedRepaired.email.includes('Saw your website.'));
});

// 7. Sanitizer on Entire ColdEmailOutputs Object
test('7. sanitizeColdEmailOutputs cleans all fields and subject line trailing periods', () => {
  const dirtyOutputs = {
    subject_lines: ['Quick idea — for Acme.', 'Uptime check—now.'],
    email: 'Hey Sarah! 🚀 We delve into uptime — and alert you immediately; fast response.',
    follow_ups: [
      { day: 3, message: 'Just touching base — any thoughts?...' },
      { day: 7, message: 'Short bump—worth checking out?' },
      { day: 14, message: 'Final note.' }
    ],
    personalization_used: 'Target company — Acme Corp'
  };

  const { sanitized, bannedFound } = sanitizeColdEmailOutputs(dirtyOutputs);

  // Subject lines should not have trailing periods or em dashes
  assert.strictEqual(sanitized.subject_lines[0], 'Quick idea, for Acme');
  assert.strictEqual(sanitized.subject_lines[1], 'Uptime check, now');

  // Email stripped of emojis and em dashes
  assert.strictEqual(sanitized.email.includes('🚀'), false);
  assert.strictEqual(sanitized.email.includes('—'), false);

  // Banned phrases caught
  assert.ok(bannedFound.includes('delve'));
  assert.ok(bannedFound.includes('touch base'));
});

// 8. 7-Day Expiry Logic Verification
test('8. 7-day retention expiry timestamps and active record filtering', () => {
  const now = new Date('2026-11-17T12:00:00.000Z');
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + sevenDaysMs);

  assert.strictEqual(expiresAt.toISOString(), '2026-11-24T12:00:00.000Z');

  // Active record check
  const checkActive = (recordExpiresAt, currentTime) => new Date(recordExpiresAt).getTime() > new Date(currentTime).getTime();

  // Fresh record is active
  assert.strictEqual(checkActive(expiresAt.toISOString(), now.toISOString()), true);

  // Record after 6 days is still active
  const sixDaysLater = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
  assert.strictEqual(checkActive(expiresAt.toISOString(), sixDaysLater.toISOString()), true);

  // Record after 7 days + 1 second is expired
  const eightDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 1000);
  assert.strictEqual(checkActive(expiresAt.toISOString(), eightDaysLater.toISOString()), false);
});

// 9. Website Context Extraction
test('9. extractPageSummary extracts title, meta description, headings, and clean copy', () => {
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Acme Software - Modern Cloud Solutions</title>
        <meta name="description" content="Acme provides enterprise cloud infrastructure and monitoring tools.">
        <script>console.log("analytics script");</script>
        <style>body { color: red; }</style>
      </head>
      <body>
        <nav><a href="/home">Home</a></nav>
        <h1>Next Generation Cloud Hosting</h1>
        <h2>Built for High Reliability</h2>
        <p>We help engineering teams ship software 10x faster with zero downtime deployment.</p>
        <footer>Copyright 2026 Acme</footer>
      </body>
    </html>
  `;

  const summary = extractPageSummary(sampleHtml);
  assert.ok(summary.includes('Site Title: Acme Software - Modern Cloud Solutions'));
  assert.ok(summary.includes('Meta Description: Acme provides enterprise cloud infrastructure'));
  assert.ok(summary.includes('Next Generation Cloud Hosting'));
  assert.ok(summary.includes('Built for High Reliability'));
  assert.ok(summary.includes('ship software 10x faster'));
  // Scripts and styles excluded
  assert.strictEqual(summary.includes('analytics script'), false);
  assert.strictEqual(summary.includes('body { color: red; }'), false);
});

// 10. Model Resolution
test('10. resolveClaudeModel maps default and friendly model names correctly', () => {
  assert.strictEqual(resolveClaudeModel('claude-opus-5-5'), 'claude-opus-5-5');
  assert.strictEqual(resolveClaudeModel('claude-opus'), 'claude-opus-5-5');
  assert.strictEqual(resolveClaudeModel(), 'claude-opus-5-5');
  assert.strictEqual(resolveClaudeModel('claude-3-5-sonnet-20241022'), 'claude-opus-5-5');
  assert.strictEqual(resolveClaudeModel('custom-model-id'), 'custom-model-id');
});

// 11. System Prompt Constraints Integrity
test('11. System prompt contains required constraints and JSON schema definition', () => {
  assert.ok(SYSTEM_PROMPT.includes('"subject_lines"'));
  assert.ok(SYSTEM_PROMPT.includes('"follow_ups"'));
  assert.ok(SYSTEM_PROMPT.includes('NEVER use em dashes'));
  assert.ok(SYSTEM_PROMPT.includes('delve'));
  assert.ok(SYSTEM_PROMPT.includes('{{first_name}}'));
});

console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
if (passedTests !== totalTests) {
  process.exit(1);
}
