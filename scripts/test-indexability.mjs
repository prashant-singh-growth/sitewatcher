// Comprehensive automated test suite for Indexability & Noindex Monitoring
import assert from 'node:assert';
import {
  evaluateTechnicalIndexability,
  extractMetaRobotsFromHtml,
  extractCanonicals,
  evaluateCanonical,
  parseDirectiveTokens,
  normalizeUrlForComparison
} from '../modules/indexability/parser.ts';

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

console.log('--- Running SiteWatch Indexability & Noindex Test Suite ---\n');

// 1. Meta Robots Noindex
test('1. Meta robots noindex (<meta name="robots" content="noindex">)', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Pricing</title>
        <meta name="robots" content="noindex, follow">
        <link rel="canonical" href="https://example.com/pricing">
      </head>
      <body><h1>Pricing</h1></body>
    </html>
  `;
  const result = evaluateTechnicalIndexability({
    url: 'https://example.com/pricing',
    httpStatus: 200,
    html
  });

  assert.strictEqual(result.hasNoindex, true);
  assert.strictEqual(result.noindexSource, 'meta_robots');
  assert.strictEqual(result.isTechnicallyIndexable, false);
  assert.strictEqual(result.canonicalStatus, 'self_referencing');
  assert.ok(result.indexabilityReasons.some(r => r.includes('noindex')));
});

// 2. Meta Googlebot Noindex
test('2. Meta googlebot noindex (<meta name="googlebot" content="noindex">)', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Staging Page</title>
        <meta name="robots" content="index, follow">
        <meta name="googlebot" content="noindex">
      </head>
      <body><h1>Internal</h1></body>
    </html>
  `;
  const result = evaluateTechnicalIndexability({
    url: 'https://example.com/internal',
    httpStatus: 200,
    html
  });

  assert.strictEqual(result.hasNoindex, true);
  assert.strictEqual(result.noindexSource, 'meta_googlebot');
  assert.strictEqual(result.isTechnicallyIndexable, false);
});

// 3. HTTP Header X-Robots-Tag Noindex
test('3. HTTP X-Robots-Tag: noindex header', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Clean HTML</title></head>
      <body><h1>No meta here</h1></body>
    </html>
  `;
  const result = evaluateTechnicalIndexability({
    url: 'https://example.com/api-doc',
    httpStatus: 200,
    html,
    xRobotsHeader: 'noindex, nofollow'
  });

  assert.strictEqual(result.hasNoindex, true);
  assert.strictEqual(result.noindexSource, 'x_robots_tag');
  assert.strictEqual(result.hasNofollow, true);
  assert.strictEqual(result.isTechnicallyIndexable, false);
});

// 4. Nofollow alone does not mean noindex
test('4. Nofollow alone is not treated as noindex', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="robots" content="nofollow">
        <link rel="canonical" href="https://example.com/blog/sponsored-post">
      </head>
      <body><h1>Sponsored Content</h1></body>
    </html>
  `;
  const result = evaluateTechnicalIndexability({
    url: 'https://example.com/blog/sponsored-post',
    httpStatus: 200,
    html
  });

  assert.strictEqual(result.hasNoindex, false);
  assert.strictEqual(result.hasNofollow, true);
  assert.strictEqual(result.isTechnicallyIndexable, true);
});

// 5. Directive Combinations (index,follow / noindex,follow / noindex,nofollow / none)
test('5. Directive combinations parsing', () => {
  const tokens1 = parseDirectiveTokens('index, follow');
  assert.strictEqual(tokens1.has('index'), true);
  assert.strictEqual(tokens1.has('follow'), true);
  assert.strictEqual(tokens1.has('noindex'), false);

  const tokens2 = parseDirectiveTokens('noindex, follow');
  assert.strictEqual(tokens2.has('noindex'), true);
  assert.strictEqual(tokens2.has('follow'), true);

  const tokens3 = parseDirectiveTokens('none'); // RFC: none = noindex, nofollow
  assert.strictEqual(tokens3.has('none'), true);

  const resNone = evaluateTechnicalIndexability({
    url: 'https://example.com/none-page',
    httpStatus: 200,
    html: '<html><head><meta name="robots" content="none"></head><body></body></html>'
  });
  assert.strictEqual(resNone.hasNoindex, true);
  assert.strictEqual(resNone.hasNofollow, true);
  assert.strictEqual(resNone.isTechnicallyIndexable, false);
});

// 6. Conflicting Directives Detection
test('6. Conflicting directives (index AND noindex declared)', () => {
  const html = `
    <html>
      <head>
        <meta name="robots" content="index, noindex, follow">
      </head>
      <body></body>
    </html>
  `;
  const result = evaluateTechnicalIndexability({
    url: 'https://example.com/conflict',
    httpStatus: 200,
    html
  });

  assert.strictEqual(result.hasConflict, true);
  assert.strictEqual(result.hasNoindex, true); // Restrictive rule wins
  assert.strictEqual(result.isTechnicallyIndexable, false);
});

// 7. Canonical Tag Analysis: Self-Referencing vs Canonicalized vs Cross-Domain
test('7. Canonical status analysis (self-referencing, canonicalized, cross-domain)', () => {
  // Self-referencing (matching case and trailing slash tolerance)
  const selfRef = evaluateCanonical('https://example.com/products/shoes/', ['https://example.com/products/shoes']);
  assert.strictEqual(selfRef.status, 'self_referencing');

  // Canonicalized to parent or alternate
  const canonAway = evaluateCanonical('https://example.com/products/shoes?color=blue', ['https://example.com/products/shoes']);
  assert.strictEqual(canonAway.status, 'canonicalized');
  assert.strictEqual(canonAway.canonicalUrl, 'https://example.com/products/shoes');

  // Cross-domain canonical
  const crossDomain = evaluateCanonical('https://example.com/syndicated-article', ['https://syndicate-partner.com/article']);
  assert.strictEqual(crossDomain.status, 'cross_domain');
  assert.strictEqual(crossDomain.canonicalUrl, 'https://syndicate-partner.com/article');
});

// 8. Multiple Conflicting Canonical Tags
test('8. Multiple conflicting canonical tags detected in HTML', () => {
  const html = `
    <html>
      <head>
        <link rel="canonical" href="https://example.com/page-a">
        <link rel="canonical" href="https://example.com/page-b">
      </head>
      <body></body>
    </html>
  `;
  const canonicals = extractCanonicals(html, null);
  assert.strictEqual(canonicals.length, 2);

  const evalRes = evaluateCanonical('https://example.com/page-a', canonicals);
  assert.strictEqual(evalRes.status, 'multiple');
  assert.strictEqual(evalRes.canonicalUrl, null);

  const fullRes = evaluateTechnicalIndexability({
    url: 'https://example.com/page-a',
    httpStatus: 200,
    html
  });
  assert.strictEqual(fullRes.canonicalStatus, 'multiple');
  assert.strictEqual(fullRes.isTechnicallyIndexable, false);
});

// 9. HTTP Link Header Canonical
test('9. Canonical declared via HTTP Link header', () => {
  const html = '<html><head><title>No HTML canonical</title></head><body></body></html>';
  const linkHeader = '<https://example.com/canonical-master>; rel="canonical"';

  const canonicals = extractCanonicals(html, linkHeader);
  assert.strictEqual(canonicals.length, 1);
  assert.strictEqual(canonicals[0], 'https://example.com/canonical-master');

  const fullRes = evaluateTechnicalIndexability({
    url: 'https://example.com/canonical-master',
    httpStatus: 200,
    html,
    httpLinkHeader: linkHeader
  });
  assert.strictEqual(fullRes.canonicalStatus, 'self_referencing');
  assert.strictEqual(fullRes.isTechnicallyIndexable, true);
});

// 10. HTTP 404 & 410 Handling
test('10. HTTP 404 Not Found and 410 Gone handling', () => {
  const res404 = evaluateTechnicalIndexability({
    url: 'https://example.com/deleted-page',
    httpStatus: 404,
    html: '<html><body>404 Not Found</body></html>'
  });
  assert.strictEqual(res404.isTechnicallyIndexable, false);
  assert.ok(res404.indexabilityReasons.some(r => r.includes('404')));

  const res410 = evaluateTechnicalIndexability({
    url: 'https://example.com/gone-forever',
    httpStatus: 410,
    html: '<html><body>410 Gone</body></html>'
  });
  assert.strictEqual(res410.isTechnicallyIndexable, false);
  assert.ok(res410.indexabilityReasons.some(r => r.includes('410')));
});

// 11. HTTP 500 Server Error & 403 Forbidden
test('11. HTTP 500 Server Error and 403 Forbidden handling', () => {
  const res500 = evaluateTechnicalIndexability({
    url: 'https://example.com/server-crash',
    httpStatus: 500,
    html: '<html><body>500 Internal Server Error</body></html>'
  });
  assert.strictEqual(res500.isTechnicallyIndexable, false);
  assert.ok(res500.indexabilityReasons.some(r => r.includes('500')));

  const res403 = evaluateTechnicalIndexability({
    url: 'https://example.com/restricted-admin',
    httpStatus: 403,
    html: '<html><body>403 Forbidden</body></html>'
  });
  assert.strictEqual(res403.isTechnicallyIndexable, false);
  assert.ok(res403.indexabilityReasons.some(r => r.includes('403')));
});

// 12. Complete Technical Indexability Verdict Rules
test('12. End-to-end technical indexability validation', () => {
  // Case A: Perfect indexable page (200 OK, self-referencing canonical, no noindex)
  const perfect = evaluateTechnicalIndexability({
    url: 'https://example.com/services/seo',
    httpStatus: 200,
    html: `
      <html>
        <head>
          <meta name="robots" content="index, follow">
          <link rel="canonical" href="https://example.com/services/seo">
        </head>
        <body><h1>SEO Services</h1></body>
      </html>
    `
  });
  assert.strictEqual(perfect.isTechnicallyIndexable, true);
  assert.strictEqual(perfect.hasNoindex, false);
  assert.strictEqual(perfect.canonicalStatus, 'self_referencing');

  // Case B: Canonicalized page (200 OK, but canonical points to primary URL)
  // Technical status: Not self-indexable because it points away
  const canonicalized = evaluateTechnicalIndexability({
    url: 'https://example.com/services/seo?ref=twitter',
    httpStatus: 200,
    html: `
      <html>
        <head>
          <link rel="canonical" href="https://example.com/services/seo">
        </head>
        <body></body>
      </html>
    `
  });
  assert.strictEqual(canonicalized.isTechnicallyIndexable, false);
  assert.strictEqual(canonicalized.canonicalStatus, 'canonicalized');

  // Case C: Missing canonical (200 OK, no canonical declared, no noindex)
  // Technical status: Indexable (canonical is not mandatory for indexation)
  const noCanonical = evaluateTechnicalIndexability({
    url: 'https://example.com/about-us',
    httpStatus: 200,
    html: '<html><head><title>About</title></head><body></body></html>'
  });
  assert.strictEqual(noCanonical.isTechnicallyIndexable, true);
  assert.strictEqual(noCanonical.canonicalStatus, 'missing');
});

console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
if (passedTests !== totalTests) {
  process.exit(1);
}
