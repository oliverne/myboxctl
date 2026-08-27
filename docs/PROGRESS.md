# Progress

이 문서는 프로젝트 상태의 단일 기준이다. 추측이나 예정된 결과가 아니라 현재 checkout에서
확인된 사실만 기록한다.

## 현재 상태

- 현재 phase: `09-download`
- 상태: `in_progress`
- 릴리스 상태: `보류`
- 활성 구현 phase: `09-download`
- 다음 담당자: Phase 09 구현 담당자
- CLI 문서의 소비자는 특정 제품이 아닌 다양한 로컬 AI 에이전트로 정의한다.
- 마지막 갱신: 2026-08-27

## Phase 상태

| Phase                     | 상태        | 완료 증거                                                                       | 문서                                                                         |
| ------------------------- | ----------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 00 API contract           | complete    | contract test 4회 성공, resolver/upload 결과 및 미확정 항목을 API ledger에 기록 | [`phases/00-api-contract.md`](phases/00-api-contract.md)                     |
| 01 Foundation             | complete    | config/error/output/client 및 fake HTTP test 통과, typecheck/lint/build 통과    | [`phases/01-foundation.md`](phases/01-foundation.md)                         |
| 02 Read commands          | complete    | path/resolver/stat/ls 구현, fake HTTP/subprocess 및 실제 MYBOX smoke 통과       | [`phases/02-read-commands.md`](phases/02-read-commands.md)                   |
| 03 Ensure directory       | complete    | ensure-dir, 공유 검색 limiter, fake/subprocess/실제 MYBOX acceptance 통과       | [`phases/03-ensure-dir.md`](phases/03-ensure-dir.md)                         |
| 04 Upload                 | complete    | 실제 소형 acceptance와 100MiB bounded-memory resume 완료 전송 통과              | [`phases/04-upload.md`](phases/04-upload.md)                                 |
| 05 Put                    | complete    | 순수 decision, CLI/fake HTTP, 실제 metadata policy flow 및 cleanup 통과         | [`phases/05-put.md`](phases/05-put.md)                                       |
| 06 Delete                 | complete    | file/non-empty-folder 실제 삭제, ID reconcile, limiter 및 cleanup 통과          | [`phases/06-delete.md`](phases/06-delete.md)                                 |
| 07 Hardening              | complete    | P07-A~D CI 및 통합 P07-E live acceptance 1회와 cleanup 확인                     | [`phases/07-hardening.md`](phases/07-hardening.md)                           |
| 08 Official API alignment | complete    | 공식 API correction, 일반 CI와 실제 MYBOX acceptance 통과                       | [`phases/08-official-api-alignment.md`](phases/08-official-api-alignment.md) |
| 09 Download               | in_progress | P09-A targeted download probe 구현 중                                           | [`phases/09-download.md`](phases/09-download.md)                             |

## 초기화 상태

- [x] Git 저장소 초기화
- [x] Bun 1.4 package/tooling 정의
- [x] TypeScript CLI smoke scaffold
- [x] 프로젝트용 `AGENTS.md`
- [x] phase/reference/architecture 문서 구조
- [x] `bun install` 및 `bun.lock` 생성
- [x] `bun run check` — typecheck, Biome, Bun test 통과
- [x] `bun run build` — `dist/cli.js` 생성 및 help 실행 확인

Phase 00 integration test를 구현하고 4회 성공시켰다. PAT 인증과 전용 `/myboxctl-integration-test/`
prefix 존재를 확인했으며, resolver/upload 계약 및 미확정 항목을
`docs/reference/mybox-api.md`에 기록했다.

Phase 01 Foundation을 완료했다. config/PAT 보호, domain error와 exit code, JSON envelope/redaction,
Zod 기반 API contract, GET 전용 retry/pagination transport, ephemeral fake HTTP server와 관련
테스트를 추가했다.

Phase 02 Read commands를 완료했다. POSIX remote path parser, exact search resolver, 공식 direct-child
listing client, `stat`/`ls`와 JSON/human output을 추가했다. fake HTTP 및 subprocess test에서
pagination, exact filtering, type conflict, absent 결과, deterministic ordering을 검증했고, 실제
MYBOX의 root/nested/Unicode smoke와 opt-in integration contract test를 통과시켰다.

Phase 03 Ensure directory를 완료했다. 누락된 remote folder component를 root부터 순차적으로
생성하고, 409/응답 유실 가능 오류 뒤에는 exact resolve로 reconcile하며 mutation POST를 반복하지
않는다. 최종 folder가 이미 존재하면 검색 1회로 반환하고, folder가 없을 때만 file conflict를
검색한다.

검색 GET은 local state의 10회/분 sliding window를 atomic lock으로 공유한다. 429는
`Retry-After`를 우선하고 header가 없으면 60초 + jitter를 사용하며 GET을 한 번만 재시도한다.
Phase 00 contract probe는 `test:contract`, command acceptance는 `test:integration`으로 분리했다.
`bun run check`는 76 pass, 6 integration skip, 0 fail이었고 build와 실제 MYBOX ensure-dir
acceptance도 통과했다. 실제 integration은 contract 3 skip, acceptance 1 pass였으며 unique test
resource cleanup까지 완료됐다.

후속 리뷰에서 Commander argument 오류도 JSON failure envelope와 exit 2를 사용하도록 보강했고,
공식 검색 계약의 optional `resources`/`responseMetaData` 누락을 빈 검색 결과로 정규화했다.

후속 phase 계획도 현재 rate-limit 및 probe 정책에 맞춰 갱신했다. 당시 Phase 04는 API-05 100MB
streaming, API-06 실제 interruption/non-zero resume와 resume 관련 API-08 `modifiedTime` 규칙을
targeted upload probe로 먼저 확정하고, 미확정이면 `blocked`로 두도록 계획했다. 이후 실제 probe와
사용자 정책 결정에 따라 server offset 0도 유효한 복구 지점으로 변경했다. Phase 05는 기존 search
limiter와 upload mutation 정책을 재사용하고, Phase 06은 같은 공유 state에 delete 60회/분 bucket과
동일 resource ID 기반 429 reconcile을 추가한다. Phase 07은 교차 프로세스 state/lock/cooldown과
최종 429 `retryAfterMs`/exit 8 계약을 검증한다. broad `test:contract`는 계약 변경이나 ledger
모순이 있을 때만 다시 실행한다.

최초 Phase 04 targeted probe는 unique integration folder에서 100MiB streaming multipart를
중단한 뒤 재예약했지만 `offset: 0`을 반환했다. 후속 리뷰에서 이 실행은 임의의 fetch 오류도 중단
성공으로 취급하고, 최초 reservation에 resume identity를 넣지 않았으며, 8MiB body read 직후
settle delay 없이 재예약한 것으로 확인됐다. 따라서 이 결과는 non-zero resume 미확정 증거일 뿐,
MYBOX resume 불가의 증거로 사용하지 않는다.

probe를 수정하고 실제 MYBOX에서 세 조건을 실행했다. 최초/재예약 모두 같은 `resume: true`,
`modifiedTime`, `isOverwrite`를 사용하고 64MiB read 뒤 2초 settle delay를 적용했다. in-process
stream error, read 직후 worker `SIGKILL`, 2초간 client buffer drain 뒤 worker `SIGKILL` 모두 resume
reservation이 `201 / offset: 0`을 반환했다. 각 실행 후 `/myboxctl-integration-test/` 목록이 빈 것도
확인했다.

따라서 현재 확인된 계약은 중단 후 resume reservation은 성공하지만 서버가 non-zero checkpoint를
제공하지 않는다는 것이다. 사용자가 server-returned `offset: 0`부터 전체 파일을 다시 보내는
recovery를 승인해 Phase 04를 `in_progress`로 재개했다.

production `upload` command와 file-handle 기반 multipart streaming을 추가했다. 최초 예약부터
`resume: true`와 같은 `modifiedTime`을 사용하며, retryable content failure 뒤 동일 identity로
예약을 정확히 한 번 재발급한다. 서버 offset 0은 전체 파일, non-zero는 남은 byte만 전송하고 두
번째 실패 뒤에는 세 번째 시도를 하지 않는다. 0-byte, non-zero range, restart-from-zero,
overwrite opt-in, `--mkdir`, local-file-changed, JSON subprocess 계약을 fake HTTP test로 고정했다.
실제 MYBOX용 0-byte Unicode 신규 upload, conflict, overwrite acceptance도 격리 prefix cleanup과 함께
추가했다. `MYBOX_INTEGRATION=1 bun test test/integration/upload.test.ts`를 실행해 1 pass, 0 fail을
확인했고 exact file/folder cleanup도 오류 없이 완료됐다.

승인된 offset 0 복구 정책을 반영한 뒤 `bun run test:upload-probe`를 다시 실행했다. 64MiB read 후
hard-kill한 최초 전송의 재예약은 `offset: 0`을 반환했고, production `MyboxUploader`가 100MiB 전체를
재전송해 postcondition을 만족했다. peak RSS 증가는 23,609,344 bytes로 파일 크기 104,857,600
bytes의 절반 미만이었으며 unique file/folder cleanup도 통과했다. Phase 04 완료 조건을 모두 충족해
상태를 `complete`로 변경했다.

Phase 05 Put을 완료했다. I/O 없는 decision 함수에 2초 mtime tolerance와 force/type/absent/file
우선순위를 고정했고 table-driven unit test 12개가 통과했다. command는 exact remote detail을 읽어
`uploaded`, `overwritten`, `skipped`를 반환하며 remote-newer와 folder conflict에서는 mutation을
수행하지 않는다. upload/overwrite는 Phase 04 `runUpload`를 재사용해 resume, postcondition,
`--mkdir`, 공유 search limiter 정책을 그대로 유지한다.

fake HTTP와 subprocess에서 skip/conflict POST 0회, absent upload, force overwrite, stable JSON reason과
conflict code를 확인했다. 실제 MYBOX 단독 put acceptance는 1 pass, 0 fail이었고, 전체
`bun run test:integration`은 5 pass, 6 opt-in skip, 0 fail로 완료됐다. unique 경로에서
uploaded → skipped → size-different overwrite → remote-newer conflict → force overwrite와 missing
parent → `--mkdir`를 검증하고 file/folder cleanup을 완료했다. `bun run check`는 107 pass, 15 skip,
0 fail이었고 build와 diff check도 통과했다.

Phase 06 Delete를 완료했다. 기본 absent는 `already-absent`, `--strict`는 not-found/exit 4이며 root는
API 호출 전에 거부한다. DELETE timeout/5xx/429 뒤에는 resolve 당시 resource ID만 조회한다. ID가
사라졌으면 삭제 성공으로 reconcile하고, 남아 있으면 429에만 같은 ID로 한 번 재시도한다. timeout/5xx는
DELETE를 반복하지 않으며 path에 새 ID가 나타나도 삭제 대상으로 바꾸지 않는다.

origin별 delete bucket을 기존 shared state/lock에 60회/분으로 추가했다. 두 limiter instance의 slot과
429 cooldown 공유, search bucket 분리를 fake clock으로 검증했다. 실제 MYBOX에서 file과 non-empty
folder DELETE가 204, 같은 ID 재삭제가 404임을 확인했다. 단독 acceptance는 1 pass, 전체
`bun run test:integration`은 6 pass, 6 opt-in skip, 0 fail이었다. active integration prefix cleanup은
완료됐고 unique test resources는 MYBOX 삭제 의미에 따라 휴지통에 남는다. `bun run check`는 121
pass, 18 skip, 0 fail이었고 build와 diff check도 통과했다.

Phase 07 Hardening을 시작했다. `SharedRateLimiter`에 production 기본값을 바꾸지 않는 test-only policy
주입을 추가하고, 두 Bun child process의 search slot 및 429 cooldown 공유, stale lock 복구, active
lock timeout fail-closed, malformed state fail-closed, state 비밀정보 비저장 테스트를 작성했다. 모든
command의 최종 429 JSON 한 줄/exit 8/`retryAfterMs`/redaction 계약과 build artifact의
shebang/help/version/argument 오류 계약도 subprocess test로 추가했다. symbolic link는 명령 시작 시
연 regular-file handle을 사용하며 경로를 다시 resolve하지 않는 정책을 test/reference에 고정했다.

Ubuntu Server 24.04의 frozen install, 0600 credentials, AI agent subprocess, retry/exit code,
upgrade/rollback 문서를 추가했다. 최초 작성 환경에는 Bun, Biome, TypeScript compiler와 MYBOX PAT가
없어 새 테스트, `bun run check`, `bun run build`, integration과 Ubuntu 실환경 절차를 실행하지
못했으며, 당시에는 Phase 07을 `in_progress`로 유지했다. 이후 Ubuntu 24.04/Bun 1.4 GitHub Actions
CI와 opt-in live acceptance로 필요한 증거를 보완했다.

GitHub Actions CI를 추가해 `ubuntu-24.04`와 Bun 1.4.0에서 frozen install, check, build를 실행한다.
CI에는 secret을 전달하지 않으며 MYBOX integration은 opt-in 상태로 유지한다. workflow run 결과는
원격 반영 후 확인해 Phase 07 검증 증거에 추가한다.

PR #1의 GitHub Actions CI run 3에서 Ubuntu 24.04/Bun 1.4.0 검증이 통과했다. frozen install,
typecheck, Biome, build artifact와 전체 test가 성공했으며 결과는 131 pass, 18 opt-in skip, 0 fail이다.
별도 build step도 104 modules bundle에 성공했다. 당시 Phase 07의 남은 필수 검증은 실제 MYBOX
acceptance와 credential leak/diff 최종 검사였다.

2026-08-24 공식 MYBOX Open API 문서를 전수 조사하고 현재 `MyboxClient`와 대조했다. 조사
시점에는 공식 20개 operation 중 8개를 사용했고 12개는 비범위 후보였다. 이후 Phase 08에서
`GET /v1/drive/storage`를 추가해 현재 coverage는 9/20이며, 나머지 11개는 사용 사례가 생길 때만
검토한다. 조사 결과와 분류는 `docs/reference/official-api-audit.md`에 기록했다.

사용자는 P07-E live acceptance를 Phase 08 breaking correction 이후로 이관하도록 승인했다. 이
전환에 한해 Phase 07과 Phase 08을 함께 `in_progress`로 두었고, Phase 08에서는 storage preflight,
현재 사용 operation별 limiter와 file/folder search type 분리를 production code와 테스트에 반영했다.
구현과 일반 CI 통과 후 사용자는 `live_acceptance=true` 실행 1회 성공을 충분한 최종 증거로 승인했다.

## Phase 08 구현 및 일반 CI 검증

Phase 08의 contract correction을 구현했다.

- `SearchOptions`를 `FileSearchOptions`와 `FolderSearchOptions`로 교체하고 file search의
  undocumented `path` 직렬화를 제거했다.
- storage/root list/folder list/resource detail/folder create/upload reservation에 operation별 독립
  60회/분 shared bucket을 추가했다.
- 공식 storage response schema와 process-local 5분 cache를 추가했다.
- upload와 mutation이 필요한 put은 `maxFileBytes` 초과를 reservation 전에 `FILE_TOO_LARGE`로
  거부한다. quota 부족은 서버 507을 따른다.
- PR #4 CI에서 Ubuntu 24.04/Bun 1.4.0 frozen install, typecheck, Biome, build,
  138 pass/21 opt-in skip/0 fail, diff check가 통과했다.

2026-08-24 GitHub Actions의 `live_acceptance=true` 실행 1회가 성공했다고 사용자가 확인했다. 해당
integration suite의 unique prefix cleanup과 일반 CI의 credential redaction/diff 검사를 최종 증거로
채택해 Phase 07과 Phase 08을 모두 `complete`로 변경했다.

## Phase 07/08 검증 순서 결정

2026-08-24 사용자는 Phase 08의 breaking refactor 전에 Phase 07 live acceptance를 실행하지 않고 최종
검증으로 통합하도록 승인했다. 이후 일반 CI와 통합 live acceptance 1회가 성공했고, 사용자는 1회를
충분한 최종 기준으로 승인했다. unique prefix cleanup, credential redaction과 diff 검증을 포함한
증거를 근거로 두 phase를 완료 처리했다.

## 릴리스 결정

2026-08-24 사용자는 현재 MVP의 공개 릴리스를 보류했다. Phase 00~08의 완료 상태와 기존 검증 증거는
유지하며, 릴리스 작업이나 새 구현을 자동으로 시작하지 않는다. 다음 작업은 실제 요구사항이 확정된 뒤
별도 phase로 정의한다.

## Phase 09 계획

2026-08-27 사용자는 미구현 공식 API 중 download를 다음 phase로 선택하고 계획 문서 저장을 요청했다.
[`phases/09-download.md`](phases/09-download.md)에 contract-first probe, local no-clobber/atomic commit,
bounded-memory streaming, secret redaction, fake/CLI/실제 MYBOX 및 세 운영체제 검증 조건을 기록했다.

Phase 09 구현을 시작했다. 현재 P09-A targeted download probe와 opt-in CI 실행 경로를 작성 중이며
실제 MYBOX 결과가 확인되기 전에는 signed content transport의 production 계약을 고정하지 않는다.
기존 공개 릴리스 보류 결정은 유지한다. rename, move, copy, favorite와 휴지통 관리 기능은 계속
미선택 후보로 남긴다.

## 상태 변경 규칙

- phase를 시작할 때만 `pending → in_progress`로 변경한다.
- 외부 권한이나 API 제약으로 진행할 수 없을 때 `blocked`와 구체적인 해제 조건을 기록한다.
- phase 문서의 모든 완료 조건과 검증이 충족된 경우에만 `complete`로 변경한다.
- 다음 phase를 시작하기 전 이전 phase의 handoff 결과가 `HANDOFF.md`에 있어야 한다.
