# Phase 14 — CLI UX & Agent Contract

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 공개 Release 전에 `myboxctl`의 명령 체계와 출력
계약을 사람과 AI 에이전트 양쪽에서 직관적이고 예측 가능하게 만드는 계획을 정의한다.

기존 개선 메모: [`../reference/cli-contract-improvements.md`](../reference/cli-contract-improvements.md)

## 상태와 진입 조건

- 상태: `complete`
- 활성 phase: 없음
- Phase 00~13 구현과 live acceptance는 완료된 상태를 전제로 한다.
- 아직 공개 Release 전이므로 기존 CLI 이름과 JSON shape의 호환성 유지보다 명확한 public contract를
  우선한다.
- 구현 결과와 검증 사실은 `docs/PROGRESS.md`와 `docs/HANDOFF.md`에 기록한다.
- 실제 MYBOX 검증이 필요한 경우 기존 opt-in 정책과 `/myboxctl-integration-test/` 격리 규칙을 유지한다.

## 배경

현재 CLI는 API 안전성, Unicode 이름 처리, rate limit, upload resume, delete reconcile, JSON envelope와
exit code 같은 내부 계약은 충분히 단단해졌다. 반면 사용자에게 노출되는 CLI surface는 다음 문제가
남아 있다.

- `stat`, `ensure-dir`, `put`은 Unix/개발자 관례를 모르는 사용자에게 기능이 이름만으로 드러나지 않는다.
- `ls`는 인자가 필수라서 `myboxctl ls`가 오류가 되며 일반적인 `ls` 사용 감각과 다르다.
- `ls`는 file path를 거부하고 directory만 허용해 POSIX `ls file`과 다르다.
- `upload`/`download`의 두 번째 인자를 항상 정확한 file path로 해석해 `cp`/`scp` 계열의 destination
  감각과 다르다. root나 기존 directory에 basename으로 넣는 자연스러운 사용이 불가능하다.
- `ensure-dir`은 실제로 항상 `mkdir -p`에 가까운데 Phase 14에서 이름만 `mkdir`로 바꾸면 알려진
  `mkdir` semantics와 달라진다.
- `stat`은 missing path를 성공으로 처리하고 `delete`는 missing path를 기본 성공으로 처리해
  `stat`/`rm` 계열의 일반적인 exit semantics와 반대다.
- 기본 human 성공 출력이 헤더 없는 TSV라서 필드 의미를 기억해야 하고 빈 `ls`는 아무 출력도 없다.
- `--json`은 최종 stdout envelope는 안정적이지만 기본 warning이 stderr JSONL로 나올 수 있어 단순한
  subprocess 호출자가 stdout/stderr 두 stream의 계약을 알아야 한다.
- `--json`, `--verbose`, `--quiet`가 subcommand option에만 묶여 있어 global option처럼 앞에 두는
  자연스러운 호출을 지원하지 않는다.
- `size` 단위, optional field의 생략/null 혼용, schema version 부재 등은 에이전트가 문서 밖의 추론을
  하게 만든다.

Phase 14는 새 기능을 늘리는 phase가 아니라 이미 구현된 기능을 더 명확한 CLI 제품 계약으로 정리하는
phase다.

## 설계 원칙

1. 일반적인 POSIX/Unix 파일 CLI에서 이미 널리 알려진 surface semantics는 특별한 이유가 없으면 따른다.
2. POSIX를 복제하는 것이 목적은 아니다. MYBOX API 특성, cross-platform 동작, 데이터 안전성을 위해 더
   보수적인 정책이 필요하면 명시적으로 다르게 동작한다.
3. 사람이 설명서를 읽지 않고 한두 번 시도해도 destination, overwrite, not-found 동작을 예측할 수 있어야
   한다.
4. AI 에이전트는 `--json` stdout 하나와 exit code만으로 최종 결과를 안정적으로 판단할 수 있어야 한다.
5. path spelling이나 확장자로 file/directory를 추측하지 않는다. 존재하는 resource type, trailing
   separator로 표현된 directory intent와 명시적 option만 사용한다.

## 목표

1. 명령 이름만 보고도 한국어 사용자를 포함한 일반 사용자가 기능을 쉽게 추측할 수 있게 한다.
2. Linux/Unix 사용자에게 익숙한 shorthand와 destination 동작은 안전한 범위에서 그대로 제공한다.
3. 기본 human 출력은 별도 문서를 보지 않아도 이해할 수 있게 한다.
4. `--json`은 단일 subprocess 호출에서 stdout JSON 하나와 exit code만으로 결과를 판단할 수 있게 한다.
5. JSON 필드의 단위, nullable 규칙, 시간/type 정규화와 version을 명시적으로 고정한다.
6. 공개 Release 전에 기존 `put`/`stat`/`ensure-dir` 중심 명령 체계를 정리해 향후 compatibility 비용을
   만들지 않는다.

## 비목표와 의도적인 POSIX 차이

다음은 의도적으로 추가하지 않거나 기존 보수 정책을 유지한다.

- shell 형태의 remote current working directory와 `cd`
- remote path의 `.`/`..` 해석
- glob과 recursive listing
- 여러 source를 한 번에 upload/download하는 문법
- stdin/stdout을 의미하는 `-`
- 양방향 sync, directory sync, daemon, MCP, SDK
- upload의 무조건 overwrite: metadata 기반 안전 판단과 remote-newer conflict를 유지한다.
- download의 기존 local file 무조건 overwrite: 명시적 `--overwrite`가 필요하다.
- symlink/non-regular destination에 대한 보수적 안전 정책
- localization framework나 한국어 번역 시스템. 명령 이름과 기본 메시지는 짧고 쉬운 영어를 유지한다.
- table/markdown/spinner를 위한 새 UI dependency
- rename/move/copy 등 MYBOX의 새 기능

## Public command surface

Phase 14 완료 후 canonical command는 다음 여섯 개로 정리한다.

| Command                                      | Alias | 의미                              | destination/인자 생략   |
| -------------------------------------------- | ----- | --------------------------------- | ----------------------- |
| `list [remote-path]`                         | `ls`  | 폴더 내용 또는 단일 resource 표시 | 생략 시 `/`             |
| `info <remote-path>`                         | 없음  | 원격 파일/폴더 정보 조회          | 생략 불가               |
| `mkdir [-p\|--parents] <remote-directory>`   | 없음  | 원격 폴더 생성                    | 생략 불가               |
| `upload <local-file> [remote-destination]`   | 없음  | 안전한 조건부 업로드/갱신         | 생략 시 `/` destination |
| `download <remote-file> [local-destination]` | 없음  | 원격 파일 다운로드                | 생략 시 현재 directory  |
| `delete [--ignore-missing] <remote-path>`    | 없음  | 원격 파일/폴더를 휴지통으로 이동  | 생략 불가               |

### `list` / `ls`

`list`를 canonical command로 두고 `ls`를 shorthand alias로 제공한다.

```bash
myboxctl list
myboxctl list /reports
myboxctl ls
myboxctl ls /reports/report.pdf
```

- 인자를 생략하면 항상 `/`를 사용한다.
- remote cwd 상태는 만들지 않는다. 따라서 기본값은 실행 위치와 관계없이 deterministic한 MYBOX root다.
- 대상이 directory면 direct children을 표시한다.
- 대상이 file이면 POSIX `ls file`처럼 해당 resource 한 개를 동일한 list row shape로 표시한다.
- missing path는 not-found / exit 4다.
- 두 이름은 동일한 command contract와 exit code를 사용한다.
- JSON의 canonical `command` 값은 alias 입력 여부와 관계없이 `"list"`로 정규화한다.

### `info`

기존 `stat`을 `info`로 대체한다.

```bash
myboxctl info /reports/a.pdf
```

- file과 folder 모두 조회한다.
- 인자를 생략하면 대상이 모호하므로 argument error다.
- 없는 경로는 성공 결과로 표현하지 않고 `not-found` / exit 4로 처리한다.
- existence check가 필요한 AI도 structured failure의 `error.kind: "not-found"`와 exit 4로 판단한다.
- 공개 전 breaking change로 처리하며 `stat` alias는 남기지 않는다.

### `mkdir`

기존 `ensure-dir`을 이름만 바꾸지 않고 일반적인 `mkdir`/`mkdir -p` semantics로 분리한다.

```bash
myboxctl mkdir /reports
myboxctl mkdir -p /reports/2026/08
myboxctl mkdir --parents /reports/2026/08
```

기본 `mkdir`:

- 바로 위 parent directory가 존재해야 한다.
- 대상 directory가 없으면 한 단계만 생성하고 `action: "created"`다.
- 대상 directory가 이미 존재하면 conflict / exit 5다.
- parent가 없거나 parent가 file이면 적절한 not-found/conflict로 실패한다.

`-p` / `--parents`:

- 누락된 parent를 계층적으로 생성한다.
- 대상 directory가 이미 존재해도 성공하며 `action: "existing"`이다.
- 중간 component가 file이면 conflict다.
- `/`는 이미 존재하는 directory로 성공한다.

기존 `ensure-dir`의 idempotent hierarchy 보장 동작은 `mkdir -p` 구현으로 재사용한다. 공개 전 breaking
change로 처리하며 `ensure-dir` alias는 남기지 않는다.

### destination 해석 공통 원칙

`upload`의 remote destination과 `download`의 local destination은 정확한 filename만 받는 인자가 아니라
`cp`/`scp`와 비슷한 destination으로 취급한다.

- destination이 존재하는 directory면 source basename을 붙인다.
- `/` 또는 `.`처럼 명백한 directory destination도 source basename을 붙인다.
- trailing separator는 directory intent를 나타낸다.
- 존재하지 않고 directory intent도 없는 path는 정확한 새 filename으로 해석한다.
- 확장자 유무로 file/directory를 추측하지 않는다.
- directory intent가 있는데 directory가 없으면 해당 command가 지원하는 명시적 생성 option이 없는 한
  실패한다.

remote path의 canonical identity와 CLI destination intent는 분리한다. 현재 `parseRemotePath()`가
`/store`와 `/store/`를 동일하게 정규화하는 동작은 resource identity용으로 유지할 수 있지만, CLI
argument를 정규화하기 전에 trailing `/` 여부를 보존하는 별도 destination parser/value object를 둔다.

예시 shape:

```ts
type RemoteDestination = {
  path: RemotePath;
  directoryIntent: boolean;
};
```

### `upload`

기존 `put`의 안전한 metadata 정책을 `upload`의 기본 동작으로 승격하고 기존 `put` command는 제거한다.
기존 `upload`의 create-only/`--overwrite` surface도 제거한다.

```bash
myboxctl upload ./file.zip
myboxctl upload ./file.zip /
myboxctl upload ./file.zip /store
myboxctl upload ./file.zip /store/
myboxctl upload ./file.zip /store/archive.zip
myboxctl upload ./file.zip /store/ --mkdir
myboxctl upload ./file.zip /store/archive.zip --force
```

remote destination 결정:

| 입력/상태                          | effective target                                   |
| ---------------------------------- | -------------------------------------------------- |
| destination 생략                   | `/<local-basename>`                                |
| `/`                                | `/<local-basename>`                                |
| `/store`가 기존 directory          | `/store/<local-basename>`                          |
| `/store`가 기존 file               | `/store`                                           |
| `/store`가 없음, trailing `/` 없음 | 정확한 file path `/store`                          |
| `/store/`가 기존 directory         | `/store/<local-basename>`                          |
| `/store/`가 없음                   | 기본 실패                                          |
| `/store/`가 없음 + `--mkdir`       | directory 생성 후 `/store/<local-basename>`        |
| `/a/b/file.zip`가 없음             | 정확한 file path `/a/b/file.zip`; parent 정책 적용 |

- destination을 생략하거나 `/`를 지정하면 root 업로드를 정상 지원한다.
- 기존 remote directory를 destination으로 지정하면 conflict가 아니라 local basename을 그 아래에 붙인다.
- trailing `/`는 directory intent이므로 `/store/`를 새 remote filename `/store`로 해석하지 않는다.
- local basename으로 새 remote name을 만들 때 기존 NFC 생성 정책을 적용한다.

최종 effective target에 대한 metadata 정책:

| 상태                                  | 결과                                         |
| ------------------------------------- | -------------------------------------------- |
| 원격 파일 없음                        | `uploaded`                                   |
| size 다름                             | `overwritten`                                |
| local이 2초 tolerance를 넘어 더 최신  | `overwritten`                                |
| 현재 metadata상 동일                  | `skipped`                                    |
| remote가 2초 tolerance를 넘어 더 최신 | conflict / exit 5                            |
| effective target이 folder             | conflict / exit 5                            |
| `--force`                             | metadata 비교 결과와 관계없이 file overwrite |

- `--mkdir`은 누락된 remote parent 또는 명시적 directory destination을 생성한다.
- `--overwrite`는 제거하고 강제 변경은 `--force` 하나로 통일한다.
- 이 명령은 directory sync나 양방향 sync가 아니다. 한 local file을 한 effective remote file path에
  반영하는 명령이다.
- content hash를 도입하지 않는다. 현재 size + modified time 정책과 2초 tolerance를 유지하되 help에
  제한을 명시한다.
- 기존 `put`은 공개 전 제거하고 alias를 남기지 않는다.

### `download`

이름과 안전한 streaming/atomic commit 정책은 유지하되 local argument를 destination으로 해석한다.

```bash
myboxctl download /share/file.zip
myboxctl download /share/file.zip .
myboxctl download /share/file.zip ./downloads
myboxctl download /share/file.zip ./renamed.zip
myboxctl download /share/file.zip ./downloads/ --overwrite
```

local destination 결정:

| 입력/상태                                 | effective destination                |
| ----------------------------------------- | ------------------------------------ |
| destination 생략                          | `./<remote-basename>`                |
| `.`                                       | `./<remote-basename>`                |
| 기존 local directory                      | `<directory>/<remote-basename>`      |
| 존재하지 않는 path, directory intent 없음 | 정확한 file path                     |
| trailing separator + 기존 directory       | `<directory>/<remote-basename>`      |
| trailing separator + directory 없음       | 실패; directory를 자동 생성하지 않음 |

- existing effective file destination은 기본 conflict다.
- `--overwrite`는 existing regular file만 안전하게 교체한다.
- directory destination 자체는 overwrite 대상이 아니며 그 아래 basename file을 대상으로 판단한다.
- local parent directory는 자동 생성하지 않는다.
- directory, symbolic link와 기타 non-regular effective file destination에 대한 기존 보수 정책은 유지한다.

### `delete`

이름과 MYBOX trash 이동 의미는 유지하되 missing 기본 동작을 일반적인 `rm` 감각에 가깝게 바꾼다.

```bash
myboxctl delete /reports/old.pdf
myboxctl delete /reports/old.pdf --ignore-missing
```

- 성공: `action: "deleted"`
- 이미 없음: 기본 `not-found` / exit 4
- `--ignore-missing`: 이미 없어도 exit 0, `action: "already-absent"`
- 기존 `--strict`은 제거한다.
- `/` 삭제는 항상 argument error로 거부한다.
- `rm` alias는 추가하지 않는다. destructive command는 축약보다 명시성을 우선한다.

MYBOX delete는 휴지통 이동이고 현재 API/구현은 folder subtree를 하나의 remote resource로 삭제한다. 이번
phase에서 POSIX `rm -r`을 그대로 추가하지는 않는다. 대신 help와 human result에서 folder deletion이
folder 전체를 휴지통으로 이동한다는 사실을 명시한다. 이는 의도적인 POSIX 차이다.

## Global presentation options

`--json`, `--verbose`, `--quiet`는 command 기능 option이 아니라 출력/presentation 전역 option으로
취급한다.

다음 형태를 모두 지원하고 같은 의미로 테스트한다.

```bash
myboxctl --json list /
myboxctl list / --json
myboxctl --verbose upload ./a.zip /
myboxctl upload ./a.zip / --verbose
```

- `--verbose`와 `--quiet`의 conflict는 위치와 관계없이 동일하게 검증한다.
- subcommand 전용 option(`upload --force`, `mkdir -p`, `delete --ignore-missing` 등)은 해당 command에만
  적용한다.
- alias `ls`를 사용해도 global option parsing과 JSON canonical command 규칙이 달라지지 않는다.

## Human output contract

기본 출력은 사람이 직접 읽는 UI다. shell script나 AI가 안정적으로 파싱해야 하는 경우 `--json`을
사용한다. 따라서 기본 human output은 기존의 헤더 없는 TSV compatibility를 유지하지 않는다.

### `list`

TTY/non-TTY 모두 필드 의미를 알 수 있는 compact table을 사용한다.

```text
$ myboxctl list /reports

TYPE    NAME          SIZE      MODIFIED
file    report.pdf    12.1 MiB  2026-08-31 21:42
folder  archive       -         2026-08-30 10:11

2 items
```

빈 폴더는 성공했음을 명시한다.

```text
$ myboxctl list /empty
No items in /empty.
```

file path를 직접 지정하면 같은 column contract로 한 줄만 표시한다.

```text
$ myboxctl ls /reports/report.pdf

TYPE  NAME        SIZE      MODIFIED
file  report.pdf  12.1 MiB  2026-08-31 21:42
```

원격 전체 path보다 현재 directory 기준 `NAME`을 기본 표시해 사람이 훑기 쉽게 한다. 정확한 path와
resource ID는 `info` 또는 `--json`에서 확인한다.

### `info`

key/value 형태로 표시한다.

```text
Path:      /reports/report.pdf
Type:      file
Size:      12.1 MiB (12687769 bytes)
Modified:  2026-08-31 21:42
```

없는 경우는 성공 text를 출력하지 않고 human not-found error를 stderr에 출력하며 exit 4다.

### mutation/download 결과

기본 성공 결과는 한눈에 의미가 드러나는 짧은 문장으로 출력한다.

```text
Created /reports/2026/08
Directory already exists: /reports
Uploaded /reports/report.pdf (12.1 MiB)
Updated /reports/report.pdf (12.1 MiB)
Skipped /reports/report.pdf (already current)
Downloaded /reports/report.pdf -> ./report.pdf (12.1 MiB)
Deleted /reports/old.pdf
Folder moved to trash: /reports/archive
Already absent: /reports/old.pdf
```

- `Already absent`는 `delete --ignore-missing`에서만 정상 성공 결과로 사용한다.
- resource ID는 기본 human output에 표시하지 않는다.
- byte size는 사람이 읽는 단위와 필요할 때 exact bytes를 함께 제공한다.
- 시간은 human mode에서 local/표시용 형식으로 읽기 쉽게 표현하되 JSON 원본 시간의 의미를 바꾸지 않는다.
- credential, signed URL과 내부 request detail은 계속 출력하지 않는다.

### Human error

기존 `Error:`, optional `Code:`, `Request ID:`, `Retry after:` 구조를 유지한다.

해결 방법이 명확하고 안전한 경우에만 `Hint:`를 추가한다.

```text
Error: Remote file is newer than the local file.
Code: REMOTE_NEWER
Hint: Review the remote file or retry with --force if overwriting is intended.
```

모든 conflict에 자동으로 `--force`를 권하지 않는다.

## Machine/AI output contract

### 기본 stream 규칙

`--json`은 별도의 machine mode로 취급한다.

| 모드               | stdout                        | stderr                             |
| ------------------ | ----------------------------- | ---------------------------------- |
| 기본 human         | human 최종 성공               | warning/progress + human 최종 오류 |
| `--json`           | 최종 JSON envelope 정확히 1개 | 기본 empty                         |
| `--verbose`        | 선택한 모드의 최종 결과       | 상세 human event                   |
| `--json --verbose` | 최종 JSON envelope 정확히 1개 | event JSON Lines                   |
| `--quiet`          | human 최종 결과 유지          | human 실행 중 event 억제           |

- AI 호출자는 기본적으로 `myboxctl ... --json`만 사용하면 된다.
- 기본 JSON mode는 warning/progress를 stderr에 쓰지 않는다.
- 실행 event가 필요한 에이전트만 `--json --verbose`를 opt-in한다.
- terminal failure는 JSON mode에서 stdout failure envelope에만 한 번 출력한다.
- exit code는 기존 semantic mapping을 유지하되 Phase 14에서 not-found semantics가 바뀌는 command test를
  새 계약에 맞춰 갱신한다.

### Envelope version

성공/실패 envelope 최상단에 `schemaVersion`을 추가한다.

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "list",
  "action": "listed",
  "data": {}
}
```

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "upload",
  "error": {
    "kind": "conflict",
    "message": "...",
    "retryable": false,
    "code": "REMOTE_NEWER",
    "requestId": null,
    "retryAfterMs": null
  }
}
```

- `schemaVersion`은 machine contract의 breaking change에서만 증가한다.
- Phase 14를 공개 v1 contract의 기준점으로 삼는다.

### Nullability와 단위

machine output은 field 존재 여부를 추측하지 않게 한다.

공통 resource shape:

```ts
type Resource = {
  resourceId: string | null;
  path: string;
  name: string;
  type: "file" | "folder";
  sizeBytes: number | null;
  modifiedAt: string | null;
};
```

- optional field 생략 대신 `null`을 사용한다.
- `size`는 `sizeBytes`로 변경해 byte 단위를 field name에 고정한다.
- folder에 의미 없는 size는 `null`이다.
- root처럼 API resource ID가 없으면 `resourceId: null`이다.
- API가 modified time을 제공하지 않는 경우 `modifiedAt: null`이다.

failure의 현재 optional field도 같은 원칙을 적용한다.

```ts
code: string | null;
requestId: string | null;
retryAfterMs: number | null;
```

### 정규화

- `type`은 항상 소문자 `file` 또는 `folder`다.
- `modifiedAt`은 존재할 경우 UTC RFC 3339/ISO 8601 문자열로 정규화한다.
- JSON `command`는 사용자가 alias `ls`를 입력해도 canonical `list`를 반환한다.
- path는 기존 remote Unicode/path 정책에 따라 normalized public path를 반환한다.
- upload/download 결과에는 사용자가 입력한 destination만이 아니라 실제 결정된 effective file path를
  명시적으로 반환한다.

### Action enum

`action: string`을 사실상의 공개 enum으로 문서와 TypeScript type에서 고정한다.

| command    | actions                                                |
| ---------- | ------------------------------------------------------ |
| `list`     | `listed`                                               |
| `info`     | `found`                                                |
| `mkdir`    | `created`, `existing` (`existing`은 `-p`에서만 정상)   |
| `upload`   | `uploaded`, `overwritten`, `skipped`                   |
| `download` | `downloaded`                                           |
| `delete`   | `deleted`, `already-absent` (`--ignore-missing`에서만) |

missing `info`는 success action `absent`가 아니라 failure envelope/not-found로 표현한다. 새 action 추가가
에이전트 분기에 영향을 주는 경우 contract change로 취급한다.

## Help contract

root help는 명령을 기능 중심으로 이해할 수 있게 한다.

```text
Commands:
  list|ls [remote-path]                    List a file or directory (default: /)
  info <remote-path>                       Show file or folder information
  mkdir [-p|--parents] <remote-directory>  Create a directory
  upload <local-file> [remote-destination] Upload or update a file when needed
  download <remote-file> [local-destination] Download a file
  delete [--ignore-missing] <remote-path>  Move a file or folder to MYBOX trash
```

각 subcommand help에는 다음을 포함한다.

- argument가 path인지 destination인지 명확한 설명
- remote path가 `/`로 시작한다는 규칙
- destination 생략/default와 directory destination 처리
- trailing separator의 directory intent
- 기본 동작과 destructive/conflict/not-found 정책
- 주요 option 의미
- human 예제와 `--json` 예제
- 관련 exit code 또는 최소한 실패 유형

`mkdir --help`는 기본 `mkdir`과 `-p`/`--parents`의 차이를 명시한다.

`upload --help`는 특히 다음을 명시한다.

- destination 생략 시 root에 local basename으로 업로드
- 기존 directory destination에는 local basename을 붙임
- trailing `/`는 directory intent
- metadata가 같으면 skip
- remote가 더 최신이면 기본 conflict
- `--force`와 `--mkdir`의 의미
- size + modified time 비교이며 content hash가 아니라는 제한

`download --help`는 destination 생략 시 현재 directory에 remote basename으로 저장하고 기존 local
directory를 destination으로 받을 수 있음을 명시한다.

`delete --help`는 folder도 contents와 함께 MYBOX trash로 이동한다는 점과 `--ignore-missing`의 정확한
의미를 명시한다.

## Compatibility 정책

아직 공개 Release 전이므로 Phase 14의 command rename, semantics와 JSON schema 변경은 호환
alias/deprecation layer 없이 한 번에 적용한다.

제거/변경 대상:

- `stat`
- `ensure-dir`
- `put`
- 기존 create-only `upload` semantics
- `upload --overwrite`
- `delete --strict`
- `info`/기존 stat의 missing-success semantics
- `delete`의 기본 missing-success semantics
- 항상 `mkdir -p`처럼 동작하던 ensure-dir semantics를 일반 `mkdir` + `mkdir -p`로 분리
- upload/download의 exact-file-path-only destination semantics
- JSON `size`
- JSON optional field 생략

유지할 alias는 사용성 가치가 명확한 `ls -> list` 하나다.

README, `docs/reference/cli-contract.md`, shell completion/release smoke/test fixture에 기존 이름이나 제거된
semantics가 남지 않게 검색으로 검증한다. 과거 phase 문서는 당시 사실 기록이므로 history 설명 안의 기존
command 이름과 당시 semantics는 억지로 변경하지 않는다.

## 구현 순서

### P14-A — command surface, POSIX familiarity와 help

후보 파일:

- `src/cli.ts`
- `src/remote/path.ts`
- destination parser 신규 파일 후보
- CLI subprocess tests
- README command examples

작업:

- `list` canonical + `ls` alias와 기본 `/`를 구현한다.
- `list`가 file path도 한 resource row로 처리하게 한다.
- `stat -> info`, `ensure-dir -> mkdir` rename을 적용한다.
- `info` missing을 not-found/exit 4로 변경한다.
- `mkdir` 기본 one-level create와 `-p`/`--parents` hierarchy/idempotent 모드를 분리한다.
- `put`을 제거하고 `upload`에 현재 put metadata 정책을 연결한다.
- upload remote destination, download local destination semantics를 도입한다.
- remote destination에서 trailing `/` directory intent를 path canonicalization 전에 보존한다.
- `upload --overwrite`를 제거하고 `--force`로 통일한다.
- `delete --strict`을 제거하고 기본 missing failure + `--ignore-missing`으로 전환한다.
- `--json`, `--verbose`, `--quiet`를 global presentation option으로 처리해 subcommand 앞/뒤 모두 허용한다.
- root/subcommand help에 argument/destination 설명, default, 예제와 핵심 정책을 추가한다.
- alias 입력 시 JSON `command`가 canonical name으로 나오는지 subprocess test로 고정한다.

### P14-B — versioned machine contract

후보 파일:

- `src/output.ts`
- `src/features/stat.ts` 또는 rename된 info feature
- `src/features/ls.ts` 또는 rename된 list feature
- upload/download/delete/mkdir result type
- `src/mybox/contract.ts`
- 관련 unit/subprocess tests

작업:

- `schemaVersion: 1`을 success/failure envelope에 추가한다.
- `size -> sizeBytes`로 변경한다.
- public resource와 failure optional field를 explicit `null`로 통일한다.
- `type`과 `modifiedAt`을 public output boundary에서 정규화한다.
- command별 action type을 literal union으로 고정한다.
- effective upload/download file path를 machine result에서 명시한다.
- changed not-found semantics가 success/failure envelope에 일관되게 반영되는지 검증한다.
- credential redaction과 단일 stdout JSON 규칙을 회귀 검증한다.

### P14-C — JSON stderr와 global presentation option 단순화

후보 파일:

- `src/human-ui.ts`
- `src/runtime.ts`
- `src/cli.ts`
- observability/subprocess tests

작업:

- 기본 `--json`에서 실행 event를 렌더링하지 않는다.
- `--json --verbose`에서만 기존 structured JSONL event를 stderr에 출력한다.
- human 기본 warning/progress 정책은 유지한다.
- presentation option을 command 전후 어느 위치에 두어도 동일하게 동작시킨다.
- terminal failure 중복 금지, `--quiet`/`--verbose` conflict와 active-line cleanup을 유지한다.
- success/failure 각각 stdout 정확히 한 JSON + 기본 empty stderr를 subprocess test로 고정한다.

### P14-D — human renderer

후보 파일:

- `src/human-ui.ts`
- success renderer 분리 파일
- CLI subprocess tests

작업:

- list table, empty message, file-one-row, info key/value 출력과 mutation/download 문장형 결과를 구현한다.
- destination이 directory였던 upload/download는 실제 effective file path를 사람이 바로 알 수 있게 한다.
- folder delete는 folder 전체가 trash로 이동했음을 명확히 표시한다.
- resource ID와 machine-oriented raw field를 기본 human output에서 제거한다.
- byte/date formatter를 작은 내부 함수로 구현하고 dependency를 추가하지 않는다.
- narrow TTY와 non-TTY에서도 의미가 사라지지 않게 test writer로 검증한다.
- deterministic한 경우에만 error `Hint:`를 추가한다.

### P14-E — contract/document/release validation

후보 파일:

- `docs/reference/cli-contract.md`
- `docs/reference/cli-contract-improvements.md`
- `README.md`
- `docs/PROGRESS.md`
- release/native smoke tests

작업:

- 적용된 제안을 stable `cli-contract.md`로 승격한다.
- POSIX와 의도적으로 다른 정책을 stable contract/help에 명시한다.
- `cli-contract-improvements.md`에서 완료 항목을 제거하거나 문서를 종료한다.
- README 예제와 command 목록을 새 surface로 교체한다.
- package/release smoke가 `--help`, `list`, destination semantics와 machine JSON contract를 검증하게 한다.
- repository search로 production/current reference에 제거된 command surface와 semantics가 남지 않았는지
  확인한다.
- 일반 회귀 검증 후 필요한 최소 live acceptance만 opt-in으로 실행한다.

## 테스트 매트릭스

최소 subprocess acceptance:

| 시나리오                                            | 기대 결과                                         |
| --------------------------------------------------- | ------------------------------------------------- |
| `myboxctl list`                                     | `/` direct children, exit 0                       |
| `myboxctl ls`                                       | `list`와 동일 결과                                |
| `myboxctl list /file`                               | file 한 row, exit 0                               |
| `myboxctl list /missing`                            | not-found / exit 4                                |
| `myboxctl list --json`                              | `command: "list"`, stdout JSON 1개, stderr empty  |
| `myboxctl ls --json`                                | canonical `command: "list"`                       |
| empty list human                                    | 명시적 `No items ...`                             |
| `info` found                                        | human + JSON `found`                              |
| `info` missing                                      | failure/not-found / exit 4                        |
| `mkdir /a/b` parent missing                         | not-found, mutation 없음                          |
| `mkdir /a` existing                                 | conflict / exit 5                                 |
| `mkdir -p /a/b`                                     | parents 생성 또는 existing 성공                   |
| `upload file.zip`                                   | `/file.zip` effective target                      |
| `upload file.zip /`                                 | `/file.zip` effective target                      |
| `upload file.zip /store` existing directory         | `/store/file.zip`                                 |
| `upload file.zip /store` missing                    | exact `/store` file target                        |
| `upload file.zip /store/` missing                   | failure                                           |
| `upload file.zip /store/ --mkdir`                   | `/store/file.zip`                                 |
| `upload` metadata current                           | skipped                                           |
| `upload` local newer/size diff                      | overwritten                                       |
| `upload` remote newer                               | conflict/exit 5                                   |
| `upload --force`                                    | overwrite                                         |
| `download /share/file.zip`                          | `./file.zip`                                      |
| `download /share/file.zip ./downloads` existing dir | `./downloads/file.zip`                            |
| `download /share/file.zip ./renamed.zip`            | exact destination                                 |
| download trailing directory intent but missing dir  | local-file failure, directory 생성 안 함          |
| `delete /missing`                                   | not-found / exit 4                                |
| `delete /missing --ignore-missing`                  | already-absent / exit 0                           |
| folder delete                                       | folder/subtree trash 의미가 help/result에 명확함  |
| `myboxctl --json list /`                            | 정상 machine mode                                 |
| `myboxctl list / --json`                            | 위와 동일                                         |
| `--json` failure                                    | versioned failure envelope 1개 + stderr empty     |
| `--json --verbose`                                  | stdout final envelope + stderr valid JSONL events |
| credential-shaped fixture                           | 모든 output stream redacted                       |

추가 unit/feature acceptance:

- remote destination parser가 `/store`와 `/store/`의 resource identity는 같게 유지하면서
  `directoryIntent`를 구분한다.
- 확장자 유무가 destination type 판정에 영향을 주지 않는다.
- NFC/NFD와 case 정책은 기존 Phase 12 계약을 유지한다.
- effective target 결정 후에만 upload metadata decision을 수행하고 directory 자체를 file overwrite하지
  않는다.
- download existing directory는 안전하게 basename child를 선택하고 directory 자체를 overwrite하지 않는다.

## 완료 조건

Phase 14는 다음을 모두 충족해야 `complete`다.

- [x] canonical command가 `list`, `info`, `mkdir`, `upload`, `download`, `delete`로 정리됨
- [x] `ls` alias와 argument 생략 시 `/` default가 검증됨
- [x] `list|ls`가 directory와 단일 file target 모두 자연스럽게 처리함
- [x] `stat`, `ensure-dir`, `put`, `upload --overwrite`, `delete --strict`이 current public surface에서 제거됨
- [x] `info` missing이 not-found/exit 4로 일관되게 처리됨
- [x] `mkdir`와 `mkdir -p|--parents` semantics가 분리되고 검증됨
- [x] `upload`가 기존 metadata 조건부 정책을 기본으로 사용함
- [x] `upload <file>`과 root/existing-directory/trailing-slash destination이 예상 가능한 effective target을
      선택함
- [x] `download` destination 생략, existing-directory, exact-file semantics가 검증됨
- [x] `delete` missing 기본 실패와 `--ignore-missing` idempotent mode가 검증됨
- [x] folder delete의 subtree trash 의미가 help/human output에 명시됨
- [x] global `--json`/`--verbose`/`--quiet`가 subcommand 전후 위치에서 동일하게 동작함
- [x] human `list`가 헤더/빈 결과/file-one-row를 명확히 표시함
- [x] human `info`와 mutation/download 결과가 self-describing함
- [x] JSON envelope에 `schemaVersion: 1`이 존재함
- [x] `sizeBytes`, explicit null, normalized type/time 규칙이 모든 관련 command에 적용됨
- [x] 기본 `--json` stdout은 JSON document 정확히 1개이고 stderr는 비어 있음
- [x] `--json --verbose` event JSONL은 기존 credential/redaction 계약을 유지함
- [x] action enum, exit code와 error shape가 문서와 tests로 고정됨
- [x] README와 stable CLI contract가 실제 구현과 일치함
- [x] 일반 typecheck/lint/unit/subprocess/release smoke가 모두 통과함
- [x] 새 API를 추가하지 않는 CLI contract 변경이라 opt-in MYBOX acceptance는 별도 실행하지 않음

## 공개 Release 경계

Phase 14 완료 전에는 현재 draft `v0.1.0`을 공개하지 않는다. Phase 14가 완료되면 새 CLI surface,
destination semantics와 `schemaVersion: 1`을 실제 첫 public contract로 간주하고
release artifact/help/README를 다시 검증한 뒤 별도 승인으로 공개한다.
