# Current handoff

## 요약

Phase 03 Ensure directory 구현을 완료했다. `ensure-dir`가 normalized remote path의 component를
root부터 순회하며 누락된 폴더를 parent ID와 함께 순차적으로 생성하고, 이미 존재하는 경로에는
idempotent 성공을 반환한다. create mutation은 generic retry하지 않으며, 409 또는 응답 유실 가능
오류 뒤에는 bounded exact resolve로 reconcile한다.

검색 API는 문서상 최저 한도인 10회/분 sliding window를 local state 파일과 atomic directory
lock으로 여러 CLI process에 공유한다. `Retry-After`가 없는 429는 60초 + jitter 뒤 GET을 한 번만
재시도한다. Phase 00 contract probe를 일반 acceptance에서 분리한 뒤 실제 MYBOX integration은
429 없이 생성, 두 번째 `existing`, cleanup까지 통과했다.

## 현재 phase와 상태

- Phase: `03-ensure-dir`
- 상태: `complete`
- `docs/PROGRESS.md`와 일치한다.
- 다음 phase: `04-upload`는 아직 `pending`이며 시작하지 않았다.

## 변경 파일

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
  - direct integration helper와 실제 CLI process가 같은 rate-limit state를 사용한다.
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

성공:

- `bun run check` — 76 pass, 6 integration skip, 0 fail
- `bun run build` — `dist/cli.js` 생성
- rate-limit/read/ensure-dir 집중 테스트 — 53 pass, 0 fail
- `bun run test:integration` — contract 3 skip, ensure-dir acceptance 1 pass, 0 fail
  - 전체 60.96초, acceptance body 2.05초
  - Unicode 계층 첫 호출 `created`, 두 번째 호출 `existing`, cleanup 완료

확인하지 않은 항목:

- 두 OS process가 같은 경로를 동시에 생성하는 실제 MYBOX probe는 실행하지 않았다. fake HTTP의
  409/timeout reconcile과 두 limiter instance의 공유 state 동작은 검증했다.
- Phase 00 contract probe는 이번 작업에서 다시 실행하지 않았다. 이미 완료된 probe를 acceptance와
  분리하는 것이 이번 변경의 목적이다.

PAT, Authorization header, upload URL은 테스트 출력이나 문서에 기록하지 않았다. 새 integration
test는 unique child path의 folder ID만 cleanup하며 prefix parent는 삭제하지 않는다.

## 남은 API 미확정 사항

Phase 00에서 기록한 다음 항목은 여전히 미확정이다.

- Phase 04 완료 차단: 100MB bounded-memory upload
- Phase 04 완료 차단: 실제 interruption 후 non-zero resume
- Phase 04 완료 차단: resume file identity에 필요한 API-08 `modifiedTime` literal/instant 규칙
- 릴리스 비차단, 자연 관찰만 수행: 429 `Retry-After` live 형식
- 릴리스 비차단, 자연 관찰만 수행: 423 해제 및 retry 특성

다음 담당자는 `docs/phases/04-upload.md`를 읽고 Phase 04를 시작할 때만 `pending → in_progress`로
변경한다. 먼저 broad `test:contract`가 아니라 opt-in `test:upload-probe`를 구현·실행하고
API-05/API-06과 resume 관련 API-08 결과를 API ledger에 기록한다. 셋 중 하나라도 재현되지 않으면
Phase 04를 `blocked`로 남기고 guessed fallback을 구현하지 않는다.

upload의 parent/target/postcondition 검색에는 기존 공유 search limiter를 재사용한다. reservation과
content mutation에는 generic retry를 추가하지 않고 probe로 확인한 resume/reconcile만 사용한다.
Phase 05는 이 정책을 그대로 재사용하고, Phase 06은 같은 state/lock 구현에 delete 60회/분 bucket과
동일 resource ID 기반 429 reconcile을 추가한다. Phase 07에서 두 Bun process의 slot 공유, stale
lock, cooldown, `retryAfterMs`/exit 8을 검증한다. live 429/423을 만들기 위해 호출 한도나 lock을
고의로 유발하지 않는다.
