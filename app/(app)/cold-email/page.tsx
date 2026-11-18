'use client';
import { useState } from 'react';
import Link from 'next/link';
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
  Select,
  Skeleton,
  Table,
  Tabs,
  call,
  fmtDate,
  ago,
  useAsync,
  useToast
} from '../../ui/kit';
import type {
  ColdEmailInputs,
  ColdEmailOutputs,
  ColdEmailRecord
} from '../../../modules/cold-email/types';

const INITIAL_INPUTS: ColdEmailInputs = {
  companyName: '',
  companyWebsite: '',
  targetPersonName: '',
  targetPersonRole: '',
  painPoints: '',
  ourOffer: '',
  senderName: '',
  senderCompany: '',
  goal: '',
  tone: 'friendly',
  length: 'short',
  extraNotes: ''
};

export default function ColdEmailPage() {
  const { user, canWrite } = useApp();
  const tz = user.timezone;
  const toast = useToast();

  const [inputs, setInputs] = useState<ColdEmailInputs>(INITIAL_INPUTS);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [currentOutputs, setCurrentOutputs] = useState<ColdEmailOutputs | null>(null);
  const [currentModelUsed, setCurrentModelUsed] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'email' | 'fu1' | 'fu2' | 'fu3' | 'subjects'>('email');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [clearingAll, setClearingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Load user's recent generations (7-day retention)
  const historyQ = useAsync(
    () => call(`/api/cold-email/generations?page=${page}&limit=10`),
    [page]
  );
  const historyList: ColdEmailRecord[] = historyQ.data?.items ?? [];
  const totalHistory = historyQ.data?.total ?? 0;
  const totalPages = historyQ.data?.totalPages ?? 1;

  const updateField = (key: keyof ColdEmailInputs, value: string) => {
    setInputs(prev => ({ ...prev, [key]: value }));
    if (validationError) setValidationError(null);
  };

  const hasAtLeastOneField = () => {
    return Object.entries(inputs).some(([k, v]) => {
      if (k === 'tone' || k === 'length') return false; // Tone and length alone don't count as prospect content
      return typeof v === 'string' && v.trim().length > 0;
    });
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!hasAtLeastOneField()) {
      setValidationError('Please fill in at least one field (company, prospect, pain points, website, etc.) to generate a cold email.');
      return;
    }

    setGenerating(true);
    setValidationError(null);

    try {
      const res = await call('/api/cold-email/generate', 'POST', inputs);
      const gen: ColdEmailRecord = res.generation;
      setCurrentOutputs(gen.outputs);
      setCurrentModelUsed(gen.modelUsed);
      setActiveTab('email');
      toast('Cold email generated successfully.');
      historyQ.reload(true as any);
    } catch (err: any) {
      toast(err?.message || 'Failed to generate cold email.', 'err');
    } finally {
      setGenerating(false);
    }
  };

  const handleReset = () => {
    setInputs(INITIAL_INPUTS);
    setValidationError(null);
    setCurrentOutputs(null);
    setCurrentModelUsed(null);
  };

  const copyToClipboard = async (text: string, key: string) => {
    if (!text) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedKey(key);
      toast('Copied to clipboard!');
      setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      toast('Failed to copy to clipboard', 'err');
    }
  };

  const loadPastGeneration = (record: ColdEmailRecord) => {
    setInputs(record.inputs || INITIAL_INPUTS);
    setCurrentOutputs(record.outputs);
    setCurrentModelUsed(record.modelUsed);
    setActiveTab('email');
    setValidationError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Loaded past generation.');
  };

  const handleDeleteRecord = async (id: number) => {
    setDeletingId(id);
    try {
      await call(`/api/cold-email/generations/${id}`, 'DELETE');
      toast('Generation removed.');
      historyQ.reload(true as any);
    } catch (err: any) {
      toast(err?.message || 'Failed to delete record.', 'err');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to delete all recent cold email generations? This cannot be undone.')) {
      return;
    }
    setClearingAll(true);
    try {
      await call('/api/cold-email/generations', 'DELETE');
      toast('All cold email history cleared.');
      historyQ.reload(true as any);
    } catch (err: any) {
      toast(err?.message || 'Failed to clear history.', 'err');
    } finally {
      setClearingAll(false);
    }
  };

  const wordCount = (text: string) => (text ? text.trim().split(/\s+/).filter(Boolean).length : 0);

  const formatExpiresIn = (expiresAtStr: string) => {
    const diffMs = new Date(expiresAtStr).getTime() - Date.now();
    if (diffMs <= 0) return 'expired';
    const hours = Math.round(diffMs / 3600000);
    if (hours < 24) return `${hours}h left`;
    const days = (diffMs / 86400000).toFixed(1);
    return `${days}d left`;
  };

  return (
    <div className="sw-page">
      {/* Header */}
      <div className="sw-page-head">
        <div>
          <p className="eyebrow">AI TOOLS</p>
          <h1>AI Cold Email Generator</h1>
          <p className="muted">
            Personalized, natural-sounding cold emails, high-converting subject lines, and multi-touch follow-ups powered by Claude.{' '}
            <Link href="/docs?article=cold-email-generator" className="sw-link" style={{ fontSize: 13 }}>
              View guide & best practices →
            </Link>
          </p>
        </div>
        <div className="sw-actions">
          <Btn kind="ghost" onClick={handleReset} disabled={generating}>
            Clear Form
          </Btn>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="sw-grid-2" style={{ alignItems: 'start' }}>
        {/* Left Column: Input Form */}
        <Card
          title="Lead & Outreach Details"
          subtitle="Every field is optional. Fill in whatever information you have."
        >
          <form onSubmit={handleGenerate}>
            {validationError && (
              <div style={{ marginBottom: 16 }}>
                <ErrorBox error={validationError} />
              </div>
            )}

            {/* Target Company & Website */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <Field label="Company Name" hint="Target account name">
                <Input
                  placeholder="e.g. Acme Corp"
                  value={inputs.companyName || ''}
                  onChange={e => updateField('companyName', e.target.value)}
                  disabled={generating}
                />
              </Field>
              <Field label="Company Website URL" hint="Live copy will be fetched">
                <Input
                  type="url"
                  placeholder="https://example.com"
                  value={inputs.companyWebsite || ''}
                  onChange={e => updateField('companyWebsite', e.target.value)}
                  disabled={generating}
                />
              </Field>
            </div>

            {/* Target Person Name & Role */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <Field label="Target Person Name" hint="Recipient first & last name">
                <Input
                  placeholder="e.g. Sarah Connor"
                  value={inputs.targetPersonName || ''}
                  onChange={e => updateField('targetPersonName', e.target.value)}
                  disabled={generating}
                />
              </Field>
              <Field label="Target Person Role / Title" hint="Job title or seniority">
                <Input
                  placeholder="e.g. Head of Growth"
                  value={inputs.targetPersonRole || ''}
                  onChange={e => updateField('targetPersonRole', e.target.value)}
                  disabled={generating}
                />
              </Field>
            </div>

            {/* Pain Points */}
            <div style={{ marginBottom: 14 }}>
              <Field label="Business Pain Points" hint="Problems, bottlenecks, or friction they likely face">
                <textarea
                  className="sw-input"
                  rows={3}
                  placeholder="e.g. High customer churn, slow manual response times, difficulty tracking indexation drops..."
                  value={inputs.painPoints || ''}
                  onChange={e => updateField('painPoints', e.target.value)}
                  disabled={generating}
                  style={{ fontFamily: 'inherit' }}
                />
              </Field>
            </div>

            {/* Our Offer */}
            <div style={{ marginBottom: 14 }}>
              <Field label="Our Product / Service Offer" hint="What we do and how we solve their problem">
                <textarea
                  className="sw-input"
                  rows={3}
                  placeholder="e.g. SiteWatch automated website monitoring that alerts engineering in under 60 seconds..."
                  value={inputs.ourOffer || ''}
                  onChange={e => updateField('ourOffer', e.target.value)}
                  disabled={generating}
                  style={{ fontFamily: 'inherit' }}
                />
              </Field>
            </div>

            {/* Sender & Goal */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <Field label="Sender Name & Company" hint="Who is sending this email">
                <Input
                  placeholder="e.g. Alex at SiteWatch"
                  value={inputs.senderName || ''}
                  onChange={e => updateField('senderName', e.target.value)}
                  disabled={generating}
                />
              </Field>
              <Field label="Desired Goal / CTA" hint="Low-friction ask">
                <Input
                  placeholder="e.g. Worth a quick 10-min chat?"
                  value={inputs.goal || ''}
                  onChange={e => updateField('goal', e.target.value)}
                  disabled={generating}
                />
              </Field>
            </div>

            {/* Tone & Length */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <Field label="Tone" hint="Style of voice">
                <Select
                  value={inputs.tone || 'friendly'}
                  onChange={e => updateField('tone', e.target.value)}
                  disabled={generating}
                >
                  <option value="friendly">Friendly (Default)</option>
                  <option value="casual">Casual</option>
                  <option value="direct">Direct</option>
                  <option value="professional">Professional</option>
                </Select>
              </Field>
              <Field label="Email Length" hint="Word count target">
                <Select
                  value={inputs.length || 'short'}
                  onChange={e => updateField('length', e.target.value)}
                  disabled={generating}
                >
                  <option value="short">Short (50-75 words)</option>
                  <option value="medium">Medium (75-110 words)</option>
                </Select>
              </Field>
            </div>

            {/* Extra Notes */}
            <div style={{ marginBottom: 18 }}>
              <Field label="Extra Notes / Custom Instructions" hint="Special angles, constraints, or mentions">
                <textarea
                  className="sw-input"
                  rows={2}
                  placeholder="e.g. Don't mention pricing; focus on ease of setup..."
                  value={inputs.extraNotes || ''}
                  onChange={e => updateField('extraNotes', e.target.value)}
                  disabled={generating}
                  style={{ fontFamily: 'inherit' }}
                />
              </Field>
            </div>

            {/* Submit Button */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Btn type="submit" busy={generating} disabled={generating || !canWrite}>
                {generating ? 'Drafting Emails...' : '▶ Generate Cold Email'}
              </Btn>
            </div>
          </form>
        </Card>

        {/* Right Column: Generated Output */}
        <div>
          {generating ? (
            <Card title="Generating Outreach..." subtitle="Claude is crafting personalized cold emails without marketing jargon.">
              <Skeleton rows={6} />
              <p className="muted small" style={{ marginTop: 12 }}>
                Fetching website context if provided, applying anti-AI sanitizers, and generating 3 follow-ups...
              </p>
            </Card>
          ) : !currentOutputs ? (
            <Card>
              <Empty
                title="No email generated yet"
                text="Fill in any details about your prospect or offer on the left, then click Generate Cold Email."
              />
            </Card>
          ) : (
            <Card
              title="Generated Outreach Package"
              subtitle={currentModelUsed ? `Engine: ${currentModelUsed} · Kept for 7 days` : 'Kept for 7 days'}
              actions={
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn kind="ghost" onClick={() => handleGenerate()} busy={generating}>
                    <Icon name="refresh" size={14} /> Regenerate
                  </Btn>
                </div>
              }
              flush
            >
              {/* Output Tabs */}
              <div style={{ padding: '12px 18px 0', borderBottom: '1px solid var(--line)' }}>
                <Tabs
                  value={activeTab}
                  onChange={v => setActiveTab(v as any)}
                  tabs={[
                    ['email', 'Main Email'],
                    ['fu1', 'Day 3 Follow-up'],
                    ['fu2', 'Day 7 Follow-up'],
                    ['fu3', 'Day 14 Follow-up'],
                    ['subjects', `Subject Lines (${currentOutputs.subject_lines?.length || 3})`]
                  ]}
                />
              </div>

              <div style={{ padding: 20 }}>
                {/* TAB 1: Main Email */}
                {activeTab === 'email' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span className="small muted">
                        Editable draft · {wordCount(currentOutputs.email)} words
                      </span>
                      <Btn
                        kind="ghost"
                        style={{ padding: '5px 12px', fontSize: 12 }}
                        onClick={() => copyToClipboard(currentOutputs.email, 'email')}
                      >
                        <Icon name={copiedKey === 'email' ? 'check' : 'copy'} size={14} />
                        {copiedKey === 'email' ? 'Copied!' : 'Copy Email'}
                      </Btn>
                    </div>
                    <textarea
                      className="sw-input"
                      rows={10}
                      value={currentOutputs.email}
                      onChange={e => setCurrentOutputs({ ...currentOutputs, email: e.target.value })}
                      style={{ lineHeight: 1.6, fontFamily: 'inherit', fontSize: 13 }}
                    />
                  </div>
                )}

                {/* TAB 2: Follow-up Day 3 */}
                {activeTab === 'fu1' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span className="small muted">
                        Quick thought or check-in · {wordCount(currentOutputs.follow_ups?.[0]?.message || '')} words
                      </span>
                      <Btn
                        kind="ghost"
                        style={{ padding: '5px 12px', fontSize: 12 }}
                        onClick={() => copyToClipboard(currentOutputs.follow_ups?.[0]?.message || '', 'fu1')}
                      >
                        <Icon name={copiedKey === 'fu1' ? 'check' : 'copy'} size={14} />
                        {copiedKey === 'fu1' ? 'Copied!' : 'Copy Message'}
                      </Btn>
                    </div>
                    <textarea
                      className="sw-input"
                      rows={6}
                      value={currentOutputs.follow_ups?.[0]?.message || ''}
                      onChange={e => {
                        const next = [...(currentOutputs.follow_ups || [])];
                        next[0] = { day: 3, message: e.target.value };
                        setCurrentOutputs({ ...currentOutputs, follow_ups: next });
                      }}
                      style={{ lineHeight: 1.6, fontFamily: 'inherit', fontSize: 13 }}
                    />
                  </div>
                )}

                {/* TAB 3: Follow-up Day 7 */}
                {activeTab === 'fu2' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span className="small muted">
                        One-line value or brief thought · {wordCount(currentOutputs.follow_ups?.[1]?.message || '')} words
                      </span>
                      <Btn
                        kind="ghost"
                        style={{ padding: '5px 12px', fontSize: 12 }}
                        onClick={() => copyToClipboard(currentOutputs.follow_ups?.[1]?.message || '', 'fu2')}
                      >
                        <Icon name={copiedKey === 'fu2' ? 'check' : 'copy'} size={14} />
                        {copiedKey === 'fu2' ? 'Copied!' : 'Copy Message'}
                      </Btn>
                    </div>
                    <textarea
                      className="sw-input"
                      rows={6}
                      value={currentOutputs.follow_ups?.[1]?.message || ''}
                      onChange={e => {
                        const next = [...(currentOutputs.follow_ups || [])];
                        next[1] = { day: 7, message: e.target.value };
                        setCurrentOutputs({ ...currentOutputs, follow_ups: next });
                      }}
                      style={{ lineHeight: 1.6, fontFamily: 'inherit', fontSize: 13 }}
                    />
                  </div>
                )}

                {/* TAB 4: Follow-up Day 14 */}
                {activeTab === 'fu3' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span className="small muted">
                        Breakup or gentle final touch · {wordCount(currentOutputs.follow_ups?.[2]?.message || '')} words
                      </span>
                      <Btn
                        kind="ghost"
                        style={{ padding: '5px 12px', fontSize: 12 }}
                        onClick={() => copyToClipboard(currentOutputs.follow_ups?.[2]?.message || '', 'fu3')}
                      >
                        <Icon name={copiedKey === 'fu3' ? 'check' : 'copy'} size={14} />
                        {copiedKey === 'fu3' ? 'Copied!' : 'Copy Message'}
                      </Btn>
                    </div>
                    <textarea
                      className="sw-input"
                      rows={5}
                      value={currentOutputs.follow_ups?.[2]?.message || ''}
                      onChange={e => {
                        const next = [...(currentOutputs.follow_ups || [])];
                        next[2] = { day: 14, message: e.target.value };
                        setCurrentOutputs({ ...currentOutputs, follow_ups: next });
                      }}
                      style={{ lineHeight: 1.6, fontFamily: 'inherit', fontSize: 13 }}
                    />
                  </div>
                )}

                {/* TAB 5: Subject Lines */}
                {activeTab === 'subjects' && (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <p className="muted small" style={{ margin: '0 0 4px' }}>
                      Short, lowercase-friendly, non-clickbait subject options:
                    </p>
                    {currentOutputs.subject_lines?.map((subj, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: 'var(--soft)',
                          borderRadius: 8,
                          gap: 12
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 13, wordBreak: 'break-word' }}>
                          {subj}
                        </span>
                        <Btn
                          kind="ghost"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => copyToClipboard(subj, `subj-${idx}`)}
                        >
                          <Icon name={copiedKey === `subj-${idx}` ? 'check' : 'copy'} size={13} />
                          {copiedKey === `subj-${idx}` ? 'Copied' : 'Copy'}
                        </Btn>
                      </div>
                    ))}
                  </div>
                )}

                {/* Personalization Note */}
                {currentOutputs.personalization_used && (
                  <div
                    style={{
                      marginTop: 18,
                      padding: '10px 14px',
                      background: '#f9fafd',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      fontSize: 12
                    }}
                  >
                    <strong style={{ color: 'var(--ink)' }}>Personalization applied: </strong>
                    <span className="muted">{currentOutputs.personalization_used}</span>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Recent Generations (Kept for 7 Days) */}
      <Card
        title="Recent Generations"
        subtitle="Saved drafts are automatically retained for 7 days. Only accessible by your account."
        actions={
          historyList.length > 0 ? (
            <Btn
              kind="ghost"
              style={{ fontSize: 12, color: 'var(--red)' }}
              onClick={handleClearAll}
              busy={clearingAll}
            >
              <Icon name="trash" size={13} /> Clear All History
            </Btn>
          ) : undefined
        }
        flush
      >
        {historyQ.loading && !historyQ.data ? (
          <Skeleton rows={4} />
        ) : historyList.length === 0 ? (
          <Empty
            title="No past generations"
            text="Any cold emails you generate will appear here for 7 days so you can reopen, copy, or edit them anytime."
          />
        ) : (
          <>
            <Table head={['Created', 'Company / Prospect', 'Subject Sample', 'Email Snippet', 'Retention', 'Actions']}>
              {historyList.map(record => {
                const targetTitle = [
                  record.inputs?.companyName,
                  record.inputs?.targetPersonName
                ].filter(Boolean).join(' · ') || 'General Outreach';

                const sampleSubject = record.outputs?.subject_lines?.[0] || 'Cold Email';
                const emailSnippet = record.outputs?.email
                  ? `${record.outputs.email.slice(0, 70)}...`
                  : '—';

                return (
                  <tr key={record.id}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                      {ago(record.createdAt)}
                    </td>
                    <td>
                      <strong>{targetTitle}</strong>
                      {record.inputs?.companyWebsite && (
                        <div className="small muted">{record.inputs.companyWebsite}</div>
                      )}
                    </td>
                    <td>
                      <code>{sampleSubject}</code>
                    </td>
                    <td className="small muted" style={{ maxWidth: 280 }}>
                      {emailSnippet}
                    </td>
                    <td>
                      <Badge tone="blue">{formatExpiresIn(record.expiresAt)}</Badge>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Btn
                          kind="ghost"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => loadPastGeneration(record)}
                        >
                          Restore
                        </Btn>
                        <Btn
                          kind="ghost"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          onClick={() => copyToClipboard(record.outputs?.email || '', `hist-${record.id}`)}
                          title="Copy main email"
                        >
                          <Icon name={copiedKey === `hist-${record.id}` ? 'check' : 'copy'} size={13} />
                        </Btn>
                        <Btn
                          kind="danger"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          onClick={() => handleDeleteRecord(record.id)}
                          busy={deletingId === record.id}
                          title="Delete generation"
                        >
                          <Icon name="trash" size={13} />
                        </Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div
                style={{
                  padding: '14px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid var(--line)'
                }}
              >
                <span className="small muted">
                  Showing page {page} of {totalPages} ({totalHistory} total saved)
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn
                    kind="ghost"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >
                    Previous
                  </Btn>
                  <Btn
                    kind="ghost"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Btn>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
