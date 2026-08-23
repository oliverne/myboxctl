# Current handoff

## 요약

Phase 03 Ensure directory와 Phase 04 Upload를 완료했다. `upload`는 같은 file handle의
`fstat` 결과를 기준으로 multipart body를 streaming하며, retryable content failure 뒤 서버 offset을
기준으로 정확히 한 번 복구한다. 실제 probe에서 관찰된 `offset: 0`은 전체 파일 재전송으로 처리하고,
향후 non-zero가 반환되면 해당 지점부터 남은 byte만 보낸다.

검색 API는 문서상 최저 한도인 10회/분 sliding window를 local state 파일과 atomic directory
lock으로 여러 CLI process에 공유한다. `Retry-After`가 없는 429는 60초 + jitter 뒤 GET을 한 번만
재시도한다. Phase 00 contract probe를 일반 acceptance에서 분리한 뒤 실제 MYBOX integration은
429 없이 생성, 두 번째 `existing`, cleanup까지 통과했다.

## 현재 phase와 상태

- Phase: `04-upload`
- 상태: `complete`
- `docs/PROGRESS.md`와 일치한다.
- 수정된 probe를 실제 MYBOX에서 실행했다. 동일 resume identity로 64MiB를 읽은 뒤 in-process stream
  error, 즉시 worker `SIGKILL`, 2초 client-buffer drain 뒤 worker `SIGKILL`을 각각 시도했지만 모두
  resume reservation이 `201 / offset: 0`을 반환했다.
- 각 실행 후 `/myboxctl-integration-test/`를 조회해 잔여 리소스가 없음을 확인했다.
- 사용자가 server-returned offset 0부터 전체 파일을 한 번 재전송하는 정책을 승인했다.
- production command의 실제 MYBOX acceptance와 100MiB bounded-memory 완료 전송이 통과했다.
  Phase 04를 완료 처리했으며 Phase 05는 아직 시작하지 않았다.

## 변경 파일

- `src/mybox/upload.ts`
  - 1MiB 단위 file-handle read로 multipart `Filedata` body를 streaming한다.
  - 정확한 `Content-Length`와 resume `Content-Range: offset-end/size`를 생성한다.
  - signed upload URL에는 PAT `Authorization` header를 보내지 않으며 오류에도 URL을 포함하지 않는다.
- `src/features/upload.ts`
  - local open/fstat, parent resolve/`--mkdir`, exact target conflict, reservation, content transfer,
    postcondition, local stability 검사를 하나의 vertical slice로 구현했다.
  - retryable content failure 뒤 같은 reservation identity로 한 번만 재예약한다. offset 0/non-zero와
    offset==fileSize를 처리하고 두 번째 실패 뒤에는 세 번째 시도를 하지 않는다.
- `src/mybox/client.ts`, `src/runtime.ts`, `src/cli.ts`
  - `resume: true`일 때 `modifiedTime`을 필수로 만든 upload request type, uploader runtime dependency,
    `upload <local-path> <remote-path> [--overwrite] [--mkdir] [--json]` command를 추가했다.
- `test/http/upload.test.ts`, `test/cli/upload.test.ts`
  - remaining-byte range, offset 0 재시작, 복구 1회 상한, 0-byte, secret header/URL 보호, conflict,
    explicit overwrite, `--mkdir`, local-file-changed와 JSON subprocess 성공을 검증한다.
- `test/integration/upload.test.ts`
  - `/myboxctl-integration-test/` 아래 unique child에서 0-byte Unicode 신규 upload, 기본 conflict,
    explicit overwrite와 exact cleanup을 검증하는 opt-in acceptance다.

- `src/features/ensure-dir.ts`
  - root `/`는 API를 호출하지 않고 `existing`과 `resourceId: null`을 반환한다.
  - 최종 folder를 먼저 검색해 존재하면 검색 1회로 `existing`을 반환한다.
  - 각 component의 folder를 먼저 확인하고 없을 때만 file conflict를 검색한다.
  - 확인된 folder ID를 다음 component의 `parentId`로 재사용한다.
  - absent component는 `createFolder`를 한 번만 호출한다.
  - 성공 응답의 `resourceId`를 다음 parent와 최종 결과에 사용한다.
  - create가 conflict, retryable API/network 오류 또는 invalid response로 끝나면 같은 exact path를
    `[0, 250, 1000, 2000]` elapsed schedule로 조회한다. folder를 찾으면 `existing`으로
    reconcile하고, file이면 conflict를 반환하며, 끝까지 absent면 원래 retryable 오류를 반환한다.
  - 이번 실행에서 201 응답으로 확인한 경로만 `createdPaths`에 넣는다. 따라서 다른 process가 만든
    폴더를 409/timeout 뒤에 발견한 경우 action은 `existing`이다.
- `src/remote/resolver.ts`
  - `resolveExact`, `resolveFolderExact`, `resolveFileExact`와 bounded polling 공통 helper를 추가했다.
  - folder가 발견되면 file 검색을 생략한다. Phase 00의 동일 이름/type conflict 계약에 근거한다.
  - 전체 nested resolve와 달리 `resolveExact`는 이미 확인된 parent component를 다시 검색하지
    않으므로 ensure-dir가 component 확인 결과를 메모리에서 재사용한다.
- `src/cli.ts`
  - `ensure-dir <remote-directory> [--json]` command를 등록했다.
  - JSON success envelope와 human-readable tabular output을 지원한다.
- `test/http/ensure-dir.test.ts`
  - existing, hierarchy creation, intermediate file conflict, 409 folder/file reconcile, timeout
    folder reconcile, timeout unknown state의 POST 비반복, root를 검증한다.
- `test/cli/ensure-dir.test.ts`
  - Unicode hierarchy JSON contract, root no-op, conflict exit code를 subprocess로 검증한다.
- `test/integration/ensure-dir.test.ts`
  - opt-in 실제 MYBOX acceptance test를 추가했다. `/myboxctl-integration-test/` 아래 unique
    Unicode hierarchy만 만들고, second invocation 및 exact resource cleanup을 검증한다.
- `src/mybox/rate-limit.ts`, `src/runtime.ts`
  - `/v1/search/` GET에 origin별 10회/분 sliding window를 적용한다.
  - 기본 state는 `${XDG_STATE_HOME}/myboxctl/rate-limit.json`이며 override는
    `MYBOX_RATE_LIMIT_STATE_PATH`다.
  - state에는 timestamp와 `blockedUntil`만 저장하며 query, body, PAT는 저장하지 않는다.
  - atomic directory lock, stale lock 복구, atomic rename으로 여러 process를 조정한다.
- `src/mybox/client.ts`, `src/errors.ts`, `src/output.ts`
  - 429와 network/5xx backoff를 분리했다.
  - `Retry-After` seconds/HTTP-date를 상한 없이 사용하고, 없으면 60초 + jitter를 사용한다.
  - GET 429는 한 번만 재시도하며 failure JSON에 optional `retryAfterMs`를 제공한다.
  - mutation은 generic retry하지 않는다.
- `package.json`, `test/integration/`
  - `test:integration`은 command acceptance, `test:contract`는 Phase 00 probe로 분리했다.
  - `test:upload-probe`는 100MiB streaming/interruption/resume 계약 전용 opt-in probe다.
  - direct integration helper와 실제 CLI process가 같은 rate-limit state를 사용한다.
- `test/integration/upload-contract.test.ts`
  - unique folder 아래 sparse 100MiB 파일을 file handle과 `ReadableStream`으로 전송한다.
  - 최초/재예약에 동일한 `resume`, `modifiedTime`, overwrite policy를 사용한다.
  - signed URL을 출력하지 않는 worker가 64MiB를 읽고 pause한 뒤 parent가 `SIGKILL`한다.
  - worker는 PAT를 상속하지 않으며, hard-kill 전 client buffer drain과 kill 후 storage settle에 각각
    2초를 둔다.
  - non-zero offset이면 기존 실측 `offset-end/total` Content-Range로 이어 올린다.
  - multipart `Content-Length`, `Filedata` part, offset, postcondition을 확인하며 PAT와 signed upload
    URL을 출력하지 않는다.
- `test/integration/upload-interrupt-worker.ts`
  - signed URL과 local file metadata를 transient environment로만 받아 multipart body를 전송한다.
  - 64MiB read를 IPC로 알린 뒤 pause하며, URL이나 오류 원문을 stdout/stderr에 기록하지 않는다.
- `docs/reference/cli-contract.md`
  - ensure-dir root의 `resourceId: null`과 reconcile 결과의 `existing` semantics를 기록했다.
- `README.md`, `docs/PROGRESS.md`
  - 현재 phase와 구현 상태를 갱신했다.

## ensure-dir 규칙

1. 입력은 기존 POSIX absolute remote path parser로 normalize한다.
2. `/`는 existing이며 create/search 요청을 하지 않는다.
3. non-root path는 최종 folder를 먼저 확인하고, 없으면 component별 folder/file search를 한다.
4. 이미 확인한 folder의 `resourceId`를 다음 create의 `parentId`로 전달한다. root 바로 아래
   component는 `parentId`를 body에 넣지 않는다.
5. 중간 component가 file이면 create하지 않고 conflict를 반환한다.
6. create 성공은 `createdPaths`에 기록한다.
7. create 실패 후 reconcile에서는 POST를 반복하지 않는다. 폴더를 찾으면 성공, file이면 conflict,
   absent면 원래 오류를 반환한다.
8. create/reconcile 후 최종 `resourceId`는 마지막 component의 folder ID다. root만 null이다.

## 검증

이번 수정에서 성공:

- `bun run check` — 89 pass, 12 opt-in skip, 0 fail
- upload HTTP/CLI 집중 테스트 — 11 pass, 0 fail
- `MYBOX_INTEGRATION=1 bun test test/integration/upload.test.ts` — 실제 MYBOX 1 pass, 0 fail;
  0-byte Unicode 신규 upload, 기본 conflict, explicit overwrite, exact cleanup 통과
- `bun run test:upload-probe` — 3 pass, 0 fail; 중단 후 `offset: 0`부터 production uploader로
  100MiB 완료, peak RSS 증가 23,609,344 bytes, postcondition 및 exact cleanup 통과
- `bun run build` — `dist/cli.js` 생성
- `git diff --check` — 통과

확인하지 않은 항목:

- 두 OS process가 같은 경로를 동시에 생성하는 실제 MYBOX probe는 실행하지 않았다. fake HTTP의
  409/timeout reconcile과 두 limiter instance의 공유 state 동작은 검증했다.
- Phase 00 contract probe는 이번 작업에서 다시 실행하지 않았다. 이미 완료된 probe를 acceptance와
  분리하는 것이 이번 변경의 목적이다.

PAT, Authorization header, upload URL은 테스트 출력이나 문서에 기록하지 않았다. 새 integration
test는 unique child의 file과 folder만 exact ID로 cleanup하며 prefix parent는 삭제하지 않는다.

## 남은 API 미확정 사항

Phase 00에서 기록한 다음 항목은 여전히 미확정이다.

- 비차단 자연 관찰: 실제 interruption 후 non-zero checkpoint
- 비차단 자연 관찰: API-08 동일 instant의 다른 `modifiedTime` literal 규칙
- 릴리스 비차단, 자연 관찰만 수행: 429 `Retry-After` live 형식
- 릴리스 비차단, 자연 관찰만 수행: 423 해제 및 retry 특성

다음 담당자는 upload probe를 반복하지 않는다. 같은 identity, 64MiB read, process hard-kill,
pre-kill drain, post-kill settle 뒤 offset 0이 재현됐고, production uploader의 100MiB 전체 재전송,
bounded-memory, postcondition, cleanup까지 확인했다. 다음 작업은 Phase 05 `put` 시작 여부를 결정하는
것이다.

upload의 parent/target/postcondition 검색에는 기존 공유 search limiter를 재사용한다. reservation과
content mutation에는 generic retry를 추가하지 않고 probe로 확인한 resume/reconcile만 사용한다.
Phase 05는 이 정책을 그대로 재사용하고, Phase 06은 같은 state/lock 구현에 delete 60회/분 bucket과
동일 resource ID 기반 429 reconcile을 추가한다. Phase 07에서 두 Bun process의 slot 공유, stale
lock, cooldown, `retryAfterMs`/exit 8을 검증한다. live 429/423을 만들기 위해 호출 한도나 lock을
고의로 유발하지 않는다.
