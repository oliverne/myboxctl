# Phase 13 — Observability & Integration Test Latency

문서: `docs/phases/13-observability-and-test-latency.md`

상세 분석: `docs/reference/test-latency-investigation.md`

## 상태

`pending` — 실행 계획은 사용자가 구체화한다.

## 목표

1. 통합 테스트가 수 분씩 걸리는 지연의 실제 원인(서버 429 가설)을 확증한다.
2. 429/재시도/지연을 사용자와 AI agent가 관측할 수 있도록 로깅을 추가한다.
3. rate-limiter 전략(선제 대기 vs 서버 429 의존)을 실제 관측 데이터에 기반해 재검토한다.

## 배경

실제 MYBOX PAT로 통합 테스트를 돌리던 중 다음이 관찰됐다:

- 개별 API 호출은 0.2~0.4초로 빠르다.
- `ensure-dir` CLI 직접 실행은 67초, `ensure-dir` acceptance는 ~127초(limiter OFF),
  ~121초(limiter ON), `delete` acceptance는 ~244초(limiter ON)가 소요된다.
- `src/`에 `console.*`가 없고, 중간 429/재시도/지연은 침묵한다. `--verbose` 등 플래그도 없다.

유력 가설: `client.ts`가 GET 429 시 `retryAfterMs ?? SEARCH_WINDOW_MS`(60초)만큼 조용히 대기 후
재시도한다. limiter를 꺼도 서버 측 429는 독립적이므로, 서버 429가 60초 지연을 유발한다.
(증명 필요 — 현재 미확증)

## 미결정 사항

`docs/reference/test-latency-investigation.md`의 "미결정 사항" 참조:

1. 서버 429 가설 확증 방법 (임시 로그 vs 영구 로그)
2. 로깅 범위: A(stderr 경고) / B(stdout JSON `notices`) / C(둘 다)
3. rate-limiter 전략: ON(선제 대기) vs OFF(서버 429 의존) — 둘 다 60초 소요 역설
4. 전체 integration suite 진행 방식 (직렬/병렬, limiter ON/OFF)
5. `upload-contract` 100MB probe 포함 여부
6. 실험적 코드 변경(uncommitted) 처리

## 실행 계획

TODO — 사용자가 구체화한다. 최소한 다음 순서를 권장한다:

1. 429 가설 확증 (임시 또는 영구 로그 추가 후 `ensure-dir` 1회 실행)
2. 로깅 범위 결정 및 구현 (stdout 오염 금지, 민감정보 미포함)
3. 실제 429 빈도/위치 관측 데이터 수집
4. rate-limiter 한도/동작 재검토 및 필요 시 조정
5. 전체 integration suite 완주 검증

## 검증 조건

TODO — 구체화 시 작성. 최소 요건 후보:

- 429 발생 시 로그/필드로 관측됨 (stdout JSON 파싱 방해 없음)
- 테스트 지연 원인이 명확히 특정됨
- `bun run check` 통과
- 실제 MYBOX 통합 테스트가 합리적인 시간 내 완주 (또는 지연 원인이 문서화됨)

## 범위 밖

- 공식 API 신규 command 추가
- 양방향 sync, watch daemon 등 MVP 이후 후보
- PAT/헤더/업로드·다운로드 URL을 어떤 출력에도 노출하는 변경 (원칙상 금지)
