// Central navigation registry. A new module adds ONE entry here; the sidebar, breadcrumbs and permission gating pick it up.
export type Gate = 'manageUsers' | 'manageSettings' | 'viewActivity';
export type NavItem = { label: string; href: string; icon: string; gate?: Gate; match?: string[] };
export type NavSection = { title: string; items: NavItem[] };
export const NAV: NavSection[] = [
  { title: 'Main', items: [
    { label: 'Overview', href: '/', icon: 'grid' },
    { label: 'Projects', href: '/projects', icon: 'folder' },
    { label: 'Websites', href: '/websites', icon: 'globe' } ] },
  { title: 'Monitoring', items: [
    { label: 'Cron Monitor', href: '/cron-monitor', icon: 'pulse' },
    { label: 'Speed Test', href: '/speed-test', icon: 'zap' } ] },
  { title: 'Analytics', items: [
    { label: 'Reports', href: '/reports', icon: 'file' },
    { label: 'Performance History', href: '/performance', icon: 'chart' },
    { label: 'Activity Logs', href: '/activity', icon: 'clock', gate: 'viewActivity' } ] },
  { title: 'Administration', items: [
    { label: 'Team Management', href: '/team', icon: 'users' },
    { label: 'User Management', href: '/users', icon: 'shield', gate: 'manageUsers' },
    { label: 'Settings', href: '/settings', icon: 'sliders' } ] }
];
export const ALL_ITEMS = NAV.flatMap(s => s.items);
