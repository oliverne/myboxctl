# Phase 19 — Automatic Failure Diagnostics

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 사용자가 설정으로 활성화한 경우 실패한 실행에만
자동 진단 로그를 남기도록 기존 `--diagnostic-log` 계약을 확장하는 계획을 정의한다.

## 상태와 진입 조건

- 상태: `pending`
- 활성 phase: 없음
- Phase 18 완료 후 시작한다.
- 구현을 시작할 때 `docs/PROGRESS.md`에서 Phase 19만 `in_progress`로 변경한다.
- 기존 opt-in 로그의 redaction, exclusive create와 원래 command 결과 보존 정책을 유지한다.

## 목표

사용자가 `config.json`에서 한 번 활성화하면 이후 실패한 command의 진단 artifact를 자동으로 남긴다.
성공 실행은 파일을 만들지 않고, 실패 출력에서 생성된 파일 경로를 확인할 수 있어야 한다.

```json
{
  "diagnostics": {
    "onError": true
  }
}
```

기본값은 `false`다. 명시적 `--diagnostic-log <file>`은 계속 전체 실행을 기록하는 지원용 기능으로
유지한다.

## 저장과 privacy 계약

- 기본 디렉터리는 `${XDG_STATE_HOME}/myboxctl/diagnostics/`이며 XDG 값이 없으면
  `~/.local/state/myboxctl/diagnostics/`를 사용한다.
- POSIX directory는 `0700`, file은 `0600`을 요청하고 Windows는 사용자 계정의 parent ACL을 따른다.
- 파일명은 UTC timestamp와 UUID를 사용해 여러 process가 충돌하지 않게 한다.
- PAT, Authorization, upload/download URL, credential 내용, raw argv와 raw HTTP header/body는 기록하지
  않는다.
- 기존 `sanitizeForOutput`을 메모리 buffer와 disk write 양쪽에 적용한다.
- 자동 로그에는 local path와 redaction된 stack이 포함될 수 있음을 설정 및 사용자 문서에 알린다.

## Buffer와 보존 정책

- 자동 모드는 실행 중 sanitized record를 memory ring buffer에만 보관한다.
- `run-started`와 최종 failure는 항상 보존하고 event는 최근 256개, 직렬화 기준 최대 1 MiB 안에서
  오래된 항목부터 버린다.
- exit code 0이면 buffer를 폐기하고 filesystem에 아무것도 만들지 않는다.
- 실패하면 고유 JSONL 파일을 exclusive create하고 buffer와 `run-completed`를 기록한다.
- 자동 관리 디렉터리에서 정규 파일이며 myboxctl 파일명 형식과 일치하는 로그만 대상으로 최근 20개를
  유지한다. symlink, directory와 형식이 다른 파일은 열거나 삭제하지 않는다.
- retention 정리가 실패해도 원래 command 결과와 새 로그 기록을 실패로 바꾸지 않는다.

## CLI와 우선순위

- `--diagnostic-log`가 지정되면 그 파일만 사용하고 자동 failure log를 중복 생성하지 않는다.
- `--help`, `--version`과 인자 없는 help는 자동 로그 대상이 아니다.
- config 자체를 읽거나 검증하지 못해 `onError`를 확정할 수 없는 경우 기존 config failure만 출력한다.
- 자동 로그가 생성되면 human stderr에 경로를 한 줄 표시한다.
- JSON failure envelope에는 optional `diagnosticLogPath`를 additive field로 제공한다.
- 자동 로그 생성/기록 실패는 redaction된 warning만 출력하고 원래 exit code와 failure envelope를
  유지한다.

## 구현 순서

### P19-A — config와 bounded buffer

- config schema에 `diagnostics.onError` boolean을 추가한다.
- clock, UUID와 serializer를 주입할 수 있는 bounded diagnostic buffer를 구현한다.
- success, record count와 byte limit, redaction을 unit test로 고정한다.

### P19-B — failure persistence와 retention

- XDG/default state path, directory/file mode와 exclusive create를 구현한다.
- 한 process가 만든 형식의 정규 파일만 정리하도록 retention boundary를 테스트한다.
- write/close/retention 실패가 원래 command 결과를 바꾸지 않는지 검증한다.

### P19-C — CLI output와 교차 운영체제 검증

- 기존 diagnostic session과 자동 buffer의 우선순위를 연결한다.
- human/JSON failure에서 path를 노출하고 성공 stdout/stderr 계약은 바꾸지 않는다.
- Ubuntu, macOS와 Windows에서 path, mode/ACL 기대 범위와 다중 process 충돌을 검증한다.

## 검증

```bash
bun run check
bun run build
```

실제 MYBOX mutation은 이 phase의 필수 검증이 아니다. fake failure와 local filesystem/subprocess test로
자동 기록 계약을 검증한다.

## 완료 조건

- 기본 설정에서는 현재처럼 자동 파일을 만들지 않는다.
- 활성화한 경우 실패 실행만 bounded, redacted JSONL을 남긴다.
- 명시적 로그와 자동 로그가 중복 생성되지 않는다.
- retention이 관리 디렉터리 밖이나 다른 형식의 파일을 변경하지 않는다.
- 로그 오류가 원래 command의 mutation, result와 exit code를 바꾸지 않는다.
