# Current handoff

## 인수 목적

Phase 13 Observability & Integration Test Latency의 구현, 로컬 회귀 검증, targeted live probe와 full
live acceptance를 완료했다. PR [#11](https://github.com/oliverne/myboxctl/pull/11)은 열려 있으며 다음
작업은 변경과 원격 검증 결과를 검토한 뒤 merge 여부를 결정하는 것이다.

## 현재 상태

- Phase 00~13: `complete`
- 활성 구현 phase: 없음
- 작업 브랜치: `phase-13-observability`
- PR: [#11 feat: add Phase 13 observability and progress events](https://github.com/oliverne/myboxctl/pull/11)
- integration stderr 계약 수정 commit: `710cde214f93d7758b7cabe226b6d0d769c28bd4`
- 로컬 검증: 212 pass, 35 opt-in skip, 0 fail
- 별도 release contract: 3 pass, 0 fail

5개 live integration test의 오래된 `stderr === ""` assertion을 제거했다. 각 CLI subprocess는
`--json` stderr가 비어 있거나 모든 non-empty line이 다음 조건을 만족하는지 검증한다.

- `type: "event"`와 실제 command
- allowlisted event name, top-level field와 event별 data field
- `info` 또는 `warning` level
- PAT, Authorization, upload/download URL과 signed query 비노출

최종 stdout은 계속 JSON envelope 하나이며 terminal failure가 stderr에 중복되면 event parser가
실패한다. 빈 stderr가 계약인 경우는 기존 `--quiet` subprocess 회귀 test가 별도로 유지한다.

## 원격 검증

- PR CI run [`33388258127`](https://github.com/oliverne/myboxctl/actions/runs/33388258127): 성공
- PR Release run [`33388258207`](https://github.com/oliverne/myboxctl/actions/runs/33388258207): 5개 native smoke 성공
- Phase 13 targeted probe run [`33388395781`](https://github.com/oliverne/myboxctl/actions/runs/33388395781): 성공
- full live acceptance run [`33388494698`](https://github.com/oliverne/myboxctl/actions/runs/33388494698): 성공

targeted probe는 `phase13_probe=true`만 켜 실행했다. 기존 `/myboxctl-integration-test/` root를 조회하고
mutation하지 않았으며 1 pass, 0 fail, 1,095.83ms에 끝났다. stderr event는 0건이어서 원인별 wait
합계도 0ms였다.

full acceptance는 `live_acceptance=true`만 켜 실행했다. 전용 integration prefix 아래의 unique child만
mutation하고 cleanup까지 통과했다. 결과는 8 pass, 17 opt-in skip, 0 fail이며 test wall time은
1,875.35초였다.

## 지연 원인과 정책 결정

직전 진단 run [`33385894964`](https://github.com/oliverne/myboxctl/actions/runs/33385894964)은 빈 stderr
assertion 때문에 실패했지만 실제 JSONL event를 assertion diff에 남겼다. 중복 diff 출력을 제외한
`rate-limit.wait-started/completed` 16쌍은 모두 search `quota`였다.

| command      | quota wait 횟수 | 시작 event `waitMs` 합계 |
| ------------ | --------------: | -----------------------: |
| `put`        |               8 |                162,764ms |
| `upload`     |               3 |                 53,214ms |
| `ensure-dir` |               5 |                 55,799ms |
| 합계         |              16 |                271,777ms |

세 live 실행에서 자연 발생 서버 429, `server-cooldown`과 `http.retry-scheduled` 증거는 없었다. 장시간
지연 원인은 공식 10회/분 검색 한도를 지키는 local shared limiter의 quota 대기로 판정했다. 검색
bucket을 완화하지 않고 GET 429 한 번 retry, `Retry-After` 우선, header가 없을 때 60~61초 fallback
정책을 유지한다.

상세 근거는 [`reference/test-latency-investigation.md`](reference/test-latency-investigation.md)에 있다.

## 저장소와 Release 경계

- 저장소: `oliverne/myboxctl` (private)
- 기본 브랜치: `main`
- `v0.1.0` tag 대상: `4e895b745d7822b6b2e74fc80939642d27c542e5`
- draft Release ID: `379266317`
- 공개 Release: 없음
- npm publish, Homebrew tap 반영, Scoop registry 등록: 미실행

Release artifact action은 Node 24 기반 `upload-artifact@v7`과 `download-artifact@v8`이며 PR #11의
Release workflow에서 5개 native smoke가 통과했다. 새 tag 기반 artifact transfer는 별도 검증하지
않았다.

다음 작업에는 PR #11 merge, draft Release 공개, 저장소 public 전환, package publish, registry 반영,
credential 변경과 `v0.1.0` tag 이동·삭제가 포함되지 않는다. 각각 별도 승인 후 실행한다. 추가 MYBOX
live test도 다시 사용자 의사를 확인한다.

## 다음 실행 범위

1. PR #11 diff와 모든 check 결과를 검토한다.
2. 사용자 승인 후에만 PR #11을 merge한다.
3. merge했다면 `main` CI와 Git 상태를 확인하고 status 문서의 branch/PR 표현만 정리한다.
4. 다음 product phase는 실제 우선순위를 확인한 뒤 별도 계획으로 시작한다.

## 로컬 시작 명령

```bash
git fetch origin
git switch phase-13-observability
git pull --ff-only origin phase-13-observability
bun install --frozen-lockfile
bun run check
```

GitHub CLI를 사용한다면 `gh pr checkout 11`로 대체할 수 있다.
