# Phase 07 — Hardening and release readiness

## 목표

모든 명령의 cross-cutting failure path와 Ubuntu Server 24.04 운영 방식을 검증하고 MVP acceptance
flow를 완료한다.

## 진입 조건

- Phase 00~06이 모두 `complete`다.
- public CLI contract 변경이 동결되어 있다.
- `docs/PROGRESS.md`의 Phase 07이 `in_progress`다.

## 작업 범위

### 1. 입력과 파일 edge case

- 0-byte, 1-byte, 100MB 이상 file
- 한글, emoji, 공백, `#`, `%`, `+`, leading dot
- 매우 긴 path/name의 API 오류 mapping
- symlink와 업로드 중 local 변경
- root folder와 empty folder
- duplicate/partial-match search result

### 2. 장애와 process behavior

- DNS/network failure
- timeout과 connection reset
- 429 + Retry-After
- 500/502/503 retry exhaustion
- mutation response lost + reconcile
- SIGINT 중 list/upload/delete
- stdout JSON 1개, stderr 분리, deterministic exit code
- 어떤 실패에서도 token/signed URL 비노출

### 3. CLI subprocess contract suite

모든 명령의 성공과 대표 실패를 `dist/cli.js`를 실행하여 검증한다. source import test만으로 release
준비를 판단하지 않는다.

검증 대상:

- `--help`, `--version`
- option/argument validation
- success/failure JSON schema
- human-readable output의 최소 유용성
- process exit code
- build artifact 실행 권한과 shebang

### 4. Ubuntu Server 운영 문서

README 또는 별도 how-to에 다음을 작성하고 Ubuntu 24.04 환경에서 검증한다.

- Bun 1.4 설치 전제
- `bun install --frozen-lockfile`
- build와 설치 경로
- `MYBOX_PAT` 환경 변수 또는 0600 credentials file
- Hermes subprocess 예시
- timeout/retry/exit code 운영 지침
- upgrade와 rollback 절차

MVP는 daemon/systemd service를 구현하지 않는다. 단발 CLI를 Hermes가 호출한다.

### 5. Acceptance flow

unique integration prefix에서 `PLAN.md`의 전체 흐름을 두 번 반복한다. 두 번째 실행에서도 이전
실행의 resource가 결과를 오염시키지 않아야 한다.

## 검증

```bash
bun install --frozen-lockfile
bun run check
bun run build
MYBOX_PAT=... bun run test:integration
```

Ubuntu 24.04 검증이 현재 환경에서 불가능하면 macOS 결과로 대체해 완료 처리하지 않는다.
`blocked` 또는 명시적 미검증 상태로 남긴다.

## 완료 조건

- 전체 unit/HTTP/CLI/integration suite가 통과한다.
- build artifact에서 모든 command가 실행된다.
- Ubuntu Server 24.04 설치/실행 증거가 있다.
- 100MB 이상 upload의 bounded memory 증거가 있다.
- acceptance flow가 두 번 반복 통과한다.
- credential leak scan과 Git diff 검사가 통과한다.
- README가 실제 설치/운영 절차와 일치한다.
- `docs/PROGRESS.md`의 모든 phase가 `complete`다.

## 최종 Handoff

`docs/HANDOFF.md`에 다음을 남긴다.

- release 가능한 build/install 명령
- 전체 검증 명령과 환경, 결과
- 실제 acceptance prefix와 cleanup 상태
- 알려진 제한과 metadata 비교 한계
- 운영자가 알아야 할 retry/exit code
- MVP 이후 후보와 명시적으로 제외된 기능
