# Bun 1.4+ reference

이 문서는 Bun 1.4.0을 기준으로 추가된 내장 API와 CLI 기능을 확인해야 할 때만 읽는 선택형
reference다. 프로젝트는 Bun 1.4.0 이상을 지원하므로, 설치된 Bun이 더 최신이면 현재 버전의
동작과 공식 문서도 함께 확인한다. Bun 1.4 release notes에는 1.3 이후 추가된 기능도 정리되어 있다.
프로젝트의 필수 런타임·패키지 매니저·검증 명령 규칙은 루트 [`AGENTS.md`](../../AGENTS.md)가
기준이다.

## 읽어야 하는 경우

- 새 의존성을 추가하기 전에 Bun 내장 기능을 확인할 때
- Bun API를 사용하거나 Bun과 Node.js의 호환성 문제를 조사할 때
- Bun의 test/build/package maintenance/profiling 명령을 사용할 때

## 내장 API

새 npm 의존성을 추가하기 전에 Bun이 필요한 기능을 이미 제공하는지 먼저 확인한다.

- `Bun.Image`: 이미지 디코드, resize, rotate, encode. 단순한 이미지 처리는 `sharp`보다 먼저
  검토한다.
- `Bun.WebView`: 내장 headless browser automation. 단순한 자동화에는 Puppeteer/Playwright보다
  먼저 검토한다.
- `Bun.markdown.html()`, `.react()`, `.render()`: Markdown 렌더링. HTML 결과는 sanitize되지
  않으므로 신뢰하지 않는 Markdown은 별도로 sanitize한다.
- `Bun.cron()`: OS 수준 또는 프로세스 내 scheduling. 기본 timezone은 local timezone이며 UTC가
  필요하면 `{ tz: "UTC" }`를 지정한다.
- `Bun.Terminal`과 `Bun.spawn({ terminal })`: 여러 경우에 `node-pty`를 대체할 수 있는 PTY 기능.
- `Bun.XML` (1.4.0), `Bun.JSON5`, `Bun.JSONC`, `Bun.JSONL`, `Bun.TOML`: 데이터 형식 처리.
- `Bun.Archive`, `Bun.stringWidth()`, `Bun.sliceAnsi()`, `Bun.wrapAnsi()`: archive와 terminal
  utility.
- `process.on("memoryPressure", ...)`: OS 메모리 부족 이벤트 처리.

## CLI와 tooling

```bash
# package.json script 병렬 실행
bun run --parallel build test
bun run --parallel "build:*"

# test file 병렬 실행
bun test --parallel
bun test --parallel=4

# Bun 1.4.0 package maintenance
bun audit fix --dry-run
bun dedupe --check
bun prune --production

# Markdown profiler/build output
bun --cpu-prof-md ./app.ts
bun --heap-prof-md ./app.ts
bun build ./src/index.ts --outdir ./dist --metafile-md=./dist/meta.md
```

## 호환성 규칙

- Node.js 호환성은 Playwright, Vitest, OpenTelemetry, `dd-trace` 등을 포함해 크게 개선되었지만,
  Bun이 100% Node.js와 호환되는 것은 아니다. 호환성 문제가 의심되면 Bun과 Node.js의 실제 동작을
  먼저 비교한다.
- 안정적인 외부 의존성을 Bun 내장 기능으로 바꾸기 위해 불필요한 rewrite를 하지 않는다. 새
  의존성을 추가하거나 단순한 기능을 구현할 때 Bun 내장 기능을 우선 검토한다.

## 공식 문서

- [Bun 1.4 release notes](https://bun.com/blog/bun-v1.4)
- [Bun API reference](https://bun.com/reference/bun)
- [Bun XML docs](https://bun.com/docs/runtime/xml)
