# Current handoff

## 요약

Phase 01 Foundation을 완료했다. 이후 vertical slice가 사용할 config, domain error, JSON output,
Zod contract, MYBOX HTTP transport와 local fake HTTP server를 구현했으며 관련 테스트가 통과했다.
`stat`/`ls`를 포함한 public command는 아직 구현하지 않았다.

## 현재 phase와 상태

- Phase: `01-foundation`
- 상태: `complete`
- `docs/PROGRESS.md`와 일치한다.
- 다음 phase: Phase 02 Read commands (`pending`)

## 변경 파일

- `src/config.ts`
  - `MYBOX_PAT`가 있으면 원문을 그대로 사용하고, 없으면 XDG 기본 경로 또는 `HOME` 기반
    credentials 파일의 단일 trimmed line을 사용한다.
  - 빈 token, multiline credentials, POSIX group/other permission, 잘못된 timeout/base URL을
    거부한다.
  - `AppConfig`의 PAT는 private field와 getter로 보관하고 `JSON.stringify`/`toJSON`에는 포함하지
    않는다.
- `src/errors.ts`
  - CLI contract의 10개 error kind와 exhaustive exit code mapping을 추가했다.
  - HTTP status를 안정적인 domain message로 매핑하고 raw API message는 사용하지 않는다.
  - config error와 timeout/network error를 domain error로 정규화하며 serialization 전에 credential
    형태의 문자열을 redaction한다.
- `src/output.ts`
  - success/failure envelope, JSON renderer/writer, exit code helper를 추가했다.
  - JSON은 하나의 document와 하나의 trailing newline을 출력한다.
  - PAT prefix, Bearer/Authorization, `stoken`, URL, secret-shaped field를 redaction한다.
  - `path` 필드는 PAT로 오인하지 않고 그대로 보존한다.
- `src/mybox/contract.ts`
  - Phase 00 관찰 결과를 기준으로 resource/detail, search resource/list, response metadata,
    folder creation, upload reservation/content, MYBOX error schema와 `z.infer` 타입을 추가했다.
  - root/detail resource는 fixture의 필드를 필수로 검증하고 search resource는 API 문서상 optional
    필드를 허용한다. 모든 schema는 unknown field를 보존한다.
- `src/mybox/client.ts`
  - public method: `requestJson`, `request`, `getResource`, `listRootPage`, `listRoot`,
    `searchFoldersPage`, `searchFolders`, `searchFilesPage`, `searchFiles`, `createFolder`,
    `createUpload`.
  - URL query는 `URL.searchParams`로 encoding하고 Bearer auth, JSON body, timeout signal을
    사용한다. client의 PAT도 private field로 보관한다.
  - GET만 network failure, 429, 500, 502, 503을 최대 4회까지 재시도한다. 기본 delay는 500ms,
    1s, 2s에 주입된 random 기반 jitter를 더하며 유효한 `Retry-After` seconds/date가 우선한다.
    mutation은 generic retry하지 않는다.
  - root/search pagination은 cursor cycle을 감지하고 최대 1,000 page에서 중단한다.
  - response body가 비어 있으면 `undefined`, non-JSON이면 text로 처리한 뒤 JSON schema endpoint에서
    `api-unavailable`로 변환한다.
- `src/runtime.ts`
  - config와 `MyboxClient`를 조립하는 runtime factory를 추가했다.
- `test/http/server.ts`
  - 고정 port를 사용하지 않는 Bun ephemeral fake server를 추가했다. request method/path/query/
    headers/body를 기록하고 scripted response sequence 또는 handler를 제공한다.
- 테스트
  - `src/config.test.ts`, `src/errors.test.ts`, `src/output.test.ts`,
    `src/mybox/contract.test.ts`, `test/http/client.test.ts`를 추가했다.

## Phase 00 fixture와 schema 차이

- `test/fixtures/mybox/api-contract.latest.json`은 secret을 제거한 key/status 관찰 fixture라서
  실제 resource body 전체를 담지 않는다.
- fixture와 Phase 00 integration assertion에서 root/detail resource의 metadata 필드가 확인되어
  `resourceItemSchema`/`resourceDetailSchema`에서는 이를 필수로 뒀다.
- Phase 00 문서가 search result 필드를 optional로 기록했으므로 search 전용 schema를 분리했다.
- `nextCursor`는 API 응답의 absent/null뿐 아니라 empty string도 종료 값으로 수용한다.
- upload content transfer 자체는 아직 `src/mybox/upload.ts`로 구현하지 않았다. reservation
  schema와 `createUpload`만 foundation 범위에서 제공한다.

## 검증

성공:

- `bun run typecheck`
- `bun test src/config.test.ts src/errors.test.ts src/output.test.ts test/http`
  - 19 pass, 0 fail
- `bun run lint`
- `bun run check`
  - 23 pass, 3 integration skip, 0 fail
- `bun run build`
- build 결과 `dist/cli.js`에서 `mbx_pat_`, `authorization:`, `stoken=` secret-like 문자열 미검출

Integration test는 Foundation의 required check가 아니므로 이번 phase에서 실행하지 않았다. 실제
MYBOX 미확정 사항은 Phase 00 ledger와 동일하다: direct children endpoint, 100MB bounded-memory
probe, 실제 interruption 후 non-zero resume, `Retry-After` live 형식, 423 해제 특성.
