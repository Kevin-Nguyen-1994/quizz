import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import express from 'express';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { after, before, describe, it } from 'node:test';

let temporaryDataDir = '';
let databaseModule: typeof import('./db');
let server: http.Server;
let baseUrl = '';
let adminToken = '';
let userToken = '';
let createdUserId = 0;
let assignmentId = 0;

async function request(
  pathname: string,
  options: {
    method?: string;
    body?: unknown;
    admin?: boolean;
    token?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.admin ? { Authorization: `Bearer ${adminToken}` } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = (await response.json()) as Record<string, unknown>;
  return { response, data };
}

before(async () => {
  temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'til-quiz-users-'));
  process.env.DATA_DIR = temporaryDataDir;
  process.env.ADMIN_PASSWORD = 'internal-users-admin-password';
  process.env.JWT_SECRET = 'internal-users-jwt-secret-at-least-32-characters';

  // Start from the pre-Phase-2D users schema to exercise the real migration.
  const legacyDb = await open({
    filename: path.join(temporaryDataDir, 'quizz.db'),
    driver: sqlite3.Database,
  });
  await legacyDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_password_change TEXT
    )
  `);
  await legacyDb.run(
    'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
    'legacy@example.com',
    'Nhân viên cũ',
    await bcrypt.hash('legacy-password', 4),
  );
  await legacyDb.close();

  databaseModule = await import('./db');
  await databaseModule.initDb();
  const [{ authRouter }, { usersRouter }, middleware] = await Promise.all([
    import('./routes/auth'),
    import('./routes/users'),
    import('./middleware'),
  ]);
  adminToken = middleware.signToken({ id: 0, role: 'super_admin', username: 'admin' });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/admin/users', usersRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (databaseModule?.db) await databaseModule.db.close();
  if (temporaryDataDir) fs.rmSync(temporaryDataDir, { recursive: true, force: true });
});

describe('internal employee accounts', () => {
  it('migrates legacy users safely and keeps email login as fallback', async () => {
    const columns = await databaseModule.db.all<Array<{ name: string; notnull: number }>>(
      'PRAGMA table_info(users)',
    );
    assert.equal(columns.find((column) => column.name === 'email')?.notnull, 0);
    const legacy = await databaseModule.db.get<{
      login_name: string | null;
      email: string | null;
    }>('SELECT login_name, email FROM users WHERE email = ?', 'legacy@example.com');
    assert.equal(legacy?.login_name, 'legacy');
    assert.equal(legacy?.email, 'legacy@example.com');

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'legacy@example.com', password: 'legacy-password' },
    });
    assert.equal(login.response.status, 200);
  });

  it('creates an employee without email and rejects a duplicate login name', async () => {
    const created = await request('/api/admin/users', {
      method: 'POST',
      admin: true,
      body: {
        loginName: '  LOG01  ',
        username: 'Nguyễn Thị Hương Giang',
        password: 'initial-password',
      },
    });
    assert.equal(created.response.status, 201);
    const user = created.data.user as Record<string, unknown>;
    createdUserId = user.id as number;
    assert.equal(user.login_name, 'LOG01');
    assert.equal(user.email, null);

    const duplicate = await request('/api/admin/users', {
      method: 'POST',
      admin: true,
      body: { loginName: 'log01', username: 'Trùng', password: 'another-password' },
    });
    assert.equal(duplicate.response.status, 409);
    const unsafe = await request('/api/admin/users', {
      method: 'POST',
      admin: true,
      body: { loginName: 'LOG 02', username: 'Không hợp lệ', password: 'another-password' },
    });
    assert.equal(unsafe.response.status, 400);
  });

  it('logs in by login name, rejects bad passwords, reset works, and ban blocks login', async () => {
    const valid = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'log01', password: 'initial-password' },
    });
    assert.equal(valid.response.status, 200);
    const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${String(valid.data.token)}` },
    });
    const me = (await meResponse.json()) as { loginName?: string; email?: string | null };
    assert.equal(me.loginName, 'LOG01');
    assert.equal(me.email, null);

    const invalid = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'LOG01', password: 'wrong-password' },
    });
    assert.equal(invalid.response.status, 401);

    const reset = await request(`/api/admin/users/${createdUserId}/reset-password`, {
      method: 'POST',
      admin: true,
      body: {},
    });
    assert.equal(reset.response.status, 200);
    assert.equal(typeof reset.data.password, 'string');

    const ban = await request(`/api/admin/users/${createdUserId}/ban`, {
      method: 'POST',
      admin: true,
    });
    assert.equal(ban.response.status, 200);
    const bannedLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'LOG01', password: reset.data.password },
    });
    assert.equal(bannedLogin.response.status, 403);

    await request(`/api/admin/users/${createdUserId}/unban`, { method: 'POST', admin: true });
    const resetLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'LOG01', password: reset.data.password },
    });
    assert.equal(resetLogin.response.status, 200);
    userToken = String(resetLogin.data.token);
  });

  it('protects employee administration from no-auth and ordinary-user tokens', async () => {
    const noAuth = await request('/api/admin/users');
    assert.equal(noAuth.response.status, 401);

    const ordinaryUser = await request('/api/admin/users', { token: userToken });
    assert.equal(ordinaryUser.response.status, 403);

    const superAdmin = await request('/api/admin/users', { admin: true });
    assert.equal(superAdmin.response.status, 200);
  });

  it('rate-limits repeated failed logins by trusted Cloudflare client IP', async () => {
    const headers = { 'CF-Connecting-IP': '198.51.100.77' };
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const failed = await request('/api/auth/login', {
        method: 'POST',
        body: { identifier: 'rate-limit-test', password: 'incorrect-password' },
        headers,
      });
      assert.equal(failed.response.status, 401);
      assert.equal(failed.response.headers.get('ratelimit-remaining'), String(10 - attempt));
    }

    const blocked = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'rate-limit-test', password: 'incorrect-password' },
      headers,
    });
    assert.equal(blocked.response.status, 429);
    assert.equal(blocked.response.headers.get('retry-after'), '600');
    assert.equal(
      blocked.data.error,
      'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau ít phút.',
    );
  });

  it('disables self-registration', async () => {
    const registration = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'new@example.com', username: 'New', password: 'password' },
    });
    assert.equal(registration.response.status, 403);
  });

  it('uses login snapshots in Assignment reports and CSV when email is null', async () => {
    const service = await import('./assignmentService');
    const reporting = await import('./assignmentReporting');
    const quiz = await databaseModule.db.run(
      `INSERT INTO quizzes (title, description, language, owner_kind)
       VALUES ('Quiz nội bộ', '', 'vi', 'admin')`,
    );
    await databaseModule.db.run(
      `INSERT INTO questions (
        quiz_id, text, options, correct_index, base_score, time_sec, order_index, question_type
      ) VALUES (?, 'Câu hỏi', '["Đúng","Sai"]', 0, 500, 20, 0, 'multiple_choice')`,
      quiz.lastID,
    );
    const now = Date.now();
    const assignment = await service.createDraftAssignment(
      { id: 0, role: 'super_admin' },
      {
        quizId: Number(quiz.lastID),
        title: 'Bài kiểm tra nội bộ',
        opensAtMs: now - 1_000,
        deadlineAtMs: now + 60_000,
      },
    );
    assignmentId = assignment.id;
    await service.setAssignmentMembers({ id: 0, role: 'super_admin' }, assignment.id, [
      createdUserId,
    ]);
    await service.publishAssignment({ id: 0, role: 'super_admin' }, assignment.id);

    const member = await databaseModule.db.get<{
      login_name_snapshot: string | null;
      email_snapshot: string;
    }>(
      'SELECT login_name_snapshot, email_snapshot FROM assignment_members WHERE assignment_id = ?',
      [assignment.id],
    );
    assert.equal(member?.login_name_snapshot, 'LOG01');
    assert.equal(member?.email_snapshot, '');

    const report = await reporting.getAssignmentReport(
      { id: 0, role: 'super_admin' },
      assignment.id,
    );
    assert.equal(report.participants[0].loginName, 'LOG01');
    assert.equal(report.participants[0].email, null);
    const csv = await reporting.buildAssignmentCsv({ id: 0, role: 'super_admin' }, assignment.id);
    assert.equal(csv.body.startsWith('\uFEFF'), true);
    assert.equal(csv.body.includes('Assignment,Login name,Participant name,Email'), true);
    assert.equal(csv.body.includes('LOG01,Nguyễn Thị Hương Giang,,'), true);
  });

  it('can run the migration repeatedly without losing users or Assignment data', async () => {
    await databaseModule.db.close();
    await databaseModule.initDb();
    await databaseModule.db.close();
    await databaseModule.initDb();
    const counts = await databaseModule.db.get<{ users: number; assignments: number }>(
      `SELECT
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM assignments WHERE id = ?) as assignments`,
      assignmentId,
    );
    assert.equal(counts?.users, 2);
    assert.equal(counts?.assignments, 1);
  });
});
