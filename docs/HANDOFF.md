# Current handoff

## 인수 목적

Phase 00~14의 구현과 로컬 검증을 완료했고 Phase 15 recursive folder transfer의 로컬 구현과 일반 검사를
완료했다. 교차 운영체제와 실제 MYBOX 검증이 남아 상태는 `in_progress`이다. 인자 없는 실행의 root help 수정은 commit
`fd36b3d`와 `v0.2.3` tag로 push했고 npm `latest`로 게시했다. 실행 절차는
[`operations/npm-release.md`](operations/npm-release.md)에 있다.

## 현재 상태

- Phase 00~13: `complete`
- Phase 14: `complete`
- Phase 15: `in_progress`
- 활성 구현 phase: Phase 15
- 작업 브랜치: 없음 (PR #11은 `main`으로 merge 완료)
- PR: [#11 feat: add Phase 13 observability and progress events](https://github.com/oliverne/myboxctl/pull/11) — 2026-08-31 merge됨
- integration stderr 계약 수정 commit: `710cde214f93d7758b7cabe226b6d0d769c28bd4`
- 로컬 검증: Phase 15 구현 기준 `bun run check` 248 pass, 37 opt-in skip, 0 fail. 별도
  `bun run build` 결과는 아래 Phase 15 기록에 남긴다.
- Phase 14 계획: [`phases/14-cli-ux-and-agent-contract.md`](phases/14-cli-ux-and-agent-contract.md)
- Phase 14 구현·검증: P14-A~E 완료
- 2026-09-01 최근 소스 리뷰: [`reviews/2026-09-01-phase14-source-review.md`](reviews/2026-09-01-phase14-source-review.md)
- 리뷰 결과 blocker는 없으며 공개 Release 전 P2 hardening 3건을 권장했다. 2026-09-01 실행에서 3건을 모두 처리했다: upload host-native basename, CJK/긴 이름 human table 열 순서(`TYPE SIZE MODIFIED NAME`), public resource malformed API fail-closed 검증. 초기 검증: `bun run check` 234 pass/35 skip/0 fail, `bun run build` 통과, `bun run test:release` 4 pass. 후속 `modifiedAt` RFC 3339 검증 강화와 test lint 보정 후 CI run `33576388192`는 236 pass/35 skip/0 fail로 성공했다(최종 commit `7e474bdd310d8455d432964a6ff4a43d1356c74e`).

canonical command는 `list`/`ls`, `info`, `mkdir`, `upload`, `download`, `delete`다. destination intent와
`mkdir -p`, delete `--ignore-missing`, human table/sentence renderer, `schemaVersion: 1`,
`sizeBytes`와 explicit nullable fields, normalized type/time, JSON stdout/stderr와 global presentation
option 위치를 구현했다. 기존 legacy command와 제거된 option은 public CLI에서 제거했다.

2026-09-04 공개 기본 `README.md`를 영문으로 전환하고 `README.ko.md`를 추가했다. 별도 AI 요약 문서는
삭제하고 공개 command, 인증, 핵심 안전 규칙과 자동화 계약만 두 README에 통합했다. 두 문서는 서로
링크하며 상세 계약은 `docs/reference/cli-contract.md`를 기준으로 한다.

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

### 2026-09-03 배포 전략 변경 (standalone 폐기 → npm-only)

macOS Gatekeeper 차단 문제와 미사용 판단으로 standalone 실행파일 배포를 폐기하고 npm(Node 기반)
단독 배포로 전환했다. 상세 사실은 `PROGRESS.md`의 동명 섹션에 있다.

- 삭제: `scripts/build-release.ts`, `render-packaging.ts`, `verify-release.ts`, `release-config.ts`(+test),
  `test/cli/release-contract.test.ts`, `.github/workflows/release.yml`, `.github/workflows/publish-homebrew.yml`,
  `docs/operations/release.md`, `docs/operations/release-v0.2.0-checklist.md`. `package.json`에서
  `build:release`/`verify:release`/`test:release` 제거.
- `src`의 Bun 런타임 API 4곳을 Node 동등 코드로 교체, `build.ts` target `bun`→`node`, npm 패키지 재작성
  (Node 번들 + `bin/myboxctl.js` 런처, `engines.node >= 20`). Homebrew/Scoop/install.sh 경로 폐기.
- `v0.2.0` draft Release 삭제 완료. `v0.2.0` tag는 npm publish용 보존(게시 시 새 commit으로 이동 필요).
- 로컬 검증: `bun run check` 229 pass / 35 skip / 0 fail; `node release/npm/bin/myboxctl.js --version`
  → `0.2.0` 출력·exit 0.

### 2026-09-04 npm package 리뷰 수정

- npm launcher를 `process.exitCode = code ?? 0`으로 바꿔 pending stdout/stderr write를 보존한다.
- 실제 Node child process와 pipe를 사용해 stdout/stderr 각각 2 MiB 및 exit 7을 검증하는 회귀 테스트를
  추가했다. 수정 전 truncation을 재현했고 수정 후 통과한다.
- npm package에 루트 `README.md`를 복사하고 manifest `files`에도 포함했다.
- 검증: 대상 test 2 pass, `bun run check` 231 pass / 35 opt-in skip / 0 fail, 별도 `bun run build`
  통과. v0.2.1 package launcher `--version`은 `0.2.1`/exit 0, `npm pack --dry-run`은 README를 포함한
  5개 파일을 확인했다. MYBOX live test와 npm publish는 실행하지 않았다.

### 2026-09-04 npm publish 차단점 수정

- `bun test`가 `src/cli.ts`를 import할 때 `Bun.main` 조건으로 CLI까지 실행해 233개 test가 통과해도
  process exit 2가 되는 문제를 수정했다. 직접 실행 여부를 process entry와 module URL로 판정한다.
- import가 host exit code를 바꾸지 않는 회귀 test와 실제 Node bundle을 npm launcher로 실행했을 때
  `--version`이 정확히 한 번 출력되는 회귀 test를 추가했다.
- `publish-npm.yml`에 동일 tag concurrency, 일반 check, package version/help/pack 검증을 추가했다.
- 첫 publish 후보는 `v0.2.2`다. 이미 push된 `v0.2.1`은 이 수정 전 commit을 가리키므로 publish에
  사용하지 않고 이력으로 유지한다.
- [`operations/npm-release.md`](operations/npm-release.md)에 최초 publish용 granular token 생성,
  GitHub secret 등록, tag/workflow, registry smoke와 이후 OIDC 전환 순서를 기록했다.

### 2026-09-04 영문·국문 README 통합

- 공개 GitHub/npm 기본 문서는 영문 `README.md`, 한국어 문서는 `README.ko.md`다. 두 문서는 상단과
  문서 목록에서 서로 링크한다.
- 별도 AI 요약 문서는 삭제했다. 필요한 command/인증/안전/JSON/exit code 요약만 README에 통합하고
  상세 계약은 `docs/reference/cli-contract.md`로 연결했다.
- npm package manifest와 준비 script가 두 README를 모두 포함하며, 실제 package 복사를 회귀 test로
  검증한다.
- 두 README는 각각 98줄, 97줄이다. Prettier, local link 검사와 v0.2.2 package dry-run이 통과했다.

### 2026-09-04 root no-args help 수정

- 게시된 `v0.2.2`에서 `myboxctl`을 인자 없이 실행하면 stderr에 `Error: (outputHelp)`가 나오고 exit 2로
  종료되는 문제를 재현했다.
- 인자가 없으면 runtime/config/PAT를 초기화하지 않고 root help를 stdout에 출력한 뒤 exit 0으로
  종료하도록 수정했다. subprocess 회귀 테스트는 help 내용, 빈 stderr와 MYBOX API 미호출을 검증한다.
- `bun run check`는 234 pass, 35 opt-in skip, 0 fail이고 별도 build도 통과했다. v0.2.3 npm launcher의
  no-args help/`--version`과 6개 파일 package dry-run도 통과했다.
- 이 변경은 commit `fd36b3d`와 `v0.2.3` tag로 push했고 main CI run `33885020537`이 성공했다.
  `v0.2.3`은 npm `latest`로 게시됐으며 MYBOX live test는 실행하지 않았다.

### 2026-09-04 live probe entrypoint 정리

- `test:phase10-probe`와 `phase10_probe`를 `test:server-semantics-probe`와
  `server_semantics_probe`로 바꾸고 opt-in 환경변수도 동작 중심으로 변경했다.
- `test:phase12-probe`와 `phase12_probe`를 `test:unicode-probe`와 `unicode_probe`로 바꿨다.
- 낮은 신호의 Phase 13 observability live probe와 script/CI input/step은 제거했다. observability 계약은
  `src/observability.test.ts`, `src/human-ui.test.ts`와 전체 live integration의 JSONL 검증이 유지한다.
- `bun run check` 234 pass, 34 opt-in skip, 0 fail, 별도 build와 CI YAML parsing이 통과했다. 실제 MYBOX
  probe는 실행하지 않았다. 변경은 아직 commit/push하지 않았다.

### 2026-09-05 Phase 15 계획

- 다음 기능은 [`phases/15-recursive-folder-transfer.md`](phases/15-recursive-folder-transfer.md)의
  one-shot recursive folder upload/download다. 상태는 `pending`이다.
- folder에는 `--recursive`를 요구하고 root `/` download, 기존 destination merge/recursive overwrite,
  parallel transfer와 tree 전체 atomic commit은 제외한다.
- 계획 리뷰 후 missing parent/`--mkdir` matrix, transfer tree exclusive create, response-loss uncertain
  중단, portable name과 manifest 이후 file/directory identity 검증을 명시했다.
- remote topology/file metadata 재검증, 기존 파일별 upload/download 정책 재사용과 structured partial
  failure 계약을 P15-A~D로 나눴다.
- 계획 문서 수정 후 Prettier와 `git diff --check`, `bun run check` 234 pass/34 opt-in skip/0 fail 및 별도
  `bun run build`가 통과했다.
- 구현, 실제 MYBOX 검증, commit/push는 실행하지 않았다.

### 2026-09-05 download progress 및 공백 경로 문서화

- Windows 대용량 download에서 진행 상태가 보이지 않는다는 사용자 피드백에 따라, 현재 구현에 없는
  download byte progress를 Phase 15 구현 범위로 명시했다.
- 단일 파일과 recursive download 모두 실제로 기록한 byte 기반 `download.transfer-*` event를 내고,
  기존 500ms TTY 표시 및 verbose non-TTY/JSONL 정책을 따르도록 계획·완료 조건을 구체화했다.
- `README.md`와 `README.ko.md`에 공백이 있는 local/remote 경로를 각각 quote하는 PowerShell 및
  `cmd.exe` 예시를 추가했다. 구현과 live MYBOX 검증은 실행하지 않았다.
- 검증은 `bun run check` 233 pass/35 opt-in skip/0 fail, 별도 `bun run build`와
  `git diff --check` 통과다.

### 2026-09-05 PowerShell API 토큰 관리 가이드

- `docs/operations/powershell-api-secrets.md`를 추가해 PowerShell SecretStore 기반 토큰 관리와
  AI agent 자동 로드 방법을 문서화했다.
- 문서에는 실제 secret 값을 포함하지 않았고, 코드 변경과 MYBOX live test는 실행하지 않았다.

### Phase 15 API 사용 한도 검토 반영

- 계획에 사용자 `plan` 설정을 추가했다. `MYBOX_PLAN` → XDG 지원 `config.json`의 `plan` → 보수적
  기본값 순서로 적용하며, 요금제별 검색/삭제 한도와 다운로드 일 한도 참고값을 매핑한다.
- 요금제 자동 감지, 임의 rate override와 limiter 해제는 제외한다. 요금제 변경 시 기존 공유 호출
  이력과 cooldown을 보존한다. 설정은 아직 구현되지 않았다.
- P15-A에서 설정/preset/limiter 검증, P15-B에서 parent ID 재사용과 파일별 search 제거, P15-C에서
  detail `2N`·URL 발급 `N`·목록 `2P` 검증, P15-D에서 사용자 문서와 일 한도 안내를 구현한다.
- 다운로드 일 한도는 실제 남은 횟수로 표시하지 않는다. 부분 실패 후 같은 effective destination root
  재전송은 conflict이며, 남은 파일의 단일 다운로드 또는 새 destination으로 재전송하는 수동 절차를
  문서화한다. 같은 CLI 인자의 재실행은 기존 directory를 container로 해석할 수 있어 이어받기가 아니다.
- 이번 반영은 문서 변경이며 Phase 15는 `pending`이다. 구현과 실제 MYBOX 검증은 실행하지 않았다.
- 이번 문서 변경의 Prettier 검사와 `git diff --check`가 통과했다. 전체 check/build는 재실행하지
  않았으며 위의 234 pass 기록은 앞선 계획 변경 시점의 결과다.

### 2026-09-05 Phase 15 Windows 진단 로그 계획

- Windows 테스트에서 error code만 남아 원인 확인이 어려웠던 사례를 Phase 15 계획에 반영했다.
- 모든 canonical command의 opt-in `--diagnostic-log <file>`은 기존 file/symlink를 덮어쓰지 않는 독립
  JSONL로 계획했다. 실행 환경, typed event, 최종 envelope/exit code와 제한된 OS 오류 정보를 남긴다.
- console/file sink 분리, presentation option과 무관한 file 기록, SIGINT flush, open/first-write/mid-write
  failure, Node npm launcher 기반 Windows 회귀와 secret redaction 조건을 구체화했다.
- local path와 redaction된 stack은 opt-in 로그에 포함될 수 있어 공유 전에 검토하도록 문서화한다. raw
  argv, HTTP header/body, PAT, Authorization과 signed URL은 기록하지 않는다.
- 이번 변경은 문서 계획이며 Phase 15는 `pending`이다. 구현, 실제 MYBOX 호출, commit/push는 실행하지
  않았다.
- 대상 문서 Prettier 검사와 `git diff --check`가 통과했다. 코드 변경이 없어 전체 check/build는
  재실행하지 않았다.

## Phase 15 로컬 구현 결과

- `upload <directory> ... --recursive`와 `download <folder> ... --recursive`를 구현했다. manifest-first,
  exclusive transfer root, no-merge, empty folder, portable name/collision, local identity와 remote topology 재검증,
  파일별 기존 upload/download 안전 정책을 적용한다.
- mutation 응답이 불확실하면 같은 POST를 반복하지 않는다. 이미 확인된 file/folder/byte와 root 소유권을
  `error.partialTransfer`에 기록해 pre-mutation failure와 partial/uncertain failure를 구분한다.
- 요금제 설정은 `MYBOX_PLAN`, `config.json`, 보수적 기본값 순이다. shared limiter의 기존 history와 cooldown은
  유지한다. download 일 한도는 실제 잔여량이 아닌 참고값으로만 출력한다.
- 실제 write byte 기반 download progress와 TTY/non-TTY/JSONL 표시를 추가했다. 모든 canonical command의
  opt-in `--diagnostic-log`는 exclusive mode 0600 JSONL로 run/event/final envelope와 exit code를 기록하며
  secret-shaped 값과 raw HTTP/argv는 제외한다.
- `test/integration/recursive-transfer.test.ts`는 기존 opt-in gate 아래 unique child의
  nested/empty/Unicode/0-byte 왕복과 resource ID cleanup을 검증하도록 추가했다. 이번 작업에서는 PAT 기반
  live mutation을 실행하지 않았다.
- 로컬 `bun run check`: 248 pass, 37 opt-in skip, 0 fail. 별도 `bun run build`: 통과. 교차 운영체제 CI와
  실제 MYBOX round-trip은 미검증이므로 Phase 15는 `in_progress`를 유지한다.
- 변경은 아직 commit/push하지 않았다.

### 2026-09-05 3-OS local 검증 연결

- `.github/workflows/ci.yml`의 Ubuntu/macOS/Windows matrix가 Phase 15 tree manifest, recursive transfer,
  diagnostic log, upload/download local·HTTP·CLI와 npm launcher 테스트를 실행하도록 확장했다. 이 job은
  MYBOX credential과 live mutation을 사용하지 않는다.
- workflow YAML은 Ruby YAML parser로 확인했고, 현재 checkout에서 같은 테스트 묶음은 ephemeral fake HTTP
  port를 허용한 실행으로 48 pass, 0 fail이었다. 실제 3-OS Actions run은 아직 없으며 commit/push도 하지
  않았다.

## 원격 검증

- PR CI run [`33388258127`](https://github.com/oliverne/myboxctl/actions/runs/33388258127): 성공
- PR Release run [`33388258207`](https://github.com/oliverne/myboxctl/actions/runs/33388258207): 5개 native smoke 성공
- Phase 13 targeted probe run [`33388395781`](https://github.com/oliverne/myboxctl/actions/runs/33388395781): 성공
- full live acceptance run [`33388494698`](https://github.com/oliverne/myboxctl/actions/runs/33388494698): 성공

targeted probe는 당시 전용 workflow input만 켜 실행했다. 기존 `/myboxctl-integration-test/` root를 조회하고
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

- 저장소: `oliverne/myboxctl` (public)
- 기본 브랜치: `main`
- `v0.1.0` tag/Release: 삭제됨 (2026-09-03)
- `v0.2.2` tag: 생성·push 완료. `v0.2.0`과 `v0.2.1` tag는 이전 commit을 가리키는 이력 마커로
  잔류. GitHub Release: 없음
- `v0.2.3` tag: root help 수정 commit `fd36b3d`를 가리키며 생성·push 및 npm 게시 완료
- 배포 방식: npm 단독(`@oliverne/myboxctl`), standalone 실행파일/Homebrew/Scoop/install.sh 폐기
- npm publish: `@oliverne/myboxctl@0.2.3` 게시 완료, npm `latest`도 `0.2.3`. Homebrew tap/Scoop
  registry: 폐기

PR #11 merge는 2026-08-31에 완료했다. 추가 package publish, tag 생성, credential 변경은 각각 별도
승인 후 실행한다. 추가 MYBOX live test도 다시 사용자 의사를 확인한다.

## 다음 실행 범위

1. Phase 15 변경을 선택적으로 검토·commit한 뒤, push 승인 시 3-OS Actions matrix를 실행한다.
2. 별도 승인을 받아 `MYBOX_INTEGRATION=1 bun test test/integration`으로 recursive round-trip과 cleanup을
   실행한다.
3. 실제 결과를 반영해 Phase 15 완료 조건과 `PROGRESS.md`/`HANDOFF.md`를 갱신한다.
4. 다음 npm 배포가 필요하면 version을 정한 뒤 [`operations/npm-release.md`](operations/npm-release.md)를
   따른다. tag/publish는 별도 승인 대상이다.

## 로컬 시작 명령

```bash
git fetch origin
git switch main
git pull --ff-only origin main
bun install --frozen-lockfile
bun run check
```

GitHub CLI로는 `gh pr view 11`로 merge 상태를 확인할 수 있다.
