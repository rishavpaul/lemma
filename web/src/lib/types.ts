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
