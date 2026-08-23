# Phase 03 — `ensure-dir`

## 목표

remote directory path의 누락된 component를 계층적으로 생성하고, 이미 존재할 때는 idempotent한
성공을 반환한다. 검색 API의 문서상 최저 한도 안에서 여러 CLI 프로세스가 함께 동작하도록 한다.

## 진입 조건

- Phase 02가 `complete`다.
- resolver의 생성 직후 가시성과 exact folder 판정 방식이 확정되어 있다.
- `docs/PROGRESS.md`의 Phase 03이 `in_progress`다.

## 구현 파일

```text
src/features/ensure-dir.ts
src/remote/resolver.ts
src/mybox/client.ts
src/mybox/rate-limit.ts
src/runtime.ts
src/errors.ts
test/http/ensure-dir.test.ts
test/cli/ensure-dir.test.ts
src/mybox/rate-limit.test.ts
```

## 테스트 우선 matrix

| 상황                            | 기대 결과                              |
| ------------------------------- | -------------------------------------- |
| `/a/b` 모두 존재                | `existing`, 생성 요청 0회              |
| `/a`만 존재                     | `/a/b` 생성, `created`                 |
| 모두 없음                       | parent부터 순차 생성                   |
| 중간 `/a`가 file                | conflict, 생성 요청 0회                |
| create가 409 후 folder 발견     | 동시 생성으로 reconcile 성공           |
| create가 409 후 file 발견       | conflict                               |
| create가 timeout 후 folder 발견 | 성공으로 reconcile                     |
| create가 timeout 후 상태 불명   | retryable API failure, POST 반복 없음  |
| path `/`                        | `existing`, 생성 요청 0회              |
| 최종 folder가 이미 존재         | folder 검색 1회로 `existing`           |
| 프로세스 합계 검색 11번째 요청  | 60초 sliding window의 빈 slot까지 대기 |
| GET 429 + `Retry-After`         | 지시한 시간 뒤 1회만 재시도            |
| GET 429 + header 없음           | 60초 + jitter 뒤 1회만 재시도          |

## 구현 절차

1. path component를 root부터 순회한다.
2. 최종 folder를 먼저 exact resolve하고, 존재하면 즉시 `existing`을 반환한다.
3. 각 component는 folder를 먼저 exact resolve한다.
4. folder면 다음 component로 진행한다.
5. folder가 없을 때만 같은 위치의 file을 검색하고, file이면 conflict를 반환한다.
6. 둘 다 없으면 현재 parentId로 `createFolder`를 한 번 호출한다.
7. 409 또는 응답 유실 가능 오류면 같은 exact path를 재조회한다.
8. created/reconciled folder ID를 다음 parent로 사용한다.

검색 요청은 `${XDG_STATE_HOME}/myboxctl/rate-limit.json`의 최근 요청 시각을 atomic lock 아래에서
공유한다. `XDG_STATE_HOME`이 없으면 플랫폼별 local state 기본 경로를 사용한다. bucket에는 PAT나
request/response body를 저장하지 않는다. 검색 기본 budget은 가장 낮은 요금제 기준 10회/분이다.
429가 발생하면 `Retry-After` 또는 보수적인 60초 fallback을 같은 bucket의 `blockedUntil`로
공유한다.

같은 명령 실행 중 확인한 component는 메모리에 유지한다. rate-limit 조정 상태 외에 path cache나
content state DB는 추가하지 않는다.

## CLI 결과

```bash
myboxctl ensure-dir /agents/reports/2026 --json
```

- 하나 이상 생성: `created`, `data.createdPaths`에 생성한 normalized path 순서
- 모두 존재: `existing`, 빈 `createdPaths`
- 결과의 resourceId는 최종 folder ID

## 검증

```bash
bun run check
bun run build
MYBOX_PAT=... bun run test:integration
```

integration test에서는 같은 path를 연속 두 번 호출해 두 번째가 `existing`인지 확인한다. 가능하면
두 process의 동시 호출도 unique child에서 검증한다.

## 완료 조건

- matrix의 모든 case가 fake server test로 고정되어 있다.
- mutation generic retry 없이 409/timeout reconcile이 동작한다.
- root와 Unicode folder integration test가 통과한다.
- test resource가 허용 prefix 밖에 생성되지 않는다.
- 여러 limiter instance가 같은 검색 window와 429 cooldown을 공유한다.
- Phase 00 contract probe는 `bun run test:contract`로 일반 acceptance와 분리되어 있다.

## Handoff

- create/reconcile algorithm과 bounded polling 값
- create response와 최종 resolved resource 차이
- 동시 호출 integration 결과
- 남은 test resource와 cleanup 상태
- check/build/integration 결과
- 검색 request 수와 rate-limit state/retry 결과
