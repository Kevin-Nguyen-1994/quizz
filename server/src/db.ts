import fs from 'node:fs';
import path from 'node:path';
import { type Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import type { DbPlayer } from './types';

// All persistent data lives in DATA_DIR (Docker) or <project-root>/data/ (local dev)
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), '..', 'data');
const DB_PATH = path.join(dataDir, 'quizz.db');

export let db: Database;

export async function initDb(): Promise<void> {
  fs.mkdirSync(dataDir, { recursive: true });
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.run('PRAGMA journal_mode = WAL');
  await db.run('PRAGMA foreign_keys = ON');
  await db.run('PRAGMA busy_timeout = 5000');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS questions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id     INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      text        TEXT NOT NULL,
      options     TEXT NOT NULL,
      correct_index INTEGER NOT NULL,
      base_score  INTEGER NOT NULL DEFAULT 500,
      time_sec    INTEGER NOT NULL DEFAULT 20,
      order_index INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id                INTEGER NOT NULL REFERENCES quizzes(id),
      pin                    TEXT NOT NULL UNIQUE,
      status                 TEXT NOT NULL DEFAULT 'waiting',
      current_question_index INTEGER NOT NULL DEFAULT -1,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      started_at             TEXT,
      finished_at            TEXT
    );

    CREATE TABLE IF NOT EXISTS players (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      username    TEXT NOT NULL,
      total_score INTEGER NOT NULL DEFAULT 0,
      joined_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, username)
    );

    CREATE TABLE IF NOT EXISTS answers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      session_id   INTEGER NOT NULL,
      question_id  INTEGER NOT NULL,
      chosen_index INTEGER NOT NULL,
      is_correct   INTEGER NOT NULL DEFAULT 0,
      score        INTEGER NOT NULL DEFAULT 0,
      answer_order INTEGER NOT NULL DEFAULT 0,
      answered_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_password_change TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login_name TEXT COLLATE NOCASE,
      email TEXT UNIQUE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_password_change TEXT
    );

    CREATE TABLE IF NOT EXISTS question_translations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id       INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      locale        TEXT NOT NULL,
      order_index   INTEGER NOT NULL,
      question_type TEXT NOT NULL,
      text          TEXT NOT NULL,
      options       TEXT NOT NULL,
      matches       TEXT,
      explanation   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(quiz_id, locale, order_index)
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id           INTEGER REFERENCES quizzes(id) ON DELETE SET NULL,
      owner_kind        TEXT NOT NULL CHECK(owner_kind IN ('admin', 'user')),
      owner_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title             TEXT NOT NULL,
      access_code       TEXT UNIQUE,
      audience_mode     TEXT NOT NULL DEFAULT 'members'
                        CHECK(audience_mode IN ('members', 'open')),
      opens_at_ms       INTEGER NOT NULL,
      deadline_at_ms    INTEGER,
      status            TEXT NOT NULL DEFAULT 'draft'
                        CHECK(status IN ('draft', 'published', 'closed', 'archived')),
      max_attempts      INTEGER NOT NULL DEFAULT 1 CHECK(max_attempts > 0),
      result_policy     TEXT NOT NULL DEFAULT 'highest_score'
                        CHECK(result_policy IN ('highest_score', 'latest_completed')),
      review_policy     TEXT NOT NULL DEFAULT 'after_deadline'
                        CHECK(review_policy IN ('after_deadline', 'after_close')),
      shuffle_questions INTEGER NOT NULL DEFAULT 1 CHECK(shuffle_questions IN (0, 1)),
      shuffle_options   INTEGER NOT NULL DEFAULT 1 CHECK(shuffle_options IN (0, 1)),
      created_at_ms     INTEGER NOT NULL,
      updated_at_ms     INTEGER NOT NULL,
      published_at_ms   INTEGER
    );

    CREATE TABLE IF NOT EXISTS assignment_questions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id      INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      source_question_id INTEGER,
      text               TEXT NOT NULL,
      options            TEXT NOT NULL,
      correct_index      INTEGER NOT NULL,
      correct_indices    TEXT,
      base_score         INTEGER NOT NULL DEFAULT 500,
      time_sec           INTEGER NOT NULL DEFAULT 20,
      order_index        INTEGER NOT NULL DEFAULT 0,
      image_url          TEXT,
      explanation        TEXT,
      range_min          INTEGER,
      range_max          INTEGER,
      question_type      TEXT NOT NULL DEFAULT 'multiple_choice',
      correct_answer     TEXT,
      media_url          TEXT,
      media_type         TEXT,
      blanks             TEXT,
      geo                TEXT,
      matches            TEXT,
      tags               TEXT,
      UNIQUE(assignment_id, order_index)
    );

    CREATE TABLE IF NOT EXISTS assignment_members (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id         INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      user_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
      login_name_snapshot   TEXT,
      display_name_snapshot TEXT NOT NULL,
      email_snapshot        TEXT NOT NULL,
      assigned_at_ms        INTEGER NOT NULL,
      UNIQUE(assignment_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS assignment_attempts (
      id                             INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id                  INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      assignment_member_id           INTEGER REFERENCES assignment_members(id) ON DELETE SET NULL,
      user_id                        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      participant_login_name         TEXT,
      participant_name               TEXT NOT NULL,
      participant_email              TEXT NOT NULL,
      attempt_number                 INTEGER NOT NULL,
      status                         TEXT NOT NULL DEFAULT 'in_progress'
                                     CHECK(status IN ('in_progress', 'completed', 'expired')),
      current_question_index         INTEGER NOT NULL DEFAULT 0,
      current_question_started_at_ms INTEGER,
      started_at_ms                  INTEGER NOT NULL,
      completed_at_ms                INTEGER,
      last_activity_at_ms            INTEGER NOT NULL,
      correct_count                  INTEGER NOT NULL DEFAULT 0,
      total_score                    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(assignment_id, user_id, attempt_number)
    );

    CREATE TABLE IF NOT EXISTS attempt_answers (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id               INTEGER NOT NULL REFERENCES assignment_attempts(id) ON DELETE CASCADE,
      assignment_question_id   INTEGER NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
      status                   TEXT NOT NULL CHECK(status IN ('answered', 'timed_out')),
      chosen_index             INTEGER,
      chosen_indices           TEXT,
      chosen_text              TEXT,
      is_correct               INTEGER NOT NULL DEFAULT 0 CHECK(is_correct IN (0, 1)),
      score                    INTEGER NOT NULL DEFAULT 0,
      question_started_at_ms   INTEGER NOT NULL,
      response_time_ms         INTEGER,
      answered_at_ms           INTEGER NOT NULL,
      UNIQUE(attempt_id, assignment_question_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_assignment_attempts_one_in_progress
      ON assignment_attempts(assignment_id, user_id)
      WHERE status = 'in_progress' AND user_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_assignment_members_assignment
      ON assignment_members(assignment_id);

    CREATE INDEX IF NOT EXISTS idx_assignment_attempts_assignment
      ON assignment_attempts(assignment_id);

    CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt
      ON attempt_answers(attempt_id);
  `);

  // Column migrations (safe to run multiple times)
  const columnMigrations = [
    `ALTER TABLE questions ADD COLUMN image_url TEXT`,
    `ALTER TABLE questions ADD COLUMN question_type TEXT NOT NULL DEFAULT 'multiple_choice'`,
    `ALTER TABLE questions ADD COLUMN correct_answer TEXT`,
    `ALTER TABLE answers ADD COLUMN chosen_text TEXT`,
    `ALTER TABLE questions ADD COLUMN correct_indices TEXT`,
    `ALTER TABLE answers ADD COLUMN chosen_indices TEXT`,
    `ALTER TABLE quizzes ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE quizzes ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'admin'`,
    `ALTER TABLE sessions ADD COLUMN hosted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE questions ADD COLUMN explanation TEXT`,
    `ALTER TABLE questions ADD COLUMN range_min INTEGER`,
    `ALTER TABLE questions ADD COLUMN range_max INTEGER`,
    `ALTER TABLE questions ADD COLUMN media_url TEXT`,
    `ALTER TABLE questions ADD COLUMN media_type TEXT`,
    `ALTER TABLE questions ADD COLUMN blanks TEXT`,
    `ALTER TABLE questions ADD COLUMN hotspot TEXT`,
    `ALTER TABLE quizzes ADD COLUMN cover_image TEXT`,
    `ALTER TABLE questions ADD COLUMN tags TEXT`,
    `ALTER TABLE questions ADD COLUMN geo TEXT`,
    `ALTER TABLE quizzes ADD COLUMN theme TEXT NOT NULL DEFAULT 'default'`,
    `ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN play_display_name TEXT`,
    `ALTER TABLE users ADD COLUMN play_avatar TEXT`,
    `ALTER TABLE users ADD COLUMN login_name TEXT`,
    `ALTER TABLE players ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE players ADD COLUMN avatar TEXT`,
    `ALTER TABLE questions ADD COLUMN matches TEXT`,
    `ALTER TABLE players ADD COLUMN locale TEXT`,
    `ALTER TABLE quizzes ADD COLUMN language TEXT NOT NULL DEFAULT 'vi'`,
    `ALTER TABLE answers ADD COLUMN response_time_ms INTEGER`,
    `ALTER TABLE sessions ADD COLUMN current_question_started_at_ms INTEGER`,
    `ALTER TABLE assignment_members ADD COLUMN login_name_snapshot TEXT`,
    `ALTER TABLE assignment_attempts ADD COLUMN participant_login_name TEXT`,
  ];
  for (const sql of columnMigrations) {
    try {
      await db.run(sql);
    } catch {
      /* column already exists */
    }
  }

  await migrateInternalUserIdentifiers();
  await migrateEmployeeLevelsAndTargeting();
  await migrateQuestionBank();

  // Migrate admin from config to database if needed
  const adminCount = await db.get('SELECT COUNT(*) as count FROM admins');
  if (adminCount.count === 0) {
    // Only create the initial super-admin if none exists yet.
    const username = process.env.ADMIN_USERNAME || 'admin';
    // Never seed a well-known password. Use ADMIN_PASSWORD when provided,
    // otherwise generate a strong random one and print it once so the
    // operator can log in and rotate it.
    const { randomBytes } = await import('node:crypto');
    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
      password = randomBytes(18).toString('base64url');
      console.warn(
        `\n[quizz] No ADMIN_PASSWORD set. Generated a one-time super-admin password:\n` +
          `        username: ${username}\n` +
          `        password: ${password}\n` +
          `        Log in and change it now; this will not be shown again.\n`,
      );
    }

    const { hashPassword } = await import('./passwords');
    const hashedPassword = await hashPassword(password);
    await db.run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [
      username,
      hashedPassword,
    ]);
  }
}

const QUESTION_CATEGORY_SEEDS = [
  ['THU_TUC_HAI_QUAN', 'Thủ tục và khai báo hải quan', 10],
  ['HS_PHAN_LOAI', 'HS và phân loại hàng hóa', 20],
  ['THUE_TRI_GIA', 'Thuế và trị giá hải quan', 30],
  ['XUAT_XU_CHUNG_TU', 'Xuất xứ và chứng từ', 40],
  ['CHINH_SACH_CHUYEN_NGANH', 'Chính sách mặt hàng và chuyên ngành', 50],
  ['DNCX_XNK_TAI_CHO', 'DNCX và XNK tại chỗ', 60],
  ['GIA_CONG_SXXK', 'Gia công và SXXK', 70],
  ['LOAI_HINH_DAC_THU', 'Loại hình và xử lý đặc thù', 80],
  ['PHAP_LY_TUAN_THU', 'Pháp lý, tuân thủ và xử phạt', 90],
  ['LOGISTICS_VAN_TAI', 'Logistics, vận tải và hiện trường', 100],
  ['VAN_HANH_CS_CHAT_LUONG', 'Vận hành CS và chất lượng', 110],
  ['AN_TOAN_KY_THUAT', 'An toàn và kiểm tra kỹ thuật', 120],
] as const;

/** Phase 7B additive Question Bank and per-assignment generation schema. */
async function migrateQuestionBank(): Promise<void> {
  await db.run('BEGIN IMMEDIATE');
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS question_categories (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        code          TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(trim(code) <> ''),
        name          TEXT NOT NULL CHECK(trim(name) <> ''),
        sort_order    INTEGER NOT NULL DEFAULT 0,
        is_active     INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS question_bank_imports (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        bank_id          TEXT NOT NULL,
        bank_version     TEXT NOT NULL,
        schema_version   TEXT NOT NULL,
        source_hash      TEXT NOT NULL,
        source_filename  TEXT NOT NULL,
        imported_at_ms   INTEGER NOT NULL,
        inserted_count   INTEGER NOT NULL DEFAULT 0,
        updated_count    INTEGER NOT NULL DEFAULT 0,
        skipped_count    INTEGER NOT NULL DEFAULT 0,
        conflict_count   INTEGER NOT NULL DEFAULT 0,
        error_count      INTEGER NOT NULL DEFAULT 0,
        summary_json     TEXT NOT NULL DEFAULT '{}',
        UNIQUE(bank_id, bank_version, source_hash)
      );

      CREATE TABLE IF NOT EXISTS bank_questions (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        source_bank_id        TEXT NOT NULL,
        source_question_id    TEXT NOT NULL,
        source_bank_version   TEXT NOT NULL,
        source_content_hash   TEXT NOT NULL,
        last_import_id        INTEGER REFERENCES question_bank_imports(id) ON DELETE SET NULL,
        question_type         TEXT NOT NULL,
        text                  TEXT NOT NULL,
        options               TEXT NOT NULL,
        correct_index         INTEGER NOT NULL DEFAULT 0,
        correct_indices       TEXT,
        correct_answer        TEXT,
        blanks                TEXT,
        range_min             INTEGER,
        range_max             INTEGER,
        geo                   TEXT,
        matches               TEXT,
        base_score            INTEGER NOT NULL DEFAULT 500 CHECK(base_score >= 0),
        time_sec              INTEGER NOT NULL DEFAULT 20 CHECK(time_sec > 0),
        image_url             TEXT,
        media_url             TEXT,
        media_type            TEXT,
        explanation           TEXT,
        tags                  TEXT,
        category_id           INTEGER NOT NULL REFERENCES question_categories(id) ON DELETE RESTRICT,
        topic                 TEXT NOT NULL,
        minimum_level_id      INTEGER NOT NULL REFERENCES employee_levels(id) ON DELETE RESTRICT,
        difficulty            TEXT CHECK(difficulty IN ('easy', 'medium', 'hard')),
        competency_code       TEXT CHECK(competency_code IN ('must_remember', 'know_where_to_lookup', 'application')),
        critical              INTEGER NOT NULL DEFAULT 0 CHECK(critical IN (0, 1)),
        recommended_seconds   INTEGER CHECK(recommended_seconds > 0),
        source_metadata_json  TEXT NOT NULL DEFAULT '{}',
        is_enabled            INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1)),
        revision              INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
        created_at_ms         INTEGER NOT NULL,
        updated_at_ms         INTEGER NOT NULL,
        UNIQUE(source_bank_id, source_question_id)
      );

      CREATE TABLE IF NOT EXISTS quiz_generation_rules (
        id                           INTEGER PRIMARY KEY AUTOINCREMENT,
        quiz_id                      INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        category_id                  INTEGER REFERENCES question_categories(id) ON DELETE RESTRICT,
        minimum_level_id             INTEGER REFERENCES employee_levels(id) ON DELETE RESTRICT,
        difficulty                   TEXT CHECK(difficulty IN ('easy', 'medium', 'hard')),
        question_type                TEXT,
        critical                     INTEGER CHECK(critical IN (0, 1)),
        question_count               INTEGER NOT NULL CHECK(question_count > 0),
        points_override              INTEGER CHECK(points_override >= 0),
        recommended_seconds_override INTEGER CHECK(recommended_seconds_override > 0),
        sort_order                   INTEGER NOT NULL DEFAULT 0,
        created_at_ms                INTEGER NOT NULL,
        updated_at_ms                INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assignment_question_previews (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id             INTEGER NOT NULL UNIQUE REFERENCES assignments(id) ON DELETE CASCADE,
        quiz_id                   INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        blueprint_revision        INTEGER NOT NULL,
        generation_seed           TEXT NOT NULL,
        pool_fingerprint           TEXT NOT NULL,
        selection_fingerprint      TEXT NOT NULL,
        total_questions            INTEGER NOT NULL,
        total_score                INTEGER NOT NULL,
        recommended_total_seconds  INTEGER NOT NULL,
        created_at_ms              INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assignment_question_preview_items (
        preview_id              INTEGER NOT NULL REFERENCES assignment_question_previews(id) ON DELETE CASCADE,
        order_index             INTEGER NOT NULL,
        rule_id                 INTEGER NOT NULL REFERENCES quiz_generation_rules(id) ON DELETE RESTRICT,
        bank_question_id        INTEGER NOT NULL REFERENCES bank_questions(id) ON DELETE RESTRICT,
        bank_question_revision  INTEGER NOT NULL,
        effective_score         INTEGER NOT NULL,
        effective_time_sec      INTEGER NOT NULL,
        PRIMARY KEY(preview_id, order_index),
        UNIQUE(preview_id, bank_question_id)
      );

      CREATE TABLE IF NOT EXISTS live_session_questions (
        id                            INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id                    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        source_bank_question_id       INTEGER REFERENCES bank_questions(id) ON DELETE RESTRICT,
        source_bank_question_revision INTEGER,
        source_generation_rule_id     INTEGER,
        text                          TEXT NOT NULL,
        options                       TEXT NOT NULL,
        correct_index                 INTEGER NOT NULL DEFAULT 0,
        correct_indices               TEXT,
        base_score                    INTEGER NOT NULL DEFAULT 500,
        time_sec                      INTEGER NOT NULL DEFAULT 20,
        order_index                   INTEGER NOT NULL DEFAULT 0,
        image_url                     TEXT,
        explanation                   TEXT,
        range_min                     INTEGER,
        range_max                     INTEGER,
        question_type                 TEXT NOT NULL DEFAULT 'multiple_choice',
        correct_answer                TEXT,
        media_url                     TEXT,
        media_type                    TEXT,
        blanks                        TEXT,
        geo                           TEXT,
        matches                       TEXT,
        tags                          TEXT,
        source_metadata_snapshot      TEXT,
        UNIQUE(session_id, order_index),
        UNIQUE(session_id, source_bank_question_id)
      );
    `);

    await addColumnIfMissing(
      'quizzes',
      'quiz_mode',
      "quiz_mode TEXT NOT NULL DEFAULT 'static' CHECK(quiz_mode IN ('static', 'bank_generated'))",
    );
    await addColumnIfMissing(
      'quizzes',
      'selection_mode',
      "selection_mode TEXT NOT NULL DEFAULT 'per_assignment' CHECK(selection_mode IN ('per_assignment', 'per_attempt'))",
    );
    await addColumnIfMissing(
      'quizzes',
      'blueprint_revision',
      'blueprint_revision INTEGER NOT NULL DEFAULT 1',
    );

    await addColumnIfMissing(
      'questions',
      'source_bank_question_id',
      'source_bank_question_id INTEGER REFERENCES bank_questions(id) ON DELETE RESTRICT',
    );
    await addColumnIfMissing(
      'questions',
      'source_bank_question_revision',
      'source_bank_question_revision INTEGER',
    );

    for (const [column, definition] of [
      ['uses_question_snapshot', 'uses_question_snapshot INTEGER NOT NULL DEFAULT 0'],
      ['generation_seed', 'generation_seed TEXT'],
      ['question_pool_fingerprint', 'question_pool_fingerprint TEXT'],
      ['question_selection_fingerprint', 'question_selection_fingerprint TEXT'],
      ['quiz_blueprint_revision_snapshot', 'quiz_blueprint_revision_snapshot INTEGER'],
    ] as const) {
      await addColumnIfMissing('sessions', column, definition);
    }

    for (const [column, definition] of [
      ['generation_seed', 'generation_seed TEXT'],
      ['question_pool_fingerprint', 'question_pool_fingerprint TEXT'],
      ['question_selection_fingerprint', 'question_selection_fingerprint TEXT'],
      ['quiz_blueprint_revision_snapshot', 'quiz_blueprint_revision_snapshot INTEGER'],
      ['question_selection_mode_snapshot', 'question_selection_mode_snapshot TEXT'],
    ] as const) {
      await addColumnIfMissing('assignments', column, definition);
    }

    for (const [column, definition] of [
      [
        'source_bank_question_id',
        'source_bank_question_id INTEGER REFERENCES bank_questions(id) ON DELETE RESTRICT',
      ],
      ['source_bank_question_revision', 'source_bank_question_revision INTEGER'],
      [
        'source_category_id',
        'source_category_id INTEGER REFERENCES question_categories(id) ON DELETE RESTRICT',
      ],
      ['source_category_code', 'source_category_code TEXT'],
      ['source_category_name', 'source_category_name TEXT'],
      ['source_topic', 'source_topic TEXT'],
      ['minimum_level_code_snapshot', 'minimum_level_code_snapshot TEXT'],
      ['difficulty_snapshot', 'difficulty_snapshot TEXT'],
      ['critical_snapshot', 'critical_snapshot INTEGER'],
      ['competency_snapshot', 'competency_snapshot TEXT'],
      ['source_generation_rule_id', 'source_generation_rule_id INTEGER'],
      ['source_metadata_snapshot', 'source_metadata_snapshot TEXT'],
    ] as const) {
      await addColumnIfMissing('assignment_questions', column, definition);
    }

    const now = Date.now();
    for (const [code, name, sortOrder] of QUESTION_CATEGORY_SEEDS) {
      await db.run(
        `INSERT INTO question_categories
           (code, name, sort_order, is_active, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           name = excluded.name,
           sort_order = excluded.sort_order`,
        code,
        name,
        sortOrder,
        now,
        now,
      );
    }

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_bank_questions_category_status_difficulty
        ON bank_questions(category_id, is_enabled, difficulty, id);
      CREATE INDEX IF NOT EXISTS idx_bank_questions_category_status_level
        ON bank_questions(category_id, is_enabled, minimum_level_id, id);
      CREATE INDEX IF NOT EXISTS idx_bank_questions_category_status_type
        ON bank_questions(category_id, is_enabled, question_type, id);
      CREATE INDEX IF NOT EXISTS idx_bank_questions_status_updated
        ON bank_questions(is_enabled, updated_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_quiz_generation_rules_quiz_order
        ON quiz_generation_rules(quiz_id, sort_order, id);
      CREATE INDEX IF NOT EXISTS idx_assignment_questions_bank_source
        ON assignment_questions(source_bank_question_id, source_bank_question_revision);
      CREATE INDEX IF NOT EXISTS idx_questions_bank_source
        ON questions(quiz_id, source_bank_question_id);
      CREATE INDEX IF NOT EXISTS idx_live_session_questions_session
        ON live_session_questions(session_id, order_index);
    `);
    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function addColumnIfMissing(
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const columns = await db.all<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
  if (!columns.some((item) => item.name === column)) {
    await db.run(`ALTER TABLE "${table}" ADD COLUMN ${definition}`);
  }
}

/** Phase 5B additive schema. Existing employees and historical assignments stay unclassified. */
async function migrateEmployeeLevelsAndTargeting(): Promise<void> {
  await db.run('BEGIN IMMEDIATE');
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS employee_levels (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        code          TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(trim(code) <> ''),
        name          TEXT NOT NULL CHECK(trim(name) <> ''),
        sort_order    INTEGER NOT NULL DEFAULT 0,
        is_active     INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS employee_level_history (
        id                         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id                    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_login_name_snapshot   TEXT NOT NULL,
        user_display_name_snapshot TEXT NOT NULL,
        old_level_id               INTEGER REFERENCES employee_levels(id) ON DELETE SET NULL,
        old_level_code_snapshot    TEXT,
        old_level_name_snapshot    TEXT,
        new_level_id               INTEGER REFERENCES employee_levels(id) ON DELETE SET NULL,
        new_level_code_snapshot    TEXT,
        new_level_name_snapshot    TEXT,
        changed_at_ms              INTEGER NOT NULL,
        changed_by_role            TEXT NOT NULL,
        changed_by_id              INTEGER,
        changed_by_name_snapshot   TEXT NOT NULL,
        reason                     TEXT
      );

      CREATE TABLE IF NOT EXISTS assignment_target_overrides (
        assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action        TEXT NOT NULL CHECK(action IN ('include', 'exclude')),
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (assignment_id, user_id)
      );
    `);

    await addColumnIfMissing(
      'users',
      'employee_level_id',
      'employee_level_id INTEGER REFERENCES employee_levels(id) ON DELETE SET NULL',
    );
    await addColumnIfMissing(
      'quizzes',
      'recommended_level_id',
      'recommended_level_id INTEGER REFERENCES employee_levels(id) ON DELETE SET NULL',
    );
    await addColumnIfMissing(
      'assignments',
      'assignment_kind',
      "assignment_kind TEXT NOT NULL DEFAULT 'general' CHECK(assignment_kind IN ('general', 'periodic', 'promotion'))",
    );
    await addColumnIfMissing(
      'assignments',
      'target_mode',
      "target_mode TEXT NOT NULL DEFAULT 'manual' CHECK(target_mode IN ('manual', 'current_level', 'promotion'))",
    );
    await addColumnIfMissing(
      'assignments',
      'target_level_id',
      'target_level_id INTEGER REFERENCES employee_levels(id) ON DELETE SET NULL',
    );
    await addColumnIfMissing(
      'assignments',
      'promotion_target_level_id',
      'promotion_target_level_id INTEGER REFERENCES employee_levels(id) ON DELETE SET NULL',
    );
    for (const column of [
      'target_level_code_snapshot',
      'target_level_name_snapshot',
      'promotion_target_level_code_snapshot',
      'promotion_target_level_name_snapshot',
    ]) {
      await addColumnIfMissing('assignments', column, `${column} TEXT`);
    }
    await addColumnIfMissing(
      'assignment_members',
      'level_id_snapshot',
      'level_id_snapshot INTEGER REFERENCES employee_levels(id) ON DELETE SET NULL',
    );
    await addColumnIfMissing(
      'assignment_members',
      'level_code_snapshot',
      'level_code_snapshot TEXT',
    );
    await addColumnIfMissing(
      'assignment_members',
      'level_name_snapshot',
      'level_name_snapshot TEXT',
    );

    const now = Date.now();
    for (const [code, name, sortOrder] of [
      ['CS1', 'CS1', 10],
      ['CS2', 'CS2', 20],
      ['CS3', 'CS3', 30],
    ] as const) {
      await db.run(
        `INSERT INTO employee_levels (code, name, sort_order, is_active, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(code) DO NOTHING`,
        code,
        name,
        sortOrder,
        now,
        now,
      );
    }

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_employee_level
        ON users(employee_level_id);
      CREATE INDEX IF NOT EXISTS idx_employee_level_history_user_changed
        ON employee_level_history(user_id, changed_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_quizzes_recommended_level
        ON quizzes(recommended_level_id);
      CREATE INDEX IF NOT EXISTS idx_assignments_target
        ON assignments(target_mode, target_level_id);
      CREATE INDEX IF NOT EXISTS idx_assignment_members_assignment_level
        ON assignment_members(assignment_id, level_id_snapshot);
    `);
    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function normalizeLegacyLoginName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'D')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 64);
}

/**
 * Phase 2D user migration. SQLite cannot remove NOT NULL from a column in
 * place, so legacy databases get a transactionally rebuilt users table. The
 * separate unique index keeps login names case-insensitively unique while
 * allowing old/custom databases to be repaired before the constraint applies.
 */
async function migrateInternalUserIdentifiers(): Promise<void> {
  const columns = await db.all<Array<{ name: string; notnull: number }>>(
    'PRAGMA table_info(users)',
  );
  const emailColumn = columns.find((column) => column.name === 'email');

  if (emailColumn?.notnull === 1) {
    await db.run('PRAGMA foreign_keys = OFF');
    try {
      await db.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS users_phase2d_new;
        CREATE TABLE users_phase2d_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          login_name TEXT COLLATE NOCASE,
          email TEXT UNIQUE,
          username TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          is_banned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_password_change TEXT,
          play_display_name TEXT,
          play_avatar TEXT
        );
        INSERT INTO users_phase2d_new (
          id, login_name, email, username, password_hash, is_banned, created_at,
          last_password_change, play_display_name, play_avatar
        )
        SELECT
          id, login_name, email, username, password_hash, is_banned, created_at,
          last_password_change, play_display_name, play_avatar
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_phase2d_new RENAME TO users;
        COMMIT;
      `);
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await db.run('PRAGMA foreign_keys = ON');
    }
  }

  const users = await db.all<
    Array<{ id: number; login_name: string | null; email: string | null; username: string }>
  >('SELECT id, login_name, email, username FROM users ORDER BY id');
  const used = new Set<string>();
  for (const user of users) {
    const source = user.login_name?.trim() || user.email?.split('@')[0] || user.username;
    const base = normalizeLegacyLoginName(source) || `user${user.id}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      const suffixText = `-${suffix++}`;
      candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    }
    used.add(candidate.toLowerCase());
    if (candidate !== user.login_name) {
      await db.run('UPDATE users SET login_name = ? WHERE id = ?', candidate, user.id);
    }
  }
  await db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_name_nocase ON users(login_name COLLATE NOCASE)',
  );
  await db.run(`
    UPDATE assignment_members
    SET login_name_snapshot = COALESCE(
      (SELECT u.login_name FROM users u WHERE u.id = assignment_members.user_id),
      NULLIF(email_snapshot, '')
    )
    WHERE login_name_snapshot IS NULL OR trim(login_name_snapshot) = ''
  `);
  await db.run(`
    UPDATE assignment_attempts
    SET participant_login_name = COALESCE(
      (SELECT u.login_name FROM users u WHERE u.id = assignment_attempts.user_id),
      NULLIF(participant_email, '')
    )
    WHERE participant_login_name IS NULL OR trim(participant_login_name) = ''
  `);

  const foreignKeyErrors = await db.all('PRAGMA foreign_key_check');
  if (foreignKeyErrors.length > 0) {
    throw new Error('User migration failed foreign key validation');
  }
}

/** All players in a session, highest score first (shared leaderboard source). */
export async function getRankedPlayers(sessionId: number | string): Promise<DbPlayer[]> {
  return db.all<DbPlayer[]>(
    'SELECT * FROM players WHERE session_id = ? ORDER BY total_score DESC',
    sessionId,
  );
}
