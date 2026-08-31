# Current handoff

## 인수 목적

Phase 00~13의 구현과 검증을 완료했다. 첫 공개 Release 전에 CLI command surface와 출력 계약을 정리하는
Phase 14 계획을 추가했으며 상태는 `pending`이다. 아직 production code와 현재 CLI contract는 변경하지
않았다.

## 현재 상태

- Phase 00~13: `complete`
- Phase 14: `pending`
- 활성 구현 phase: 없음
- 작업 브랜치: 없음 (PR #11은 `main`으로 merge 완료)
- PR: [#11 feat: add Phase 13 observability and progress events](https://github.com/oliverne/myboxctl/pull/11) — 2026-08-31 merge됨
- integration stderr 계약 수정 commit: `710cde214f93d7758b7cabe226b6d0d769c28bd4`
- 로컬 검증: 212 pass, 35 opt-in skip, 0 fail
- 별도 release contract: 3 pass, 0 fail
- Phase 14 계획: [`phases/14-cli-ux-and-agent-contract.md`](phases/14-cli-ux-and-agent-contract.md)
- Phase 14 구현·검증: 미시작

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

PR #11 merge는 2026-08-31에 완료했다. Phase 14 완료 전에는 현재 draft `v0.1.0`을 공개하지 않는다.
Phase 14 완료 후에도 저장소 public 전환, Release 공개, package publish, registry 반영, credential 변경과
`v0.1.0` tag 이동·삭제는 각각 별도 승인 후 실행한다. 추가 MYBOX live test도 다시 사용자 의사를 확인한다.

## 다음 실행 범위

1. Phase 14 구현을 시작할 때 `docs/PROGRESS.md`의 상태를 `pending → in_progress`로 변경한다.
2. `docs/phases/14-cli-ux-and-agent-contract.md`의 P14-A~E 순서와 완료 조건을 따른다.
3. production code 변경 전 관련 CLI subprocess test를 실패 상태로 먼저 고정한다.
4. 일반 회귀와 release smoke를 통과한 뒤 필요한 최소 MYBOX live acceptance만 별도 동의를 받아 실행한다.
5. Phase 14 완료 전에는 draft Release를 공개하지 않는다.

## 로컬 시작 명령

```bash
git fetch origin
git switch main
git pull --ff-only origin main
bun install --frozen-lockfile
bun run check
```

GitHub CLI로는 `gh pr view 11`로 merge 상태를 확인할 수 있다.
