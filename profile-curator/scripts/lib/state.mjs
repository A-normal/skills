import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_STATE_DIR = '/root/.openclaw/workspace/state/profile-curator';
export const DEFAULT_GENERATED_DIR = '/root/.openclaw/workspace/generated/profile-curator';

export function statePaths(stateDir) {
  return {
    root: stateDir,
    config: path.join(stateDir, 'config.json'),
    observations: path.join(stateDir, 'observations.jsonl'),
    decisions: path.join(stateDir, 'decisions.jsonl'),
    currentView: path.join(stateDir, 'current-view.json'),
    lastRun: path.join(stateDir, 'last-run.json'),
    activeRun: path.join(stateDir, 'active-run.json'),
    runs: path.join(stateDir, 'runs'),
    locks: path.join(stateDir, 'locks'),
    legacyCandidates: path.join(stateDir, 'candidates.jsonl'),
    legacyApplyState: path.join(stateDir, 'apply-state.json'),
    legacyApplyPending: path.join(stateDir, 'apply-pending.json'),
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

async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writeTextAtomic(filePath, text, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(tempPath, 'wx', mode);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
    await syncDirectory(path.dirname(filePath));
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value, mode = 0o600) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

export async function writeJsonlAtomic(filePath, records) {
  const payload = records.length === 0 ? '' : `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  await writeTextAtomic(filePath, payload);
}

export async function initializeState(stateDir, defaultConfigPath) {
  const paths = statePaths(stateDir);
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
  await fs.mkdir(paths.runs, { recursive: true, mode: 0o700 });
  await fs.mkdir(paths.locks, { recursive: true, mode: 0o700 });

  if (!(await pathExists(paths.config))) {
    const config = JSON.parse(await fs.readFile(defaultConfigPath, 'utf8'));
    await writeJsonAtomic(paths.config, config);
  }
  for (const filePath of [paths.observations, paths.decisions]) {
    if (!(await pathExists(filePath))) await writeJsonlAtomic(filePath, []);
  }
  if (!(await pathExists(paths.lastRun))) {
    await writeJsonAtomic(paths.lastRun, {
      schemaVersion: 2,
      lastStatus: 'initialized',
      completedAt: null,
      sourceWatermarks: {},
      sourceWatermarksTrust: 'declared',
    });
  }
  return paths;
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return true;
    if (error.code === 'ESRCH') return false;
    return null;
  }
}

export async function inspectLock(stateDir, name = 'mutation') {
  const lockPath = path.join(statePaths(stateDir).locks, `${name}.lock`);
  if (!(await pathExists(lockPath))) return { exists: false, lockPath };
  const text = await fs.readFile(lockPath, 'utf8');
  const stat = await fs.stat(lockPath);
  let metadata = null;
  try {
    metadata = JSON.parse(text);
  } catch {
    // A malformed lock still requires explicit hash-bound recovery.
  }
  const sameHost = metadata?.hostname === os.hostname();
  return {
    exists: true,
    lockPath,
    sha256: sha256Text(text),
    ageSeconds: Math.max(0, Math.floor((Date.now() - stat.mtimeMs) / 1000)),
    metadata,
    ownerAlive: sameHost ? processAlive(metadata?.pid) : null,
  };
}

export async function recoverStaleLock(stateDir, { expectedSha256, minAgeSeconds, name = 'mutation' }) {
  const current = await inspectLock(stateDir, name);
  if (!current.exists) return { status: 'absent', lockPath: current.lockPath };
  if (current.sha256 !== expectedSha256) throw new Error('锁文件哈希已变化，拒绝恢复');
  if (current.ageSeconds < minAgeSeconds) throw new Error(`锁文件仅存在 ${current.ageSeconds} 秒，未达到恢复阈值 ${minAgeSeconds} 秒`);
  if (current.ownerAlive !== false) {
    throw new Error(current.ownerAlive === true ? '锁所有者进程仍存活' : '无法证明锁所有者已退出');
  }
  const text = await fs.readFile(current.lockPath, 'utf8');
  if (sha256Text(text) !== expectedSha256) throw new Error('锁文件在恢复前发生变化');
  await fs.rm(current.lockPath);
  return { status: 'recovered', lockPath: current.lockPath, previous: current.metadata };
}

export async function acquireLock(stateDir, name = 'mutation') {
  const lockDir = statePaths(stateDir).locks;
  await fs.mkdir(lockDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(lockDir, `${name}.lock`);
  let handle;
  let created = false;
  try {
    handle = await fs.open(lockPath, 'wx', 0o600);
    created = true;
    await handle.writeFile(`${JSON.stringify({
      schemaVersion: 2,
      pid: process.pid,
      hostname: os.hostname(),
      token: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    })}\n`);
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (created) await fs.rm(lockPath, { force: true }).catch(() => {});
    if (error.code === 'EEXIST') throw new Error(`已有 Profile Curator 任务持有锁：${lockPath}；先运行 lock-status`);
    throw error;
  }
  return async () => {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true });
  };
}

export function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function sha256File(filePath) {
  return sha256Text(await fs.readFile(filePath, 'utf8'));
}

export async function hashStateInputs(paths) {
  return {
    configSha256: await sha256File(paths.config),
    observationsSha256: await sha256File(paths.observations),
    decisionsSha256: await sha256File(paths.decisions),
  };
}

export function stableId(prefix, parts) {
  const digest = crypto.createHash('sha256').update(parts.join('\u001f'), 'utf8').digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

export function safeTimestamp(iso = new Date().toISOString()) {
  return iso.replaceAll(':', '-').replaceAll('.', '-');
}
