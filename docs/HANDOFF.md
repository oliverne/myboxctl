# Current handoff

## 요약

Phase 03 Ensure directory, Phase 04 Upload, Phase 05 Put, Phase 06 Delete를 완료했다. `upload`는 같은 file handle의
`fstat` 결과를 기준으로 multipart body를 streaming하며, retryable content failure 뒤 서버 offset을
기준으로 정확히 한 번 복구한다. 실제 probe에서 관찰된 `offset: 0`은 전체 파일 재전송으로 처리하고,
향후 non-zero가 반환되면 해당 지점부터 남은 byte만 보낸다.

검색 API는 문서상 최저 한도인 10회/분 sliding window를 local state 파일과 atomic directory
lock으로 여러 CLI process에 공유한다. `Retry-After`가 없는 429는 60초 + jitter 뒤 GET을 한 번만
재시도한다. Phase 00 contract probe를 일반 acceptance에서 분리한 뒤 실제 MYBOX integration은
429 없이 생성, 두 번째 `existing`, cleanup까지 통과했다.

## 현재 phase와 상태

- Phase: `08-official-api-alignment`
- 상태: `complete`
- `docs/PROGRESS.md`와 일치한다.
- 수정된 probe를 실제 MYBOX에서 실행했다. 동일 resume identity로 64MiB를 읽은 뒤 in-process stream
  error, 즉시 worker `SIGKILL`, 2초 client-buffer drain 뒤 worker `SIGKILL`을 각각 시도했지만 모두
  resume reservation이 `201 / offset: 0`을 반환했다.
- 각 실행 후 `/myboxctl-integration-test/`를 조회해 잔여 리소스가 없음을 확인했다.
- 사용자가 server-returned offset 0부터 전체 파일을 한 번 재전송하는 정책을 승인했다.
- production command의 실제 MYBOX acceptance와 100MiB bounded-memory 완료 전송이 통과했다.
- Phase 05의 decision/command/integration flow와 Phase 06의 delete matrix/live acceptance가 통과했다.
- Phase 07의 limiter/CLI artifact/Ubuntu 운영 문서와 P07-A~D 검증은 Ubuntu 24.04/Bun 1.4.0 CI에서
  통과했다. P07-E는 Phase 08 종료 검증으로 이관했다.
- GitHub Actions의 `live_acceptance=true` 실행 1회가 성공했다고 사용자가 확인했으며, 이를 충분한
  최종 acceptance와 cleanup 증거로 승인했다.
- 일반 CI의 credential redaction/diff 검사와 live acceptance를 근거로 Phase 07/08을 완료했다.
- Phase 08의 search type 분리, operation별 60회/분 limiter, storage schema/cache,
  `maxFileBytes` preflight를 구현했다.
- PR #4 CI에서 Ubuntu 24.04/Bun 1.4.0, 138 pass/21 skip/0 fail과 build/diff check가
  통과했다.

## 변경 파일

- `src/features/delete.ts`, `src/mybox/client.ts`, `src/cli.ts`
  - `delete <remote-path> [--strict] [--json]` vertical slice와 단일 DELETE transport를 추가했다.
  - timeout/5xx/429 뒤 resolve 당시 ID만 조회하고 429에서 같은 ID로 한 번만 재시도한다.
  - 기본 absent/DELETE 404는 `already-absent`, strict는 not-found이며 root는 API 전에 거부한다.
- `src/mybox/rate-limit.ts`, `src/mybox/rate-limit.test.ts`
  - search와 분리된 origin별 delete 60회/분 bucket을 같은 state/atomic lock에 추가했다.
  - 두 limiter instance의 slot, 429 cooldown, search/delete 독립성을 검증한다.
- `test/http/delete.test.ts`, `test/cli/delete.test.ts`
  - idempotent/strict/root, 204/404, timeout/5xx/429 reconcile, same-ID retry 1회 상한과 JSON 계약을
    검증한다.
- `test/integration/delete.test.ts`
  - unique file과 non-empty folder의 204, 같은 ID 재삭제 404, default/strict 및 active cleanup을
    검증한다.
- `docs/reference/mybox-api.md`, `docs/reference/cli-contract.md`, `docs/architecture/reliability.md`
  - 실제 delete 관찰, public data shape, ID 기반 retry와 delete bucket을 기록했다.

- `src/features/put/decision.ts`, `src/features/put/decision.test.ts`
  - 2초 mtime tolerance를 사용하는 I/O 없는 decision table을 구현했다.
  - force, absent, folder, remote-newer, size-different, local-newer, current와 경계 ±1ms를 검증한다.
- `src/features/put/command.ts`, `src/cli.ts`
  - `put <local-path> <remote-path> [--force] [--mkdir] [--json]` vertical slice를 추가했다.
  - skip/conflict는 mutation 없이 반환하고 upload/overwrite는 Phase 04 `runUpload`를 재사용한다.
  - remote-newer는 `REMOTE_NEWER`, folder conflict는 `REMOTE_TYPE_CONFLICT` code를 반환한다.
- `test/http/put.test.ts`, `test/cli/put.test.ts`
  - skip/conflict POST 0회, absent upload, force overwrite와 JSON reason/code를 검증한다.
- `test/integration/put.test.ts`
  - unique prefix에서 uploaded, skipped, size overwrite, remote-newer conflict, force overwrite,
    missing parent와 `--mkdir`, exact cleanup을 검증한다.
- `README.md`, `docs/reference/cli-contract.md`
  - 같은 size와 2초 이내 mtime의 다른 content가 skip될 수 있는 metadata 비교 한계와 public
    reason/conflict code를 기록했다.

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
- Phase 05 decision/HTTP/CLI 집중 테스트 — 18 pass, 0 fail
- Phase 05 실제 MYBOX 단독 acceptance — 1 pass, 0 fail, exact cleanup 통과
- `bun run test:integration` — 5 pass, 6 opt-in skip, 0 fail, 모든 unique resource cleanup 통과
- Phase 05 포함 `bun run check` — 107 pass, 15 opt-in skip, 0 fail
- Phase 06 limiter/HTTP/CLI 집중 테스트 — 21 pass, 0 fail
- Phase 06 실제 MYBOX 단독 acceptance — 1 pass, 0 fail; file/non-empty-folder 204와 same-ID 404 확인
- Phase 06 포함 `bun run test:integration` — 6 pass, 6 opt-in skip, 0 fail
- Phase 06 포함 `bun run check` — 121 pass, 18 opt-in skip, 0 fail

확인하지 않은 항목:

- 두 OS process가 같은 경로를 동시에 생성하는 실제 MYBOX probe는 실행하지 않았다. fake HTTP의
  409/timeout reconcile과 두 limiter instance의 공유 state 동작은 검증했다.
- Phase 00 contract probe는 이번 작업에서 다시 실행하지 않았다. 이미 완료된 probe를 acceptance와
  분리하는 것이 이번 변경의 목적이다.

PAT, Authorization header, upload URL은 테스트 출력이나 문서에 기록하지 않았다. 새 integration
test는 unique child의 file과 folder만 exact ID로 cleanup하며 prefix parent는 삭제하지 않는다.
Phase 06 delete acceptance가 만든 `delete-<timestamp>-<suffix>` 계열 리소스는 API 의미대로 MYBOX
휴지통에 남아 있으며 복원하거나 영구 삭제하지 않았다. active `/myboxctl-integration-test/` child는
정리됐다.

## 남은 API 미확정 사항

Phase 00에서 기록한 다음 항목은 여전히 미확정이다.

- 비차단 자연 관찰: 실제 interruption 후 non-zero checkpoint
- 비차단 자연 관찰: API-08 동일 instant의 다른 `modifiedTime` literal 규칙
- 릴리스 비차단, 자연 관찰만 수행: 429 `Retry-After` live 형식
- 릴리스 비차단, 자연 관찰만 수행: 423 해제 및 retry 특성

다음 담당자는 upload probe, 완료된 command acceptance나 Phase 07 집중 테스트를 반복하지 않는다.
같은 identity, 64MiB read, process hard-kill, pre-kill drain, post-kill settle 뒤 offset 0이 재현됐고,
production uploader의 100MiB 전체 재전송, bounded-memory, postcondition, cleanup까지 확인했다.
Phase 05 metadata policy, Phase 06 delete, Phase 07 집중 테스트와 Ubuntu 24.04 일반 CI도 확인했다.
Phase 08 이후 실제 MYBOX acceptance 1회와 cleanup도 통과했다. MVP 구현 phase의 필수 검증은
완료됐으며, 다음 작업은 별도의 릴리스 여부 결정 또는 실제 요구에 따른 후속 phase 정의다.

upload의 parent/target/postcondition 검색에는 기존 공유 search limiter를 재사용한다. reservation과
content mutation에는 generic retry를 추가하지 않고 probe로 확인한 resume/reconcile만 사용한다.
Phase 05는 이 정책을 그대로 재사용하고, Phase 06은 같은 state/lock 구현에 delete 60회/분 bucket과
동일 resource ID 기반 429 reconcile을 추가한다. Phase 07에서 두 Bun process의 slot 공유, stale
lock, cooldown, `retryAfterMs`/exit 8을 검증한다. live 429/423을 만들기 위해 호출 한도나 lock을
고의로 유발하지 않는다.

## Phase 07 구현 및 검증 상태

- 구현: test-only limiter policy, 두 Bun process slot/cooldown worker test, stale/active lock과 손상
  state fail-closed test
- 구현: 모든 command의 final 429 JSON/exit/redaction subprocess test
- 구현: build artifact shebang/help/version/invalid-argument test와 `test:release` script
- 구현: symbolic-link regular-file handle 정책 test/reference
- 문서: Ubuntu Server 24.04 설치, credentials, agent 호출, upgrade/rollback
- CI: `.github/workflows/ci.yml`에서 Ubuntu 24.04/Bun 1.4.0 frozen install, check, build
- 검증: PR #1 CI run 3, Ubuntu 24.04/Bun 1.4.0 — frozen install, typecheck, Biome, build,
  131 pass/18 opt-in skip/0 fail
- 검증: PR #4 CI, Ubuntu 24.04/Bun 1.4.0 — Phase 08 포함 frozen install, typecheck,
  Biome, build, 138 pass/21 opt-in skip/0 fail, diff check 통과
- 검증: PR #4 branch의 GitHub Actions `live_acceptance=true` 실행 1회 성공 — 사용자 확인,
  integration suite의 unique prefix cleanup 포함

Phase 07의 P07-E와 Phase 08 contract correction 검증을 완료했다. 사용자는 live acceptance 1회를
충분한 최종 증거로 승인했고, 일반 CI의 credential redaction/diff 검사까지 근거로 Phase 07/08을
함께 종료했다. 다음 bounded action은 별도 릴리스 결정 또는 실제 요구가 확인된 후속 phase 정의다.
