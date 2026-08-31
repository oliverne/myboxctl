# Phase 14 — CLI UX & Agent Contract

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 공개 Release 전에 `myboxctl`의 명령 체계와 출력
계약을 사람과 AI 에이전트 양쪽에서 직관적이고 예측 가능하게 만드는 계획을 정의한다.

기존 개선 메모: [`../reference/cli-contract-improvements.md`](../reference/cli-contract-improvements.md)

## 상태와 진입 조건

- 상태: `planned`
- 활성 phase: 없음
- Phase 00~13 구현과 live acceptance는 완료된 상태를 전제로 한다.
- 아직 공개 Release 전이므로 기존 CLI 이름과 JSON shape의 호환성 유지보다 명확한 public contract를
  우선한다.
- 구현을 시작할 때만 `docs/PROGRESS.md`의 활성 phase를 Phase 14 `in_progress`로 변경한다.
- 실제 MYBOX 검증이 필요한 경우 기존 opt-in 정책과 `/myboxctl-integration-test/` 격리 규칙을 유지한다.

## 배경

현재 CLI는 API 안전성, Unicode 이름 처리, rate limit, upload resume, delete reconcile, JSON envelope와
exit code 같은 내부 계약은 충분히 단단해졌다. 반면 사용자에게 노출되는 CLI surface는 다음 문제가
남아 있다.

- `stat`, `ensure-dir`, `put`은 Unix/개발자 관례를 모르는 사용자에게 기능이 이름만으로 드러나지 않는다.
- `ls`는 인자가 필수라서 `myboxctl ls`가 오류가 되며 일반적인 `ls` 사용 감각과 다르다.
- 기본 human 성공 출력이 헤더 없는 TSV라서 필드 의미를 기억해야 하고 빈 `ls`는 아무 출력도 없다.
- `--json`은 최종 stdout envelope는 안정적이지만 기본 warning이 stderr JSONL로 나올 수 있어 단순한
  subprocess 호출자가 stdout/stderr 두 stream의 계약을 알아야 한다.
- `size` 단위, optional field의 생략/null 혼용, schema version 부재 등은 에이전트가 문서 밖의 추론을
  하게 만든다.

Phase 14는 새 기능을 늘리는 phase가 아니라 이미 구현된 기능을 더 명확한 CLI 제품 계약으로 정리하는
phase다.

## 목표

1. 명령 이름만 보고도 한국어 사용자를 포함한 일반 사용자가 기능을 쉽게 추측할 수 있게 한다.
2. Linux/Unix 사용자에게 익숙한 shorthand는 의미가 명확한 범위에서 alias로 제공한다.
3. 기본 human 출력은 별도 문서를 보지 않아도 이해할 수 있게 한다.
4. `--json`은 단일 subprocess 호출에서 stdout JSON 하나와 exit code만으로 결과를 판단할 수 있게 한다.
5. JSON 필드의 단위, nullable 규칙, 시간/type 정규화와 version을 명시적으로 고정한다.
6. 공개 Release 전에 기존 `put`/`stat`/`ensure-dir` 중심 명령 체계를 정리해 향후 compatibility 비용을
   만들지 않는다.

## 비목표

- shell 형태의 remote current working directory를 추가하지 않는다.
- `cd`, glob, recursive listing, interactive prompt를 추가하지 않는다.
- 양방향 sync, directory sync, daemon, MCP, SDK를 추가하지 않는다.
- localization framework나 한국어 번역 시스템을 추가하지 않는다. 명령 이름과 기본 메시지는 짧고
  쉬운 영어를 유지한다.
- table/markdown/spinner를 위한 새 UI dependency를 추가하지 않는다.
- rename/move/copy 등 MYBOX의 새 기능을 이번 phase에 추가하지 않는다.

## Public command surface

Phase 14 완료 후 canonical command는 다음 여섯 개로 정리한다.

| Command | Alias | 의미 | 인자 생략 |
| --- | --- | --- | --- |
| `list [remote-directory]` | `ls` | 원격 폴더의 direct children 조회 | `/` 사용 |
| `info <remote-path>` | 없음 | 원격 파일/폴더 정보 조회 | 오류 |
| `mkdir <remote-directory>` | 없음 | 누락된 parent를 포함해 폴더 보장 | 오류 |
| `upload <local-path> <remote-path>` | 없음 | 안전한 조건부 업로드/갱신 | 오류 |
| `download <remote-file> <local-path>` | 없음 | 원격 파일 다운로드 | 오류 |
| `delete <remote-path>` | 없음 | 원격 파일/폴더를 휴지통으로 이동 | 오류 |

### `list` / `ls`

`list`를 canonical command로 두고 `ls`를 shorthand alias로 제공한다.

```bash
myboxctl list
myboxctl list /reports
myboxctl ls
myboxctl ls /reports
```

- `remote-directory`를 생략하면 항상 `/`를 사용한다.
- remote cwd 상태는 만들지 않는다. 따라서 기본값은 실행 위치와 관계없이 deterministic한 MYBOX root다.
- 두 이름은 동일한 command contract, JSON `command` 값과 exit code를 사용한다.
- JSON의 canonical `command` 값은 alias 입력 여부와 관계없이 `"list"`로 정규화한다.

### `info`

기존 `stat`을 `info`로 대체한다.

```bash
myboxctl info /reports/a.pdf
```

- file과 folder 모두 조회한다.
- 인자를 생략하면 대상이 모호하므로 오류다.
- 없는 경로는 기존 정책처럼 정상 조회 결과 `action: "absent"`, exit 0을 유지한다.
- 공개 전 breaking change로 처리하며 `stat` alias는 남기지 않는다.

### `mkdir`

기존 `ensure-dir`을 `mkdir`로 대체한다.

```bash
myboxctl mkdir /reports/2026/08
```

- 의미는 일반 `mkdir`보다 `mkdir -p`에 가깝다.
- 누락된 parent를 함께 생성한다.
- 대상이 이미 존재해도 성공하며 `action: "existing"`을 반환한다.
- 중간 component가 file이면 conflict다.
- 도움말에서 "missing parents are created; existing directory is success"를 명시한다.
- 공개 전 breaking change로 처리하며 `ensure-dir` alias는 남기지 않는다.

### `upload`

기존 `put`의 안전한 metadata 정책을 `upload`의 기본 동작으로 승격하고 기존 `put` command는 제거한다.
기존 `upload`의 create-only/`--overwrite` surface도 제거한다.

```bash
myboxctl upload ./report.md /reports/report.md
myboxctl upload ./report.md /reports/report.md --mkdir
myboxctl upload ./report.md /reports/report.md --force
```

기본 정책:

| 상태 | 결과 |
| --- | --- |
| 원격 파일 없음 | `uploaded` |
| size 다름 | `overwritten` |
| local이 2초 tolerance를 넘어 더 최신 | `overwritten` |
| 현재 metadata상 동일 | `skipped` |
| remote가 2초 tolerance를 넘어 더 최신 | conflict / exit 5 |
| remote가 folder | conflict / exit 5 |
| `--force` | metadata 비교 결과와 관계없이 file overwrite |

- `--mkdir`은 기존처럼 누락된 remote parent를 생성한다.
- `--overwrite`는 제거하고 강제 변경은 `--force` 하나로 통일한다.
- 이 명령은 directory sync나 양방향 sync가 아니다. 한 local file을 한 remote path에 반영하는 명령이다.
- content hash를 도입하지 않는다. 현재 size + modified time 정책과 2초 tolerance를 유지하되 help에
  제한을 명시한다.
- 기존 `put`은 공개 전 제거하고 alias를 남기지 않는다.

### `download`

이름과 핵심 의미는 유지한다.

- destination이 존재하면 기본 conflict다.
- `--overwrite`는 기존 regular file만 안전하게 교체한다.
- local parent는 자동 생성하지 않는다.

### `delete`

이름과 기본 idempotent 정책을 유지한다.

- 성공: `deleted`
- 이미 없음: `already-absent`, exit 0
- `--strict`: absent를 exit 4로 처리
- `/` 삭제는 항상 거부
- `rm` alias는 추가하지 않는다. destructive command는 축약보다 명시성을 우선한다.

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

없는 경우:

```text
Not found: /reports/missing.pdf
```

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
Already absent: /reports/old.pdf
```

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

| 모드 | stdout | stderr |
| --- | --- | --- |
| 기본 human | human 최종 성공 | warning/progress + human 최종 오류 |
| `--json` | 최종 JSON envelope 정확히 1개 | 기본 empty |
| `--verbose` | 선택한 모드의 최종 결과 | 상세 human event |
| `--json --verbose` | 최종 JSON envelope 정확히 1개 | event JSON Lines |
| `--quiet` | human 최종 결과 유지 | human 실행 중 event 억제 |

- AI 호출자는 기본적으로 `myboxctl ... --json`만 사용하면 된다.
- 기본 JSON mode는 warning/progress를 stderr에 쓰지 않는다.
- 실행 event가 필요한 에이전트만 `--json --verbose`를 opt-in한다.
- terminal failure는 JSON mode에서 stdout failure envelope에만 한 번 출력한다.
- exit code는 기존 semantic mapping을 유지한다.

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

### Action enum

`action: string`을 사실상의 공개 enum으로 문서와 TypeScript type에서 고정한다.

| command | actions |
| --- | --- |
| `list` | `listed` |
| `info` | `found`, `absent` |
| `mkdir` | `created`, `existing` |
| `upload` | `uploaded`, `overwritten`, `skipped` |
| `download` | `downloaded` |
| `delete` | `deleted`, `already-absent` |

새 action 추가가 에이전트 분기에 영향을 주는 경우 contract change로 취급한다.

## Help contract

root help는 명령을 기능 중심으로 이해할 수 있게 한다.

```text
Commands:
  list|ls [remote-directory]       List files and folders (default: /)
  info <remote-path>               Show file or folder information
  mkdir <remote-directory>         Create a directory and missing parents
  upload <local-path> <remote-path> Upload or update a file when needed
  download <remote-file> <local-path> Download a file
  delete <remote-path>             Move a file or folder to MYBOX trash
```

각 subcommand help에는 다음을 포함한다.

- argument 의미와 remote path가 `/`로 시작한다는 규칙
- 기본 동작과 destructive/conflict 정책
- 주요 option 의미
- human 예제 1개와 `--json` 예제 1개
- 관련 exit code 또는 최소한 실패 유형

`upload --help`는 특히 다음을 명시한다.

- metadata가 같으면 skip
- remote가 더 최신이면 기본 conflict
- `--force`의 의미
- `--mkdir`의 의미
- size + modified time 비교이며 content hash가 아니라는 제한

## Compatibility 정책

아직 공개 Release 전이므로 Phase 14의 command rename과 JSON schema 변경은 호환 alias/deprecation layer 없이
한 번에 적용한다.

제거 대상:

- `stat`
- `ensure-dir`
- `put`
- 기존 create-only `upload` semantics
- `upload --overwrite`
- JSON `size`
- JSON optional field 생략

유지할 alias는 사용성 가치가 명확한 `ls -> list` 하나다.

README, `docs/reference/cli-contract.md`, shell completion/release smoke/test fixture에 기존 이름이 남지 않게
검색으로 검증한다. 과거 phase 문서는 당시 사실 기록이므로 history 설명 안의 기존 command 이름은 억지로
변경하지 않는다.

## 구현 순서

### P14-A — command surface와 help

후보 파일:

- `src/cli.ts`
- CLI subprocess tests
- README command examples

작업:

- `list` canonical + `ls` alias와 기본 `/`를 구현한다.
- `stat -> info`, `ensure-dir -> mkdir` rename을 적용한다.
- `put`을 제거하고 `upload`에 현재 put 정책을 연결한다.
- `upload --overwrite`를 제거하고 `--force`로 통일한다.
- root/subcommand help에 argument 설명, default, 예제와 핵심 정책을 추가한다.
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
- credential redaction과 단일 stdout JSON 규칙을 회귀 검증한다.

### P14-C — JSON stderr 단순화

후보 파일:

- `src/human-ui.ts`
- `src/runtime.ts`
- `src/cli.ts`
- observability/subprocess tests

작업:

- 기본 `--json`에서 실행 event를 렌더링하지 않는다.
- `--json --verbose`에서만 기존 structured JSONL event를 stderr에 출력한다.
- human 기본 warning/progress 정책은 유지한다.
- terminal failure 중복 금지, `--quiet`/`--verbose` conflict와 active-line cleanup을 유지한다.
- success/failure 각각 stdout 정확히 한 JSON + 기본 empty stderr를 subprocess test로 고정한다.

### P14-D — human renderer

후보 파일:

- `src/human-ui.ts`
- success renderer 분리 파일
- CLI subprocess tests

작업:

- list table, empty message, info key/value 출력과 mutation/download 문장형 결과를 구현한다.
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
- `cli-contract-improvements.md`에서 완료 항목을 제거하거나 문서를 종료한다.
- README 예제와 command 목록을 새 surface로 교체한다.
- package/release smoke가 `--help`, `list`, machine JSON contract를 검증하게 한다.
- repository search로 production/current reference에 제거된 command surface가 남지 않았는지 확인한다.
- 일반 회귀 검증 후 필요한 최소 live acceptance만 opt-in으로 실행한다.

## 테스트 매트릭스

최소 subprocess acceptance:

| 시나리오 | 기대 결과 |
| --- | --- |
| `myboxctl list` | `/` direct children, exit 0 |
| `myboxctl ls` | `list`와 동일 결과 |
| `myboxctl list --json` | `command: "list"`, stdout JSON 1개, stderr empty |
| `myboxctl ls --json` | canonical `command: "list"` |
| empty list human | 명시적 `No items ...` |
| `info` found/absent | human + JSON action 고정 |
| `mkdir` existing/new | idempotent action 고정 |
| `upload` absent | uploaded |
| `upload` metadata current | skipped |
| `upload` local newer/size diff | overwritten |
| `upload` remote newer | conflict/exit 5 |
| `upload --force` | overwrite |
| `--json` failure | versioned failure envelope 1개 + stderr empty |
| `--json --verbose` | stdout final envelope + stderr valid JSONL events |
| credential-shaped fixture | 모든 output stream redacted |

## 완료 조건

Phase 14는 다음을 모두 충족해야 `complete`다.

- [ ] canonical command가 `list`, `info`, `mkdir`, `upload`, `download`, `delete`로 정리됨
- [ ] `ls` alias와 argument 생략 시 `/` default가 검증됨
- [ ] `stat`, `ensure-dir`, `put`, `upload --overwrite`가 current public surface에서 제거됨
- [ ] `upload`가 기존 put의 안전한 조건부 정책을 기본으로 사용함
- [ ] human `list`가 헤더/빈 결과를 명확히 표시함
- [ ] human `info`와 mutation/download 결과가 self-describing함
- [ ] JSON envelope에 `schemaVersion: 1`이 존재함
- [ ] `sizeBytes`, explicit null, normalized type/time 규칙이 모든 관련 command에 적용됨
- [ ] 기본 `--json` stdout은 JSON document 정확히 1개이고 stderr는 비어 있음
- [ ] `--json --verbose` event JSONL은 기존 credential/redaction 계약을 유지함
- [ ] action enum, exit code와 error shape가 문서와 tests로 고정됨
- [ ] README와 stable CLI contract가 실제 구현과 일치함
- [ ] 일반 typecheck/lint/unit/subprocess/release smoke가 모두 통과함
- [ ] 필요한 경우 opt-in MYBOX acceptance와 cleanup이 통과함

## 공개 Release 경계

Phase 14 완료 전에는 현재 draft `v0.1.0`을 공개하지 않는다. Phase 14가 완료되면 새 CLI surface와
`schemaVersion: 1`을 실제 첫 public contract로 간주하고 release artifact/help/README를 다시 검증한 뒤
별도 승인으로 공개한다.
