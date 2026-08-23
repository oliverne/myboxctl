# Progress

이 문서는 프로젝트 상태의 단일 기준이다. 추측이나 예정된 결과가 아니라 현재 checkout에서
확인된 사실만 기록한다.

## 현재 상태

- 현재 phase: `03-ensure-dir`
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
| 04 Upload           | pending  | 없음                                                                            | [`phases/04-upload.md`](phases/04-upload.md)               |
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

후속 phase 계획도 현재 rate-limit 및 probe 정책에 맞춰 갱신했다. Phase 04는 API-05 100MB
streaming, API-06 실제 interruption/non-zero resume와 resume 관련 API-08 `modifiedTime` 규칙을
targeted upload probe로 먼저 확정하며, 미확정이면 `blocked`다. Phase 05는 기존 search limiter와
upload mutation 정책을 재사용하고, Phase 06은 같은 공유 state에 delete 60회/분 bucket과 동일
resource ID 기반 429 reconcile을 추가한다. Phase 07은 교차 프로세스 state/lock/cooldown과 최종
429 `retryAfterMs`/exit 8 계약을 검증한다. broad `test:contract`는 계약 변경이나 ledger 모순이
있을 때만 다시 실행한다. 이 문서 갱신으로 phase 상태나 구현 상태가 바뀌지는 않았다.

## 상태 변경 규칙

- phase를 시작할 때만 `pending → in_progress`로 변경한다.
- 외부 권한이나 API 제약으로 진행할 수 없을 때 `blocked`와 구체적인 해제 조건을 기록한다.
- phase 문서의 모든 완료 조건과 검증이 충족된 경우에만 `complete`로 변경한다.
- 다음 phase를 시작하기 전 이전 phase의 handoff 결과가 `HANDOFF.md`에 있어야 한다.
