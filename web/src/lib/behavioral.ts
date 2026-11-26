import type { Level } from "./types";

export type Competency = { key: string; name: string; why: string };
export type BStatus = "todo" | "attempted" | "done";
export type BQuestion = {
  id: number; slug: string; competency: string; title: string; prompt: string; status: BStatus;
  story_id: number | null; last_score: number | null; attempts: number;
};
export type Story = { id: number; title: string; notes: string; updated_at?: number; question_ids?: number[] };
export type Overview = { competencies: Competency[]; questions: BQuestion[]; stories: Story[] };

export type Dim = { score: number; assessed: boolean; rationale: string };
export type Review = {
  overall_score: number; level_signal: Level; answers_the_question: boolean; summary: string;
  dimension_scores: Record<string, Dim>; strengths: string[]; gaps: { issue: string; quote: string; fix: string }[];
  follow_ups: string[]; stronger_outline: string;
};
export type JobRef = { id: number; status: string; error_kind: string | null; error: string | null } | null;
export type Attempt = {
  id: number; question_id: number; story_id: number | null; text: string; status: "queued" | "running" | "done" | "failed";
  result: Review | null; model: string | null; created_at: number; job: JobRef;
};
export type QuestionDetail = {
  id: number; slug: string; competency: string; competency_name: string; competency_why: string; title: string; prompt: string;
  look_for: string; draft: string; story_id: number | null; attempts: Attempt[]; stories: Story[];
};

export const DIMS: [string, string][] = [
  ["scope_impact", "Scope and impact"], ["ownership", "Ownership"], ["influence_leadership", "Influence and leadership"],
  ["judgment", "Judgment"], ["self_awareness", "Self-awareness"], ["structure_clarity", "Structure and clarity"],
];

/** Spoken length at a steady interview pace (about 140 words a minute). A strong answer is roughly 2 to 3 minutes. */
export const spokenMinutes = (words: number) => words / 140;
export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
