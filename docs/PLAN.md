# myboxctl 구현 계획

> 대상 구현 에이전트: GPT 5.6 Luna
> 운영 환경: Ubuntu Server 24.04, macOS Latest, Windows 11
> 런타임: Bun 1.4+, TypeScript, ESM
> 주 호출자: 다양한 로컬 AI 에이전트

## 1. 목표

NAVER MYBOX Open API를 이용하여 다음 작업을 결정적으로 수행하는 경량 CLI를 만든다.

1. 원격 경로의 파일과 폴더 조회
2. 원격 폴더 생성과 계층 보장
3. 로컬 파일과 폴더 tree의 안전한 조건부 업로드와 명시적 강제 덮어쓰기
4. 원격 파일과 폴더를 MYBOX 휴지통으로 이동
5. 원격 파일과 폴더 tree를 로컬에 안전하게 다운로드
6. 다양한 AI 에이전트가 파싱할 수 있는 안정적인 JSON과 exit code 제공

예상 사용 방식:

```bash
myboxctl info /agents/output/report.md --json
myboxctl mkdir --parents /agents/output --json
myboxctl upload ./report.md /agents/output/ --mkdir --json
myboxctl upload ./output /agents/ --recursive --mkdir --json
myboxctl download /agents/output/report.md ./report.md --json
myboxctl download /agents/output ./output --recursive --json
myboxctl delete /agents/output/old-report.md --json
```

## 2. 비목표

- 양방향 sync 또는 원격 변경의 자동 로컬 반영
- 로컬 삭제에 따른 자동 원격 삭제
- 전체 디렉터리 미러링
- conflict resolution 엔진
- FUSE mount, GUI, TUI
- 다중 MYBOX 계정
- MVP 이전 daemon/watch 모드
- 완전한 rclone 호환
- MYBOX Open API 전체 기능의 wrapper

## 3. 핵심 결정

- Bun 1.4의 TypeScript 실행, `fetch`, test runner, build 기능을 사용한다.
- CLI command에서 직접 HTTP를 호출하지 않는다.
- 사용자는 POSIX 형식의 절대 원격 경로만 입력하며 `resourceId`를 입력하지 않는다.
- `resourceId`는 `list`/`info`와 mutation 결과의 machine JSON에 포함한다.
- `upload`는 원격 파일이 명확히 더 최신이면 기본적으로 conflict를 반환한다.
- 원격 최신 파일을 포함해 반드시 덮어써야 할 때만 `--force`를 사용한다.
- 변경 요청은 공통 fetch retry로 재실행하지 않고 operation별 reconcile/resume 정책을 사용한다.
- 검색 요청은 문서상 최저 한도인 10회/분을 기본값으로 프로세스 간 공유 조정한다.
- 실제 API 사실은 공식 문서 또는 재현 가능한 integration test로만 확정한다.
- 공식 API에 존재한다는 이유만으로 새 command를 추가하지 않는다. 실제 agent workflow가 필요성을 보여줄
  때만 범위를 확장한다.
- **첫 stable release 전에는 기존 코드 호환성보다 공식 MYBOX API 계약 정합성을 우선한다.** 현재
  public TypeScript type, 내부 abstraction, 테스트가 공식 계약을 잘못 모델링한다면 breaking change를
  허용하고 구조 자체를 바로잡는다.
- 잘못된 기존 구조를 유지하기 위한 compatibility shim, deprecated alias, dual behavior는 기본적으로
  추가하지 않는다. 테스트도 기존 동작 보존이 아니라 올바른 공식 계약을 검증하도록 수정한다.

상세 근거와 의존성 방향은 [`architecture/overview.md`](architecture/overview.md),
안정성 정책은 [`architecture/reliability.md`](architecture/reliability.md)를 따른다.
공식 API 전체 inventory와 현재 구현 coverage는
[`reference/official-api-audit.md`](reference/official-api-audit.md)를 따른다.

## 4. 문서 구조와 상태 관리

| 문서                | 역할                                    | 갱신 시점               |
| ------------------- | --------------------------------------- | ----------------------- |
| `PLAN.md`           | 범위, phase 순서, 프로젝트 완료 정의    | 범위나 phase가 바뀔 때  |
| `PROGRESS.md`       | phase/task 상태의 단일 기준             | 작업 시작/완료/차단 시  |
| `HANDOFF.md`        | 다음 에이전트가 즉시 이어받을 현재 문맥 | 모든 작업 종료 전       |
| `phases/*.md`       | 각 phase의 실행 가능한 상세 계획        | 해당 phase 계획 변경 시 |
| `architecture/*.md` | 설계 원칙과 트레이드오프                | 설계 결정 변경 시       |
| `reference/*.md`    | CLI/API 등 안정적인 계약과 coverage     | 관찰/계약 변경 시       |

상태 값은 `pending`, `in_progress`, `blocked`, `complete`만 사용한다. 원칙적으로 동시에 하나의
phase만 `in_progress`일 수 있다. 단, Phase 07의 마지막 live acceptance를 breaking contract correction
이후로 이관한 전환 기간에는 Phase 07과 Phase 08을 함께 `in_progress`로 둘 수 있으며, 예외 사유와
통합 종료 조건을 `PROGRESS.md`에 기록한다. phase 완료는 코드 작성 여부가 아니라 해당 phase
문서의 검증 및 handoff 조건으로 판정한다.

## 5. Phase 로드맵

### Phase 00 — MYBOX API 계약 검증

문서: [`phases/00-api-contract.md`](phases/00-api-contract.md)

구현을 좌우하는 미확인 계약을 실제 전용 테스트 경로에서 검증한다.

- 하위 폴더 목록 또는 검색 기반 exact path resolver 가능 여부
- 생성/업로드 직후 read-after-write 가시성
- 업로드 URL의 실제 method/header/body/응답
- `resume`, `modifiedTime`, `offset` 조합
- overwrite 후 `resourceId`와 `modifiedAt`
- 429 응답의 `Retry-After`

이 phase가 완료되기 전에는 resolver와 uploader의 최종 인터페이스를 고정하지 않는다.
완료 후에는 endpoint/schema/protocol 변경이나 기존 ledger와 모순되는 관찰이 있을 때만 broad
contract probe를 다시 실행한다. 후속 phase의 미확정 항목은 해당 항목만 다루는 targeted probe로
검증한다.

### Phase 01 — 기반과 CLI 계약

문서: [`phases/01-foundation.md`](phases/01-foundation.md)

- config 로딩과 PAT 보호
- 공통 오류 분류
- JSON 성공/오류 envelope
- exit code 매핑
- MYBOX fetch transport의 timeout, redaction, GET retry
- fake HTTP server test 기반

### Phase 02 — `stat`/`ls` 읽기 vertical slice

문서: [`phases/02-read-commands.md`](phases/02-read-commands.md)

- 원격 경로 normalize와 exact resolve
- cursor pagination
- `stat`, `ls`
- JSON 및 human-readable 출력

### Phase 03 — `ensure-dir`

문서: [`phases/03-ensure-dir.md`](phases/03-ensure-dir.md)

- 계층적 폴더 생성
- 이미 존재하는 폴더의 idempotent 성공
- 파일/폴더 type conflict
- 동시 생성 409 후 재조회/reconcile
- 검색 호출량 최적화와 프로세스 간 10회/분 sliding-window 조정

### Phase 04 — `upload`

문서: [`phases/04-upload.md`](phases/04-upload.md)

- file handle 기반 안정적인 stat/stream
- 100MB streaming, 실제 interruption resume와 `modifiedTime` 규칙의 targeted preflight probe
- 신규 업로드와 `--overwrite`
- 100MB 이상 파일의 bounded memory 검증
- interrupted upload와 resume
- 업로드 후 결과 검증
- resolve/postcondition 검색의 기존 공유 limiter 재사용

### Phase 05 — `put`

문서: [`phases/05-put.md`](phases/05-put.md)

- 순수 decision 함수
- remote absent, same, local newer, remote newer, size mismatch
- `--force`, `--mkdir`
- upload/overwrite/skip/conflict 결과
- Phase 03/04의 limiter와 mutation 안전 정책 재사용

### Phase 06 — `delete`

문서: [`phases/06-delete.md`](phases/06-delete.md)

- 휴지통 이동
- 없는 경로의 `already-absent`
- `--strict`
- resolve/delete 사이 race 처리
- delete 60회/분 공유 bucket과 operation-specific 429 reconcile

### Phase 07 — 안정화와 배포 준비

문서: [`phases/07-hardening.md`](phases/07-hardening.md)

- Unicode/한글/특수문자/빈 파일/대용량 파일
- timeout, 429, API 장애, SIGINT
- search/delete bucket의 교차 프로세스 state, stale lock, cooldown 검증
- `retryAfterMs` CLI contract와 natural 429 관찰 정책 검증
- CLI subprocess contract test
- Ubuntu Server 24.04 설치 및 운영 문서
- 실제 MYBOX acceptance test
- Phase 08의 breaking contract correction 이후 최종 live acceptance를 1회 실행하도록 P07-E를 이관

### Phase 08 — Official API alignment

문서: [`phases/08-official-api-alignment.md`](phases/08-official-api-alignment.md)

2026-08-24 공식 Open API 전수 조사 결과 중 **현재 CLI의 안정성과 계약 정합성에 직접 영향을 주는
항목만** 반영한다.

- `GET /v1/drive/storage`의 `maxFileBytes`를 upload/put preflight에 활용할지 결정하고 구현
- 검색/삭제 외 현재 사용 API의 공식 `API별 60회/분` 한도 alignment
- file search에서 공식 문서에 없는 `path` query를 public type/request가 표현하지 못하도록 정리
- PAT 유효기간, 암호 폴더/공유 받은 폴더 미지원 등 공식 제약과 사용자 문서 정합성 확인
- 기존 search/delete limiter와 mutation no-generic-retry 정책 regression 검증
- pre-release 단계에서는 기존 구현과의 호환성 유지보다 공식 API에 맞는 단순하고 정확한 구조를 우선
- 잘못된 abstraction/type/test를 유지하기 위한 shim 없이 필요한 breaking refactor 수행
- Phase 07은 완료 처리하지 않되, 중복 검증을 피하기 위해 남은 P07-E live acceptance를 Phase 08 최종 검증과 통합

Phase 08은 MYBOX API 전체 기능 추가 phase가 아니다. 다운로드, rename/move/copy, favorite, trash 관리
등 공식 API의 미구현 기능은 inventory에 남기고 실제 요구가 확인될 때만 별도 범위로 승격한다.

### Phase 09 — `download`

문서: [`phases/09-download.md`](phases/09-download.md)

Phase 00~08 MVP 완료 후 선택한 첫 후속 vertical slice다.

- exact remote file resolve와 folder/type conflict
- 1회용·10분 유효 signed download URL의 targeted contract probe
- signed URL과 PAT를 출력하지 않는 bounded-memory streaming
- 기존 로컬 파일을 기본적으로 보존하고 `--overwrite`에서만 명시적으로 교체
- 임시 파일과 원자적 commit을 통한 partial file 비노출
- 원격 metadata와 실제 byte count를 이용한 postcondition
- download URL 발급 한도와 retry 정책의 공식 계약 정합성
- fake HTTP, CLI subprocess, 실제 MYBOX acceptance 및 세 운영체제의 로컬 파일 commit 검증

Phase 09는 구현과 실제 MYBOX acceptance를 완료했다. Phase 00~08의 기존 MVP 완료 판정은 소급해
변경하지 않으며, 다음 기능은 실제 요구가 확인될 때 별도 phase로 정의한다.

### Phase 10 — Cross-implementation hardening

문서: [`phases/10-cross-implementation-hardening.md`](phases/10-cross-implementation-hardening.md)

PHP/Flysystem 구현체 교차 감사에서 확인한 후보 중 현재 CLI의 안전성과 신뢰성에 직접 필요한 항목만
자체 targeted probe로 검증한다.

- remote path component의 C0 control/DEL 거부
- delete 이후 resource detail, active path, parent listing 교차 확인
- NFC/NFD 및 대소문자 name semantics 관찰
- 관찰 전 Unicode normalization/case folding을 production resolver에 추가하지 않음
- generic mutation retry, purge/root clear, move/copy, full API wrapper는 제외

### Phase 11 — Distribution & Release

문서: [`phases/11-distribution-release.md`](phases/11-distribution-release.md)

Phase 00~10에서 완성한 CLI를 clone/Bun 설치 없이 사용할 수 있도록 동일한 standalone binary를 여러
배포 경로로 전달한다.

- Bun standalone 5개 target: macOS arm64/x64, Linux glibc arm64/x64, Windows x64
- version 주입, archive와 SHA-256, native `--version`/`--help` smoke
- tag 기반 draft GitHub Release 자동화
- npm optional platform packages, `oliverne/homebrew-tap`, Linux installer, Scoop manifest
- 실제 publish는 공개 Release, package/tap 소유권, credential과 native smoke 확인 뒤 명시적으로 실행

Phase 11은 CLI 기능/API 범위를 늘리지 않는다. Windows arm64, Linux musl, 자동 업데이트 기능은 실제
수요가 확인될 때 별도 범위로 다룬다.

### Phase 12 — Cross-platform Unicode filename compatibility

문서: [`phases/12-cross-platform-unicode-filenames.md`](phases/12-cross-platform-unicode-filenames.md)

macOS, Windows와 WSL2 사이에서 같은 사용자 표시 파일명이 NFC/NFD 차이로 서로 다른 원격 resource가
되는 문제를 첫 공개 릴리스 전에 방지한다.

- 로컬 파일시스템 경로는 입력 spelling 그대로 사용
- 새 원격 file/folder component는 NFC로 생성
- read exact lookup 실패 시 fully paginated direct-child 목록에서 단일 canonical-equivalent resource 조회
- mutation은 exact match 여부와 관계없이 canonical sibling의 유일성을 확인
- 여러 canonical-equivalent 후보는 mutation 없이 conflict
- 기존 NFD resource overwrite 시 ID와 실제 spelling을 보존해 NFC duplicate 방지
- macOS, Windows, Ubuntu CI와 실제 MYBOX targeted probe로 왕복 계약 검증

Phase 12는 case folding, 로컬 파일 rename, 기존 resource 자동 migration, 양방향 sync를 추가하지 않는다.

### Phase 13 — Observability & Integration Test Latency

문서: [`phases/13-observability-and-test-latency.md`](phases/13-observability-and-test-latency.md)

상세 분석: [`reference/test-latency-investigation.md`](reference/test-latency-investigation.md)

Human UI 조사: [`reference/human-cli-ui-investigation.md`](reference/human-cli-ui-investigation.md)

실제 MYBOX PAT로 통합 테스트를 돌리던 중, 개별 API 호출은 0.2~0.4초로 빠른데 `ensure-dir`/
`delete` acceptance가 수 분씩 걸리는 지연이 발견됐다. Phase 13 계측 결과 긴 대기는 서버 429가
아니라 공식 검색 한도를 지키는 local shared limiter의 `quota` 대기에서 발생했다.

Phase 13은 각 대기 경로를 구조화 event로 계측한 뒤 GET 429의 1회 retry와 60~61초 fallback을
유지·조정·fail-fast 중 하나로 판정한다. 같은 event boundary로 사람과 AI 에이전트에 자동 retry,
rate-limit 대기, upload/put 단계와 byte progress를 제공한다. 별도 format option 없이 기본 모드는
사람이 읽는 stdout 성공 결과와 stderr 오류/event를, `--json`은 stdout의 단일 최종 envelope와
stderr JSON Lines event를 사용한다. `--quiet`는 event만 억제하고 최종 오류는 유지한다. Phase 13은
로컬 CLI UI prototype에서 검증한 semantic status, 단일 progress bar와 단계 표현을 참고하되 범용
TUI dependency는 추가하지 않는다. TTY에서만 redraw/countdown을 사용하고 non-TTY는 line log로
유지한다. Phase 13은 신규 MYBOX API 범위나 mutation retry 정책을 추가하지 않는다.

격리된 targeted probe는 약 1.096초에 event 없이 통과했고, full live acceptance는 8 pass, 17
opt-in skip, 0 fail로 1,875.35초가 걸렸다. 자연 발생 서버 429와 `server-cooldown`은 관찰되지
않았으므로 검색 bucket과 bounded GET 429 retry 정책을 유지한다.

### Phase 14 — CLI UX & Agent Contract

문서: [`phases/14-cli-ux-and-agent-contract.md`](phases/14-cli-ux-and-agent-contract.md)

Phase 14는 첫 공개 Release 전에 기존 기능을 사람이 이해하기 쉽고 AI 에이전트가 안정적으로 파싱할 수
있는 public CLI contract로 정리한다. 상태는 `complete`이며 아래 구현·검증을 완료했다.

- canonical command를 `list`, `info`, `mkdir`, `upload`, `download`, `delete`로 정리
- upload/download destination과 not-found 동작을 예측 가능한 규칙으로 통일
- 기본 human 출력을 self-describing table과 문장형 결과로 개선
- versioned JSON envelope, 명시적 nullability, 단위와 action enum 고정
- global presentation option과 stdout/stderr 계약 단순화
- 일반 회귀, release smoke와 필요한 최소 live acceptance 후 공개 Release 경계 재확인

Phase 14는 새 MYBOX API나 동기화 기능을 추가하지 않는다. 구현 결과와 검증 사실은
`PROGRESS.md`와 `HANDOFF.md`에 기록한다. 실제 MYBOX live acceptance는 opt-in이라 이번
로컬 검증에서는 실행하지 않았다.

### Phase 15 — Recursive Folder Transfer

문서: [`phases/15-recursive-folder-transfer.md`](phases/15-recursive-folder-transfer.md)

단일 파일 전용 `upload`와 `download`를 명시적인 `--recursive` folder transfer로 확장한다.

- folder 입력은 `--recursive`가 있을 때만 허용하고 MYBOX root `/` 전체 다운로드는 거부
- local walk와 remote direct-child pagination으로 deterministic manifest를 만든 뒤 파일을 순차 전송
- config 파일의 `plan`과 `MYBOX_PLAN`으로 공식 요금제별 한도를 적용하고 미설정 시 보수적인 기본값 유지
- 이미 확인한 parent/resource ID를 재사용해 파일별 검색을 제거하고 정상 API 호출량을 회귀 검증
- 다운로드 일 한도 안내와 부분 실패 후 수동 처리 절차 제공; 실제 잔여 quota 추정과 폴더 resume는 제외
- empty folder 보존, portable name collision, symlink/non-regular entry와 manifest 이후 경로 교체를
  fail-closed
- transfer tree는 exclusive create하고 409/응답 유실로 소유권이 불확실하면 기존 tree에 merge하지 않음
- 기존 local/remote destination merge/recursive overwrite와 폴더 전체 atomic commit은 제외
- 기존 파일별 upload resume/postcondition, download temp/atomic commit과 secret redaction 재사용
- 부분 성공 또는 mutation 결과 불확실성을 version 1 failure envelope의 structured additive field로 제공
- Windows를 포함한 현장 오류를 재현할 수 있도록 모든 command에 opt-in `--diagnostic-log <file>` JSONL을
  제공하고, typed event와 최종 결과 및 제한된 OS 오류 정보를 secret redaction 뒤 기록
- fake HTTP/CLI 회귀, 세 운영체제 local filesystem과 승인된 실제 MYBOX round-trip으로 검증

Phase 15는 one-shot transfer이며 directory sync, remote watch 또는 local 삭제 전파를 추가하지 않는다.

## 6. 전체 MVP 완료 조건

이 절은 Phase 00~08에서 판정한 MVP 완료 기준을 기록한다. 이후 추가된 기능과 첫 public contract의
완료 조건은 각 후속 phase 문서를 따르며, 현재 공개 Release 전 최종 경계는 Phase 14 완료 조건이다.

다음 조건을 모두 충족해야 MVP를 완료할 수 있다.

```bash
bun run check
bun run build
bun run test:integration
```

`test:integration`은 command acceptance만 실행한다. broad `test:contract`는 API 계약 변경이나
ledger 모순 조사에만 사용하고 정기 MVP 검증에 포함하지 않는다. Phase 04의 upload targeted
probe 결과는 API ledger와 handoff에 이미 남아 있어야 한다.

실제 MYBOX 전용 테스트 prefix에서 아래 흐름이 성공해야 한다.

1. `ensure-dir` → `created` 또는 `existing`
2. 첫 `put` → `uploaded`
3. `stat` → 정확한 metadata
4. 동일 파일 `put` → `skipped`
5. 로컬 변경 후 `put` → `overwritten`
6. 원격이 명확히 최신인 경우 → `conflict`
7. 같은 상황에서 `--force` → `overwritten`
8. 첫 `delete` → `deleted`
9. 두 번째 `delete` → `already-absent`

추가 조건:

- stdout JSON만으로 호출한 AI 에이전트가 결과를 판정할 수 있다.
- 정상적인 대용량 업로드에서 메모리가 파일 크기에 비례해 증가하지 않는다.
- PAT, Authorization header, upload/download URL이 출력과 로그에 나타나지 않는다.
- 원격 mutation은 unique integration-test prefix 밖에서 실행되지 않는다.
- Phase 00~08이 모두 `complete`이고 `HANDOFF.md`에 미완료 MVP 구현 작업이 없다.

## 7. 이후 후보

MVP 완료 후 실제 요구가 확인된 경우에만 검토한다.

- local state/cache 및 SHA-256 기록
- resumable upload 고도화
- watch daemon
- systemd unit
- rename/move/copy
- favorite/unfavorite
- trash list/restore

휴지통 영구 삭제, 휴지통 전체 비우기, 계정 수준의 휴지통 보존 설정은 특히 파괴적이거나 전역적인
작업이므로 단순 편의 기능으로 추가하지 않는다. 공식 API 전체 후보와 검토 조건은
[`reference/official-api-audit.md`](reference/official-api-audit.md)에 기록한다.

watch가 추가되더라도 로컬 삭제는 원격 삭제로 전파하지 않는다.
