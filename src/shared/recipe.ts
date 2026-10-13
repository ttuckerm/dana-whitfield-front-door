/**
 * THE RECIPE — everything one client's Front Door says, written from their
 * interview and research (by the Second Act package build), never chosen
 * from a template. The template only decides how it looks.
 *
 * The scoring (`doorOutcome`) and the publish check (`doorProblems`) are the
 * same rules as the Second Act Front Door (second-act-doors
 * agents/contracts/extraction-pilot.ts): unanswered questions are named, never
 * guessed; any stop answer gives the stop result; `unknownThreshold` unknowns
 * give "can't tell yet"; otherwise clear.
 */

export type Signal = "stop" | "unknown" | "caution" | "clear";
export type ResultKey = "stop" | "unclear" | "clear";

export type DoorOption = { id: string; label: string; signal: Signal; why: string };
export type DoorQuestion = { id: string; text: string; options: DoorOption[] };
export type ResultText = { title: string; body: string };

export type DoorRecipe = {
  version: 1;
  /** Public name shown on every screen, e.g. "Dana Whitfield". */
  ownerName: string;
  /** "Dana Whitfield · Night nurse for twelve years" */
  byline: string;
  /** The assessment's name. */
  title: string;
  intro: string;
  minutes: number;
  questions: DoorQuestion[];
  unknownThreshold: number;
  results: Record<ResultKey, ResultText>;
  /** Things that are always true, shown on every result. */
  always: string[];
  disclaimer: string;
  method: { name: string; oneLine: string; steps: { name: string; text: string }[]; limits: string };
  offer: { name: string; get: string; forWho: string; notIncluded: string[] };
  /** The closing call to the client: heading, text and button words. */
  ask: { heading: string; text: string; button: string };
  plan: { days: number; title: string };
  /** Optional longer view in phases (business-type doors use it). */
  phases?: { title: string; focus: string }[];
  welcome: { heading: string; receive: { label: string; text: string }[] };
  advisor: { name: string; quickReplies: string[] };
  /** Where this recipe came from. A stand-in is labelled on every screen. */
  source: { packageId: string; builtBy: "package-build" | "stand-in-conversion"; note: string };
};

/** Chosen by the client when they approve: the look, never the words. */
export type DoorSettings = {
  template: TemplateId;
  /** Their brand color as #rrggbb. */
  brand: string;
  /** Shown in the header; their logo file is optional. */
  displayName: string;
  logo: string | null;
  /** Where "Ask <owner>" goes: their booking page and/or email. */
  contact: { url: string | null; email: string | null };
  /** Shown on every screen when set, e.g. for a made-up test customer. */
  testLabel?: string | null;
  /** Demo builds only: lets the reviewer switch template and color in the
   *  page address (?template=ledger&brand=%23336699). Off for clients. */
  preview?: boolean;
  /** True once the product picture has been made for this door. */
  productImage?: boolean;
};

export const TEMPLATES = ["signal", "ledger", "harbor"] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export type Answers = Record<string, string | undefined>;
export type DoorPick = { questionId: string; question: string; answer: string; why: string; signal: Signal };
export type Outcome =
  | { done: false; missing: string[] }
  | { done: true; result: ResultKey; told: DoorPick[]; clearCount: number; total: number };

export function doorOutcome(recipe: Pick<DoorRecipe, "questions" | "unknownThreshold">, answers: Answers): Outcome {
  const missing = recipe.questions.filter((q) => !q.options.some((o) => o.id === answers[q.id])).map((q) => q.id);
  if (missing.length > 0) return { done: false, missing };
  const picked = recipe.questions.map((q) => ({ q, o: q.options.find((o) => o.id === answers[q.id]) as DoorOption }));
  const count = (s: Signal) => picked.filter((p) => p.o.signal === s).length;
  const result: ResultKey = count("stop") > 0 ? "stop" : count("unknown") >= recipe.unknownThreshold ? "unclear" : "clear";
  const order: Signal[] = ["stop", "unknown", "caution"];
  const told = order.flatMap((s) =>
    picked
      .filter((p) => p.o.signal === s)
      .map((p) => ({ questionId: p.q.id, question: p.q.text, answer: p.o.label, why: p.o.why, signal: s })),
  );
  return { done: true, result, told, clearCount: count("clear"), total: picked.length };
}

const filled = (s: unknown, max: number) => typeof s === "string" && s.trim().length > 0 && s.length <= max;

/** Every reason a recipe could not run as a Front Door. Empty = it can. Each
 *  of the three results must be reachable, so changed answers change the
 *  conclusion. */
export function doorProblems(r: DoorRecipe): string[] {
  const out: string[] = [];
  if (r?.version !== 1) out.push("version");
  for (const [k, max] of [["ownerName", 80], ["byline", 120], ["title", 120], ["intro", 600], ["disclaimer", 400]] as const) {
    if (!filled(r[k], max)) out.push(k);
  }
  if (!(Number.isInteger(r.minutes) && r.minutes >= 1 && r.minutes <= 10)) out.push("minutes");
  const qs = Array.isArray(r.questions) ? r.questions : [];
  if (qs.length < 4 || qs.length > 10) out.push(`${qs.length} questions (4 to 10)`);
  const qIds = new Set<string>();
  for (const q of qs) {
    if (!filled(q.id, 20) || qIds.has(q.id)) out.push(`question id ${q.id}`);
    qIds.add(q.id);
    if (!filled(q.text, 200)) out.push(`question ${q.id} text`);
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length < 2 || opts.length > 5) out.push(`question ${q.id}: ${opts.length} answers (2 to 5)`);
    const oIds = new Set<string>();
    for (const o of opts) {
      if (!filled(o.id, 20) || oIds.has(o.id)) out.push(`question ${q.id} answer id ${o.id}`);
      oIds.add(o.id);
      if (!filled(o.label, 80)) out.push(`question ${q.id} answer label`);
      if (!["stop", "unknown", "caution", "clear"].includes(o.signal)) out.push(`question ${q.id} answer signal`);
      if (o.signal !== "clear" && !filled(o.why, 300)) out.push(`question ${q.id} answer why`);
    }
    if (!opts.some((o) => o.signal === "clear" || o.signal === "caution")) out.push(`question ${q.id} has no ordinary answer`);
  }
  const t = r.unknownThreshold;
  if (!(Number.isInteger(t) && t >= 1 && t <= 3)) out.push("unknownThreshold");
  if (!qs.some((q) => (q.options ?? []).some((o) => o.signal === "stop"))) out.push("no answer leads to the stop result");
  if (qs.filter((q) => (q.options ?? []).some((o) => o.signal === "unknown")).length < (Number.isInteger(t) ? t : 1)) {
    out.push("too few questions offer an unknown");
  }
  const titles = [r.results?.stop?.title, r.results?.unclear?.title, r.results?.clear?.title];
  if (!titles.every((x) => filled(x, 80)) || new Set(titles).size !== 3) out.push("result titles");
  if (![r.results?.stop?.body, r.results?.unclear?.body, r.results?.clear?.body].every((x) => filled(x, 600))) out.push("result text");
  if (!Array.isArray(r.always) || r.always.length > 5 || !r.always.every((x) => filled(x, 200))) out.push("always");
  const m = r.method;
  if (!filled(m?.name, 80) || !filled(m?.oneLine, 300) || !filled(m?.limits, 400)) out.push("method");
  if (!Array.isArray(m?.steps) || m.steps.length < 2 || m.steps.length > 6 || !m.steps.every((s) => filled(s.name, 80) && filled(s.text, 300))) {
    out.push("method steps");
  }
  if (!filled(r.offer?.name, 80) || !filled(r.offer?.get, 400)) out.push("offer");
  if (!filled(r.ask?.heading, 120) || !filled(r.ask?.text, 400) || !filled(r.ask?.button, 60)) out.push("ask");
  if (!(Number.isInteger(r.plan?.days) && r.plan.days >= 3 && r.plan.days <= 14) || !filled(r.plan?.title, 80)) out.push("plan");
  if (r.phases !== undefined && (!Array.isArray(r.phases) || r.phases.length < 2 || r.phases.length > 4 || !r.phases.every((p) => filled(p.title, 60) && filled(p.focus, 200)))) {
    out.push("phases");
  }
  if (!filled(r.welcome?.heading, 120) || !Array.isArray(r.welcome?.receive) || r.welcome.receive.length < 3 || r.welcome.receive.length > 6 ||
    !r.welcome.receive.every((x) => filled(x.label, 40) && filled(x.text, 200))) {
    out.push("welcome");
  }
  if (!filled(r.advisor?.name, 60) || !Array.isArray(r.advisor?.quickReplies) || r.advisor.quickReplies.length > 4 || !r.advisor.quickReplies.every((x) => filled(x, 80))) {
    out.push("advisor");
  }
  if (!filled(r.source?.packageId, 120) || !["package-build", "stand-in-conversion"].includes(r.source?.builtBy)) out.push("source");
  return out;
}

export function settingsProblems(s: DoorSettings): string[] {
  const out: string[] = [];
  if (!TEMPLATES.includes(s?.template)) out.push("template");
  if (!/^#[0-9a-f]{6}$/i.test(s?.brand ?? "")) out.push("brand color");
  if (!filled(s?.displayName, 80)) out.push("display name");
  const url = s?.contact?.url;
  const email = s?.contact?.email;
  if (url !== null && !(typeof url === "string" && /^https:\/\/[^\s]+$/.test(url))) out.push("contact url");
  if (email !== null && !(typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) out.push("contact email");
  if (url === null && email === null) out.push("no way to reach the owner");
  return out;
}
