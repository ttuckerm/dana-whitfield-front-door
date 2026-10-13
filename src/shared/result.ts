import type { Answers, DoorPick, DoorRecipe, ResultKey } from "./recipe";

/** The part of one visitor's result that is written for them (by the AI, or
 *  by the labelled stand-in during free tests). Everything else on the result
 *  page — the headline result, what needs attention and why, what is always
 *  true — comes from the recipe by fixed rules. */
export type Written = {
  /** "What this means for you": 2–4 short points tied to their answers. */
  read: string[];
  startHere: { title: string; task: string; minutes: number };
  /** One entry per plan day; `step` is the name of one of the method's steps. */
  plan: { day: number; step: string; task: string; minutes: number }[];
  /** Present only when the recipe has phases, one per phase. */
  phases?: { title: string; milestone: string }[];
  advisorGreeting: string;
  quickReplies: string[];
};

export type WriterInfo = { kind: "ai" | "stand-in"; model: string | null; costUsd: number };

export type DoorResult = {
  id: string;
  createdAt: string;
  firstName: string | null;
  answers: Answers;
  note: string | null;
  outcome: { result: ResultKey; told: DoorPick[]; clearCount: number; total: number };
  /** Null when the personal part could not be written (the day's limit was
   *  reached, or the AI's reply broke the rules twice). The fixed parts still
   *  show, with `writeNote` saying plainly why the plan is missing. */
  written: Written | null;
  writeNote: string | null;
  writer: WriterInfo;
};

export type ChatMessage = { role: "user" | "assistant"; text: string; at: string };

const NUM = /\d+(?:[.,]\d+)*/g;
const URLISH = /(https?:\/\/|www\.|\.com\b|\.org\b|\.net\b|@[a-z0-9-]+\.[a-z])/i;
const PHONEISH = /(\+?\d[\d\s().-]{6,}\d)/;

/** Every number a written line may use: the ones already in the recipe, the
 *  visitor's own words, and the plan's day numbers. */
export function allowedNumbers(recipe: DoorRecipe, note: string | null): Set<string> {
  const pool = JSON.stringify({ ...recipe, source: undefined }) + " " + (note ?? "");
  const out = new Set<string>((pool.match(NUM) ?? []).map((n) => n.replace(/,/g, "")));
  for (let d = 1; d <= recipe.plan.days; d++) out.add(String(d));
  return out;
}

function textProblems(where: string, s: unknown, max: number, numbers: Set<string>): string[] {
  if (typeof s !== "string" || s.trim().length === 0) return [`${where}: empty`];
  const out: string[] = [];
  if (s.length > max) out.push(`${where}: longer than ${max}`);
  if (URLISH.test(s)) out.push(`${where}: has a web or email address`);
  if (PHONEISH.test(s)) out.push(`${where}: has a phone number`);
  for (const n of s.match(NUM) ?? []) {
    if (!numbers.has(n.replace(/,/g, ""))) out.push(`${where}: number ${n} is not in the record`);
  }
  return out;
}

/** Every reason a written part can't be shown. Empty = it can. */
export function writtenProblems(w: Written, recipe: DoorRecipe, note: string | null): string[] {
  const out: string[] = [];
  if (!w || typeof w !== "object") return ["not an object"];
  const nums = allowedNumbers(recipe, note);
  const okMinutes = (m: unknown) => Number.isInteger(m) && (m as number) >= 5 && (m as number) <= 240;
  if (!Array.isArray(w.read) || w.read.length < 2 || w.read.length > 4) out.push("read: 2 to 4 points");
  else w.read.forEach((x, i) => out.push(...textProblems(`read ${i + 1}`, x, 320, nums)));
  out.push(...textProblems("start title", w.startHere?.title, 90, nums));
  out.push(...textProblems("start task", w.startHere?.task, 420, nums));
  if (!okMinutes(w.startHere?.minutes)) out.push("start minutes");
  const steps = new Set(recipe.method.steps.map((s) => s.name));
  if (!Array.isArray(w.plan) || w.plan.length !== recipe.plan.days) out.push(`plan: ${recipe.plan.days} days`);
  else {
    w.plan.forEach((d, i) => {
      if (d.day !== i + 1) out.push(`plan day ${i + 1}: numbered ${d.day}`);
      if (!steps.has(d.step)) out.push(`plan day ${i + 1}: "${d.step}" is not a method step`);
      out.push(...textProblems(`plan day ${i + 1}`, d.task, 280, nums));
      if (!okMinutes(d.minutes)) out.push(`plan day ${i + 1} minutes`);
    });
  }
  if (recipe.phases) {
    if (!Array.isArray(w.phases) || w.phases.length !== recipe.phases.length) out.push(`phases: ${recipe.phases.length}`);
    else w.phases.forEach((p, i) => {
      if (p.title !== recipe.phases![i].title) out.push(`phase ${i + 1} title changed`);
      out.push(...textProblems(`phase ${i + 1}`, p.milestone, 280, nums));
    });
  } else if (w.phases !== undefined) out.push("phases: none in the recipe");
  out.push(...textProblems("greeting", w.advisorGreeting, 400, nums));
  if (!Array.isArray(w.quickReplies) || w.quickReplies.length < 2 || w.quickReplies.length > 4) out.push("quick replies: 2 to 4");
  else w.quickReplies.forEach((x, i) => out.push(...textProblems(`quick reply ${i + 1}`, x, 80, nums)));
  return out;
}

/** Visitor input, checked the same way on the page and on the server. */
export function cleanVisitorInput(raw: unknown, recipe: DoorRecipe):
  | { ok: true; firstName: string | null; answers: Answers; note: string | null }
  | { ok: false; problem: string } {
  const r = (raw ?? {}) as { firstName?: unknown; answers?: unknown; note?: unknown };
  const firstName = typeof r.firstName === "string" ? r.firstName.trim().slice(0, 40) : "";
  if (firstName && !/^[\p{L}][\p{L}' .-]*$/u.test(firstName)) return { ok: false, problem: "first name" };
  const note = typeof r.note === "string" ? r.note.trim() : "";
  if (note.length > 600) return { ok: false, problem: "note longer than 600 characters" };
  const answers: Answers = {};
  const given = (r.answers ?? {}) as Record<string, unknown>;
  for (const q of recipe.questions) {
    const a = given[q.id];
    if (typeof a === "string" && q.options.some((o) => o.id === a)) answers[q.id] = a;
  }
  return { ok: true, firstName: firstName || null, answers, note: note || null };
}
