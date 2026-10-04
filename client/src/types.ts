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

/** GeoGuessr-style correct location as real-world coordinates. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Visual/audio theme applied to a quiz's game screens. */
export type ThemeId = 'default' | 'neon' | 'paper' | 'space' | 'retro';

export const THEME_IDS: ThemeId[] = ['default', 'neon', 'paper', 'space', 'retro'];

export type AuthRole = 'super_admin' | 'user';

export type AssignmentStatus = 'draft' | 'published' | 'closed' | 'archived';
export type AssignmentAttemptStatus = 'in_progress' | 'completed' | 'expired';

export interface AdminAssignmentListItem {
  id: number;
  quiz_id: number | null;
  quiz_title: string | null;
  title: string;
  access_code: string | null;
  opens_at_ms: number;
  deadline_at_ms: number | null;
  status: AssignmentStatus;
  max_attempts: number;
  shuffle_questions: number;
  shuffle_options: number;
  question_count: number;
  member_count: number;
  attempt_count: number;
  started_count: number;
  completed_count: number;
}

export interface AdminAssignmentMember {
  id: number;
  assignment_id: number;
  user_id: number | null;
  login_name_snapshot: string | null;
  display_name_snapshot: string;
  email_snapshot: string;
  assigned_at_ms: number;
  attempt_count: number;
  completed_count: number;
  participant_status: AssignmentAttemptStatus | 'not_started';
  attempt_id: number | null;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  correct_count: number | null;
  total_score: number | null;
}

export interface AdminAssignmentDetail {
  assignment: AdminAssignmentListItem & {
    audience_mode: 'members' | 'open';
    result_policy: 'highest_score' | 'latest_completed';
    review_policy: 'after_deadline' | 'after_close';
    created_at_ms: number;
    updated_at_ms: number;
    published_at_ms: number | null;
  };
  questions: Array<{ id: number; text: string; order_index: number; time_sec: number }>;
  members: AdminAssignmentMember[];
}

export interface ParticipantAssignmentLookup {
  id: number;
  title: string;
  status: AssignmentStatus;
  opensAtMs: number;
  deadlineAtMs: number | null;
  maxAttempts: number;
  attemptsUsed: number;
  questionCount: number;
  participantStatus: AssignmentAttemptStatus | 'not_started';
  attemptId: number | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  canResume: boolean;
  canStart: boolean;
  reviewAvailable: boolean;
}

export interface AssignmentQuestionPayload {
  questionId: number;
  questionIndex: number;
  totalQuestions: number;
  text: string;
  options: string[];
  timeSec: number;
  questionType: QuestionType;
  imageUrl?: string;
  mediaUrl?: string;
  mediaType?: 'audio' | 'video';
  rangeMin?: number;
  rangeMax?: number;
  blankCount?: number;
  rightOptions?: string[];
  questionStartedAtMs: number;
  serverNowMs: number;
  remainingMs: number;
}

export interface ParticipantAttemptState {
  assignment: {
    id: number;
    title: string;
    status: AssignmentStatus;
    opensAtMs: number;
    deadlineAtMs: number | null;
    maxAttempts: number;
  };
  attempt: {
    id: number;
    attemptNumber: number;
    status: AssignmentAttemptStatus;
    currentQuestionIndex: number;
    startedAtMs: number;
    completedAtMs: number | null;
    elapsedTimeMs: number | null;
    activeAnsweringTimeMs: number;
    totalScore?: number;
    correctCount?: number;
  };
  reviewAvailable: boolean;
  question: AssignmentQuestionPayload | null;
  accepted?: boolean;
  duplicate?: boolean;
  timedOut?: boolean;
}

export interface AssignmentAnswerSubmission {
  questionId: number;
  chosenIndex?: number | null;
  chosenIndices?: Array<number | null>;
  chosenText?: string | null;
}

export type AssignmentReportResult = 'correct' | 'incorrect' | 'no_answer';

export interface AssignmentAttemptReportRow {
  id: number;
  attemptNumber: number;
  status: AssignmentAttemptStatus;
  isSelected: boolean;
  startedAtMs: number;
  completedAtMs: number | null;
  correct: number;
  incorrect: number;
  noAnswer: number;
  score: number;
  maxScore: number;
  scorePercent: number;
  elapsedTimeMs: number | null;
  activeAnsweringTimeMs: number;
  averageResponseTimeMs: number | null;
}

export interface AssignmentParticipantReportRow {
  memberId: number;
  userId: number | null;
  name: string;
  loginName: string;
  email: string | null;
  status: AssignmentAttemptStatus | 'not_started';
  selectedAttemptId: number | null;
  attempts: AssignmentAttemptReportRow[];
}

export interface AssignmentQuestionReportRow {
  questionId: number;
  questionNumber: number;
  text: string;
  questionType: QuestionType;
  sampleSize: number;
  answered: number;
  correct: number;
  incorrect: number;
  noAnswer: number;
  correctRate: number;
  correctRateAmongAnswered: number | null;
  averageScore: number;
  maxScore: number;
  averageResponseTimeMs: number | null;
  timeLimitSec: number;
}

export interface AssignmentReport {
  assignment: {
    id: number;
    title: string;
    quizTitle: string | null;
    status: AssignmentStatus;
    accessCode: string | null;
    opensAtMs: number;
    deadlineAtMs: number | null;
    maxAttempts: number;
    resultPolicy: 'highest_score' | 'latest_completed';
    reviewPolicy: 'after_deadline' | 'after_close';
    questionCount: number;
    maxScore: number;
  };
  overview: {
    assigned: number;
    notStarted: number;
    inProgress: number;
    completed: number;
    expired: number;
    completionRate: number;
    averageScore: number;
    averageScorePercent: number;
    averageElapsedTimeMs: number | null;
    averageActiveAnsweringTimeMs: number | null;
  };
  participants: AssignmentParticipantReportRow[];
  questions: AssignmentQuestionReportRow[];
}

export interface AssignmentAttemptQuestionDetail {
  questionId: number;
  questionNumber: number;
  text: string;
  questionType: QuestionType;
  submittedAnswer: string;
  correctAnswer: string;
  result: AssignmentReportResult;
  score: number;
  maxScore: number;
  responseTimeMs: number | null;
  timeLimitSec: number;
  explanation: string | null;
  answerStatus: 'answered' | 'timed_out' | 'not_answered';
}

export interface AssignmentAttemptDetail {
  assignment: { id: number; title: string; reviewAvailable: boolean };
  participant: { name: string; loginName: string; email: string | null };
  attempt: AssignmentAttemptReportRow;
  questions: AssignmentAttemptQuestionDetail[];
}

export interface AssignmentQuestionDetail {
  question: {
    id: number;
    questionNumber: number;
    text: string;
    questionType: QuestionType;
    correctAnswer: string;
    maxScore: number;
    timeLimitSec: number;
    explanation: string | null;
  };
  participants: Array<{
    memberId: number;
    name: string;
    loginName: string;
    email: string | null;
    attemptId: number | null;
    attemptNumber: number | null;
    attemptStatus: AssignmentAttemptStatus | 'not_started';
    submittedAnswer: string;
    result: AssignmentReportResult;
    responseTimeMs: number | null;
    score: number;
  }>;
}

export interface AuthUser {
  id: number;
  loginName: string;
  email: string | null;
  username: string;
  playDisplayName?: string | null;
  playAvatar?: string | null;
}

export interface UserAccount {
  id: number;
  login_name: string;
  email: string | null;
  username: string;
  is_banned: number;
  created_at: string;
  last_password_change: string | null;
  quiz_count: number;
}

export interface Quiz {
  id: number;
  title: string;
  description: string;
  cover_image?: string | null;
  theme?: ThemeId | null;
  created_at: string;
  question_count: number;
  owner_id?: number | null;
  owner_kind?: 'admin' | 'user';
  owner_email?: string | null;
  owner_username?: string | null;
}

export interface Question {
  id: number;
  quiz_id: number;
  text: string;
  options: string[];
  correct_index: number;
  correct_indices?: number[];
  base_score: number;
  time_sec: number;
  order_index: number;
  image_url?: string;
  explanation?: string;
  range_min?: number;
  range_max?: number;
  question_type: QuestionType;
  correct_answer?: string;
  media_url?: string;
  media_type?: 'audio' | 'video';
  blanks?: string[][] | null;
  geo?: GeoPoint | null;
  matches?: string[] | null;
  tags?: string[] | null;
}

export interface Session {
  id: number;
  quiz_id: number;
  pin: string;
  status: 'waiting' | 'active' | 'finished';
  current_question_index: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  current_question_started_at_ms?: number | null;
  quiz_title?: string;
  player_count?: number;
  hosted_by_user_id?: number | null;
  host_email?: string | null;
  host_username?: string | null;
}

export interface Player {
  id: number;
  session_id: number;
  username: string;
  total_score: number;
  joined_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: number;
  username: string;
  totalScore: number;
  chosenIndex: number | null;
  chosenIndices?: number[] | null;
  chosenText?: string | null;
  chosenNumber?: number | null;
  /** ordering: the items in the order this player arranged them. */
  chosenOrder?: string[] | null;
  /** fill_blank: this player's entry per blank. */
  chosenBlanks?: string[] | null;
  /** geo: where this player dropped their pin (lat/lng). */
  chosenPoint?: { lat: number; lng: number } | null;
  /** matching: this player's submitted left-to-right links (right null if unlinked). */
  chosenPairs?: Array<{ left: string; right: string | null }> | null;
  distance?: number | null;
  isCorrect: boolean;
  questionScore: number;
  avatar?: string;
}

export interface QuestionPayload {
  questionIndex: number;
  totalQuestions: number;
  questionId: number;
  text: string;
  options: string[];
  timeSec: number;
  /** Remaining seconds — only present on reconnect; absent means use timeSec */
  timeRemaining?: number;
  imageUrl?: string;
  explanation?: string;
  questionType: QuestionType;
  correctAnswer?: string;
  rangeMin?: number;
  rangeMax?: number;
  mediaUrl?: string;
  mediaType?: 'audio' | 'video';
  /** fill_blank: number of blanks the player must fill. */
  blankCount?: number;
  /** matching: the shuffled right column shown during the live question. */
  rightOptions?: string[];
}

export interface QuestionResults {
  questionId: number;
  questionText: string;
  correctIndex: number;
  correctIndices?: number[];
  correctAnswer: string | null;
  /** fill_blank: one representative correct answer per blank. */
  correctBlanks?: string[];
  /** ordering: the items in their correct order. */
  correctOrder?: string[];
  /** matching: the correct left-to-right pairing, in options order. */
  correctPairs?: Array<{ left: string; right: string }>;
  /** geo: the correct point + the map image it applies to. */
  geo?: GeoPoint;
  imageUrl?: string;
  questionType: QuestionType;
  options: string[];
  /** Per-option vote counts (option-based question types only) */
  answerDistribution?: number[];
  explanation?: string;
  rangeMin?: number;
  rangeMax?: number;
  closestRanking?: LeaderboardEntry[];
  leaderboard: LeaderboardEntry[];
  showLeaderboard?: boolean;
  isLastQuestion: boolean;
  autoAdvanceSec: number;
}

/** Lobby/host view of a connected player. */
export interface PlayerInfo {
  id: number;
  username: string;
  totalScore: number;
  avatar?: string;
}

/** Host-only preview of the upcoming question between rounds. */
export interface NextPreview {
  hasNext: boolean;
  index: number;
  total: number;
  text: string | null;
  mediaType: 'audio' | 'video' | null;
}

/** One row of the end-of-game leaderboard. */
export interface FinalLeaderboardEntry {
  rank: number;
  username: string;
  totalScore: number;
  avatar?: string;
}

export interface GameEndedPayload {
  leaderboard: FinalLeaderboardEntry[];
}

export interface PlayHistoryEntry {
  session_id: number;
  pin: string;
  quiz_title: string;
  status: Session['status'];
  total_score: number;
  player_count: number;
  rank: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ImportQuestion {
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
  blanks?: string[][];
  geo?: GeoPoint;
  /** matching: correct right-hand item per `options[i]` (left item), 2-6 pairs. */
  matches?: string[];
  tags?: string[];
}

export interface ImportPayload {
  title: string;
  description?: string;
  coverImage?: string;
  theme?: ThemeId;
  /** The language the quiz is authored in (locale code, e.g. "vi"). Defaults to Vietnamese. */
  language?: string;
  questions: ImportQuestion[];
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

/** Lobby intro shown to players on the waiting screen before the game starts. */
export interface QuizIntro {
  title: string;
  subtitle: string;
  coverImage: string | null;
  tags: Array<[string, number]>;
  questionCount: number;
  typeCounts: Array<[QuestionType, number]>;
  totalTimeSec: number;
  theme?: ThemeId;
}

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
  allowedDomain?: string;
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
  chooseQuizMaker: boolean;
}
