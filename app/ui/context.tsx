'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { call } from './kit';

export type Project = { id: number; name: string; slug: string; status: string; my_role: string; client_name: string | null; site_count: number; up_count: number; down_count: number; open_incidents: number; avg_response_ms: number | null; member_count: number; description: string | null; logo_url: string | null; primary_domain: string | null };
type Me = { user: { id: number; name: string; email: string; role: string; timezone: string }; can: { createProject: boolean; manageUsers: boolean; manageSettings: boolean; viewActivity: boolean }; features: { speedTest: boolean; email: boolean } };
type Ctx = Me & { projects: Project[]; project: Project | null; projectId: number | null; setProjectId: (id: number) => void; reloadProjects: () => Promise<void>; ready: boolean; isManager: boolean; canWrite: boolean };
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error('useApp outside provider'); return c; };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setPid] = useState<number | null>(null);
  const reloadProjects = useCallback(async () => {
    const d = await call('/api/projects'); setProjects(d.projects);
    setPid(cur => { const saved = Number(typeof window !== 'undefined' ? localStorage.getItem('sw_project') : 0); const pick = [cur, saved].find(x => x && d.projects.some((p: Project) => p.id === x)); return pick ?? d.projects.find((p: Project) => p.status !== 'archived')?.id ?? d.projects[0]?.id ?? null; });
  }, []);
  useEffect(() => { call('/api/auth/me').then(setMe).catch(() => { location.href = '/login'; }); reloadProjects().catch(() => undefined); }, [reloadProjects]);
  const setProjectId = useCallback((id: number) => { setPid(id); try { localStorage.setItem('sw_project', String(id)); } catch { /* storage unavailable */ } }, []);
  const value = useMemo<Ctx | null>(() => {
    if (!me) return null;
    const project = projects.find(p => p.id === projectId) ?? null;
    const isManager = me.user.role === 'super_admin' || project?.my_role === 'manager';
    return { ...me, projects, project, projectId, setProjectId, reloadProjects, ready: true, isManager, canWrite: !!project && project.status !== 'archived' && isManager };
  }, [me, projects, projectId, setProjectId, reloadProjects]);
  if (!value) return <div className="sw-boot"><div className="sw-spinner" /></div>;
  return <C.Provider value={value}>{children}</C.Provider>;
}
