# Phase 21 — stdin Upload

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 표준 입력을 하나의 MYBOX 파일로 안전하게 업로드하는
실행 계획과 완료 기준을 정의한다.

## 상태와 진입 조건

- 상태: `pending`
- 활성 phase: 없음
- Phase 20 완료 후 시작한다.
- 구현을 시작할 때 `docs/PROGRESS.md`에서 Phase 21만 `in_progress`로 변경한다.
- MYBOX upload reservation의 정확한 `fileSize`와 기존 seek 가능한 file-handle 계약을 유지한다.

## 목표

셸 pipeline의 byte stream을 메모리에 모두 올리지 않고 임시 regular file에 spool한 뒤 기존 upload
vertical slice로 전송한다.

```bash
printf 'hello\n' | myboxctl upload - /notes/hello.txt --json
tar -czf - ./reports | myboxctl upload - /backups/reports.tar.gz --mkdir
```

MYBOX는 archive를 자동 추출하지 않는다. 두 번째 예시는 사용자가 만든 tar.gz 한 파일을 업로드한다.

## Public CLI 계약

```text
upload - <remote-file> [--mkdir] [--force] [--json]
```

- local source가 정확히 `-`일 때만 stdin mode다.
- remote destination은 생략할 수 없고 root, trailing `/`와 기존 directory를 거부한다.
- destination은 최종 remote filename을 포함한 exact file path다.
- stdin이 interactive TTY면 대기하지 않고 invalid-arguments로 실패한다.
- `--recursive`와 stdin은 함께 사용할 수 없다.
- 기존 remote metadata/`--force`와 missing parent/`--mkdir` 정책을 재사용한다.
- spool 완료 시각을 local modified time으로 사용하며 임의 입력 timestamp option은 추가하지 않는다.

## Spool과 실패 정책

1. config/PAT를 검증하고 `maxFileBytes`를 조회한다.
2. remote destination과 parent를 resolve해 directory/type conflict와 명백한 not-found를 먼저 차단한다.
3. 운영체제 temp directory 아래 고유 regular file을 exclusive create한다.
4. POSIX에서는 `0600`을 요청하고 stdin을 bounded chunk로 기록한다.
5. byte count가 `maxFileBytes`를 초과하면 즉시 중단하고 temp file을 정리한다.
6. EOF 뒤 handle을 sync하고 같은 handle의 size를 확인한다.
7. remote target basename과 spool file handle을 기존 upload core에 전달한다.
8. 성공, 실패와 SIGINT에서 자신이 만든 temp file과 handle만 정리한다.

전체 stdin을 RAM에 보관하지 않는다. unknown-size stream을 signed upload URL로 직접 보내지 않으며 첫
버전에는 `--size` fast path를 추가하지 않는다. spool 덕분에 기존 한 번의 content resume/retry는 같은
실행 안에서 사용할 수 있지만, command 종료 뒤 stdin 자체를 재생하거나 재개하지는 않는다.

temp file 생성이나 기록이 실패하면 remote mutation을 시작하지 않는다. upload가 시작된 뒤 실패하면
기존 operation-specific partial/error 계약을 사용하고 temp 정리 실패는 원래 결과를 바꾸지 않는 warning으로
보고한다.

## 비범위

- built-in tar/zip 생성 또는 압축 option
- stdin directory manifest, 여러 remote file 또는 archive 자동 해제
- stdin을 RAM에 전체 buffering
- unknown-size direct upload와 command 간 stdin resume
- download의 stdout 출력
- shell command 실행 또는 archive tool dependency

## 구현 순서

### P21-A — stdin/spool boundary

- TTY 판정, exclusive temp file, bounded copy와 size limit을 독립 helper로 구현한다.
- 0-byte, 큰 stream, producer error, disk error, over-limit과 SIGINT cleanup을 테스트한다.

### P21-B — upload vertical slice 연결

- `upload -`에서 exact destination을 검증하고 기존 upload core를 재사용한다.
- 명백한 destination type/not-found conflict에서는 stdin을 읽지 않고, 기존 file의 metadata 비교는 spool
  완료 뒤 수행하는 순서를 behavior test로 고정한다.
- remote upload filename이 temp basename으로 바뀌지 않는지 검증한다.

### P21-C — subprocess와 문서

- Bun/Node launcher pipeline, stdout/stderr/exit code와 diagnostic redaction을 검증한다.
- Ubuntu, macOS와 Windows에서 pipe, temp cleanup과 0-byte 입력을 확인한다.
- README에는 `printf`와 `tar` 조합을 recipe로만 추가한다.

## 검증

```bash
bun run check
bun run build
```

실제 MYBOX acceptance는 unique integration child에 작은 stdin 파일 하나만 올리고 byte content와 cleanup을
확인한다.

## 완료 조건

- stdin upload가 exact remote file 하나를 생성 또는 기존 정책대로 갱신한다.
- memory 사용량이 입력 크기에 비례해 증가하지 않는다.
- size limit, local failure와 SIGINT에서 불완전한 temp file이 남지 않는다.
- 기존 file upload와 recursive upload 계약이 바뀌지 않는다.
- tar/zip 구현 없이 외부 producer와 조합할 수 있다.
