// Comprehensive automated test suite for SiteWatch Help Center & Interactive Tutorials
import assert from 'node:assert';
import { DOC_CATEGORIES, DOC_ARTICLES, canRoleAccess } from '../modules/docs/articles-data.ts';
import { TOURS } from '../modules/docs/tours-data.ts';

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

console.log('--- Running SiteWatch Documentation & Help Center Test Suite ---\n');

// 1. Category Data Integrity
test('1. Documentation categories integrity (10 categories defined)', () => {
  assert.strictEqual(DOC_CATEGORIES.length, 10);
  const slugs = new Set(DOC_CATEGORIES.map(c => c.slug));
  assert.strictEqual(slugs.size, 10);
  assert.ok(slugs.has('getting-started'));
  assert.ok(slugs.has('dashboard'));
  assert.ok(slugs.has('websites'));
  assert.ok(slugs.has('sitemaps'));
  assert.ok(slugs.has('robots'));
  assert.ok(slugs.has('indexability'));
  assert.ok(slugs.has('speed-test'));
  assert.ok(slugs.has('reports'));
  assert.ok(slugs.has('administration'));
  assert.ok(slugs.has('troubleshooting'));
});

// 2. Article Data Integrity & Category Mapping
test('2. Documentation articles integrity (25 comprehensive articles)', () => {
  assert.strictEqual(DOC_ARTICLES.length, 25);
  const catSlugs = new Set(DOC_CATEGORIES.map(c => c.slug));
  const articleSlugs = new Set();

  for (const art of DOC_ARTICLES) {
    assert.ok(catSlugs.has(art.categorySlug), `Article ${art.slug} references invalid category ${art.categorySlug}`);
    assert.ok(!articleSlugs.has(art.slug), `Duplicate article slug detected: ${art.slug}`);
    articleSlugs.add(art.slug);
    assert.ok(art.title.length > 5, `Title too short for ${art.slug}`);
    assert.ok(art.summary.length > 10, `Summary too short for ${art.slug}`);
    assert.ok(art.contentMd.length > 200, `Content too brief for ${art.slug}`);
  }
});

// 3. Related Article Slugs Verification
test('3. Cross-reference integrity: related slugs exist in catalog', () => {
  const allSlugs = new Set(DOC_ARTICLES.map(a => a.slug));
  for (const art of DOC_ARTICLES) {
    for (const rel of art.relatedSlugs) {
      assert.ok(allSlugs.has(rel), `Article ${art.slug} references non-existent related slug: ${rel}`);
    }
  }
});

// 4. Role Hierarchy Access Control
test('4. Role access hierarchy (member vs manager vs super_admin)', () => {
  // Member access
  assert.strictEqual(canRoleAccess('member', 'member'), true);
  assert.strictEqual(canRoleAccess('member', 'manager'), false);
  assert.strictEqual(canRoleAccess('member', 'super_admin'), false);

  // Manager access
  assert.strictEqual(canRoleAccess('manager', 'member'), true);
  assert.strictEqual(canRoleAccess('manager', 'manager'), true);
  assert.strictEqual(canRoleAccess('manager', 'super_admin'), false);

  // Super Admin access
  assert.strictEqual(canRoleAccess('super_admin', 'member'), true);
  assert.strictEqual(canRoleAccess('super_admin', 'manager'), true);
  assert.strictEqual(canRoleAccess('super_admin', 'super_admin'), true);
});

// 5. Member Role Visibility Gating Simulation
test('5. Standard member cannot access restricted admin articles', () => {
  const memberAccessible = DOC_ARTICLES.filter(a => canRoleAccess('member', a.minRole));
  const adminOnly = DOC_ARTICLES.filter(a => a.minRole === 'super_admin');

  assert.ok(adminOnly.length > 0, 'Admin-only articles must exist for testing');
  for (const a of adminOnly) {
    assert.strictEqual(memberAccessible.some(m => m.slug === a.slug), false, `Member should not access ${a.slug}`);
  }
});

// 6. Manager Role Visibility Gating Simulation
test('6. Project manager can access manager articles but not Master Admin articles', () => {
  const managerAccessible = DOC_ARTICLES.filter(a => canRoleAccess('manager', a.minRole));
  const superAdminArticles = DOC_ARTICLES.filter(a => a.minRole === 'super_admin');

  for (const a of superAdminArticles) {
    assert.strictEqual(managerAccessible.some(m => m.slug === a.slug), false, `Manager should not access super_admin article ${a.slug}`);
  }

  // Manager can see reports and maintenance
  assert.ok(managerAccessible.some(m => m.slug === 'maintenance-windows'));
  assert.ok(managerAccessible.some(m => m.slug === 'scheduling-email-reports'));
});

// 7. Master Admin Full Access
test('7. Master Admin has 100% catalog access', () => {
  const adminAccessible = DOC_ARTICLES.filter(a => canRoleAccess('super_admin', a.minRole));
  assert.strictEqual(adminAccessible.length, DOC_ARTICLES.length);
});

// 8. Documentation Search Simulation
test('8. Search query matching across titles, summaries, and markdown content', () => {
  function search(q, role) {
    const query = q.toLowerCase();
    return DOC_ARTICLES
      .filter(a => canRoleAccess(role, a.minRole))
      .filter(a =>
        a.title.toLowerCase().includes(query) ||
        a.summary.toLowerCase().includes(query) ||
        a.contentMd.toLowerCase().includes(query)
      );
  }

  // Search "Googlebot"
  const googlebotHits = search('Googlebot', 'member');
  assert.ok(googlebotHits.length >= 2, 'Expected hits for Googlebot in member docs');
  assert.ok(googlebotHits.some(h => h.slug === 'robots-txt-monitoring-guide'));

  // Search "Core Web Vitals"
  const cwvHits = search('Core Web Vitals', 'member');
  assert.ok(cwvHits.length >= 2, 'Expected hits for Core Web Vitals');
  assert.ok(cwvHits.some(h => h.slug === 'core-web-vitals-guide'));

  // Search "scrypt" (password hashing in admin doc)
  const scryptMemberHits = search('scrypt', 'member');
  assert.strictEqual(scryptMemberHits.length, 0, 'Member should not get search hits from admin-only docs');

  const scryptAdminHits = search('scrypt', 'super_admin');
  assert.ok(scryptAdminHits.length >= 1, 'Master admin should find scrypt reference');
});

// 9. Interactive Walkthrough Tours Integrity
test('9. Interactive walkthrough tours configuration', () => {
  const tourKeys = Object.keys(TOURS);
  assert.ok(tourKeys.length >= 5, 'Expected at least 5 walkthrough tours');

  for (const key of tourKeys) {
    const tour = TOURS[key];
    assert.ok(tour.id, `Tour ${key} missing ID`);
    assert.ok(tour.name, `Tour ${key} missing name`);
    assert.ok(tour.steps.length >= 3, `Tour ${key} must have at least 3 steps`);

    for (const step of tour.steps) {
      assert.ok(step.title, `Tour ${key} has step with missing title`);
      assert.ok(step.description, `Tour ${key} has step with missing description`);
      assert.ok(step.target, `Tour ${key} step "${step.title}" missing target selector`);
    }
  }
});

// 10. Technical SEO Concept Clarity in Content
test('10. Technical SEO concepts: sitemap vs robots vs indexability vs GSC', () => {
  const gscDoc = DOC_ARTICLES.find(a => a.slug === 'technical-indexability-vs-gsc');
  assert.ok(gscDoc, 'Missing technical indexability vs GSC documentation');
  assert.ok(gscDoc.contentMd.includes('Google Search Console'), 'Must explicitly mention Google Search Console');
  assert.ok(gscDoc.contentMd.includes('Technical indexability is a deterministic engineering evaluation'), 'Must clarify engineering evaluation');

  const sitemapDoc = DOC_ARTICLES.find(a => a.slug === 'sitemap-monitoring-guide');
  assert.ok(sitemapDoc.contentMd.includes('sitemapindex'), 'Sitemap guide must explain sitemapindex');

  const robotsDoc = DOC_ARTICLES.find(a => a.slug === 'robots-txt-monitoring-guide');
  assert.ok(robotsDoc.contentMd.includes('RFC 9309'), 'Robots doc must reference RFC 9309');
});

console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
if (passedTests !== totalTests) {
  process.exit(1);
}
console.log('All Documentation & Help Center test suites passed successfully!\n');
