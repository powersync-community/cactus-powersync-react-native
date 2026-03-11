/**
 * cactus-powersync devtools — local SQLite browser
 *
 * Finds the PowerSync database inside the iOS Simulator app container,
 * opens it read-only, and serves a web UI at http://localhost:3000.
 *
 * Usage:
 *   cd devtools && npm install && npm start
 *
 * The app must be installed in a simulator (pnpm ios run at least once).
 * You can keep this server running while the simulator app is open —
 * reads are non-blocking and the DB is opened in read-only mode.
 */

import http from 'http';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

const PORT = 3000;
// The DB filename changed across builds — search for both
const DB_FILENAMES = ['cactus-powersync-demo.db', 'cactus.db'];
// App bundle ID (from app.config.js)
const BUNDLE_ID = 'com.powersync.cactusapp';
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Database discovery
// ---------------------------------------------------------------------------

function findSimulatorDb() {
  // Strategy 1: use xcrun simctl to find the booted device + app container directly.
  // This is instant and doesn't require directory listing permissions.
  try {
    const boostedUuid = execSync(
      `xcrun simctl list devices booted --json 2>/dev/null | python3 -c "import sys,json; devs=json.load(sys.stdin)['devices']; print(next(d['udid'] for runtimes in devs.values() for d in runtimes if d.get('state')=='Booted'))"`,
      { shell: '/bin/zsh', timeout: 5000 }
    ).toString().trim();

    if (boostedUuid) {
      const containerPath = execSync(
        `xcrun simctl get_app_container "${boostedUuid}" "${BUNDLE_ID}" data 2>/dev/null`,
        { shell: '/bin/zsh', timeout: 5000 }
      ).toString().trim();

      if (containerPath) {
        // op-sqlite puts the DB in Library/ (not Documents/)
        const searchDirs = [
          `${containerPath}/Library`,
          `${containerPath}/Documents`,
          `${containerPath}/Documents/databases`,
        ];
        for (const dir of searchDirs) {
          for (const name of DB_FILENAMES) {
            const candidate = `${dir}/${name}`;
            if (existsSync(candidate)) return candidate;
          }
        }
      }
    }
  } catch { /* fall through */ }

  // Strategy 2: mdfind (Spotlight) — fast on macOS, no permission issues
  try {
    for (const name of DB_FILENAMES) {
      const mdfind = execSync(
        `mdfind -name "${name}" 2>/dev/null | grep -i simulator | head -5`,
        { shell: '/bin/zsh', timeout: 5000 }
      ).toString().trim();

      if (mdfind) {
        const paths = mdfind.split('\n').filter(Boolean);
        if (paths.length === 1) return paths[0];
        const newest = execSync(
          `ls -t ${paths.map(p => `"${p}"`).join(' ')} 2>/dev/null | head -1`,
          { shell: '/bin/zsh' }
        ).toString().trim();
        return newest || paths[0];
      }
    }
  } catch { /* fall through */ }

  return null;
}

// ---------------------------------------------------------------------------
// Database queries
// ---------------------------------------------------------------------------

let _db = null;
let _dbPath = null;

function getDb() {
  const path = findSimulatorDb();
  if (!path) return null;

  // Re-open if path changed (different simulator / reinstall)
  if (!_db || path !== _dbPath) {
    if (_db) { try { _db.close(); } catch {} }
    _db = new Database(path, { readonly: true, fileMustExist: true });
    _dbPath = path;
    console.log(`[db] Opened: ${path}`);
  }

  return _db;
}

function listTables(db) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all()
    .map((r) => r.name);
}

function tableInfo(db, table) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
  const columns = db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((c) => c.name);
  return { count, columns };
}

function tableRows(db, table, limit = 200, offset = 0) {
  return db
    .prepare(`SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ? OFFSET ?`)
    .all(limit, offset);
}

function runQuery(db, sql) {
  // Only allow SELECT for safety
  const trimmed = sql.trim().toLowerCase();
  if (!trimmed.startsWith('select') && !trimmed.startsWith('pragma')) {
    throw new Error('Only SELECT and PRAGMA statements are allowed.');
  }
  return db.prepare(sql).all();
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res, message, status = 500) {
  json(res, { error: message }, status);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── API routes ──────────────────────────────────────────────────────────

  if (path === '/api/status') {
    const dbPath = findSimulatorDb();
    return json(res, { found: !!dbPath, path: dbPath ?? null });
  }

  if (path === '/api/debug') {
    let simctlOut = '', mdfindOut = '', errors = '';
    try {
      simctlOut = execSync(
        `xcrun simctl list devices booted 2>/dev/null`,
        { shell: '/bin/zsh', timeout: 5000 }
      ).toString().trim();
    } catch (e) { errors += 'simctl failed: ' + e.message + '\n'; }
    try {
      mdfindOut = execSync(
        `mdfind -name "cactus" 2>/dev/null | grep -i simulator | head -10`,
        { shell: '/bin/zsh', timeout: 5000 }
      ).toString().trim();
    } catch (e) { errors += 'mdfind failed: ' + e.message + '\n'; }
    const resolved = findSimulatorDb();
    return json(res, { resolved, simctlOut, mdfindOut, errors, dbFilenames: DB_FILENAMES, bundleId: BUNDLE_ID });
  }

  if (path === '/api/tables') {
    const db = getDb();
    if (!db) return error(res, 'Database not found. Make sure the app is installed in a simulator.', 404);
    try {
      const tables = listTables(db);
      const result = tables.map((name) => {
        try {
          return { name, ...tableInfo(db, name) };
        } catch {
          return { name, count: -1, columns: [] };
        }
      });
      return json(res, result);
    } catch (e) {
      return error(res, e.message);
    }
  }

  const tableMatch = path.match(/^\/api\/table\/(.+)$/);
  if (tableMatch) {
    const table = decodeURIComponent(tableMatch[1]);
    const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '100', 10));
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const db = getDb();
    if (!db) return error(res, 'Database not found.', 404);
    try {
      const rows = tableRows(db, table, limit, offset);
      const { count } = tableInfo(db, table);
      return json(res, { rows, total: count, limit, offset });
    } catch (e) {
      return error(res, e.message);
    }
  }

  if (path === '/api/query' && req.method === 'POST') {
    const db = getDb();
    if (!db) return error(res, 'Database not found.', 404);
    const body = await new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => resolve(data));
    });
    try {
      const { sql } = JSON.parse(body);
      const rows = runQuery(db, sql);
      return json(res, { rows });
    } catch (e) {
      return error(res, e.message, 400);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────

  if (path === '/' || path === '/index.html') {
    const html = await readFile(join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  res.writeHead(404);
  res.end('Not found');
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e) => {
    console.error(e);
    res.writeHead(500);
    res.end('Internal server error');
  });
});

server.listen(PORT, () => {
  console.log(`\n  Cactus + PowerSync devtools`);
  console.log(`  http://localhost:${PORT}\n`);

  const dbPath = findSimulatorDb();
  if (dbPath) {
    console.log(`  DB found: ${dbPath}`);
  } else {
    console.log(`  DB not found yet — run "pnpm ios" first, then refresh the browser.`);
  }
});
