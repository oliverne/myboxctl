# Project Instructions

## Communication

- Respond in Korean. Assume the user is an experienced full-stack web developer.
- Keep changes small and pragmatic. Do not add features outside the active phase.

## Runtime and tooling

- Use Bun 1.4 or later. The pinned package manager is `bun@1.4.0`.
- Use `bun install`, `bun run`, `bun test`, and `bun build`; do not introduce npm, pnpm,
  Yarn, tsx, Vitest, or a second runtime without explicit approval.
- Use TypeScript, ESM, Biome, and Bun's built-in test runner.
- HTTP calls use Bun's standards-compatible `fetch` unless a verified MYBOX behavior requires
  otherwise.

## Architecture

- Implement a vertical slice by command. Keep command orchestration in `src/features/` and
  shared MYBOX transport in `src/mybox/`.
- Do not call `fetch` directly from a CLI command.
- Derive TypeScript response types from Zod schemas where practical; do not maintain duplicate
  handwritten API types and schemas.
- Add an interface only at a real substitution boundary. TypeScript structural typing is enough
  for most tests.
- Keep `put` policy as a pure function independent of I/O.

## Workflow

1. Read `docs/PLAN.md`, `docs/PROGRESS.md`, `docs/HANDOFF.md`, and the active phase document.
2. Work only on the phase marked `in_progress` unless the user explicitly changes scope.
3. For behavior changes, write a failing test first when practical.
4. Run the verification commands required by the active phase.
5. Before stopping, update `docs/PROGRESS.md` and `docs/HANDOFF.md` with facts only.

Do not mark a task or phase complete when its required verification was skipped or failed.
Record unverified work explicitly.

## MYBOX safety

- Never commit, print, or log PATs, Authorization headers, upload URLs, download URLs, or tokens.
- Do not accept the PAT as a CLI argument.
- Treat official documentation and reproducible integration-test observations as API facts.
  Record mismatches in `docs/reference/mybox-api.md`.
- Integration tests may mutate only their unique child path under
  `/myboxctl-integration-test/`. Never delete or overwrite outside that prefix.
- Do not retry mutating requests through a generic retry wrapper. Follow the operation-specific
  policy in `docs/architecture/reliability.md`.

## Required checks

Run the checks relevant to the change. The normal full check is:

```bash
bun run check
bun run build
```

Integration tests are opt-in and require explicit credentials:

```bash
bun run test:integration
```

---

## Using Bun v1.4

> The Bun 1.4 release notes also summarize features added since 1.3. The list below focuses on practical capabilities agents should know about when working in a Bun 1.4 environment.

### Built-in APIs

Before adding a new npm dependency, first check whether Bun already provides the required functionality.

- **Image** — `Bun.Image`: decode, resize, rotate, and encode images. Consider it before adding `sharp` for simple image processing.
- **Browser** — `Bun.WebView`: built-in headless browser automation. Consider it before Puppeteer/Playwright for simple automation tasks.
- **Markdown** — `Bun.markdown.html()`, `.react()`, `.render()`.
  - **Warning:** HTML output is not sanitized. Sanitize untrusted Markdown separately.
- **Cron** — `Bun.cron()`: OS-level or in-process scheduling.
  - Uses the local timezone by default. Set `{ tz: "UTC" }` when UTC is required.
- **PTY** — `Bun.Terminal` + `Bun.spawn({ terminal })`: can replace `node-pty` for many use cases.
- **Data formats** — `Bun.XML` (1.4.0), `Bun.JSON5`, `Bun.JSONC`, `Bun.JSONL`, `Bun.TOML`.
- **Archive / terminal utilities** — `Bun.Archive`, `Bun.stringWidth()`, `Bun.sliceAnsi()`, `Bun.wrapAnsi()`.
- **Memory pressure** — handle OS low-memory events with `process.on("memoryPressure", ...)`.

#### CLI / Tooling

```bash
# Run package.json scripts in parallel
bun run --parallel build test
bun run --parallel "build:*"

# Run test files in parallel
bun test --parallel
bun test --parallel=4

# Package maintenance added in v1.4.0
bun audit fix --dry-run
bun dedupe --check
bun prune --production

# Markdown profiler/build output, useful for terminal/LLM analysis
bun --cpu-prof-md ./app.ts
bun --heap-prof-md ./app.ts
bun build ./src/index.ts --outdir ./dist --metafile-md=./dist/meta.md
```

### Compatibility / Agent Rules

- Node.js compatibility has improved significantly, including better Playwright, Vitest, OpenTelemetry, and `dd-trace` support.
- Bun is **not yet 100% Node.js compatible**. When compatibility issues are suspected, check Bun-vs-Node behavior first.
- Do not rewrite stable external dependencies just because Bun has a built-in alternative. **Prefer Bun built-ins when adding new dependencies or implementing simple functionality.**

### References

- Bun 1.4 release notes: <https://bun.com/blog/bun-v1.4>
- Bun API reference: <https://bun.com/reference/bun>
- Bun XML docs: <https://bun.com/docs/runtime/xml>
