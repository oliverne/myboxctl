# Phase 13 — Observability & Integration Test Latency

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 통합 테스트 지연의 원인을 확정하고, 사람과 AI
에이전트가 긴 작업과 복구 가능한 오류를 관측할 수 있게 하는 실행 범위와 완료 조건을 정의한다.

상세 조사 기록: [`../reference/test-latency-investigation.md`](../reference/test-latency-investigation.md)

Human UI 조사: [`../reference/human-cli-ui-investigation.md`](../reference/human-cli-ui-investigation.md)

## 상태와 진입 조건

- 상태: `complete`
- 활성 phase: 없음
- Phase 13 구현을 시작할 때 `docs/PROGRESS.md`의 활성 phase를 Phase 13 `in_progress`로 변경했고,
  완료 조건 충족 후 `complete`로 닫았다.
- Phase 11 완료 뒤 Phase 13만 `in_progress`로 두어 동시에 두 phase를 진행하지 않았다.
- 실제 MYBOX 검증은 PAT가 준비된 opt-in 실행으로 제한하고, mutation은
  `/myboxctl-integration-test/` 아래의 unique child에서만 수행한다.

### 구현 진행

- [x] P13-A typed event sink, human/JSONL renderer와 CLI mode matrix
- [x] P13-B local quota/server cooldown/GET retry 계측과 fake-clock 검증
- [x] P13-C upload/put file-byte progress, resume event와 TTY/non-TTY renderer
- [x] P13-D 일반 문서와 212 pass/35 opt-in skip 회귀 검증
- [x] targeted live probe와 실제 wall-time/event 증거 기록

targeted probe와 full live acceptance에서 자연 발생 429는 관찰되지 않았다. 장시간 지연은 local
shared limiter의 `quota` 대기로 확인했으며 현행 bounded GET retry 정책을 유지한다.

## 목표

1. 통합 테스트의 긴 대기가 local shared rate limiter, 서버 429 retry, integration polling 또는 다른
   원인 중 어디에서 발생하는지 구분하고 실제 증거로 확정한다.
2. 현재 GET 429의 1회 자동 retry와 60~61초 fallback 대기가 유지되어야 하는지 검토하고, 관측 결과에
   따라 유지·조정·fail-fast 중 하나를 결정한다.
3. 자동 retry, rate-limit 대기, upload/put 전송과 resume처럼 오래 걸리는 작업의 진행 상태를 사람과
   AI 에이전트가 실행 중에 알 수 있게 한다.
4. 기존 human/JSON 최종 오류 분기, JSON stdout envelope, exit code와 credential redaction을 깨지
   않는다.

## 관측성 계약

### 출력 모드와 채널

별도 `--error-format`이나 `--log-format`을 추가하지 않고 기존 `--json`을 전체 출력 모드 선택자로
사용한다.

| 모드        | stdout                                  | stderr                                          |
| ----------- | --------------------------------------- | ----------------------------------------------- |
| 기본 human  | 사람이 읽는 최종 성공 결과              | human event와 사람이 읽는 최종 오류             |
| `--json`    | 최종 성공/실패 JSON envelope 정확히 1개 | 실행 중 event JSON Lines                        |
| `--quiet`   | 선택한 모드의 최종 결과 유지            | 실행 중 event만 억제하며 human 최종 오류는 유지 |
| `--verbose` | 선택한 모드의 최종 결과 유지            | 상세 단계와 upload/put byte progress 추가       |

- 기본 모드의 최종 오류를 stderr text로, `--json` 오류를 stdout JSON으로 반환하는 현재 동작을 유지한다.
- terminal failure는 최종 결과 channel에서 한 번만 출력한다. `--json`에서 같은 failure를 stderr error
  event로 중복하지 않는다.
- recoverable error, retry, 대기와 진행 event는 stderr로만 보낸다.
- `--json`의 stderr event는 에이전트가 파싱할 수 있는 JSON Lines다. 각 줄은 독립된 JSON object이며
  stdout envelope와 별도 stream이다.
- 기존 JSON envelope의 필수 field를 바꾸지 않는다. stderr를 소비하지 않는 기존 에이전트도 최종
  failure의 `retryAfterMs`로 판단할 수 있다.
- 이는 현재 CLI reference의 "stderr는 `--verbose` diagnostics에만 사용" 규칙을 warning event까지
  의도적으로 확장하는 behavior change다. P13-A에서 subprocess test를 먼저 작성하고 P13-D에서
  reference를 갱신한다.

### Human 오류와 진행 표시

- 최종 오류는 `Error: <safe message>`를 기본으로 하고, 존재할 때만 안전한 `code`, `requestId`와
  `Retry after: <duration>`을 별도 줄로 보여준다.
- 해결 방법이 command와 error code로 확정되는 경우에만 `Hint:`를 제공한다. 모든 conflict에
  `--force`를 권하는 것처럼 mutation 의미를 추측하는 generic hint는 만들지 않는다.
- stderr가 TTY이면 byte progress를 같은 줄에서 갱신하고, warning이나 최종 오류 전에 진행 줄을
  정리한다.
- stderr가 TTY가 아니면 carriage return에 의존하지 않고 독립된 줄로 출력한다.
- localization framework는 추가하지 않고 기존 CLI의 영어 message와 option 이름을 유지한다.

### 로그 수준

- 기본 모드에서도 1초 이상의 rate-limit 대기, 자동 retry, upload resume처럼 사용자가 멈춤으로
  오해할 수 있는 복구 event는 stderr에 `warning`으로 알린다.
- human TTY에서는 500ms를 넘는 단계와 upload/put의 compact progress를 기본으로 보여주되, 빠르게 끝난
  작업은 아무 중간 UI도 출력하지 않는다.
- 기본 non-TTY와 `--json`에서는 warning만 출력하며, progress와 단계 history는 `--verbose`에서
  활성화한다.
- `--verbose`에서는 command 단계, upload/put byte progress와 충분한 표본이 있을 때 renderer가 계산한
  speed/ETA를 추가한다.
- `--quiet`에서는 실행 중 event만 억제한다. human 최종 오류와 `--json` 최종 envelope는 항상 남긴다.
- `--verbose`와 `--quiet`는 함께 사용할 수 없으며 argument error로 종료한다.

### Human UI renderer

로컬 `my-cli` prototype의 실제 TTY/non-TTY 출력을 참고하되 source나 package를 직접 의존하지 않는다.

- `text.ts`의 semantic prefix, `progress.ts`의 단일 bar와 `steps.ts`의 typed status 개념만 채택한다.
- `ora`, `cli-progress`, `listr2`, `consola`, box/table/markdown/prompt library는 Phase 13에 추가하지 않는다.
- spinner는 사용하지 않고, 500ms를 넘긴 작업에만 현재 stage를 표시해 짧은 명령의 flicker를 피한다.
- TTY에서는 active line을 redraw하고, non-TTY에서는 carriage return이나 cursor control 없는 line log만
  사용한다.
- upload progress는 terminal width에 따라 bar, ETA, speed 순서로 생략하며 percent와 byte는 유지한다.
- rate-limit wait는 TTY에서만 local countdown으로 갱신한다. non-TTY human/JSONL은 wait 시작과 재개
  event만 출력한다.
- `NO_COLOR`, `TERM=dumb`, narrow terminal, SIGINT와 failure cleanup을 별도 test case로 둔다.
- 첫 구현은 새 UI dependency 없이 Bun 1.4의 `Bun.stringWidth()`와 작은 내부 renderer를 사용한다.

### 구조화 event

최소 event shape는 다음과 같다.

```json
{
  "type": "event",
  "level": "warning",
  "event": "http.retry-scheduled",
  "command": "ensure-dir",
  "data": {
    "operation": "search",
    "status": 429,
    "attempt": 1,
    "waitMs": 60000,
    "delaySource": "fallback"
  }
}
```

- event name과 data field는 allowlist로 정의한다. raw request URL, query, header, response body와 error
  cause를 직렬화하지 않는다.
- PAT, Authorization, upload/download URL과 signed query는 human/JSONL event 모두에 포함하지 않는다.
- upload progress는 `transferredBytes`, `totalBytes`, `percent`와 resume `offset`만 제공한다. 로컬·원격
  경로는 command 시작/완료 event에 기본 포함하지 않는다.
- byte progress event는 첫 전송, 최대 초당 1회, 완료 시점에 emit하여 stderr 폭주를 막는다. human
  non-TTY와 JSONL은 renderer level에서 mode/verbosity에 따라 추가로 filter한다. 테스트에서는 clock과
  event sink를 주입해 결정적으로 검증한다.

## 429 검토 원칙

현재 코드는 두 종류의 대기를 가진다.

1. `SharedRateLimiter.beforeRequest()`의 선제 local wait 또는 이전 429로 기록한 cooldown
2. `MyboxClient.requestJson()`이 GET 429를 받은 뒤 수행하는 1회 retry wait

서버 429에서는 `Retry-After`를 우선하고, header가 없거나 해석할 수 없으면
`fallbackRateLimitDelayMs()`가 60~61초 delay를 만든다. 뒤의 `retryAfterMs ?? SEARCH_WINDOW_MS`는
방어 코드이며 정상적인 429 mapping에서는 fallback의 주 경로가 아니다.

다음 중 하나를 관측 전에 결론으로 고정하지 않는다.

- 현행 유지: 긴 wait를 사전에 알리고 GET을 한 번 retry한다.
- 제한 조정: 공식 한도와 자연 관찰이 기존 local bucket 설정과 다를 때만 bucket을 조정한다.
- fail-fast: `Retry-After`가 없거나 자동 대기 상한을 넘으면 즉시 `rate-limit`/exit 8과
  `retryAfterMs`를 반환한다.

mutation generic retry 금지, signed upload/download URL의 단일 사용 정책과 실제 한도를 소진하는
인위적 429 probe 금지는 그대로 유지한다.

## 구현 순서

### P13-A — 구조화 event boundary

파일 후보:

- `src/observability.ts`
- `src/human-ui.ts`
- `src/runtime.ts`
- `src/cli.ts`
- `src/output.ts`
- 관련 unit/CLI subprocess test

작업:

- transport와 feature가 `console.*`를 직접 호출하지 않도록 typed event sink를 실제 substitution
  boundary로 추가한다.
- runtime에서 command name, log level과 human/JSONL event renderer를 연결한다.
- 현재 `runCli()`의 human stderr failure와 JSON stdout failure 분기를 공통 error presentation으로
  정리하되 exit code와 JSON shape를 유지한다.
- human final error renderer에는 safe message와 optional code/requestId/retryAfter/hint만 전달한다.
- 최종 success/failure writer는 stdout 또는 human error를 쓰기 전에 active TTY line/countdown을
  종료하고 newline을 보장한다.
- `--verbose`, `--quiet`와 `--json` 조합의 success, terminal failure와 recoverable event를 subprocess
  test matrix로 먼저 고정한다.
- TTY 진행 줄과 non-TTY line log는 writer/TTY를 주입해 terminal 제어 문자를 결정적으로 검증한다.
- human renderer는 stderr TTY/columns, color support와 clock을 주입받고 stdout에 쓰지 않도록 한다.
- `NO_COLOR`, `TERM=dumb`, narrow terminal과 active-line cleanup을 unit test로 고정한다.
- `src/human-ui.test.ts`에서 TTY/non-TTY writer, delayed stage와 final output handoff를 fake clock으로
  검증한다.
- `my-cli`와 같은 UI dependency를 바로 추가하지 않고 내부 renderer로 acceptance를 먼저 충족한다.
- event renderer에도 기존 output redaction을 재사용하고 unsafe field가 추가되지 못하도록 검증한다.

### P13-B — 지연 원인 계측과 429 정책 판정

파일 후보:

- `src/mybox/rate-limit.ts`
- `src/mybox/client.ts`
- `test/http/client.test.ts`
- `src/mybox/rate-limit.test.ts`
- `test/integration/observability.test.ts`
- `docs/reference/test-latency-investigation.md`

작업:

- local limiter wait에는 bucket/operation, waitMs와 `quota`/`server-cooldown` 원인을 기록한다.
- 서버 429 retry에는 status, attempt, waitMs와 `retry-after`/`fallback` 출처를 기록한다.
- fake clock test로 두 대기 경로와 event 순서를 각각 검증한다.
- 격리된 rate-limit state로 `ensure-dir` targeted acceptance를 1회 실행해 긴 구간의 event와 wall time을
  기록한다. 자연 발생한 429만 관찰하며 한도 소진용 반복 호출은 만들지 않는다.
- 관찰 결과로 현행 유지, local bucket 조정 또는 fail-fast 중 하나를 결정하고 reliability 문서와
  regression test에 반영한다. 429가 관찰되지 않으면 서버 429를 원인으로 확정하지 않는다.

### P13-C — upload/put 진행 event

파일 후보:

- `src/mybox/upload.ts`
- `src/features/upload.ts`
- `src/features/put/`
- `test/http/upload.test.ts`
- `test/http/put.test.ts`
- 관련 CLI subprocess test

작업:

- multipart stream이 읽은 file byte를 기준으로 progress callback을 제공한다. multipart header/footer는
  전송 byte에 포함하지 않는다.
- upload/put의 reservation, transfer 시작, resume offset, postcondition과 완료 단계를 event로
  연결한다.
- retryable 전송 실패 후 새 reservation을 얻는 기존 resume 정책을 바꾸지 않고, 발생 사실과 offset만
  알린다.
- 0-byte, 소형 파일, 100MiB simulated stream과 non-zero resume에서 progress가 단조 증가하고 마지막
  값이 file size와 같은지 fake HTTP test로 검증한다.
- 500ms보다 빠른 전송은 default human progress를 표시하지 않고, 긴 TTY 전송은 한 줄 compact bar,
  `--verbose`는 speed/ETA를 표시한다.
- non-TTY와 JSONL의 default/verbose 차이, rate-limit countdown의 TTY-only 동작과 SIGINT cleanup을
  subprocess test로 검증한다.
- Phase 13에서는 download byte progress를 추가하지 않는다. 같은 event sink가 안정화된 뒤 실제 요구가
  있으면 별도 작은 slice로 확장한다.

### P13-D — 문서와 회귀 검증

파일:

- `README.md`
- `docs/reference/cli-contract.md`
- `docs/architecture/reliability.md`
- `docs/reference/test-latency-investigation.md`
- `docs/reference/human-cli-ui-investigation.md`
- `docs/PROGRESS.md`
- `docs/HANDOFF.md`

작업:

- 기본 human 성공/stdout, 오류/stderr 예시와 에이전트용 stdout + stderr JSONL 소비 예시를 분리해
  문서화한다.
- human UI가 `my-cli` prototype을 runtime dependency로 사용하지 않는다는 경계를 기록한다.
- stderr를 읽지 않는 호출자는 실시간 event를 받지 못한다는 경계를 명시한다.
- 기존 성공/실패 JSON fixture, exit code, no-secret test를 회귀 검증한다.
- targeted 관찰의 실행 시간, event 원인별 wait 합계와 429 정책 결정을 사실로 기록한다.

## 검증 명령

```bash
bun run check
bun run build
bun test test/http/client.test.ts src/mybox/rate-limit.test.ts test/http/upload.test.ts test/http/put.test.ts
bun test src/observability.test.ts src/human-ui.test.ts
bun run test:integration
```

Phase 완료 때 사용한 별도 observability live probe는 event가 발생하지 않아도 통과하는 낮은 신호의
검사였다. 완료 증거는 유지하되 현재 entrypoint는 제거했으며, 위 unit regression과 전체 live
integration의 JSONL 검증을 현재 계약으로 사용한다.

실제 MYBOX 명령은 PAT가 준비된 authorized 환경에서만 실행한다. 100MiB upload contract probe는 429
원인 확인이나 progress correctness에 필요하지 않으므로 Phase 13의 필수 검증에서 제외한다.

## 완료 조건

1. 1초 이상 대기하기 전에 원인과 예정 wait가 stderr event로 관측된다.
2. local limiter wait와 서버 429 retry wait를 event name/data로 구분할 수 있다.
3. 실제 지연 원인이 증거로 특정되거나, 관찰되지 않은 가설이 미확증 상태로 명시된다.
4. 429 현행 유지·조정·fail-fast 결정과 근거가 reliability 문서 및 test에 반영된다.
5. human terminal failure는 stderr에 한 번만 출력되고 stdout은 비어 있으며, 확정된 경우에만 안전한
   hint를 제공한다.
6. `--json` stdout은 정확히 하나의 기존 envelope이며 terminal failure가 stderr에 중복되지 않고,
   실행 중 stderr JSONL의 각 줄은 독립적으로 parse할 수 있다.
7. TTY progress는 한 줄을 갱신하고 non-TTY progress는 독립된 줄이며, warning/error와 섞여 깨지지
   않는다.
8. 500ms 안에 끝나는 기본 human 작업은 UI flicker가 없고, 긴 TTY 작업만 compact stage/progress를
   보여준다.
9. narrow TTY, `NO_COLOR`, `TERM=dumb`, non-TTY와 SIGINT에서 정보 손실이나 terminal state 누수가 없다.
10. 기본 warning, `--verbose`, `--quiet` 동작이 human/JSON subprocess test로 고정된다.
11. upload/put progress byte가 단조 증가하고 resume offset에서 이어지며 완료 시 file size와 일치한다.
12. event와 오류 출력에 PAT, Authorization, upload/download URL과 signed query가 없다.
13. 새 범용 UI/TUI dependency 없이 acceptance를 충족하거나, dependency가 필요하면 근거와 trade-off를
    먼저 문서화한다.
14. `bun run check`, `bun run build`, targeted Phase 13 probe와 command acceptance가 통과한다.
15. `PLAN.md`, reference, `docs/PROGRESS.md`와 `docs/HANDOFF.md`가 실제 결과와 동기화된다.

## 중단 조건

- event sink를 추가하려면 기존 stdout envelope나 exit code를 breaking change해야 하는 경우
- transport event에서 credential 또는 signed URL을 구조적으로 분리할 수 없는 경우
- 429 원인을 확정하려면 실제 호출 한도를 의도적으로 소진해야 하는 경우
- upload progress callback이 file 전체 buffering이나 전송 정책 변경을 요구하는 경우
- TTY UI가 non-TTY/JSON output에 terminal escape를 누출하거나 standalone target에서 cleanup되지 않는
  경우

중단 조건이 발생하면 추측성 fallback이나 광범위한 logging framework를 추가하지 않고 증거와 대안을
기록한다.

## 범위 밖

- 신규 MYBOX API command
- 범용 telemetry backend, log file rotation 또는 원격 log 전송
- PAT, header, request/response body, upload/download URL의 debug 출력
- 공개 stdout envelope에 누적 `notices` field 추가
- 별도 `--error-format`, `--log-format` 또는 localization framework
- download byte progress
- upload protocol, resume 횟수 또는 mutation retry 정책 변경
- 전체 integration suite의 무조건 병렬화
