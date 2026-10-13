import door from "../../door/door.json";
import { doorOutcome, type DoorRecipe, type DoorSettings } from "../shared/recipe";
import { cleanVisitorInput, type ChatMessage, type DoorResult } from "../shared/result";
import { DoorStore, type Env } from "./store";
import {
  CHAT_MAX_TOKENS, callClaude, chatPrompt, claudeCaller, standInReply, worstCaseUsd, writeBookingUsd, writeStandIn,
  writeWithClaude, writerPrompt, type VisitorFacts,
} from "./writer";

export { DoorStore };

const recipe = (door as { recipe: DoorRecipe; settings: DoorSettings }).recipe;

/** Visit limits per visitor (by a hash of their network address). */
const LIMITS = {
  assessPerHour: 5,
  chatPerHour: 30,
  chatPerResult: 40,
};
const DEFAULT_DAILY_LIMIT_USD = 3;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function store(env: Env) {
  return env.STORE.get(env.STORE.idFromName("door"));
}

async function visitorKey(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`front-door:${ip}`));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newId(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}

function dailyLimit(env: Env): number {
  const n = Number(env.DAILY_LIMIT_USD);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_LIMIT_USD;
}

function factsFor(r: Pick<DoorResult, "firstName" | "note" | "answers" | "outcome">): VisitorFacts {
  return {
    firstName: r.firstName,
    note: r.note,
    result: r.outcome.result,
    told: r.outcome.told,
    answered: recipe.questions.map((q) => ({ question: q.text, answer: q.options.find((o) => o.id === r.answers[q.id])?.label ?? "" })),
  };
}

/** What visitors may see of a saved result: no costs. */
function publicResult(r: DoorResult) {
  return { ...r, writer: { kind: r.writer.kind } };
}

async function assess(req: Request, env: Env): Promise<Response> {
  const input = cleanVisitorInput(await req.json().catch(() => null), recipe);
  if (!input.ok) return json({ error: input.problem }, 400);
  const outcome = doorOutcome(recipe, input.answers);
  if (!outcome.done) return json({ error: "missing", missing: outcome.missing }, 400);
  const s = store(env);
  const perHour = Number(env.ASSESS_PER_HOUR);
  const assessLimit = Number.isInteger(perHour) && perHour > 0 ? perHour : LIMITS.assessPerHour;
  if (!(await s.hit(`assess:${await visitorKey(req)}`, assessLimit, 3600))) {
    return json({ error: "Too many assessments from here in the last hour. Please try again later." }, 429);
  }

  // The reply is held open while the plan is written (up to a minute or two),
  // with a space sent every few seconds so nothing in between gives up.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const beat = setInterval(() => writer.write(enc.encode(" ")).catch(() => {}), 8000);

  const work = (async () => {
    const base = { firstName: input.firstName, note: input.note, answers: input.answers, outcome: { result: outcome.result, told: outcome.told, clearCount: outcome.clearCount, total: outcome.total } };
    const facts = factsFor(base);
    let result: DoorResult;
    if (env.WRITER === "stand-in") {
      const w = writeStandIn(recipe, facts);
      result = { id: newId(), createdAt: new Date().toISOString(), ...base, written: w.ok ? w.written : null, writeNote: null, writer: w.info };
    } else if (!env.ANTHROPIC_API_KEY) {
      result = { id: newId(), createdAt: new Date().toISOString(), ...base, written: null, writeNote: "Your personal plan isn't switched on yet.", writer: { kind: "ai", model: null, costUsd: 0 } };
    } else {
      const { system, user } = writerPrompt(recipe, facts);
      const worst = writeBookingUsd(system, user);
      const booked = await s.book(worst, dailyLimit(env), "assessment");
      if (!booked.ok) {
        result = { id: newId(), createdAt: new Date().toISOString(), ...base, written: null, writeNote: "Your personal plan can't be written right now because today's limit has been reached. Your result below is complete.", writer: { kind: "ai", model: null, costUsd: 0 } };
      } else {
        let w;
        try {
          w = await writeWithClaude(claudeCaller(env.ANTHROPIC_API_KEY), recipe, facts);
        } catch (e) {
          // Nothing came back: keep the whole booking counted (over-count, never under-count).
          console.error("writer call failed", (e as Error).message);
          w = null;
        }
        if (w) await s.settle(booked.booking, w.info.costUsd);
        const written = w?.ok ? w.written : null;
        if (written && outcome.result === "stop") {
          written.startHere = { title: recipe.results.stop.title, task: recipe.results.stop.body, minutes: 5 };
        }
        result = {
          id: newId(), createdAt: new Date().toISOString(), ...base, written,
          writeNote: written ? null : "Your personal plan couldn't be written this time. Your result below is complete.",
          writer: w?.info ?? { kind: "ai", model: null, costUsd: worst },
        };
        if (w && !w.ok) console.error("writer refused", w.reason);
      }
    }
    await s.saveResult(result);
    return result.id;
  })();

  work
    .then((id) => writer.write(enc.encode(JSON.stringify({ id }))))
    .catch((e) => {
      console.error("assess failed", (e as Error).message);
      return writer.write(enc.encode(JSON.stringify({ error: "Something went wrong on our side. Please try again." })));
    })
    .finally(() => {
      clearInterval(beat);
      writer.close().catch(() => {});
    });

  return new Response(readable, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function chat(req: Request, env: Env, id: string): Promise<Response> {
  const s = store(env);
  const saved = await s.getResult(id);
  if (!saved) return json({ error: "not found" }, 404);
  if (req.method === "GET") return json({ messages: await s.getChat(id) });
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 1000) return json({ error: "Please type a question (up to 1,000 characters)." }, 400);
  if (!saved.written) return json({ error: "The advisor needs your personal plan, which isn't available for this result." }, 409);
  const history = await s.getChat(id);
  if (history.filter((m) => m.role === "user").length >= LIMITS.chatPerResult) {
    return json({ error: "This conversation has reached its limit." }, 429);
  }
  if (!(await s.hit(`chat:${await visitorKey(req)}`, LIMITS.chatPerHour, 3600))) {
    return json({ error: "Too many questions from here in the last hour. Please try again later." }, 429);
  }
  const at = new Date().toISOString();
  let reply: string;
  if (env.WRITER === "stand-in") {
    reply = standInReply(text);
  } else {
    if (!env.ANTHROPIC_API_KEY) return json({ error: "The advisor isn't switched on yet." }, 503);
    const system = chatPrompt(recipe, factsFor(saved), saved.written);
    const msgs = history.slice(-10).map((m) => ({ role: m.role, content: m.text })).concat([{ role: "user" as const, content: `<visitor_question>\n${text}\n</visitor_question>` }]);
    if (msgs[0]?.role === "assistant") msgs.shift();
    const worst = worstCaseUsd(system, msgs.map((m) => m.content).join(""), CHAT_MAX_TOKENS);
    const booked = await s.book(worst, dailyLimit(env), "advisor");
    if (!booked.ok) return json({ error: "The advisor has reached today's limit. Please come back tomorrow." }, 429);
    try {
      const r = await callClaude(env.ANTHROPIC_API_KEY, system, msgs, CHAT_MAX_TOKENS, "low");
      await s.settle(booked.booking, r.usd);
      if (r.stop === "refusal" || !r.text.trim()) return json({ error: "The advisor couldn't answer that one. Try asking another way." }, 422);
      reply = r.text.trim();
    } catch (e) {
      console.error("advisor call failed", (e as Error).message);
      return json({ error: "The advisor couldn't answer just now. Please try again." }, 502);
    }
  }
  const added: ChatMessage[] = [{ role: "user", text, at }, { role: "assistant", text: reply, at: new Date().toISOString() }];
  return json({ messages: await s.appendChat(id, added) });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/api/assess" && req.method === "POST") return assess(req, env);
    const m = p.match(/^\/api\/(result|chat)\/([a-z0-9]{20})$/);
    if (m) {
      if (m[1] === "result" && req.method === "GET") {
        const r = await store(env).getResult(m[2]);
        return r ? json(publicResult(r)) : json({ error: "not found" }, 404);
      }
      if (m[1] === "chat" && (req.method === "GET" || req.method === "POST")) return chat(req, env, m[2]);
    }
    if (p.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
