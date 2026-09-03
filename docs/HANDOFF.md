# Current handoff

## 인수 목적

Phase 00~14의 구현과 로컬 검증을 완료했다. 첫 공개 Release 전에 CLI command surface와 출력 계약을
정리하는 Phase 14를 반영했으며 상태는 `complete`이다. 공개 Release/publish는 별도 승인 대상이다.
첫 공개 목표 version은 `v0.2.0`이며 사용자 실행 절차는
[`operations/release-v0.2.0-checklist.md`](operations/release-v0.2.0-checklist.md)에 정리했다.

## 현재 상태

- Phase 00~13: `complete`
- Phase 14: `complete`
- 활성 구현 phase: 없음
- 작업 브랜치: 없음 (PR #11은 `main`으로 merge 완료)
- PR: [#11 feat: add Phase 13 observability and progress events](https://github.com/oliverne/myboxctl/pull/11) — 2026-08-31 merge됨
- integration stderr 계약 수정 commit: `710cde214f93d7758b7cabe226b6d0d769c28bd4`
- 로컬 검증: `bun run check` 236 pass, 35 opt-in skip, 0 fail; `bun run build` 통과
- 별도 release contract: `bun run test:release` 4 pass, 0 fail
- Phase 14 계획: [`phases/14-cli-ux-and-agent-contract.md`](phases/14-cli-ux-and-agent-contract.md)
- Phase 14 구현·검증: P14-A~E 완료
- 2026-09-01 최근 소스 리뷰: [`reviews/2026-09-01-phase14-source-review.md`](reviews/2026-09-01-phase14-source-review.md)
- 리뷰 결과 blocker는 없으며 공개 Release 전 P2 hardening 3건을 권장했다. 2026-09-01 실행에서 3건을 모두 처리했다: upload host-native basename, CJK/긴 이름 human table 열 순서(`TYPE SIZE MODIFIED NAME`), public resource malformed API fail-closed 검증. 초기 검증: `bun run check` 234 pass/35 skip/0 fail, `bun run build` 통과, `bun run test:release` 4 pass. 후속 `modifiedAt` RFC 3339 검증 강화와 test lint 보정 후 CI run `33576388192`는 236 pass/35 skip/0 fail로 성공했다(최종 commit `7e474bdd310d8455d432964a6ff4a43d1356c74e`).

canonical command는 `list`/`ls`, `info`, `mkdir`, `upload`, `download`, `delete`다. destination intent와
`mkdir -p`, delete `--ignore-missing`, human table/sentence renderer, `schemaVersion: 1`,
`sizeBytes`와 explicit nullable fields, normalized type/time, JSON stdout/stderr와 global presentation
option 위치를 구현했다. 기존 legacy command와 제거된 option은 public CLI에서 제거했다.

2026-09-03 README를 사람용 요약 문서로 줄였고, 명령·옵션·JSON/exit code 계약은 루트 `llms.txt`로
분리했다. CLI source와 public contract는 변경하지 않았으며, 이번 문서 변경에서는 실제 MYBOX live
test를 실행하지 않는다.

Phase 14 review 후 기본 `mkdir`도 생성 응답 유실 가능 오류 뒤에 exact path를 polling해 reconcile하고
mutation POST를 반복하지 않는다. `download` command는 검증한 최초 canonical resolution을 local
destination 계산과 실제 download 실행에 전달하므로 command당 원격 path search는 1회다. 두 동작은
unit regression으로 고정했다.

5개 live integration test의 오래된 `stderr === ""` assertion을 제거했다. 각 CLI subprocess는
`--json` stderr가 비어 있거나 모든 non-empty line이 다음 조건을 만족하는지 검증한다.

- `type: "event"`와 실제 command
- allowlisted event name, top-level field와 event별 data field
- `info` 또는 `warning` level
- PAT, Authorization, upload/download URL과 signed query 비노출

최종 stdout은 계속 JSON envelope 하나이며 terminal failure가 stderr에 중복되면 event parser가
실패한다. 빈 stderr가 계약인 경우는 기존 `--quiet` subprocess 회귀 test가 별도로 유지한다.

### 2026-09-02 upload 통합 테스트 정정

- `test/integration/upload.test.ts`는 Phase 14에서 `put`이 `upload`로 통합된 뒤 메타데이터 정책을
  반영하지 않아 stale 상태였다. 기존 원격 파일이 크기만 다를 때 `--force` 없이도 자동 덮어쓰기
  (size-different → `overwritten`, exit 0)되므로 충돌(exit 5) 단언은 잘못됐다. 단언을 병합된 의미에
  맞게 정정했고, 같은 명령의 권위 있는 acceptance는 `test/integration/put.test.ts`다.
- 정정 때 업로드를 3회→5회로 늘렸으나 `setDefaultTimeout`은 180_000으로 두어, 10회/분 공유 검색
  quota 대기(버스트 뒤 ~60초 데드 구간 반복) 때문에 3번째 `--force` 업로드가 180초 타임아웃으로
  SIGTERM(143) 종료됐다. 동급 acceptance인 `put.test.ts`(8회 업로드, 900_000)와 맞춰 900_000으로
  올렸다. 라이브 재실행은 아직 확인하지 않아 미검증(unverified)으로 둔다.
- 업로드 경로의 중복 검색을 줄이는 리팩터를 적용했다. `runPut`이 구한 `resolveForMutation(target)`
  결과를 선택적 파라미터로 `runUpload`에 넘겨, `runUpload`가 동일 대상을 다시 `resolveForMutation`
  하는 중복을 제거했다(`src/features/put/command.ts`, `src/features/upload.ts`). `runUpload` 시그니처는
  5번째 인자를 선택적으로 추가해 기존 호출/테스트는 그대로 통과한다. 로컬 `bun run check`는 236 pass,
  35 skip, 0 fail. 라이브 검색 호출 수 감소는 아직 확인하지 않아 미검증이다. `resolveUploadDestination`의
  `resolveCanonical`과 `runPut`의 `resolveForMutation`이 같은 대상을 푸는 나머지 중복은 별도 범위다.
- 특수문자 파일명(`한글 # %+.txt`)의 exact 충돌/덮어쓰기 감지는 `searchFiles({ q, parentPath })`의
  `q` 매칭에 의존하며, 서버가 `# % +`를 literal로 취급하는지는 미확인이다. transport 계층은
  `searchParams.set`으로 퍼센트 인코딩하므로 전송은 안전하다. 이 동작은 자연 관찰 또는 전용 probe
  전까지 미확정(API-12)으로 두고 `docs/reference/mybox-api.md`에 기록했다.

### 2026-09-03 v0.2.0 live acceptance

사용자가 로컬에서 `MYBOX_INTEGRATION=1 bun test test/integration`을 실행해 8 pass, 17 opt-in skip,
0 fail, 2,284.88초로 통과했다. 통과 8건: download/upload/put/ensure-dir/delete acceptance, final MVP
flow(격리 자원 2회), upload probe interruption 분류 2건. skip 17건은 `live_acceptance=true` 또는
`phase*` 플래그 기반 opt-in probe로 plain 실행에서는 의도적으로 건너뛴다. unique integration child는
suite가 cleanup까지 검증한다.

이 실행으로 2026-09-02 정정에서 미검증으로 두었던 두 항목을 확인했다.
- upload 통합 `setDefaultTimeout(900_000)` 상향 뒤 `--force` 업로드가 SIGTERM(143) 없이 완료된다.
- `runPut`→`runUpload` resolution 전달 리팩터가 라이브 upload/put acceptance를 그대로 통과한다.

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

1. 사용자가 시작한 `MYBOX_INTEGRATION=1 bun test test/integration`의 최종 결과와 cleanup을 확인한다.
2. [`operations/release-v0.2.0-checklist.md`](operations/release-v0.2.0-checklist.md)에 따라 기존 미공개
   `v0.1.0` draft/tag를 정리한다.
3. 현재 `main`에 `v0.2.0` annotated tag를 생성·push하고 Release workflow의 5개 native smoke와 새
   draft asset 9개를 확인한다.
4. 저장소 public 전환과 GitHub Release 공개 후 npm, Homebrew, Linux installer와 Scoop을 순서대로
   게시·검증한다. 각 외부 변경과 credential 설정은 사용자가 직접 수행하거나 별도 승인 후 진행한다.
5. 배포 결과를 `README.md`, `docs/PROGRESS.md`, `docs/HANDOFF.md`에 사실 기준으로 반영한다.

## 로컬 시작 명령

```bash
git fetch origin
git switch main
git pull --ff-only origin main
bun install --frozen-lockfile
bun run check
```

GitHub CLI로는 `gh pr view 11`로 merge 상태를 확인할 수 있다.
