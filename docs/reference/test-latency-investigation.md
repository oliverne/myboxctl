# Integration 테스트 지연·관측성 조사

> 상태: 조사 중 — 지연 현상은 재현됐지만 원인은 미확증
> 관련 phase: [`../phases/13-observability-and-test-latency.md`](../phases/13-observability-and-test-latency.md)
> Human UI: [`human-cli-ui-investigation.md`](human-cli-ui-investigation.md)
> 작성일: 2026-08-29

## 요약

실제 MYBOX PAT로 integration test를 실행했을 때 개별 API 호출은 0.2~0.4초였지만 일부 command
acceptance에는 약 60초 단위의 긴 구간이 반복됐다. 현재 코드에는 local rate limiter 대기, 서버 429
retry와 integration polling을 서로 구분해 보여주는 event가 없어 wall time만으로 원인을 확정할 수
없다.

Phase 13은 먼저 각 대기 경로에 구조화 event를 추가해 원인을 구분한다. 그 결과를 바탕으로 GET 429
자동 retry를 유지할지, local bucket을 조정할지, 일정 조건에서 fail-fast할지를 결정한다. 같은 event
boundary로 upload/put 진행 상태도 사람과 AI 에이전트에 제공한다.

## 측정 증거

| 측정 대상                          | 조건                  | 소요                           |
| ---------------------------------- | --------------------- | ------------------------------ |
| `bun run src/cli.ts --version`     | 기동 기준선           | 0.03s                          |
| `stat /myboxctl-integration-test`  | read                  | 0.45s                          |
| `listRoot` 직접 client 호출        | 단일 호출             | 318ms                          |
| `listFolder`                       | 단일 호출             | 301ms                          |
| `searchFolders({path})`            | 단일 호출             | 207ms                          |
| `createFolder` (`noParent`)        | 단일 호출             | 204ms                          |
| `createFolder` (`parent`)          | 단일 호출             | 308ms                          |
| `deleteResource`                   | 단일 호출             | 305~410ms                      |
| `ensure-dir` CLI 직접 실행         | limiter 진단 설정 OFF | 66.96s (`action: created`)     |
| `ensure-dir` acceptance            | limiter 진단 설정 OFF | 약 127s (pass)                 |
| `ensure-dir` acceptance            | production limiter ON | 약 121s (pass)                 |
| `delete` acceptance                | production limiter ON | 약 244s (pass)                 |
| storage `GET` 직접 호출            | 단일 호출             | 207ms (200)                    |
| 잘못된 search query 12회 연속 호출 | 모두 404              | 429 미관찰, 한도 증거로 부적합 |

개별 호출 시간과 command wall time 사이에 약 60초 단위 차이가 있다는 점은 확인됐다. 다만 당시에는
대기 직전 event와 request별 status를 수집하지 않았으므로 어느 경로가 시간을 사용했는지는 미확증이다.

## 현재 코드에서 확인된 대기 경로

### Local shared rate limiter

`SharedRateLimiter.beforeRequest()`는 다음 상황에서 요청 전에 대기한다.

- 현재 process와 다른 process가 공유하는 bucket의 window 내 요청 수가 한도에 도달한 경우
- 이전 서버 429가 기록한 `blockedUntil` cooldown이 남은 경우

검색 bucket은 10회/60초이고, 다른 공식 operation bucket은 각각 60회/60초다. 따라서 서버 요청이
발생하지 않은 60초 지연도 가능하다. 현재는 `quota`와 `server-cooldown`을 출력에서 구분할 수 없다.

### GET 429 retry

`MyboxClient.requestJson()`은 GET 응답이 429이면 최대 한 번 자동 retry한다.

```ts
const mapped = this.parseError(result.response, result.body);
if (isGet && result.response.status === 429 && rateLimitRetries < 1) {
  rateLimitRetries += 1;
  await this.dependencies.sleep(mapped.retryAfterMs ?? SEARCH_WINDOW_MS);
  continue;
}
```

`parseError()`는 429의 `retryAfterMs`를 다음 순서로 채운다.

1. 유효한 `Retry-After` header
2. header가 없거나 해석할 수 없으면 `fallbackRateLimitDelayMs()`의 60~61초 delay

따라서 `?? SEARCH_WINDOW_MS`는 방어 코드이고, 정상적인 429 mapping에서 실제 fallback은
`fallbackRateLimitDelayMs()`다. 두 번째 429는 더 기다리지 않고 `rate-limit` failure와
`retryAfterMs`로 반환한다. mutation은 이 generic retry를 사용하지 않는다.

### Integration polling

일부 integration helper는 생성·변경 결과가 보일 때까지 짧은 backoff polling을 수행한다. 개별 wait는
429 fallback보다 짧지만 호출 횟수와 local bucket을 함께 증가시킬 수 있다. Phase 13 계측에서는
polling 자체와 그 안의 limiter/429 wait를 구분한다.

## 현재 가설과 판정 기준

| 가설                     | 확증 event                                       | 정책 후보                                    |
| ------------------------ | ------------------------------------------------ | -------------------------------------------- |
| local search quota 대기  | `rate-limit.local-wait`, cause `quota`           | 호출 수 축소 또는 공식 한도 내 bucket 재검토 |
| 이전 429 cooldown 대기   | `rate-limit.local-wait`, cause `server-cooldown` | cooldown 공유 유지, 중복 대기 여부 검증      |
| 서버 429 후 retry 대기   | `http.retry-scheduled`, status 429               | 유지, bounded wait 또는 fail-fast 검토       |
| integration polling 누적 | polling 횟수/시간은 길지만 위 wait event가 없음  | polling 횟수와 visibility 조건 조정          |
| 복합 원인                | 둘 이상의 event wait 합계가 wall time을 설명     | 각 원인별 최소 변경                          |

다음 규칙으로 결론을 제한한다.

- isolated state의 단일 실행에서 관찰하지 못한 서버 429를 실제 원인이라고 확정하지 않는다.
- 잘못된 query의 404 반복은 429가 없다는 증거 또는 공식 한도 측정값으로 사용하지 않는다.
- 실제 한도를 고의로 소진하는 probe를 만들지 않는다.
- local bucket은 공식 문서 또는 재현 가능한 정상 요청 관찰과 모순될 때만 변경한다.
- 429 처리 변경은 성공률, 총 대기 시간, `Retry-After` 유무와 agent의 재실행 가능성을 함께 비교한다.

## 사람과 AI 에이전트용 출력 방향

별도 format option을 만들지 않고 기존 `--json`으로 최종 오류와 실시간 event 형식을 함께 선택한다.

| 모드        | stdout                                  | stderr                                    |
| ----------- | --------------------------------------- | ----------------------------------------- |
| 기본 human  | 사람이 읽는 최종 성공 결과              | human event와 사람이 읽는 최종 오류       |
| `--json`    | 최종 성공/실패 JSON envelope 정확히 1개 | 실행 중 event JSON Lines                  |
| `--quiet`   | 선택한 모드의 최종 결과 유지            | event만 억제, human 최종 오류는 유지      |
| `--verbose` | 선택한 모드의 최종 결과 유지            | 상세 단계와 upload/put byte progress 추가 |

현재 CLI도 기본 모드의 최종 오류는 stderr text, `--json` 오류는 stdout JSON으로 구분한다. Phase 13은 이
분기를 유지하면서 recoverable error, 대기와 progress를 같은 출력 모드에 연결한다. terminal failure는
최종 channel에서 한 번만 출력하고 JSON mode에서 stderr error event로 중복하지 않는다.

human 최종 오류는 safe message를 기본으로 하고 optional code/requestId/retryAfter를 읽기 쉽게
표시한다. 해결 방법이 command와 error code로 확정되는 경우에만 hint를 추가한다. TTY progress는 같은
줄에서 갱신하고 warning/error 전에 정리하며, non-TTY stderr에서는 독립된 line log를 사용한다.

기본 warning은 1초 이상 예정된 대기, 자동 retry와 resume처럼 멈춤으로 오해하기 쉬운 상황만
출력한다. `--verbose`는 command stage와 upload/put byte progress를 추가하고, `--quiet`는 실행 중
event만 억제한다. stderr를 수집하지 않는 에이전트는 실시간 event를 받을 수 없으며 최종 stdout
failure의 `retryAfterMs`만 사용할 수 있다.

event data는 allowlist로 구성한다. operation, status, attempt, waitMs, delay source, transferred/total
byte와 offset은 허용하지만 raw URL, query, header, body와 error cause는 허용하지 않는다. PAT,
Authorization, upload/download URL과 signed query는 redaction에만 의존하지 않고 애초에 event payload에
전달하지 않는다.

## 이전 진단 변경

진단 중 다음 변경을 임시 적용했다가 2026-08-29 되돌렸다. 현재 checkout의 production surface에는
포함되지 않는다.

- `test/integration/helpers.ts`: `MYBOX_TEST_RATE_LIMIT=off`일 때 test process limiter를 완화
- `src/runtime.ts`: `MYBOX_DISABLE_RATE_LIMIT=1`일 때 CLI subprocess limiter를 비활성화

두 설정에서 모두 약 60초 단위 지연이 보였다는 사실만 남긴다. 당시 event가 없었으므로 이 결과만으로
local limiter 또는 서버 429를 배제하지 않는다.

## 다음 조사

1. fake clock으로 local quota/cooldown과 서버 429 retry event를 각각 고정한다.
2. clean shared-state path를 사용해 `ensure-dir` targeted acceptance를 한 번 실행한다.
3. wall time, request 수, event별 waitMs와 자연 발생 429 여부를 기록한다.
4. 증거에 따라 429 자동 retry 유지·조정·fail-fast 중 하나를 선택한다.
5. 선택한 정책의 deterministic test를 추가하고 전체 command acceptance 시간을 다시 기록한다.

## 2026-08-31 구현 결과

- `rate-limit.wait-started/completed`가 local quota와 server cooldown을 구분한다.
- `http.retry-scheduled/completed`가 backoff, `Retry-After`, fallback 출처를 구분한다.
- fake clock에서 search quota 1,000ms, shared server cooldown 2,000ms와 GET 429 fallback 60,000ms를
  각각 검증했다.
- upload file byte는 offset부터 file size까지 단조 증가하며 최대 초당 1회와 완료 시점에 emit된다.
- `--json` stdout envelope는 유지되고 warning/progress event는 stderr JSON Lines로 분리됐다.
- 일반 회귀 검증은 212 pass, 35 opt-in skip, 0 fail이다.

실제 Phase 13 probe는 아직 실행하지 않았다. 따라서 서버 429가 이전 장시간 지연의 원인이라는 결론은
내리지 않는다. 현행 bounded GET retry 정책은 유지하고, live probe의 자연 관찰 결과가 다를 때만
bucket 또는 fail-fast 정책을 다시 검토한다.
