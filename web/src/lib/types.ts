export type Level = "below_senior" | "senior" | "staff" | "senior_staff_plus";
export type Signal = "strong_no" | "lean_no" | "lean_hire" | "strong_hire";

export const LEVELS: Record<Level, string> = {
  below_senior: "Below senior",
  senior: "Senior",
  staff: "Staff",
  senior_staff_plus: "Senior staff+",
};
export const SIGNALS: Record<Signal, string> = {
  strong_no: "Strong no",
  lean_no: "Lean no",
  lean_hire: "Lean hire",
  strong_hire: "Strong hire",
};

export interface Job {
  id: number;
  type: string;
  ref_id: number;
  status: "queued" | "running" | "done" | "failed" | "pending_retry";
  attempts: number;
  error_kind: string | null;
  error: string | null;
}

export interface Question {
  id: number;
  slug: string;
  title: string;
  prompt: string;
  stresses: string[];
  crux_hints?: string;
  is_custom: number;
  has_research: boolean;
  attempts: number;
  last_score: number | null;
}

export interface SessionRow {
  id: number;
  question_id: number;
  title: string;
  status: "in_progress" | "grading" | "done";
  started_at: number;
  finished_at: number | null;
  overall_score: number | null;
  overall_level: Level | null;
  sections_saved: number;
  sections_total: number;
}

export interface Gap {
  tag: string;
  description: string;
  why_it_matters_at_staff?: string;
  what_a_staff_answer_sounds_like?: string;
  severity: "low" | "medium" | "high";
}

export interface SectionGrade {
  score: number;
  level_signal: Level;
  summary: string;
  ungrounded?: boolean;
  evidence: { quote: string; observation: string }[];
  /** One paragraph on the gaps. Absent on grades written before it existed; those have `gaps` with full text. */
  gap_summary?: string;
  /** Short plain-speech version for reading aloud. Only written for interactive sessions. */
  spoken_feedback?: string;
  /** Markdown teaching write-up of the concepts to learn. Absent on older grades. */
  concepts_writeup?: string;
  gaps: Gap[];
  /** Older grades only. */
  strengths?: string[];
  interviewer_followups?: string[];
  concepts_to_study: { concept: string; why: string; resource: string }[];
  fact_checks: { claim: string; verdict: "correct" | "partially_correct" | "incorrect"; explanation: string; url?: string }[];
  /** Word choice and terminology. Absent on grades written before it existed. */
  language_review?: { register: "below_staff" | "mixed" | "staff"; assessment: string; issues: { said: string; problem: string; better: string }[] };
  notes_for_candidate?: string;
  sources: { title: string; url: string }[];
}

export interface Section {
  id: number;
  session_id: number;
  key: string;
  ord: number;
  title: string;
  cover: string[];
  budget_sec: number;
  duration_sec: number | null;
  status: "pending" | "recorded" | "transcribing" | "transcribed" | "saved";
  transcript_edited: string | null;
  transcript_raw: string | null;
  grade: SectionGrade | null;
  grade_meta: { model: string } | null;
  transcribe_job: Job | null;
  grade_job: Job | null;
  diagram: Diagram | null;
  probe: Probe | null;
  probe_job: Job | null;
  cost?: { grade: Cost | null; probe: Cost | null };
}

/** One task's model and cost. `reported` is false when the provider gives no price (e.g. free OpenRouter models). */
export interface Cost {
  model: string | null;
  cost_usd: number;
  reported: boolean;
  total_tokens: number;
  duration_s: number | null;
  calls: number;
}

export interface Probe {
  question: string | null;
  hint: string | null;
  answer: string | null;
}

export interface HolisticGrade {
  overall_score: number;
  overall_level: Level;
  hire_signal_at_staff: Signal;
  verdict: string;
  dimension_scores: Record<string, { score: number; rationale: string }>;
  strengths: string[];
  improvements_vs_previous: string[];
  recurring_patterns_vs_previous: string[];
  drill_for_next_session: string;
  /** Absent on grades written before it existed. */
  interview_focus?: {
    shape: string;
    priorities: { topic: string; minutes: number; explain: string }[];
    can_skip: string[];
  };
  sources: { title: string; url: string }[];
}

/** A concept from the section grades, merged by name across sections. */
export interface StudyConcept { concept: string; why: string; resource: string; sections: string[] }

export interface SessionPayload {
  session: { id: number; question_id: number; status: SessionRow["status"]; started_at: number; show_feedback_live: number; model: string | null };
  question: Question & { prompt: string };
  sections: Section[];
  diagram: Diagram;
  research: { state: "none" | "researching" | "ready" | "failed"; job: Job | null; brief: { grounding_warning?: string } | null };
  grade: HolisticGrade | null;
  study_plan: StudyConcept[];
  grade_meta: { model: string } | null;
  grade_job: Job | null;
  usage: { calls: number; total_tokens: number; cost_usd: number } | null;
  costs?: { overall: Cost | null; answer_key: Cost | null };
}

export interface Progress {
  timeline: { session_id: number; started_at: number; title: string; overall_level: Level; overall_score: number; dimensions: Record<string, number> }[];
  dimensions: string[];
  time_vs_budget: { title: string; avg_used: number; budget: number }[];
  gaps: { tag: string; count: number; last5: number; last_seen: number }[];
  focus: { drill: string | null; suggested: { question_id: number; title: string; reason: string } };
}

export interface UsageRow {
  calls: number; ok_calls?: number; input_tokens: number; output_tokens: number; cache_creation_tokens: number;
  cache_read_tokens: number; total_tokens: number; cost_usd: number; duration_s: number; web_searches?: number; web_fetches?: number;
}
export interface Usage {
  tracking_since: number | null;
  total: UsageRow & { ok_calls: number; web_searches: number; web_fetches: number };
  by_kind: (UsageRow & { kind: string })[];
  by_model: (UsageRow & { model: string })[];
  by_session: (UsageRow & { session_id: number; title: string })[];
  by_day: (UsageRow & { day: string })[];
  recent: { created_at: number; kind: string; model: string | null; session_id: number | null; title?: string; ok: number; error_kind: string | null; input_tokens: number; cache_creation_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number; duration_s: number | null }[];
}

export interface PlanUsage {
  latest: { created_at: number; five_hour_util: number | null; five_hour_resets: number | null; seven_day_util: number | null; seven_day_resets: number | null } | null;
  history: { created_at: number; five_hour_util: number | null; seven_day_util: number | null }[];
}

export interface Health {
  claude_ok: boolean | null; claude_version: string | null; claude_path: string | null; claude_error: string | null;
  ffmpeg_ok: boolean; whisper_loaded: boolean; whisper_loading: boolean; whisper_error: string | null; data_dir: string;
}

// ---- canvas ----
// The current canvas is an Excalidraw scene. Sessions drawn on the earlier React Flow canvas keep the legacy shape and are
// converted to a scene when opened.
export type NodeKind =
  | "client" | "cdn" | "load_balancer" | "gateway" | "service" | "worker" | "database" | "cache" | "queue"
  | "stream" | "object_store" | "search" | "external" | "monitoring" | "group" | "note";

export interface SceneElement { id: string; type: string; isDeleted?: boolean; [k: string]: unknown }
export interface SceneDiagram { format: "excalidraw"; elements: SceneElement[] }

export interface DiagramNode {
  id: string;
  type: "component" | "boundary" | "note";
  position: { x: number; y: number };
  parentId?: string;
  width?: number;
  height?: number;
  data: { kind: NodeKind; label: string; notes: string };
}
export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  data: { label: string; mode: "sync" | "async" };
}
export interface LegacyDiagram { nodes: DiagramNode[]; edges: DiagramEdge[] }
export type Diagram = SceneDiagram | LegacyDiagram;

export interface ImprovementConcept {
  concept: string; area: string; why: string; key_ideas: string[]; study: string; sessions: number[]; gap_tags?: string[];
}
export interface ImprovementReport {
  id: number; k: number; status: "queued" | "done" | "failed"; created_at: number; model: string | null; session_ids: number[];
  result: { summary: string; concepts: ImprovementConcept[] } | null;
  job: { id: number; status: string; error: string | null; error_kind: string | null } | null;
}

export interface DiagramReview {
  assessment: string;
  strengths: string[];
  issues: { severity: "low" | "medium" | "high"; issue: string; suggestion: string }[];
  narration_mismatches: string[];
}

export interface ArticleSummary { id: number; title: string; summary: string; updated_at: number; status: "pending" | "read"; rating: number | null; questions: { id: number; title: string }[] }
export interface ArticleComment { id: number; question: string | null; body: string; model: string | null; created_at: number }
export interface Article extends ArticleSummary { body: string; model: string | null; comments: ArticleComment[] }

// ---- coding vertical ----
export type SpecState = "none" | "generating" | "ready" | "partial" | "failed";
export type Rating = "clean" | "hints" | "solution";
export interface CodeProblem {
  id: number; slug: string; num: number | null; title: string; phase: number; track: "core" | "practical"; difficulty: string; premium: boolean;
  tags: string[]; note: string; is_build: boolean; levels: number | null; spec: SpecState; spec_error: string | null;
  status: "todo" | "attempted" | "done"; rating: Rating | null; attempts: number; solved_at: number | null; level_cleared: number | null;
  needs_review: boolean; last_attempt_id: number | null; last_attempt_status: "in_progress" | "solved" | null; last_worked: number | null;
  last_run: { passed: number; total: number; status: string; kind: string } | null;
}
export interface CodeStats {
  total: number; done: number; clean: number; by_difficulty: Record<string, { done: number; total: number }>;
  builds_total_levels: number; builds_levels_cleared: number; ready: number; generating: number; failed: number;
}
export interface CodePhase { num: number; track: "core" | "practical"; name: string; why: string; problems: CodeProblem[] }
export interface CodeRoadmap { phases: CodePhase[]; topics: Record<string, string>; stats: CodeStats }
export interface CodeProgress {
  stats: CodeStats; recent: CodeProblem[]; activity: number[]; phases: { num: number; name: string; track: string; done: number; total: number }[];
  topics: { key: string; label: string; done: number; total: number }[]; weekly: number[];
  next: Record<"core" | "practical", CodeProblem[]>; needs_review: CodeProblem[];
  gaps: { tag: string; n: number; sev: string; example: string }[];
  timeline: { id: number; title: string; slug: string; created_at: number; score: number; level: Level }[];
  dimensions: Record<string, number>;
}
export interface CodeCaseInfo { id: string; kind: string; name: string; level: number; input: string; expected: string }
export interface CodeSpec {
  id: number; status: "validated" | "partial"; kind: "function" | "design"; class_name: string; method: string; statement_md: string; constraints: string[];
  starter_code: string; support_code: string; levels: { n: number; title: string; statement_md: string; methods_added: string[] }[];
  cases: CodeCaseInfo[]; hidden_cases: number; hint_count: number; model: string; created_at: number;
  report: { rounds?: { round: number; kept: number; issues: number }[]; kept?: number; dropped?: number; unverified?: number; clean?: boolean; issues?: string[] };
}
/** The statement and starter file: available about 20 seconds after opening a problem, before the tests are built. */
export interface CodeBrief {
  kind: "function" | "design"; class_name: string; method: string; inplace_param: number; statement_md: string; constraints: string[];
  starter_code: string; levels: { n: number; title: string; statement_md: string; methods_added: string[] }[];
}
export interface CodeProblemDetail {
  problem: CodeProblem; job: Job | null; spec: CodeSpec | null; brief: CodeBrief | null; levels_text: { text: string; staff: boolean }[] | null;
  attempts: { id: number; status: string; level: number; hints_used: number; solution_viewed: number; started_at: number; finished_at: number | null; active_sec: number; rating: Rating }[];
}
export interface CaseVerdict {
  id: string; kind: string; name: string; level: number; ms: number; status: string; stdout: string; passed: boolean; message: string;
  trace?: string; input?: string; expected?: string; actual?: string;
}
export interface CompileInfo { ok: boolean; output: string; errors: { file: string; line: number; message: string; detail: string }[] }
export interface Verdict { status: "passed" | "failed" | "compile_error" | "unavailable"; compile: CompileInfo; passed: number; total: number; cases: CaseVerdict[] }
export interface CodeRun { id: number; kind: string; status: string; passed: number; total: number; level: number; created_at: number; duration_ms: number; verdict: Verdict | null }
export interface CodeReviewDim { score: number; assessed: boolean; rationale: string }
export interface CodeReviewResult {
  verdict_kind: "wrong" | "correct_slow" | "correct_optimal"; overall_score: number; overall_level: Level;
  hire_signal: Signal; summary: string; dimension_scores: Record<string, CodeReviewDim>;
  complexity: { your_time: string; your_space: string; optimal_time: string; optimal_space: string; note: string };
  strengths: string[]; issues: { severity: string; title: string; detail: string; quote: string; fix: string }[];
  staff_gaps: { area: string; gap: string; what_staff_does: string }[]; improvements: { title: string; why: string; code: string }[];
  say_out_loud: string; interviewer_follow_ups: { question: string; strong_answer: string }[];
  gaps: { tag: string; description: string; severity: string }[]; drill: string; redo_advice: string; caps_applied?: { reason: string; cap: number }[];
}
export interface CodeReview { id: number; attempt_id: number; status: string; model: string | null; created_at: number; explanation: string; result: CodeReviewResult | null; job: Job | null }
export interface CoachHint { id: number; question: string | null; status: string; text: string | null; job: Job | null }
export interface CodeAttempt {
  id: number; problem_id: number; spec_id: number; code: string; level: number; status: "in_progress" | "solved"; hints_used: number; solution_viewed: number;
  explanation: string; started_at: number; finished_at: number | null; active_sec: number; problem: { slug: string; title: string }; rating: Rating;
  canned_hints: string[]; coach_hints: CoachHint[]; reviews: CodeReview[]; last_run: CodeRun | null; last_submit: CodeRun | null;
}
export interface CodeSolution { reference_solution: string; approach_md: string; time_complexity: string; space_complexity: string; pitfalls: string[]; follow_ups: string[] }
export interface CodeStatus { java_ok: boolean; java_version: string | null; java_error: string | null }
