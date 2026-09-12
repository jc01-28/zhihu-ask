# AGENT.md

Operating rules for AI coding agents (Codex / Claude Code) working in this repository.
Read this file first. For architecture details read [DEVELOPER.md](DEVELOPER.md).

---

## Project

`zhihu-ask` — a Next.js app that answers one question: **when should an AI hand a user's problem to a real person?**

Core pipeline (8 sequential steps): triage → problem profile → recall → experience extraction → creator aggregation → rank → evidence verify → explain.

The pipeline is a **deterministic workflow, not an agent runtime**. Do not introduce autonomous planning, tool-calling loops, or an orchestration framework.

---

## Commands

```bash
npm run dev          # dev server on :3000
npm run typecheck    # tsc --noEmit — MUST pass before you finish
npm run build        # next build — MUST pass before you finish
npm run harvest      # offline: fetch real content into fixtures
npm audit            # must report 0 vulnerabilities
```

---

## Hard invariants

These are architectural contracts. Breaking any of them will be rejected in review.

1. **`src/framework/` must contain no business vocabulary.** No `triage`, `experience`, `creator`, `candidate`. It exposes only `Step`, `Pipeline`, `runPipeline`, `ContextDeps` — all data is `unknown`.
2. **`src/steps/` must never import a concrete adapter.** No `ZhihuHttpSource`, `ZhidaLlmClient`, `DiskCache`. Use ports only: `ctx.source`, `ctx.llm`, `ctx.cache`, `ctx.quota`.
3. **`src/adapters/index.ts` is the only composition root.** Never `new` an adapter anywhere else.
4. **Every step that changes its output logic requires `pipeline.version` in `src/steps/index.ts` to be incremented.** Cache keys embed the version. Skipping this yields stale results while the trace shows every step as `ok` — extremely hard to debug.
5. **Never write to `process.cwd()`.** Serverless filesystems are read-only. Use `dataDir()` from `src/framework/datadir.ts` for any file writes.
6. **Cache and quota guards must stay module-level singletons** in `src/adapters/index.ts`. Per-request instances break quota counting when the disk is read-only.
7. **Every file write must be fault-tolerant.** A failed write may only lose an optimization — never fail the request. Swallow the error.
8. **Every LLM call needs both a `cacheKey` and a deterministic fallback.** Quota is 100 requests/day; the demo must survive without the model.
9. **Never expose `Candidate.rejectedReasons` or any internal diagnostic field in the UI.** It names evidence that failed verification and reads as blame toward the author.

---

## Code conventions

- **Language:** TypeScript, `strict: true`. No `any` — use `unknown` and narrow.
- **Comments and log messages: Chinese.** Code identifiers: English. Match the surrounding file.
- **All user-facing strings: Chinese.**
- **Comment the *why*, not the *what*.** Every file starts with a header explaining its responsibility and its known pitfalls.
- **Named constants** for dictionaries, thresholds, and weights — at the top of the file, never inline.
- **Step functions must be effectively pure:** read `input` and ports only. No global mutable state.
- **`extractJson()` in `src/framework/llm-utils.ts` is intentionally lenient.** Do not replace it with `JSON.parse` — the model returns fenced or wrapped JSON.

---

## Adding a step

1. Add the key to `Stages` in `src/domain/types.ts` — the key must equal `step.name`.
2. Create `src/steps/NN-name.ts` exporting a `Step`.
3. Insert it into the `steps` array in `src/steps/index.ts` (array order = execution order).
4. Increment `pipeline.version`.
5. `from` refers to **step names**, not business concepts. `validatePipeline()` rejects unknown references at startup and lists the valid ones.

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

---

## Before you finish

```bash
npm run typecheck   # no output
npm run build       # ✓ Compiled successfully
npm audit           # found 0 vulnerabilities
```

Then confirm: did you change step logic? If yes, was `pipeline.version` incremented?

---

## Docs map

| File | Audience | Content |
|---|---|---|
| [README.md](README.md) | Public | Product story, positioning, how to run |
| [DEVELOPER.md](DEVELOPER.md) | Developers | Architecture, engineering boundaries, extension guide |
| [docs/STATUS.md](docs/STATUS.md) | Team | Progress, priorities, 48h plan |
| This file | AI agents | Operating rules |
