# Progress

이 문서는 프로젝트 상태의 단일 기준이다. 추측이나 예정된 결과가 아니라 현재 checkout에서
확인된 사실만 기록한다.

## 현재 상태

- 현재 phase: `04-upload`
- 상태: `complete`
- 다음 담당자: 미정
- CLI 문서의 소비자는 특정 제품이 아닌 다양한 로컬 AI 에이전트로 정의한다.
- 마지막 갱신: 2026-08-23

## Phase 상태

| Phase               | 상태     | 완료 증거                                                                       | 문서                                                       |
| ------------------- | -------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 00 API contract     | complete | contract test 4회 성공, resolver/upload 결과 및 미확정 항목을 API ledger에 기록 | [`phases/00-api-contract.md`](phases/00-api-contract.md)   |
| 01 Foundation       | complete | config/error/output/client 및 fake HTTP test 통과, typecheck/lint/build 통과    | [`phases/01-foundation.md`](phases/01-foundation.md)       |
| 02 Read commands    | complete | path/resolver/stat/ls 구현, fake HTTP/subprocess 및 실제 MYBOX smoke 통과       | [`phases/02-read-commands.md`](phases/02-read-commands.md) |
| 03 Ensure directory | complete | ensure-dir, 공유 검색 limiter, fake/subprocess/실제 MYBOX acceptance 통과       | [`phases/03-ensure-dir.md`](phases/03-ensure-dir.md)       |
| 04 Upload           | complete | 실제 소형 acceptance와 100MiB bounded-memory resume 완료 전송 통과              | [`phases/04-upload.md`](phases/04-upload.md)               |
| 05 Put              | pending  | 없음                                                                            | [`phases/05-put.md`](phases/05-put.md)                     |
| 06 Delete           | pending  | 없음                                                                            | [`phases/06-delete.md`](phases/06-delete.md)               |
| 07 Hardening        | pending  | 없음                                                                            | [`phases/07-hardening.md`](phases/07-hardening.md)         |

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

## 상태 변경 규칙

- phase를 시작할 때만 `pending → in_progress`로 변경한다.
- 외부 권한이나 API 제약으로 진행할 수 없을 때 `blocked`와 구체적인 해제 조건을 기록한다.
- phase 문서의 모든 완료 조건과 검증이 충족된 경우에만 `complete`로 변경한다.
- 다음 phase를 시작하기 전 이전 phase의 handoff 결과가 `HANDOFF.md`에 있어야 한다.
