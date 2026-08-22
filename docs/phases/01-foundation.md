# Phase 01 — Foundation

## 목표

이후 모든 vertical slice가 공유할 config, 오류, 출력, MYBOX transport와 테스트 기반을 만든다.
아직 `stat` 같은 public command 동작은 구현하지 않는다.

## 진입 조건

- Phase 00이 `complete`다.
- `docs/reference/mybox-api.md`에 resolver/upload 기본 계약이 기록되어 있다.
- `docs/PROGRESS.md`의 Phase 01이 `in_progress`다.

## 구현 파일

```text
src/config.ts
src/errors.ts
src/output.ts
src/runtime.ts
src/mybox/client.ts
src/mybox/contract.ts
test/http/server.ts
```

각 파일의 test는 구현 옆 또는 `test/http/`에 둔다.

## 작업 순서

### 1. config test와 구현

먼저 다음 실패/성공 case를 작성한다.

- `MYBOX_PAT`가 있으면 trim하지 않은 원문을 token으로 사용
- PAT가 없으면 credentials file의 단일 trimmed line 사용
- 둘 다 없으면 argument/config 오류
- 빈 token 거부
- `MYBOX_TIMEOUT_MS`는 양의 정수만 허용
- 기본 base URL과 timeout 30,000ms
- env base URL override
- config/error 직렬화에서 PAT가 노출되지 않음

credentials 기본 경로는 `${XDG_CONFIG_HOME}/myboxctl/credentials`, XDG가 없으면
`~/.config/myboxctl/credentials`다. 파일은 token 한 줄만 허용한다. POSIX에서 group/other read
bit가 있으면 사용을 거부하고 `chmod 600` 안내를 반환한다.

### 2. API schema

Phase 00 fixture를 기준으로 Zod schema를 작성한다.

- resource item
- page metadata와 list response
- search file/folder response
- create folder response
- create upload response
- MYBOX error body

unknown field는 허용하되 필수 field 누락과 잘못된 type은 `api-unavailable`로 변환한다. 타입은
`z.infer`로 생성한다.

### 3. domain error와 output

`docs/reference/cli-contract.md`의 kind와 exit code를 exhaustive mapping한다. 예상 가능한 오류는
raw `Error.message`를 직접 출력하지 않는다.

test:

- 모든 kind의 exit code
- 성공/실패 JSON에 정확히 하나의 trailing newline
- optional code/requestId 처리
- Authorization, `mbx_pat_`, `stoken`, signed URL redaction
- 예상하지 못한 오류는 kind `unexpected`, exit 70

### 4. MYBOX client transport

constructor dependency는 최소 다음으로 한다.

```ts
type ClientDependencies = {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};
```

구현:

- base URL 결합과 query encoding
- Bearer header
- `AbortSignal.timeout` 또는 동등한 timeout
- response body의 content-type/empty-body 처리
- Zod parse와 error mapping
- GET 전용 retry 및 `Retry-After`
- cursor cycle 감지와 최대 page guard

mutation method에는 generic retry를 적용하지 않는다.

### 5. local fake server

Bun test 안에서 ephemeral port의 local HTTP server를 실행한다. 고정 port를 사용하지 않는다.
request method/path/header/body와 scripted response sequence를 검증할 수 있어야 한다.

## 검증

```bash
bun run typecheck
bun test src/config.test.ts src/errors.test.ts src/output.test.ts test/http
bun run lint
bun run build
```

실제 생성된 파일명에 맞게 test 경로를 조정하되, 전체 `bun run check`도 마지막에 실행한다.

## 완료 조건

- config/error/output/client unit 및 HTTP test가 통과한다.
- GET retry와 mutation no-retry가 test로 고정되어 있다.
- schema mismatch가 명시적 domain error가 된다.
- build artifact가 PAT나 환경값을 포함하지 않는다.
- 아직 구현되지 않은 command는 help에 노출되지 않는다.

## Handoff

- public으로 사용할 client method와 반환 type
- Phase 00 fixture와 schema의 차이
- retry timing test 방식
- 남은 API 미확인 사항
- `bun run check`, `bun run build` 결과
