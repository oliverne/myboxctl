# Current handoff

## 인수 목적

Phase 13 Observability & Integration Test Latency의 P13-A~D 일반 구현과 회귀 검증은 완료됐다.
다음 단계는 PR CI 확인 후 opt-in targeted live probe를 실행하고 실제 wall time/event 증거를 기록하는
것이다.

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

## 다음 실행 범위

상세 계획은 [`phases/13-observability-and-test-latency.md`](phases/13-observability-and-test-latency.md)를
따른다.

1. PR의 Ubuntu/macOS/Windows 일반 CI를 확인한다.
2. `phase13_probe=true` workflow_dispatch를 1회 실행한다.
3. stderr JSONL event, wall time과 자연 발생 429 여부를 기록한다.
4. 결과에 따라 현행 429 정책 유지 결정을 확정하고 Phase 13을 `complete`로 변경한다.

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

## 참고 문서

- `PLAN.md`
- `docs/PROGRESS.md`
- `docs/phases/11-distribution-release.md`
- `docs/phases/13-observability-and-test-latency.md`
- `docs/reference/test-latency-investigation.md`
- `docs/reference/human-cli-ui-investigation.md`
- `docs/operations/release.md`
- `docs/reference/cli-contract.md`
