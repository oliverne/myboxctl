# Integration 테스트 지연·관측성 조사 (이슈)

> 상태: 조사 중 (가설 단계, 미확증)
> 관련 phase: `docs/phases/13-observability-and-test-latency.md`
> 작성일: 2026-08-29

## 요약

실제 MYBOX PAT로 통합 테스트를 돌리던 중, 개별 API 호출은 0.2~0.4초로 빠른데 특정 acceptance
테스트 전체가 수 분씩 걸리는 지연이 발견됐다. 원인은 rate-limiter가 아니라 **중간 429/재시도가
조용히 60초를 대기**하는 것으로 추정되나, 현재 코드에 로그가 없어 확증되지 않았다. 관측성(로깅)
부족이 근본 문제다.

## 측정 증거

| 측정 대상 | 조건 | 소요 |
| --- | --- | --- |
| `bun run src/cli.ts --version` | 기동 기준선 | 0.03s |
| `stat /myboxctl-integration-test` | read | 0.45s |
| `listRoot` (직접 client 호출) | – | 318ms |
| `listFolder` | – | 301ms |
| `searchFolders({path})` | – | 207ms |
| `createFolder` (noParent) | – | 204ms |
| `createFolder` (parent) | – | 308ms |
| `deleteResource` | – | 305~410ms |
| `ensure-dir` CLI 직접 실행 | limiter OFF | **66.96s** (`action: created`) |
| `ensure-dir` acceptance | limiter OFF | **~127s** (pass) |
| `ensure-dir` acceptance | limiter ON (10/분) | **~121s** (pass) |
| `delete` acceptance | limiter ON | **~244s** (pass) |
| storage `GET` 직접 호출 | – | 207ms (200) |
| search 12회 연속 (잘못된 query) | – | 모두 404, **429 없음** |

핵심: 개별 호출은 전부 0.2~0.4초인데, `ensure-dir` 전체는 ~67초. 호출 간에 약 60초 블록이
존재한다.

## 가설

`src/mybox/client.ts`의 `requestJson`은 GET에서 `429`를 받으면 다음과 같이 처리한다:

```ts
if (isGet && result.response.status === 429 && rateLimitRetries < 1) {
  rateLimitRetries += 1;
  await this.dependencies.sleep(mapped.retryAfterMs ?? SEARCH_WINDOW_MS); // 60초+
  continue;
}
```

- `retryAfterMs`가 없으면 `SEARCH_WINDOW_MS`(60초)만큼 **조용히** 대기 후 1회 재시도한다.
- limiter를 꺼도 **서버 측 429 제한은 독립적**이므로, 서버가 429를 주면 client가 60초를 기다린다.
- 따라서 `ensure-dir`의 search 호출 중 일부가 서버 429를 받아 60초를 기다리는 것이 67초 지연의
  유력한 원인이다(재시도 후 성공하므로 테스트는 통과).

**아직 미확증**이다. 증명하려면 `client.ts` 429 분기에 로그를 넣어 실제 429 발생을 관찰해야 한다.

## 로깅/관측 부족

- `src/` 전체에 `console.*` 호출 **0개**.
- 출력은 `src/output.ts`의 JSON envelope(stdout)과 argument/commander 에러(stderr)뿐.
- 중간 429/재시도/지연은 **완전히 침묵**.
- `--verbose` / `--debug` / log level 플래그도 없다.
- 그래서 지연 원인을 코드를 뒤져 가설만 세울 수 있었고, 실제 429 발생 여부를 확인할 방법이 없었다.

### agent 관측 관점

- 대부분의 AI agent subprocess 호출은 stdout+stderr를 모두 캡처하므로 stderr 경고도 읽을 수 있다.
- 단, agent 구현에 따라 stdout만 "판정 결과"로 쓰는 경우도 있어, 429를 agent가 **신뢰적으로**
  인지하게 하려면 stdout JSON envelope 내 구조화 필드(예: `notices`)가 정석이다.
- AGENTS.md 원칙상 stdout JSON은 agent 판정용이므로 오염하지 않아야 하며, stderr는 부수 정보로
  안전하다(PAT/헤더/업로드·다운로드 URL은 어떤 출력에도 절대 포함되지 않아야 함).

## 미결정 사항

1. **서버 429 가설 확증 방법**
   - (a) `client.ts`에 임시 429 로그 → 1회 실행 후 즉시 revert
   - (b) 영구 로그(관측성)로 그대로 둠 — 아래 2번과 연결
2. **로깅 추가 범위** (agent 신뢰성 vs 최소 변경)
   - A: stderr 경고만 (client.ts 1줄, 대부분의 agent가 읽음)
   - B: stdout JSON에 `notices` 필드 추가 (contract 확장, 가장 reliable)
   - C: A + B 둘 다 (권장)
3. **rate-limiter 전략 역설**
   - ON(10/분 선제 대기): 서버 429를 막지만 선제 대기로 60초 소요
   - OFF: 서버 429를 피하지 못해 client가 60초 fallback 대기
   - 둘 다 60초 소요 → 근본 해결은 아님. 로깅으로 실제 429 빈도/위치를 파악 후 한도/동작 재검토 필요
4. **전체 integration suite 진행 방식**
   - 각 테스트가 60초+ 대기할 수 있어 전체 완주가 매우 느림. suite를 파일별 직렬 실행할지,
     limiter ON/OFF 중 어느 쪽으로 할지 결정 필요
5. **`upload-contract` 100MB probe 포함 여부** — 별도로 매우 김(100MiB 전송 + 60초 sleep + resume)
6. **실험적 코드 변경의 처리** — 아래 참조(uncommitted 상태)

## 실험적 코드 변경 (진단용, 되돌림됨)

진단 중 다음 변경을 임시 적용했다가 2026-08-29 되돌렸다(revert, uncommitted 변경 버림):

- `test/integration/helpers.ts`: `MYBOX_TEST_RATE_LIMIT=off` env 게이트로 test 프로세스 limiter 완화
- `src/runtime.ts`: `MYBOX_DISABLE_RATE_LIMIT=1`이면 `noOpRateLimiter` 사용 (CLI subprocess limiter 비활성화)

위 변경은 진단 목적이었으며, 최종 방향(미결정 2, 3번)은 Phase 13에서 로깅/관측 데이터에 기반해 결정한다.
