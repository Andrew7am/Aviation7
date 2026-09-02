import { join } from 'path';
import { homedir } from 'os';

/**
 * Where backups live.
 *
 * BACKUP_DIR holds one folder or several separated by ';' — the first is the
 * one written and verified, the rest are copies. Every script that touches
 * backups reads it through here, so a second destination added to .env cannot
 * leave the restore looking in a path that is really two paths joined by a
 * semicolon.
 */
export function backupRoots(): string[] {
  const raw = process.env.BACKUP_DIR ?? join(homedir(), 'Documents', 'Aviation Backups');
  const roots = raw.split(';').map(s => s.trim()).filter(Boolean);
  return roots.length ? roots : [join(homedir(), 'Documents', 'Aviation Backups')];
}

/** The folder backups are written to and read back from. */
export function primaryBackupRoot(): string {
  return backupRoots()[0];
}
