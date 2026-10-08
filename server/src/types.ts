export interface GameSettings {
  baseScore?: number;
  streakBonusEnabled?: boolean;
  streakBonusBase?: number;
  showLeaderboardAfterQuestion?: boolean;
  jokersEnabled: { pass: boolean; fiftyFifty: boolean };
}

export interface AppConfig {
  port: number;
  appName: string;
  appSubtitle: string;
  jwtSecret: string;
  allowedDomain: string;
  questionTimeSec: number;
  defaultBaseScore: number;
  speedBonusMax: number;
  speedBonusMin: number;
  maxPlayersPerSession: number;
  showLeaderboardAfterQuestion: boolean;
  streakBonusEnabled: boolean;
  streakMinimum: number;
  streakBonusBase: number;
  resultsAutoAdvanceSec: number;
  /** Show the "next quiz maker" random picker on the final podium screen */
  chooseQuizMaker: boolean;
}

export type AuthRole = 'super_admin' | 'user';
export type QuizMode = 'static' | 'bank_generated';
export type QuestionSelectionMode = 'per_assignment' | 'per_attempt';
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type QuestionCompetency = 'must_remember' | 'know_where_to_lookup' | 'application';

/** Visual/audio theme applied to a quiz's game screens. */
export type ThemeId = 'default' | 'neon' | 'paper' | 'space' | 'retro';

export const THEME_IDS: ThemeId[] = ['default', 'neon', 'paper', 'space', 'retro'];

export interface JwtPayload {
  id: number;
  role: AuthRole;
  username: string;
}

export type QuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'open_text'
  | 'multi_select'
  | 'closest_to'
  | 'fill_blank'
  | 'ordering'
  | 'geo'
  | 'matching';

/**
 * GeoGuessr-style config: the correct location as real-world coordinates.
 * Players drop a pin on a live map and score by great-circle distance.
 */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface QuizQuestion {
  text: string;
  options: string[];
  correctIndex: number;
  correctIndices?: number[];
  baseScore: number;
  timeSec?: number;
  imageUrl?: string;
  explanation?: string;
  rangeMin?: number;
  rangeMax?: number;
  questionType?: QuestionType;
  correctAnswer?: string;
  mediaUrl?: string;
  mediaType?: 'audio' | 'video';
  /** fill_blank: accepted answers per blank, in order of the `___` markers. */
  blanks?: string[][];
  /** geo: the correct point on the map image (GeoGuessr-style). */
  geo?: GeoPoint;
  /** matching: correct right-hand item per `options[i]` (left item), 2-6 pairs. */
  matches?: string[];
  /** Free-form labels (difficulty/topic), e.g. ["easy", "geography"]. */
  tags?: string[];
  sourceBankQuestionId?: number | null;
  sourceBankQuestionRevision?: number | null;
}

export interface QuizImportPayload {
  title: string;
  description?: string;
  coverImage?: string;
  theme?: ThemeId;
  /** The language the quiz is authored in (locale code, e.g. "vi"). Defaults to Vietnamese. */
  language?: string;
  recommendedLevelId?: number | null;
  quizMode?: QuizMode;
  selectionMode?: QuestionSelectionMode;
  generationRules?: QuizGenerationRuleInput[];
  questions?: QuizQuestion[];
}

export interface QuizGenerationRuleInput {
  categoryId?: number | null;
  minimumLevelId?: number | null;
  difficulty?: QuestionDifficulty | null;
  questionType?: QuestionType | null;
  critical?: boolean | null;
  questionCount: number;
  pointsOverride?: number | null;
  recommendedSecondsOverride?: number | null;
  sortOrder?: number;
}

/** One question's translated display text for a given locale. */
export interface QuizTranslationQuestion {
  text: string;
  options: string[];
  matches?: string[];
  explanation?: string;
}

export interface QuizTranslationPayload {
  locale: string;
  questions: QuizTranslationQuestion[];
}

export interface TranslationRow {
  id: number;
  quiz_id: number;
  locale: string;
  order_index: number;
  question_type: QuestionType;
  text: string;
  options: string; // JSON string[]
  matches: string | null; // JSON string[]
  explanation: string | null;
}

/** Lobby intro shown to players on the waiting screen before the game starts. */
export interface QuizIntro {
  title: string;
  subtitle: string;
  coverImage: string | null;
  /** [tag, number of questions using it] pairs across the quiz. */
  tags: Array<[string, number]>;
  questionCount: number;
  /** Ordered [questionType, count] pairs present in this quiz. */
  typeCounts: Array<[QuestionType, number]>;
  totalTimeSec: number;
  theme?: ThemeId;
}

export interface DbQuiz {
  id: number;
  title: string;
  description: string;
  cover_image: string | null;
  theme: string | null;
  language: string;
  created_at: string;
  question_count?: number;
  owner_id: number | null;
  owner_kind: 'admin' | 'user';
  recommended_level_id: number | null;
  quiz_mode: QuizMode;
  selection_mode: QuestionSelectionMode;
  blueprint_revision: number;
}

export interface DbQuestionCategory {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  is_active: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface DbBankQuestion extends Omit<DbQuestion, 'quiz_id' | 'order_index'> {
  source_bank_id: string;
  source_question_id: string;
  source_bank_version: string;
  source_content_hash: string;
  last_import_id: number | null;
  category_id: number;
  topic: string;
  minimum_level_id: number;
  difficulty: QuestionDifficulty | null;
  competency_code: QuestionCompetency | null;
  critical: number;
  recommended_seconds: number | null;
  source_metadata_json: string;
  is_enabled: number;
  revision: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface DbQuizGenerationRule {
  id: number;
  quiz_id: number;
  category_id: number | null;
  minimum_level_id: number | null;
  difficulty: QuestionDifficulty | null;
  question_type: QuestionType | null;
  critical: number | null;
  question_count: number;
  points_override: number | null;
  recommended_seconds_override: number | null;
  sort_order: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface DbQuestion {
  id: number;
  quiz_id: number;
  text: string;
  options: string; // JSON string
  correct_index: number;
  correct_indices: string | null; // JSON array string, used for multi_select
  base_score: number;
  time_sec: number;
  order_index: number;
  image_url: string | null;
  explanation: string | null;
  range_min: number | null;
  range_max: number | null;
  question_type: QuestionType;
  correct_answer: string | null;
  media_url: string | null;
  media_type: string | null;
  blanks: string | null; // JSON string[][], used for fill_blank
  geo: string | null; // JSON GeoPoint {x,y}, used for geo
  matches: string | null; // JSON string[], index-aligned with options, used for matching
  tags: string | null; // JSON string[] of free-form labels
  source_bank_question_id?: number | null;
  source_bank_question_revision?: number | null;
}

export interface DbSession {
  id: number;
  quiz_id: number;
  pin: string;
  status: 'waiting' | 'active' | 'finished';
  current_question_index: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  current_question_started_at_ms: number | null;
  quiz_title?: string;
  hosted_by_user_id: number | null;
  uses_question_snapshot: number;
  generation_seed: string | null;
  question_pool_fingerprint: string | null;
  question_selection_fingerprint: string | null;
  quiz_blueprint_revision_snapshot: number | null;
}

export interface DbPlayer {
  id: number;
  session_id: number;
  username: string;
  total_score: number;
  joined_at: string;
  user_id?: number | null;
  avatar?: string | null;
  locale?: string | null;
}

export interface DbUser {
  id: number;
  login_name: string | null;
  email: string | null;
  username: string;
  password_hash: string;
  is_banned: number;
  created_at: string;
  last_password_change: string | null;
  play_display_name?: string | null;
  play_avatar?: string | null;
  employee_level_id: number | null;
}

export interface DbEmployeeLevel {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  is_active: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface DbAnswer {
  id: number;
  player_id: number;
  session_id: number;
  question_id: number;
  chosen_index: number;
  chosen_indices: string | null; // JSON array string, used for multi_select
  is_correct: number;
  score: number;
  answer_order: number;
  answered_at: string;
  chosen_text: string | null;
  response_time_ms: number | null;
}

export type AssignmentStatus = 'draft' | 'published' | 'closed' | 'archived';
export type AssignmentAudienceMode = 'members' | 'open';
export type AssignmentResultPolicy = 'highest_score' | 'latest_completed';
export type AssignmentReviewPolicy = 'after_deadline' | 'after_close';
export type AssignmentAttemptStatus = 'in_progress' | 'completed' | 'expired';
export type AttemptAnswerStatus = 'answered' | 'timed_out';
export type AssignmentKind = 'general' | 'periodic' | 'promotion';
export type AssignmentTargetMode = 'manual' | 'current_level' | 'promotion';
export type AssignmentTargetOverrideAction = 'include' | 'exclude';

export interface DbAssignment {
  id: number;
  quiz_id: number | null;
  owner_kind: 'admin' | 'user';
  owner_id: number | null;
  title: string;
  access_code: string | null;
  audience_mode: AssignmentAudienceMode;
  opens_at_ms: number;
  deadline_at_ms: number | null;
  status: AssignmentStatus;
  max_attempts: number;
  result_policy: AssignmentResultPolicy;
  review_policy: AssignmentReviewPolicy;
  shuffle_questions: number;
  shuffle_options: number;
  created_at_ms: number;
  updated_at_ms: number;
  published_at_ms: number | null;
  assignment_kind: AssignmentKind;
  target_mode: AssignmentTargetMode;
  target_level_id: number | null;
  promotion_target_level_id: number | null;
  target_level_code_snapshot: string | null;
  target_level_name_snapshot: string | null;
  promotion_target_level_code_snapshot: string | null;
  promotion_target_level_name_snapshot: string | null;
  generation_seed: string | null;
  question_pool_fingerprint: string | null;
  question_selection_fingerprint: string | null;
  quiz_blueprint_revision_snapshot: number | null;
  question_selection_mode_snapshot: QuestionSelectionMode | null;
}

export interface DbAssignmentTargetOverride {
  assignment_id: number;
  user_id: number;
  action: AssignmentTargetOverrideAction;
  created_at_ms: number;
}

/** Immutable question snapshot belonging to a published assignment. */
export interface DbAssignmentQuestion extends Omit<DbQuestion, 'quiz_id'> {
  assignment_id: number;
  source_question_id: number | null;
  source_bank_question_id?: number | null;
  source_bank_question_revision?: number | null;
  source_category_id?: number | null;
  source_category_code?: string | null;
  source_category_name?: string | null;
  source_topic?: string | null;
  minimum_level_code_snapshot?: string | null;
  difficulty_snapshot?: QuestionDifficulty | null;
  critical_snapshot?: number | null;
  competency_snapshot?: QuestionCompetency | null;
  source_generation_rule_id?: number | null;
  source_metadata_snapshot?: string | null;
}

export interface DbAssignmentMember {
  id: number;
  assignment_id: number;
  user_id: number | null;
  login_name_snapshot: string | null;
  display_name_snapshot: string;
  email_snapshot: string;
  assigned_at_ms: number;
  level_id_snapshot: number | null;
  level_code_snapshot: string | null;
  level_name_snapshot: string | null;
}

export interface DbAssignmentAttempt {
  id: number;
  assignment_id: number;
  assignment_member_id: number | null;
  user_id: number | null;
  participant_login_name: string | null;
  participant_name: string;
  participant_email: string;
  attempt_number: number;
  status: AssignmentAttemptStatus;
  current_question_index: number;
  current_question_started_at_ms: number | null;
  started_at_ms: number;
  completed_at_ms: number | null;
  last_activity_at_ms: number;
  correct_count: number;
  total_score: number;
}

export interface DbAttemptAnswer {
  id: number;
  attempt_id: number;
  assignment_question_id: number;
  status: AttemptAnswerStatus;
  chosen_index: number | null;
  chosen_indices: string | null;
  chosen_text: string | null;
  is_correct: number;
  score: number;
  question_started_at_ms: number;
  response_time_ms: number | null;
  answered_at_ms: number;
}

// Socket payloads
export interface PlayerJoinPayload {
  pin: string;
  username: string;
  avatar?: string;
  authToken?: string;
  locale?: string;
}

export interface PlayerAnswerPayload {
  sessionId: number;
  questionId: number;
  chosenIndex: number;
  chosenIndices?: number[];
  chosenText?: string;
}

export interface QuestionResult {
  questionId: number;
  questionText: string;
  correctIndex: number;
  options: string[];
  players: Array<{
    username: string;
    chosenIndex: number | null;
    isCorrect: boolean;
    score: number;
    totalScore: number;
    rank: number;
  }>;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  totalScore: number;
  playerId: number;
}
