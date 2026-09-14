# AGENT.md

Operating rules for AI coding agents (Codex / Claude Code) working in this repository.
Read this file first. For architecture details read [DEVELOPER.md](DEVELOPER.md).

---

## Project

`zhihu-ask` — a Next.js app that answers one question: **when should an AI hand a user's problem to a real person?**

Two entry points, one corpus, one core belief — **every recommendation must trace back to the original text**:

1. **问题找人** (`/app/find`) — user describes a problem; the 8-step pipeline finds people who actually lived it.
2. **领域社交** (`/app/fields`, `/app/fields/:id`) — browse 7 professional fields → topics → the real creators active in each.

Core pipeline (8 sequential steps): triage → problem profile → recall → experience extraction → creator aggregation → rank → evidence verify → explain.

The pipeline is a **deterministic workflow, not an agent runtime**. Do not introduce autonomous planning, tool-calling loops, or an orchestration framework.

### Layout

```
src/app/      Next.js route shells — forwarding only, no business logic
src/back/     backend: steps · domain · framework · adapters · handlers · fixtures
src/front/    frontend: pages · components · api-client · styles
src/shared/   contract.ts — the single front/back handoff point
```

Dependencies are one-way: `back → shared ← front`. See hard invariants 10–13.

---

## Commands

```bash
npm run dev          # dev server on :3000
npm run typecheck    # tsc --noEmit — MUST pass before you finish
npm run e2e          # 45 assertions, real HTTP — MUST pass before you finish
npm run eval         # A/B/C experiment (20 questions × 3 groups) — MUST still match the report
npm run build        # next build
npm run harvest      # offline: fetch real content into fixtures
npm audit            # must report 0 vulnerabilities
```

`typecheck` + `e2e` are the regression gates. Do not report work as done without both.
`e2e` needs a free port — it **fails loudly** if the port is occupied rather than silently testing
some other process (this used to happen and produced a full run of plausible-looking wrong numbers).

---

## Hard invariants

These are architectural contracts. Breaking any of them will be rejected in review.

1. **`src/back/framework/` must contain no business vocabulary.** No `triage`, `experience`, `creator`, `candidate`. It exposes only `Step`, `Pipeline`, `runPipeline`, `ContextDeps` — all data is `unknown`.
2. **`src/back/steps/` must never import a concrete adapter.** No `ZhihuHttpSource`, `ZhidaLlmClient`, `DiskCache`. Use ports only: `ctx.source`, `ctx.llm`, `ctx.cache`, `ctx.quota`.
3. **`src/back/adapters/index.ts` is the only composition root.** Never `new` an adapter anywhere else.
4. **Every step that changes its output logic requires `pipeline.version` in `src/back/steps/index.ts` to be incremented.** Cache keys embed the version. Skipping this yields stale results while the trace shows every step as `ok` — extremely hard to debug.
5. **Never write to `process.cwd()`.** Serverless filesystems are read-only. Use `dataDir()` from `src/back/framework/datadir.ts` for any file writes.
6. **Cache and quota guards must stay module-level singletons** in `src/back/adapters/index.ts`. Per-request instances break quota counting when the disk is read-only.
7. **Every file write must be fault-tolerant.** A failed write may only lose an optimization — never fail the request. Swallow the error.
8. **Every LLM call needs both a `cacheKey` and a deterministic fallback.** Quota is 100 requests/day; the demo must survive without the model.
9. **Never expose `Candidate.rejectedReasons` or any internal diagnostic field in the UI.** It names evidence that failed verification and reads as blame toward the author.
10. **`src/front/` must not `import @/back/*`, and must not call `fetch` directly.** It may only use `@/front/api-client` (the single request exit) and `@/shared/contract` (types). Self-check:
    ```bash
    grep -rnE "(from|require\()\s*['\"]@/back" src/front   # must print nothing
    ```
11. **Every `/api/*` endpoint returns the unified envelope** — `{ status:'success', data }` on success, `{ error, hint? }` on failure — built via `ok()` / `fail()` in `src/back/handlers/types.ts`, never hand-assembled. `e2e` has an assertion that fails if the envelope is missing.
12. **Route files hold no business logic.** `src/app/api/**/route.ts` and `src/app/**/page.tsx` only translate the HTTP context into plain arguments and hand off to `src/back/handlers/**` or `src/front/pages/**` via `_bridge.ts`. If a route grows past ~15 lines, the logic belongs elsewhere.
13. **Do not put presentation fields on `AskResult`.** `AskResult` is the *pipeline artifact* (`08-explain` builds it, `e2e` and the experiment assert on it). Anything display-only goes on `AskResponse` (which extends it) and is computed in the handler layer. This is what lets you change the 6-phase grouping without re-running any pipeline verification.
14. **The field domain (`/api/fields/*`) must read the real corpus only** — via `enumerateRealCorpus()`, which ignores `FIXTURE_CORPUS`. A star map showing fabricated authors (the synthetic corpus contains invented names like 林一舟) destroys the product's entire premise, and nobody can tell at a glance which names are made up.
15. **Field queries must never score a domain without a text match.** An unconditional "member count" bonus once made *every* query return all 7 domains — including a nonsense string. Check for a real match first; return 0 otherwise.

---

## Code conventions

- **Language:** TypeScript, `strict: true`. No `any` — use `unknown` and narrow.
- **Comments and log messages: Chinese.** Code identifiers: English. Match the surrounding file.
- **All user-facing strings: Chinese.**
- **Comment the *why*, not the *what*.** Every file starts with a header explaining its responsibility and its known pitfalls.
- **Named constants** for dictionaries, thresholds, and weights — at the top of the file, never inline.
- **Step functions must be effectively pure:** read `input` and ports only. No global mutable state.
- **`extractJson()` in `src/back/framework/llm-utils.ts` is intentionally lenient.** Do not replace it with `JSON.parse` — the model returns fenced or wrapped JSON.
- **Comment the *why* when a rule exists because something already went wrong once.** Example: `next.config.mjs` ignores `.cache/` and `.artifacts/` in `watchOptions`, and `eval.mjs` tree-kills its server. Both look removable; both fixed real, hour-losing bugs.

---

## Adding a step

1. Add the key to `Stages` in `src/back/domain/types.ts` — the key must equal `step.name`.
2. Create `src/back/steps/NN-name.ts` exporting a `Step`.
3. Insert it into the `steps` array in `src/back/steps/index.ts` (array order = execution order).
4. Increment `pipeline.version`.
5. `from` refers to **step names**, not business concepts. `validatePipeline()` rejects unknown references at startup and lists the valid ones.

## Adding a domain

The field domain (`/api/fields/*`) is the template for a second vertical:

1. Hand-write the field/topic/keyword skeleton in `src/back/domain/fields.ts` — field names are
   product narrative, so they must be reviewable and stable (clustering gives you neither).
2. Derive the *people* from real content in pure functions (`src/back/domain/field-graph.ts`).
   Never invent people.
3. Wire it up in `src/back/handlers/<domain>.ts`, then a 3-line route shell under `src/app/api/`.
4. Add types to `src/shared/contract.ts` and a wrapper in `src/front/api-client.ts`.
5. Add `e2e` assertions — including a **regression assertion for whatever bug you just fixed**.

---

## Dependencies

- Keep exactly **3 production dependencies**: `next`, `react`, `react-dom`. Adding one requires an explicit justification in the PR description — ask yourself whether ~60 lines of your own code would do.
- **Never run `npm audit fix --force`.** It upgrades `next` across a major version; Next 15 made `cookies()` async and canary-breaking, which would break every route handler.
- **Do not change dependency versions.** The current set (`next@15.5.25`, React 19, `postcss@8.5.28` via `overrides`) is verified green. Version churn mid-sprint is a net loss.

---

## Do not

- Do not add markdown documentation unless explicitly asked.
- Do not add an async job queue, push notifications, topic-link output, multi-agent orchestration, or graph visualizations. These are deliberately out of scope — see section 4.8 of [DEVELOPER.md](DEVELOPER.md).
- Do not remove or weaken the degradation paths (`optional`, `shouldRun`, fallbacks). They exist so a demo cannot fail.
- Do not run destructive git operations (`reset --hard`, `push --force`, `clean -fd`) without explicit user approval.
- Do not print secrets. Never echo `ZHIHU_ACCESS_SECRET`, `ZHIHU_APP_KEY`, or OAuth tokens into logs, responses, or commits.
- Do not commit `.env.local`, `.cache/`, or `.artifacts/` — they are gitignored for a reason.
- Do not publish anything from `internal/`. Internal drafts (e.g. the frontend spec) belong there.
- Do not add broad ignore patterns like `*.json` — `src/back/fixtures/*.json` are **input corpora**,
  not build output. Without them nobody can reproduce the numbers in `eval/report.md`.

---

## File tiers

| Tier | Location | Published? | Holds |
|---|---|---|---|
| Published | `src/`, `scripts/`, `README/DEVELOPER/AGENT.md`, `.env.example`, `eval/` | yes | product code, reproducible evaluation |
| Internal | `internal/` | no (gitignored) | planning, handoff notes, gap analysis, frontend spec |
| Runtime | `.cache/`, `.artifacts/`, `.next/`, `node_modules/` | no | regenerable output |
| Secret | `.env`, `.env.local` | no | credentials |

`internal/` is ignored at the **directory** level, so adding files there never requires touching
`.gitignore` — that is deliberately safer than per-file rules.

---

## Before you finish

```bash
npm run typecheck   # no output
npm run e2e         # 45/45 通过
npm run eval        # A/B/C numbers unchanged vs eval/report.md
npm run build       # ✓ Compiled successfully
npm audit           # found 0 vulnerabilities
```

Then confirm:
- Did you change step logic? If yes, was `pipeline.version` incremented?
- Did you add a UI-facing field? If yes, is it on `AskResponse` rather than `AskResult`?
- Did you fix a bug? If yes, is there an `e2e` assertion that would catch it coming back?

---

## Docs map

| File | Audience | Content |
|---|---|---|
| [README.md](README.md) | Public | Product story, positioning, API overview, how to run |
| [DEVELOPER.md](DEVELOPER.md) | Developers | Architecture, route map, file tiers, engineering boundaries |
| `internal/STATUS.md` | Team | Progress, priorities, gap analysis — **gitignored, not published** |
| `internal/HANDOFF.md` | Handover | Plain-language "what works / what doesn't / what next" — **gitignored, not published** |
| `internal/frontend-spec.md` | Team | Frontend spec (7 pages + 2 shared modules) — **gitignored, not published** |
| This file | AI agents | Operating rules |
