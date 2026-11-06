import { rows, db } from './db';
let cache: { at: number; map: Map<string, string> } | null = null;
async function load() {
  if (cache && Date.now() - cache.at < 30_000) return cache.map;
  const r = await rows<{ setting_key: string; setting_value: string }>('SELECT setting_key, setting_value FROM system_settings');
  cache = { at: Date.now(), map: new Map(r.map(x => [x.setting_key, x.setting_value])) };
  return cache.map;
}
export async function getSettingInt(key: string, fallback: number) {
  const v = Number((await load()).get(key));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}
export async function getAllSettings() { return Object.fromEntries(await load()); }
export async function setSetting(key: string, value: string, userId: number) {
  await db.query('INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)', [key, value, userId]);
  cache = null;
}
