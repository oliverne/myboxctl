# Current handoff

## 인수 목적

Phase 13 Observability & Integration Test Latency의 P13-A~D 일반 구현과 회귀 검증은 완료됐고 PR
[#11](https://github.com/oliverne/myboxctl/pull/11)에 올라가 있다. 일반 PR CI와 Release smoke는
성공했다. 다음 작업은 PAT workflow에서 발견된 기존 integration assertion을 새 stderr JSONL 계약에
맞춘 뒤, full live acceptance와 Phase 13 targeted probe를 다시 실행하고 실제 wall time/event 증거를
기록하는 것이다.

## 저장소와 Release 상태

- 저장소: `oliverne/myboxctl` (private)
- 기본 브랜치: `main`
- `v0.1.0` tag 대상: `4e895b745d7822b6b2e74fc80939642d27c542e5`
- Release workflow: run
  [`33309779551`](https://github.com/oliverne/myboxctl/actions/runs/33309779551), attempt 1·2 성공
- draft Release: [myboxctl 0.1.0](https://github.com/oliverne/myboxctl/releases/tag/untagged-28a14d408e2240b50b71)
- draft Release ID: `379266317`
- 공개 Release: 없음
- npm publish, Homebrew tap 반영, Scoop registry 등록: 미실행

Release run은 build/check와 macOS arm64/x64, Linux arm64/x64, Windows x64의 checksum,
`--version 0.1.0`, `--help` smoke를 통과했다. attempt 2는 같은 draft 하나를 유지하면서 9개 asset을
`--clobber`로 교체했다. 재다운로드한 5개 archive의 `SHA256SUMS` 검증도 통과했다. run log와 asset에서
PAT, Authorization 값과 signed upload/download URL 노출을 찾지 못했다.

`actions/upload-artifact@v4`와 `actions/download-artifact@v5`에 Node.js 20 deprecation annotation이
있었지만 모든 job은 성공했다. 향후 dependency maintenance 후보이며 현재 기능이나 Release 검증 실패는
아니다.

후속 local maintenance에서 두 action을 Node 24 기반 `actions/upload-artifact@v7`과
`actions/download-artifact@v8`로 갱신했다. main 반영 후에도 tag/PR 기반 원격 Release workflow
검증은 별도로 필요하다.

## Phase 상태

- Phase 00~12: `complete`
- Phase 13 Observability & test latency: `in_progress`
- 활성 phase: Phase 13

P13-A~D 일반 구현은 212 pass, 35 opt-in skip, 0 fail이다. 실제 MYBOX 검증은 PAT가 준비된 opt-in
실행이며 Phase 13 probe는 기존 `/myboxctl-integration-test/` root를 조회할 뿐 mutation하지 않는다.

## Phase 13 브랜치와 PR

- 작업 브랜치: `phase-13-observability`
- PR: [#11 feat: add Phase 13 observability and progress events](https://github.com/oliverne/myboxctl/pull/11)
- 원격 head: `5d083fd3e86a80a1a7a6c29db00f82683f93c5ff`
- PR CI run [`33360779801`](https://github.com/oliverne/myboxctl/actions/runs/33360779801): 성공
- PR Release run [`33360779756`](https://github.com/oliverne/myboxctl/actions/runs/33360779756): 성공
- PAT workflow run [`33385894964`](https://github.com/oliverne/myboxctl/actions/runs/33385894964): 실패

## PAT workflow 실패 진단

PAT 누락이나 MYBOX 인증 실패가 아니다. Phase 13부터 `--json` 명령의 복구 가능한 warning event를
stderr JSON Lines로 출력하지만, 기존 live integration test가 계속 `stderr === ""`를 요구해 실패했다.
최종 stdout JSON envelope와 명령 exit code는 성공이었다.

실패한 test는 다음 5개다.

- `test/integration/delete.test.ts`
- `test/integration/mvp-acceptance.test.ts`
- `test/integration/put.test.ts`
- `test/integration/upload.test.ts`
- `test/integration/ensure-dir.test.ts`

로그에는 `rate-limit.wait-started`와 `rate-limit.wait-completed`만 나타났다. 모든 원인은 local shared
limiter의 `quota`였고, 한 번의 wait가 약 49–56초인 구간과 1–2초 구간이 실제로 관측됐다. 서버 429
또는 `server-cooldown` 증거는 없었다. 전체 integration step은 약 603초가 걸렸으며 3 pass, 17 skip,
5 fail이었다.

이 run에서 `Run Phase 13 observability probe` step은 실행되지 않았다. GitHub workflow run API는 당시
dispatch input 값을 반환하지 않으므로 `phase13_probe`를 선택하지 않은 것인지, 선택했지만 앞의 live
acceptance 실패와 기본 `success()` 조건 때문에 건너뛴 것인지는 로그만으로 확정할 수 없다. 어느
경우든 targeted probe 자체의 성공·실패 결과는 아직 없다.

## 다음 실행 범위

상세 계획은 [`phases/13-observability-and-test-latency.md`](phases/13-observability-and-test-latency.md)를
따른다.

1. 위 5개 integration test의 빈 stderr assertion을 새 계약에 맞게 수정한다.
   - `--json` stderr가 비어 있거나, 각 non-empty line이 안전한 event JSON object인지 검증한다.
   - event는 `type: "event"`, 해당 `command`, allowlisted event name을 가져야 한다.
   - 최종 성공 envelope는 계속 stdout JSON 하나이며 stderr에 terminal failure가 중복되지 않아야 한다.
   - 빈 stderr 호환성을 검증해야 할 때는 `--quiet`를 명시한다.
2. 일반 `bun run check`, build와 release contract test를 실행한다.
3. 수정 commit을 같은 PR #11 브랜치에 push하고 일반 PR CI를 확인한다.
4. workflow dispatch input을 한 번에 하나씩 실행해 원인을 격리한다.
   - 먼저 `phase13_probe=true`만 실행한다.
   - 그다음 `live_acceptance=true`만 실행한다.
5. stderr JSONL event, wall time, 원인별 wait 합계와 자연 발생 429 여부를
   `reference/test-latency-investigation.md`에 기록한다.
6. live 결과가 안정적이면 현행 bounded GET 429 정책 유지 결정을 확정하고 phase 문서,
   `PROGRESS.md`, 이 문서를 갱신해 Phase 13을 `complete`로 변경한다.

targeted probe를 full acceptance 실패와 무관하게 항상 실행해야 한다면 별도 job으로 분리하는 방식을
우선 검토한다. 같은 job에서 단순히 `if: always()`를 사용하면 checkout/build/PAT 검증 실패 뒤에도
실환경 요청을 시도할 수 있으므로 권장하지 않는다.

관측 전에 서버 429를 지연 원인으로 확정하거나 rate-limit bucket을 변경하지 않는다. transport와
feature에서 `console.*`를 직접 호출하지 않고 typed event boundary를 사용한다. event payload에는 raw
URL, query, header, body, PAT, Authorization과 signed URL을 전달하지 않는다.

## 별도 승인 경계

다음 작업은 Phase 13 시작이나 Phase 11 완료에 포함되지 않는다.

- draft Release 공개
- 저장소 public 전환
- npm package publish
- `oliverne/homebrew-tap` 생성 또는 갱신
- Scoop registry 등록
- credential 구성
- `v0.1.0` tag 이동·삭제 또는 공개 asset 교체
- MYBOX PAT가 필요한 live test 실행

이번 PAT workflow는 사용자가 직접 승인·실행했다. 후속 자동 재실행이나 새로운 live dispatch는 다시
사용자 의사를 확인한다.

## 로컬 Codex 시작 명령

기존 clone이 있다면 다음 순서로 최신 작업 브랜치를 받는다.

```bash
git fetch origin
git switch phase-13-observability
git pull --ff-only origin phase-13-observability
bun install --frozen-lockfile
bun run check
```

GitHub CLI를 사용한다면 `gh pr checkout 11`로 대체할 수 있다. 새 수정은 PR #11을 유지하도록 같은
브랜치에 commit/push한다. PAT는 저장소나 shell history에 기록하지 말고 GitHub repository secret을
통한 workflow dispatch를 우선 사용한다.

## 참고 문서

- `PLAN.md`
- `docs/PROGRESS.md`
- `docs/phases/11-distribution-release.md`
- `docs/phases/13-observability-and-test-latency.md`
- `docs/reference/test-latency-investigation.md`
- `docs/reference/human-cli-ui-investigation.md`
- `docs/operations/release.md`
- `docs/reference/cli-contract.md`
