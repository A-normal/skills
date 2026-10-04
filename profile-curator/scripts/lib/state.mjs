import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_STATE_DIR = '/root/.openclaw/workspace/state/profile-curator';
export const DEFAULT_GENERATED_DIR = '/root/.openclaw/workspace/generated/profile-curator';

export function statePaths(stateDir) {
  return {
    root: stateDir,
    config: path.join(stateDir, 'config.json'),
    candidates: path.join(stateDir, 'candidates.jsonl'),
    decisions: path.join(stateDir, 'decisions.jsonl'),
    currentView: path.join(stateDir, 'current-view.json'),
    lastRun: path.join(stateDir, 'last-run.json'),
    applyState: path.join(stateDir, 'apply-state.json'),
    applyPending: path.join(stateDir, 'apply-pending.json'),
    backups: path.join(stateDir, 'backups'),
    locks: path.join(stateDir, 'locks'),
  };
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && arguments.length > 1) return fallback;
    throw new Error(`无法读取 JSON：${filePath}: ${error.message}`);
  }
}

export async function writeJsonAtomic(filePath, value, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode, flag: 'wx' });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readJsonl(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`JSONL 第 ${index + 1} 行无效：${filePath}: ${error.message}`);
    }
  }
  return records;
}

export async function appendJsonl(filePath, records) {
  if (records.length === 0) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const payload = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  await fs.appendFile(filePath, payload, { encoding: 'utf8', mode: 0o600 });
}

export async function writeJsonlAtomic(filePath, records) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const payload = records.length === 0 ? '' : `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  try {
    await fs.writeFile(tempPath, payload, { mode: 0o600, flag: 'wx' });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function initializeState(stateDir, defaultConfigPath) {
  const paths = statePaths(stateDir);
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
  await fs.mkdir(paths.backups, { recursive: true, mode: 0o700 });
  await fs.mkdir(paths.locks, { recursive: true, mode: 0o700 });

  if (!(await pathExists(paths.config))) {
    const config = JSON.parse(await fs.readFile(defaultConfigPath, 'utf8'));
    await fs.writeFile(paths.config, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  }
  for (const filePath of [paths.candidates, paths.decisions]) {
    if (!(await pathExists(filePath))) await fs.writeFile(filePath, '', { mode: 0o600, flag: 'wx' });
  }
  if (!(await pathExists(paths.lastRun))) {
    await writeJsonAtomic(paths.lastRun, {
      schemaVersion: 1,
      initialPreviewCompleted: false,
      lastEvaluatedAt: null,
      lastStatus: 'initialized',
    });
  }
  return paths;
}

export async function acquireLock(stateDir, name = 'mutation') {
  const lockDir = statePaths(stateDir).locks;
  await fs.mkdir(lockDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(lockDir, `${name}.lock`);
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`已有 Profile Curator 任务持有锁：${lockPath}`);
    throw error;
  }
  return async () => {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true });
  };
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function sha256File(filePath) {
  return sha256Text(await fs.readFile(filePath, 'utf8'));
}

export function stableId(prefix, parts) {
  const digest = crypto.createHash('sha256').update(parts.join('\u001f'), 'utf8').digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

export function safeTimestamp(iso = new Date().toISOString()) {
  return iso.replaceAll(':', '-').replaceAll('.', '-');
}
