# Phase 07 — Hardening and release readiness

## 상태

`complete`

## 목표

모든 명령의 cross-cutting failure path와 Ubuntu Server 24.04 운영 방식을 검증하고 MVP acceptance
flow를 완료한다.

## 진입 조건

- Phase 00~06이 모두 `complete`다.
- public CLI contract 변경이 동결되어 있다.
- `docs/PROGRESS.md`의 Phase 07이 `in_progress`다.

## 작업 패킷과 의존성

| 패킷 | 결과 | 주 소유 파일 | 의존성 | 검증 |
| --- | --- | --- | --- | --- |
| P07-A | 두 Bun process의 search/delete slot·cooldown 공유와 lock/state fail-closed 보장 | `src/mybox/rate-limit.ts`, 관련 worker/test | 없음 | 집중 Bun test, typecheck |
| P07-B | 모든 command의 final 429 JSON/exit/redaction 계약 고정 | `test/cli/hardening.test.ts` | 기존 CLI와 fake server | 집중 CLI test |
| P07-C | build artifact의 help/version/argument/output 실행 계약 고정 | `test/cli/release-contract.test.ts` | `bun run build` | build 후 artifact test |
| P07-D | Ubuntu Server 24.04 설치·credential·upgrade/rollback 운영 절차 | `README.md`, `docs/operations/` | P07-C의 실제 artifact 계약 | 문서 명령 수동 검증 |
| P07-E | unique prefix 전체 acceptance 1회, leak scan, 최종 release 판정 | progress/handoff와 기존 integration suite | P07-A~D | full check/build/integration |

P07-A~D는 공개 CLI/API 계약을 바꾸지 않는 범위에서 독립적으로 진행할 수 있다. P07-E는 앞선
패킷의 검증이 끝난 뒤에만 시작한다. 동일 파일을 수정하는 패킷은 직렬로 수행한다.

2026-08-24 순서 변경: Phase 08이 public type, rate-limit, upload preflight 계약을 수정하므로 사용자가
P07-E를 Phase 08 구현 이후의 최종 검증으로 이관하도록 승인했다. Phase 08 구현과 일반 CI 통과 후
사용자가 GitHub Actions의 `live_acceptance=true` flow 1회 성공을 확인했고, 이 실행을 충분한 최종
증거로 승인했다. 따라서 P07-E와 Phase 07을 완료한다.

## 제약과 에스컬레이션

- production의 search 10회/분, delete 60회/분 값과 환경 변수 계약은 변경하지 않는다.
- test-only timing/limit 주입은 constructor dependency로만 제공하며 production runtime에서 노출하지
  않는다.
- 새 dependency, public JSON schema, exit code, mutation retry, credential 저장 방식 변경은 계획
  재검토 대상으로 보고 구현을 중단한다.
- MYBOX PAT, Ubuntu 24.04 또는 Bun 1.4 실행 환경이 없으면 관련 검증을 성공으로 간주하지 않고
  `in_progress` 또는 `blocked` 증거로 남긴다.

## 작업 범위

### 1. 입력과 파일 edge case

- 0-byte, 1-byte, 100MB 이상 file
- 한글, emoji, 공백, `#`, `%`, `+`, leading dot
- 매우 긴 path/name의 API 오류 mapping
- symlink와 업로드 중 local 변경
- root folder와 empty folder
- duplicate/partial-match search result

### 2. 장애와 process behavior

- DNS/network failure
- timeout과 connection reset
- search/delete 429 + `Retry-After` seconds/HTTP-date/invalid/absent
- 500/502/503 retry exhaustion
- mutation response lost + reconcile
- SIGINT 중 list/upload/delete
- stdout JSON 1개, stderr 분리, deterministic exit code
- 어떤 실패에서도 token/signed URL 비노출

rate-limit hardening은 다음을 별도 test로 고정한다.

- search 10회/분과 delete 60회/분 sliding window
- 두 limiter instance의 slot/`blockedUntil` 공유
- 두 Bun child process가 같은 임시 state 파일과 atomic lock을 사용하는 동시 slot 예약
- 오래된 빈 lock directory 복구와 active lock timeout의 fail-closed 동작
- 손상된 state file의 `RATE_LIMIT_STATE_UNAVAILABLE`
- 최종 429 JSON의 `retryAfterMs`, exit 8, stdout/stderr 계약
- state/lock 파일에 PAT, query, request/response body가 없음

교차 프로세스 test helper에는 짧은 test-only window policy를 constructor dependency로 주입한다.
production runtime의 10/60회 기본값을 환경 변수로 낮추거나 우회하는 option은 추가하지 않는다.

### 3. CLI subprocess contract suite

모든 명령의 성공과 대표 실패를 `dist/cli.js`를 실행하여 검증한다. source import test만으로 release
준비를 판단하지 않는다.

검증 대상:

- `--help`, `--version`
- option/argument validation
- success/failure JSON schema
- human-readable output의 최소 유용성
- process exit code
- build artifact 실행 권한과 shebang

### 4. Ubuntu Server 운영 문서

README 또는 별도 how-to에 다음을 작성하고 Ubuntu 24.04 환경에서 검증한다.

- Bun 1.4 설치 전제
- `bun install --frozen-lockfile`
- build와 설치 경로
- `MYBOX_PAT` 환경 변수 또는 0600 credentials file
- AI 에이전트의 subprocess 호출 예시
- timeout/retry/exit code 운영 지침
- upgrade와 rollback 절차

MVP는 daemon/systemd service를 구현하지 않는다. AI 에이전트가 필요할 때 단발 CLI를 호출하는
방식을 사용한다.

### 5. Acceptance flow

unique integration prefix에서 `PLAN.md`의 전체 흐름을 실행하고, 성공 후 생성 리소스가 정리되어
후속 실행을 오염시키지 않는지 확인한다.

`test:integration`만 정기 acceptance에 포함한다. broad `test:contract`는 endpoint/schema/protocol이
바뀌었거나 API ledger와 모순되는 관찰이 있을 때만 별도로 실행한다. Phase 04 targeted upload
probe도 API-05/API-06과 resume 관련 API-08이 confirmed이고 protocol이 바뀌지 않았다면 다시
실행하지 않는다.

live `Retry-After`는 자연 발생할 때만 sanitized 형식을 기록한다. 실제 header를 관찰하지 못해도
seconds/HTTP-date/invalid/absent fake-response test와 보수적 fallback이 통과하면 release를 막지
않는다. 429를 확인하려고 의도적으로 호출 한도를 소진하지 않는다.

## 검증

2026-08-24 사용자가 PR #4 branch의 GitHub Actions `live_acceptance=true` 실행 1회 성공을 확인했고,
이를 최종 live acceptance와 cleanup 증거로 승인했다. 일반 CI의 check/build/diff 검증과 함께
P07-E 완료 조건을 충족한다.

```bash
bun install --frozen-lockfile
bun run check
bun run build
MYBOX_PAT=... bun run test:integration
```

Ubuntu 24.04 검증이 현재 환경에서 불가능하면 macOS 결과로 대체해 완료 처리하지 않는다.
`blocked` 또는 명시적 미검증 상태로 남긴다.

## 완료 조건

- 전체 unit/HTTP/CLI/integration suite가 통과한다.
- build artifact에서 모든 command가 실행된다.
- Ubuntu Server 24.04 설치/실행 증거가 있다.
- 100MB 이상 upload의 bounded memory 증거가 있다.
- acceptance flow가 1회 통과하고 unique prefix cleanup이 확인된다.
- search/delete limiter의 교차 프로세스 state, stale lock, 429 cooldown test가 통과한다.
- 모든 command의 최종 429가 `retryAfterMs`와 exit 8 계약을 지킨다.
- credential leak scan과 Git diff 검사가 통과한다.
- README가 실제 설치/운영 절차와 일치한다.
- `docs/PROGRESS.md`의 모든 phase가 `complete`다.

## 최종 Handoff

`docs/HANDOFF.md`에 다음을 남긴다.

- release 가능한 build/install 명령
- 전체 검증 명령과 환경, 결과
- 실제 acceptance prefix와 cleanup 상태
- 알려진 제한과 metadata 비교 한계
- 실행한 targeted/broad probe와 다시 실행하지 않은 probe의 근거
- search/delete bucket과 state/lock 운영 정보
- 운영자가 알아야 할 retry/exit code
- MVP 이후 후보와 명시적으로 제외된 기능
