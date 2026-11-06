'use client';
import { useApp } from '../../ui/context';
import MembersPanel from '../../ui/members';
import { Empty } from '../../ui/kit';
export default function Team() {
  const { projectId, project } = useApp();
  return <div className="sw-page"><div className="sw-page-head"><div><p className="eyebrow">ADMINISTRATION</p><h1>Team Management</h1><p className="muted">Members of the active project{project ? `: ${project.name}` : ''}. Switch projects from the header.</p></div></div>
    {projectId ? <MembersPanel projectId={projectId} /> : <Empty title="No project selected" text="Create or select a project first." />}</div>;
}
