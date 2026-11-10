'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApp } from '../../ui/context';
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorBox,
  Field,
  Icon,
  Input,
  Modal,
  Select,
  Skeleton,
  Table,
  call,
  fmtDate,
  useAsync,
  useToast
} from '../../ui/kit';

function parseMarkdownHeaders(md: string): { id: string; text: string; level: number }[] {
  const lines = md.split('\n');
  const headers: { id: string; text: string; level: number }[] = [];
  for (const line of lines) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/[#*`]/g, '').trim();
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      headers.push({ id, text, level });
    }
  }
  return headers;
}

export default function DocsPage() {
  const searchParams = useSearchParams();
  const initSlug = searchParams.get('article') || '';
  const { user, can } = useApp();
  const tz = user.timezone;
  const toast = useToast();
  const isMasterAdmin = user.role === 'super_admin';

  // State
  const [activeSlug, setActiveSlug] = useState<string>(initSlug);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const [feedbackGiven, setFeedbackGiven] = useState<'yes' | 'no' | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // Admin edit modal state
  const [editArticle, setEditArticle] = useState<any>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Load documentation catalog
  const catalogQ = useAsync(() => call('/api/docs'), []);
  const categories: any[] = catalogQ.data?.categories ?? [];

  // Search query
  const searchQ = useAsync(
    () =>
      searchQuery.trim().length >= 2
        ? call(`/api/docs?search=${encodeURIComponent(searchQuery.trim())}`)
        : Promise.resolve({ results: [] }),
    [searchQuery]
  );
  const searchResults: any[] = searchQ.data?.results ?? [];

  // Auto-expand category of active article & select first if none selected
  useEffect(() => {
    if (!categories.length) return;

    if (!activeSlug) {
      const firstCat = categories[0];
      if (firstCat?.articles?.length) {
        setActiveSlug(firstCat.articles[0].slug);
        setExpandedCats({ [firstCat.slug]: true });
      }
    } else {
      // Find category of active slug
      for (const cat of categories) {
        if (cat.articles.some((a: any) => a.slug === activeSlug)) {
          setExpandedCats(prev => ({ ...prev, [cat.slug]: true }));
          break;
        }
      }
    }
  }, [categories, activeSlug]);

  // Load active article details
  const articleQ = useAsync(
    () => (activeSlug ? call(`/api/docs/${activeSlug}`) : Promise.resolve(null)),
    [activeSlug]
  );

  const article = articleQ.data?.article;
  const relatedArticles: any[] = articleQ.data?.relatedArticles ?? [];

  // Table of contents headers
  const headers = useMemo(() => {
    if (!article?.content_md) return [];
    return parseMarkdownHeaders(article.content_md);
  }, [article?.content_md]);

  // Handle article feedback
  const handleFeedback = async (isHelpful: boolean) => {
    if (!article?.id || submittingFeedback) return;
    setSubmittingFeedback(true);
    try {
      await call('/api/docs/feedback', 'POST', {
        articleId: article.id,
        isHelpful,
        comment: feedbackComment.trim() || undefined
      });
      setFeedbackGiven(isHelpful ? 'yes' : 'no');
      toast('Thank you for your feedback!');
    } catch {
      toast('Unable to save feedback', 'err');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  // Handle Admin Article Edit Save
  const handleSaveArticleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editArticle || savingEdit) return;
    setSavingEdit(true);
    try {
      await call(`/api/docs/${editArticle.slug}`, 'PATCH', {
        title: editArticle.title,
        summary: editArticle.summary,
        contentMd: editArticle.content_md,
        minRole: editArticle.min_role,
        isPublished: editArticle.is_published
      });
      toast('Article updated successfully.');
      setEditArticle(null);
      await Promise.all([articleQ.reload(true as any), catalogQ.reload(true as any)]);
    } catch (err: any) {
      toast(err?.message || 'Failed to update article', 'err');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="sw-page" style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div className="sw-page-head">
        <div>
          <p className="eyebrow">SUPPORT</p>
          <h1>Help Center & Documentation</h1>
          <p className="muted">
            Comprehensive guides, technical SEO tutorials, monitoring references, and troubleshooting.
          </p>
        </div>
      </div>

      {/* Main Layout: 3 Columns (Nav Sidebar / Article Body / TOC & Actions) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr 240px',
          gap: 24,
          alignItems: 'start'
        }}
        className="sw-docs-layout"
      >
        {/* LEFT COLUMN: Categories & Navigation */}
        <aside
          style={{
            background: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--line, #e2e8f0)',
            borderRadius: 8,
            padding: 16
          }}
        >
          {/* Documentation Search */}
          <div style={{ marginBottom: 16 }}>
            <Input
              placeholder="Search guides, terms, errors…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ fontSize: 13 }}
            />
          </div>

          {searchQuery.trim().length >= 2 ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>
                SEARCH RESULTS ({searchResults.length})
              </div>
              {searchResults.length === 0 ? (
                <p className="muted small">No articles match your search.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {searchResults.map((res: any) => (
                    <button
                      key={res.slug}
                      onClick={() => {
                        setActiveSlug(res.slug);
                        setSearchQuery('');
                      }}
                      className="text-btn"
                      style={{
                        textAlign: 'left',
                        padding: '6px 8px',
                        borderRadius: 4,
                        fontSize: 13,
                        lineHeight: 1.4,
                        background: activeSlug === res.slug ? 'rgba(79,101,232,0.1)' : 'transparent'
                      }}
                    >
                      <strong>{res.title}</strong>
                      <div className="small muted">{res.category_title}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : catalogQ.loading && !categories.length ? (
            <Skeleton rows={8} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {categories.map((cat: any) => {
                const isExpanded = expandedCats[cat.slug] ?? false;

                return (
                  <div key={cat.slug}>
                    <button
                      onClick={() => setExpandedCats(prev => ({ ...prev, [cat.slug]: !isExpanded }))}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        width: '100%',
                        background: 'none',
                        border: 'none',
                        padding: '4px 0',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--fg)'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name={cat.icon || 'file'} size={14} />
                        {cat.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                    </button>

                    {isExpanded && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                          marginTop: 4,
                          paddingLeft: 14,
                          borderLeft: '2px solid var(--line)'
                        }}
                      >
                        {cat.articles.map((art: any) => {
                          const isActive = art.slug === activeSlug;

                          return (
                            <button
                              key={art.slug}
                              onClick={() => {
                                setActiveSlug(art.slug);
                                setFeedbackGiven(null);
                                setFeedbackComment('');
                              }}
                              className="text-btn"
                              style={{
                                textAlign: 'left',
                                padding: '5px 8px',
                                borderRadius: 4,
                                fontSize: 12.5,
                                color: isActive ? 'var(--primary, #4f65e8)' : 'var(--fg)',
                                fontWeight: isActive ? 600 : 400,
                                background: isActive ? 'rgba(79, 101, 232, 0.08)' : 'transparent',
                                border: 'none',
                                cursor: 'pointer'
                              }}
                            >
                              {art.title}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* MIDDLE COLUMN: Article Viewer */}
        <main
          style={{
            background: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--line, #e2e8f0)',
            borderRadius: 8,
            padding: '28px 36px',
            minHeight: 650
          }}
        >
          {articleQ.loading && !article ? (
            <Skeleton rows={10} />
          ) : articleQ.error ? (
            <ErrorBox error={articleQ.error} retry={articleQ.reload} />
          ) : !article ? (
            <Empty
              title="Select an article"
              text="Choose any documentation topic from the left sidebar or use search to find an answer."
            />
          ) : (
            <div>
              {/* Category Breadcrumb & Meta */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }} className="muted">
                  <span>Docs</span>
                  <span>/</span>
                  <span>{article.category_title}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge tone={article.min_role === 'super_admin' ? 'blue' : article.min_role === 'manager' ? 'amber' : 'gray'}>
                    {article.min_role === 'super_admin' ? 'Master Admin' : article.min_role === 'manager' ? 'Manager+' : 'All Members'}
                  </Badge>
                  <span className="small muted">{article.read_time_minutes} min read</span>
                </div>
              </div>

              {/* Title & Summary */}
              <h1 style={{ fontSize: 26, margin: '0 0 10px 0', lineHeight: 1.3 }}>{article.title}</h1>
              <p
                style={{
                  fontSize: 15,
                  color: 'var(--muted)',
                  lineHeight: 1.6,
                  margin: '0 0 24px 0',
                  paddingBottom: 20,
                  borderBottom: '1px solid var(--line)'
                }}
              >
                {article.summary}
              </p>

              {/* Rendered Article Markdown Content */}
              <div
                className="sw-doc-body"
                style={{
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: 'var(--fg)'
                }}
              >
                {article.content_md.split('\n\n').map((block: string, idx: number) => {
                  const trimmed = block.trim();

                  // Header H1/H2/H3
                  if (trimmed.startsWith('### ')) {
                    const txt = trimmed.replace('### ', '');
                    const id = txt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                    return (
                      <h3 key={idx} id={id} style={{ fontSize: 18, marginTop: 28, marginBottom: 10 }}>
                        {txt}
                      </h3>
                    );
                  }
                  if (trimmed.startsWith('## ')) {
                    const txt = trimmed.replace('## ', '');
                    const id = txt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                    return (
                      <h2 key={idx} id={id} style={{ fontSize: 20, marginTop: 32, marginBottom: 12, borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
                        {txt}
                      </h2>
                    );
                  }
                  if (trimmed.startsWith('# ')) {
                    const txt = trimmed.replace('# ', '');
                    return null; // Main title already rendered
                  }

                  // Code block
                  if (trimmed.startsWith('```')) {
                    const codeText = trimmed.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '');
                    return (
                      <pre
                        key={idx}
                        className="sw-code"
                        style={{
                          margin: '16px 0',
                          padding: '14px 18px',
                          borderRadius: 6,
                          overflowX: 'auto',
                          background: 'rgba(0,0,0,0.04)',
                          fontSize: 13
                        }}
                      >
                        <code>{codeText}</code>
                      </pre>
                    );
                  }

                  // Unordered list
                  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                    const items = trimmed.split('\n').filter(Boolean);
                    return (
                      <ul key={idx} style={{ margin: '12px 0 16px 0', paddingLeft: 20 }}>
                        {items.map((item, i) => (
                          <li key={i} style={{ marginBottom: 6 }}>
                            {item.replace(/^[-*]\s+/, '')}
                          </li>
                        ))}
                      </ul>
                    );
                  }

                  // Ordered list
                  if (/^\d+\.\s+/.test(trimmed)) {
                    const items = trimmed.split('\n').filter(Boolean);
                    return (
                      <ol key={idx} style={{ margin: '12px 0 16px 0', paddingLeft: 20 }}>
                        {items.map((item, i) => (
                          <li key={i} style={{ marginBottom: 6 }}>
                            {item.replace(/^\d+\.\s+/, '')}
                          </li>
                        ))}
                      </ol>
                    );
                  }

                  // Horizontal rule
                  if (trimmed === '---') {
                    return <hr key={idx} style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '24px 0' }} />;
                  }

                  // Standard paragraph
                  return (
                    <p key={idx} style={{ margin: '12px 0' }}>
                      {trimmed}
                    </p>
                  );
                })}
              </div>

              {/* Helpful Feedback Box */}
              <div
                style={{
                  marginTop: 40,
                  padding: '20px 24px',
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.02)',
                  border: '1px solid var(--line)'
                }}
              >
                <h4 style={{ margin: '0 0 8px 0', fontSize: 15 }}>Was this article helpful?</h4>
                {feedbackGiven ? (
                  <p className="green small" style={{ margin: 0 }}>
                    ✓ Thank you! Your feedback helps us improve SiteWatch documentation.
                  </p>
                ) : (
                  <div>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                      <Btn
                        kind="ghost"
                        style={{ fontSize: 13, padding: '4px 14px' }}
                        disabled={submittingFeedback}
                        onClick={() => handleFeedback(true)}
                      >
                        👍 Yes
                      </Btn>
                      <Btn
                        kind="ghost"
                        style={{ fontSize: 13, padding: '4px 14px' }}
                        disabled={submittingFeedback}
                        onClick={() => handleFeedback(false)}
                      >
                        👎 No
                      </Btn>
                    </div>

                    <Input
                      placeholder="Optional: How could we make this article better?"
                      value={feedbackComment}
                      onChange={e => setFeedbackComment(e.target.value)}
                      style={{ fontSize: 12, maxWidth: 500 }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* RIGHT COLUMN: Table of Contents & Related Guides */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Admin Controls (Master Admin only) */}
          {isMasterAdmin && article && (
            <Card title="Admin Actions">
              <Btn
                kind="ghost"
                style={{ width: '100%', fontSize: 12 }}
                onClick={() => setEditArticle({ ...article })}
              >
                ✎ Edit Article Content
              </Btn>
              <div className="small muted" style={{ marginTop: 8 }}>
                Helpful votes: {article.helpful_count} · Unhelpful: {article.unhelpful_count}
              </div>
            </Card>
          )}

          {/* On This Page (TOC) */}
          {headers.length > 0 && (
            <Card title="On this page" flush>
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {headers.map(h => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    className="sw-link"
                    style={{
                      fontSize: 12.5,
                      textDecoration: 'none',
                      paddingLeft: h.level === 3 ? 12 : 0,
                      lineHeight: 1.4
                    }}
                  >
                    {h.text}
                  </a>
                ))}
              </div>
            </Card>
          )}

          {/* Related Articles */}
          {relatedArticles.length > 0 && (
            <Card title="Related Tutorials" flush>
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {relatedArticles.map((rel: any) => (
                  <button
                    key={rel.slug}
                    onClick={() => {
                      setActiveSlug(rel.slug);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="text-btn"
                    style={{
                      textAlign: 'left',
                      fontSize: 12.5,
                      lineHeight: 1.4,
                      padding: 0
                    }}
                  >
                    <b>{rel.title}</b>
                    <div className="small muted">{rel.read_time_minutes} min read</div>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>

      {/* Master Admin Edit Modal */}
      {editArticle && (
        <Modal
          title={`Edit Article: ${editArticle.title}`}
          onClose={() => setEditArticle(null)}
          wide
        >
          <form className="sw-form cols" onSubmit={handleSaveArticleEdit}>
            <Field label="Article Title">
              <Input
                required
                value={editArticle.title}
                onChange={e => setEditArticle({ ...editArticle, title: e.target.value })}
              />
            </Field>

            <Field label="Summary">
              <Input
                required
                value={editArticle.summary}
                onChange={e => setEditArticle({ ...editArticle, summary: e.target.value })}
              />
            </Field>

            <Field label="Minimum Accessible Role">
              <Select
                value={editArticle.min_role}
                onChange={e => setEditArticle({ ...editArticle, min_role: e.target.value })}
              >
                <option value="member">All Members</option>
                <option value="manager">Manager & Master Admin</option>
                <option value="super_admin">Master Admin Only</option>
              </Select>
            </Field>

            <Field label="Publish Status">
              <Select
                value={editArticle.is_published ? '1' : '0'}
                onChange={e => setEditArticle({ ...editArticle, is_published: e.target.value === '1' })}
              >
                <option value="1">Published</option>
                <option value="0">Draft (Hidden)</option>
              </Select>
            </Field>

            <div className="full">
              <Field label="Article Markdown Content">
                <textarea
                  className="sw-input"
                  rows={15}
                  value={editArticle.content_md}
                  onChange={e => setEditArticle({ ...editArticle, content_md: e.target.value })}
                  style={{ fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.5 }}
                />
              </Field>
            </div>

            <div className="sw-form-actions">
              <Btn kind="ghost" type="button" onClick={() => setEditArticle(null)}>
                Cancel
              </Btn>
              <Btn busy={savingEdit}>Save Changes</Btn>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
