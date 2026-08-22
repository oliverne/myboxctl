# myboxctl 구현 계획

> 대상 구현 에이전트: GPT 5.6 Luna
> 운영 환경: Ubuntu Server 24.04, macOS Latest, Windows 11
> 런타임: Bun 1.4+, TypeScript, ESM
> 주 호출자: 다양한 로컬 AI 에이전트

## 1. 목표

NAVER MYBOX Open API를 이용하여 다음 작업을 결정적으로 수행하는 경량 CLI를 만든다.

1. 원격 경로의 파일과 폴더 조회
2. 원격 폴더 계층 보장
3. 로컬 파일의 신규 업로드와 명시적 덮어쓰기
4. 로컬/원격 메타데이터를 비교하는 조건부 `put`
5. 원격 파일과 폴더를 MYBOX 휴지통으로 이동
6. 다양한 AI 에이전트가 파싱할 수 있는 안정적인 JSON과 exit code 제공

예상 사용 방식:

```bash
myboxctl stat /agents/output/report.md --json
myboxctl ensure-dir /agents/output --json
myboxctl put ./report.md /agents/output/report.md --json
myboxctl delete /agents/output/old-report.md --json
```

## 2. 비목표

- 양방향 sync 또는 원격 변경의 로컬 반영
- 로컬 삭제에 따른 자동 원격 삭제
- 전체 디렉터리 미러링
- conflict resolution 엔진
- FUSE mount, GUI, TUI
- 다중 MYBOX 계정
- MVP 이전 daemon/watch 모드
- 완전한 rclone 호환

## 3. 핵심 결정

- Bun 1.4의 TypeScript 실행, `fetch`, test runner, build 기능을 사용한다.
- CLI command에서 직접 HTTP를 호출하지 않는다.
- 사용자는 POSIX 형식의 절대 원격 경로만 입력하며 `resourceId`를 입력하지 않는다.
- `resourceId`는 `stat`/`ls`의 진단용 JSON 출력에는 포함할 수 있다.
- `put`은 원격 파일이 명확히 더 최신이면 기본적으로 conflict를 반환한다.
- 원격 최신 파일을 포함해 반드시 덮어써야 할 때만 `--force`를 사용한다.
- 변경 요청은 공통 fetch retry로 재실행하지 않고 operation별 reconcile/resume 정책을 사용한다.
- 실제 API 사실은 공식 문서 또는 재현 가능한 integration test로만 확정한다.

상세 근거와 의존성 방향은 [`docs/architecture/overview.md`](docs/architecture/overview.md),
안정성 정책은 [`docs/architecture/reliability.md`](docs/architecture/reliability.md)를 따른다.

## 4. 문서 구조와 상태 관리

| 문서                     | 역할                                    | 갱신 시점               |
| ------------------------ | --------------------------------------- | ----------------------- |
| `PLAN.md`                | 범위, phase 순서, 프로젝트 완료 정의    | 범위나 phase가 바뀔 때  |
| `docs/PROGRESS.md`       | phase/task 상태의 단일 기준             | 작업 시작/완료/차단 시  |
| `docs/HANDOFF.md`        | 다음 에이전트가 즉시 이어받을 현재 문맥 | 모든 작업 종료 전       |
| `docs/phases/*.md`       | 각 phase의 실행 가능한 상세 계획        | 해당 phase 계획 변경 시 |
| `docs/architecture/*.md` | 설계 원칙과 트레이드오프                | 설계 결정 변경 시       |
| `docs/reference/*.md`    | CLI/API 등 안정적인 계약                | 관찰/계약 변경 시       |

상태 값은 `pending`, `in_progress`, `blocked`, `complete`만 사용한다. 동시에 하나의
phase만 `in_progress`일 수 있다. phase 완료는 코드 작성 여부가 아니라 해당 phase 문서의
검증 및 handoff 조건으로 판정한다.

## 5. Phase 로드맵

### Phase 00 — MYBOX API 계약 검증

문서: [`docs/phases/00-api-contract.md`](docs/phases/00-api-contract.md)

구현을 좌우하는 미확인 계약을 실제 전용 테스트 경로에서 검증한다.

- 하위 폴더 목록 또는 검색 기반 exact path resolver 가능 여부
- 생성/업로드 직후 read-after-write 가시성
- 업로드 URL의 실제 method/header/body/응답
- `resume`, `modifiedTime`, `offset` 조합
- overwrite 후 `resourceId`와 `modifiedAt`
- 429 응답의 `Retry-After`

이 phase가 완료되기 전에는 resolver와 uploader의 최종 인터페이스를 고정하지 않는다.

### Phase 01 — 기반과 CLI 계약

문서: [`docs/phases/01-foundation.md`](docs/phases/01-foundation.md)

- config 로딩과 PAT 보호
- 공통 오류 분류
- JSON 성공/오류 envelope
- exit code 매핑
- MYBOX fetch transport의 timeout, redaction, GET retry
- fake HTTP server test 기반

### Phase 02 — `stat`/`ls` 읽기 vertical slice

문서: [`docs/phases/02-read-commands.md`](docs/phases/02-read-commands.md)

- 원격 경로 normalize와 exact resolve
- cursor pagination
- `stat`, `ls`
- JSON 및 human-readable 출력

### Phase 03 — `ensure-dir`

문서: [`docs/phases/03-ensure-dir.md`](docs/phases/03-ensure-dir.md)

- 계층적 폴더 생성
- 이미 존재하는 폴더의 idempotent 성공
- 파일/폴더 type conflict
- 동시 생성 409 후 재조회/reconcile

### Phase 04 — `upload`

문서: [`docs/phases/04-upload.md`](docs/phases/04-upload.md)

- file handle 기반 안정적인 stat/stream
- 신규 업로드와 `--overwrite`
- 100MB 이상 파일의 bounded memory 검증
- interrupted upload와 resume
- 업로드 후 결과 검증

### Phase 05 — `put`

문서: [`docs/phases/05-put.md`](docs/phases/05-put.md)

- 순수 decision 함수
- remote absent, same, local newer, remote newer, size mismatch
- `--force`, `--mkdir`
- upload/overwrite/skip/conflict 결과

### Phase 06 — `delete`

문서: [`docs/phases/06-delete.md`](docs/phases/06-delete.md)

- 휴지통 이동
- 없는 경로의 `already-absent`
- `--strict`
- resolve/delete 사이 race 처리

### Phase 07 — 안정화와 배포 준비

문서: [`docs/phases/07-hardening.md`](docs/phases/07-hardening.md)

- Unicode/한글/특수문자/빈 파일/대용량 파일
- timeout, 429, API 장애, SIGINT
- CLI subprocess contract test
- Ubuntu Server 24.04 설치 및 운영 문서
- 실제 MYBOX acceptance test

## 6. 전체 MVP 완료 조건

다음 조건을 모두 충족해야 MVP를 완료할 수 있다.

```bash
bun run check
bun run build
bun run test:integration
```

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
- 모든 phase가 `complete`이고 `docs/HANDOFF.md`에 미완료 구현 작업이 없다.

## 7. 이후 후보

MVP 완료 후 실제 요구가 확인된 경우에만 검토한다.

- local state/cache 및 SHA-256 기록
- resumable upload 고도화
- watch daemon
- systemd unit

watch가 추가되더라도 로컬 삭제는 원격 삭제로 전파하지 않는다.
