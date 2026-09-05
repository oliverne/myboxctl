# Phase 15 — Recursive Folder Transfer

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 현재 단일 파일 전용인 `upload`와 `download`를
명시적인 폴더 재귀 전송까지 확장하는 실행 계획이다.

## 상태와 진입 조건

- 상태: `in_progress`
- 활성 phase: Phase 15
- Phase 00~14와 npm `v0.2.3` 배포는 완료된 상태를 전제로 한다.
- 구현 시작 시 `docs/PROGRESS.md`에서 Phase 15만 `in_progress`로 바꾼다.
- 실제 MYBOX 검증은 기존 opt-in 정책과 `/myboxctl-integration-test/` 격리 규칙을 유지한다.

## 목표

로컬 폴더를 MYBOX에 올리고 원격 폴더를 로컬에 내려받는다. 폴더 전송은 대량 I/O와 여러 resource
생성을 명시적으로 승인하는 `--recursive`가 있을 때만 실행한다.

```bash
myboxctl upload ./reports /backup/ --recursive --mkdir
myboxctl download /reports ./backup --recursive
myboxctl download /reports --recursive --json
```

Phase 13에서 제외했던 download byte progress도 이 phase에 포함한다. 현재 단일 파일과 새 recursive
folder download 모두 실제 response body에서 기록한 byte를 기준으로 진행 상태를 제공하며, Windows를
포함한 지원 운영체제에서 같은 event와 표시 계약을 사용한다.

Windows 실행에서 최종 error code만 확보되어 원인을 재현하기 어려웠던 사례를 위해 모든 command에
opt-in 진단 파일을 추가한다. 터미널 출력과 별개의 JSON Lines에 실행 환경, typed event, 최종 결과와
제한된 OS 오류 정보를 남긴다. 사용자가 요청하지 않은 실행에서는 파일을 만들지 않는다.

기존 단일 파일 upload의 metadata 정책, mutation reconcile/resume과 로컬 변경 감지, download의
bounded-memory streaming, signed URL 보호, 전송 전후 metadata 검증과 파일별 atomic commit 계약을
그대로 재사용한다.

## Public CLI 계약

```text
myboxctl [--json] [--verbose] [--quiet] [--diagnostic-log <file>] <command>
upload <local-path> [remote-destination] [--recursive] [--mkdir] [--force]
download <remote-path> [local-destination] [--recursive] [--overwrite]
```

`--diagnostic-log`는 `list`, `info`, `mkdir`, `upload`, `download`, `delete`에 공통 적용하며 기존
presentation option처럼 root 또는 subcommand 앞뒤에 둘 수 있다.

기능 구현 전에는 PowerShell에서 기존 stream을 다음처럼 분리해 보존할 수 있다. `result.json`에는 최종
성공/실패 envelope, `events.jsonl`에는 `--verbose` typed event가 남고 실제 exit code는
`$LASTEXITCODE`로 확인한다.

```powershell
myboxctl download ... --json --verbose 1> result.json 2> events.jsonl
$LASTEXITCODE
```

### upload local source

- regular file은 현재 동작을 유지하며 `--recursive`가 필요하지 않다. regular file에 함께 지정된
  `--recursive`는 안전 정책을 바꾸지 않는 redundant option으로 허용한다.
- directory는 `--recursive`가 없으면 invalid-arguments / exit 2다.
- symbolic link와 socket/device 등 non-regular entry는 manifest 생성 중 fail-closed한다.
- 빈 directory를 포함해 상대 경로, entry type, file size, modified time과 platform에서 확인 가능한
  file/directory identity를 manifest에 기록한다.
- source root의 `realpath`와 identity를 anchor로 기록하고 첫 remote mutation 직전에 전체 local manifest를
  다시 검증한다. 각 file은 upload reservation 전에 `lstat`과 열린 handle의 `fstat`을 manifest identity와
  비교하고, 검증한 동일 handle에서 content를 읽는다. source tree 안의 조상 directory도 manifest
  identity와 symlink 여부를 다시 확인한다.
- manifest 생성 뒤 local tree가 바뀌면 `local-file-changed` / exit 7로 실패한다. 변경을 발견하기 전에
  이미 remote mutation이 있었다면 부분 전송 failure 계약을 사용한다.

### upload remote destination

| 입력/상태                                    | effective target                                        |
| -------------------------------------------- | ------------------------------------------------------- |
| destination 생략 또는 `/`                    | `/<local-folder-basename>`                              |
| 기존 remote directory                        | `<directory>/<local-folder-basename>`                   |
| missing path, parent 존재                    | 해당 path를 새 remote root folder로 한 단계 생성        |
| missing path, parent 없음                    | `--mkdir` 없이는 not-found / exit 4                     |
| missing path, parent 없음 + `--mkdir`        | parent hierarchy 생성 후 해당 path를 remote root로 생성 |
| trailing `/`인 missing directory             | `--mkdir` 없이는 not-found / exit 4                     |
| trailing `/`인 missing directory + `--mkdir` | container hierarchy 생성 후 그 아래 basename 사용       |
| 최종 remote root가 이미 존재                 | file/folder 모두 conflict / exit 5                      |
| directory source와 `--force`를 함께 사용     | invalid-arguments / exit 2                              |

- 기존 remote directory merge와 recursive overwrite는 이번 phase에 포함하지 않는다.
- 각 remote component는 기존 NFC 생성 정책을 사용한다.
- local tree의 모든 component는 아래 portable name 정책을 적용한다. NFC와 collision key 변환 후 같은
  remote path가 되는 이름은 mutation 전에 conflict로 거부한다.
- `--mkdir`로 만드는 destination parent/container는 기존 idempotent ensure-dir와 response-loss
  reconciliation을 재사용할 수 있다. 반면 transfer root와 그 child folder는 기존 tree와 merge하지 않는
  exclusive create다.
- exclusive create가 직접 성공한 경우에만 해당 folder를 이번 실행이 생성한 것으로 확정하고 하위
  mutation을 계속한다. 명시적인 409는 conflict다. retryable failure 또는 invalid response 뒤에는 같은
  exact path를 poll하되, folder가 발견되어도 소유권을 확정할 수 없으므로 creation outcome이 uncertain인
  부분 failure로 중단한다. 어느 경우에도 POST를 반복하지 않는다.
- file은 결정적인 relative path 순서로 하나씩 업로드하고 기존 size/mtime, resume와 postcondition을
  재사용한다. manifest에서 검증한 열린 file handle, effective target/resolution과 생성 응답에서 얻은
  `parentId`를 전달한다. 기존 `runUpload`는 target resolution을 받아도 부모를 다시 resolve하므로,
  recursive core에서는 이미 확인한 부모를 파일마다 다시 검색하지 않도록 변경한다.

### download 원격 대상

- file은 현재 동작을 유지하며 `--recursive`가 필요하지 않다.
- folder는 `--recursive`가 없으면 conflict / exit 5다.
- MYBOX root `/`의 재귀 다운로드는 실수로 전체 계정을 내려받는 것을 막기 위해 거부한다.
- folder traversal은 direct-child pagination을 사용하며 path 검색으로 각 child를 다시 resolve하지 않는다.
- manifest에는 resource ID, parent ID, type, 실제 name과 relative path를 기록하고, file은 size와
  modified time도 기록한다.
- 같은 resource ID를 file/folder 구분 없이 두 번 방문하면 잘못된 서버 계층으로 보고 안전하게 실패한다.

### download local destination

| 입력/상태                               | 결과                                   |
| --------------------------------------- | -------------------------------------- |
| destination 생략 또는 `.`               | `./<remote-folder-basename>`           |
| 기존 local directory                    | `<directory>/<remote-folder-basename>` |
| 존재하지 않는 path                      | 해당 path를 새 destination root로 생성 |
| 최종 destination root가 이미 존재       | conflict / exit 5                      |
| folder 입력과 `--overwrite`를 함께 사용 | invalid-arguments / exit 2             |

- 기존 directory merge와 recursive overwrite는 이번 phase에 포함하지 않는다.
- destination parent는 이미 존재하는 실제 directory여야 하고 그 entry 자체가 symlink이면 안 된다.
  parent의 최초 `realpath`와 identity를 anchor로 기록해 상위 경로가 바뀌어도 감지한다.
- destination root는 exclusive create하고 remote의 빈 folder도 보존한다. root와 생성한 모든 하위
  directory의 identity를 기록하고 mkdir, temp file 생성과 commit 전에 parent anchor와 destination tree
  안의 전체 조상 chain이 그대로인지 다시 확인한다.
- remote name은 아래 portable name 정책과 전체 manifest collision 검사를 통과해야 한다. 서로 다른
  remote resource를 하나의 local path로 임의 병합하지 않는다.

### portable name 정책

재귀 transfer는 생성된 tree가 Ubuntu, macOS와 Windows 사이에서 다시 왕복할 수 있도록 upload local
component와 download remote component에 같은 fail-closed 정책을 적용한다.

- 빈 이름, `.`/`..`, `/`, `\\`, C0/DEL과 Windows 금지 문자 `<`, `>`, `:`, `"`, `|`, `?`, `*`를 거부한다.
- ASCII space 또는 `.`으로 끝나는 component를 거부한다.
- component의 첫 `.` 앞 stem이 Windows 예약 basename `CON`, `PRN`, `AUX`, `NUL`, `COM1`~~`COM9`,
  `LPT1`~~`LPT9`이면 확장자와 대소문자에 관계없이 거부한다.
- collision key는 component를 NFC로 바꾼 뒤 ECMAScript의 locale-independent `toLowerCase()`를 적용해
  만든다. 한 manifest 안에서 같은 parent 아래 key가 중복되면 운영체제와 관계없이 conflict다.
- 실제 target 운영체제에서 component나 전체 path를 안전하게 표현할 수 없는 경우 destination root
  생성 전에 실패한다. local source의 원래 spelling은 rename하거나 정규화하지 않는다.

## 실행과 실패 정책

upload는 전체 local manifest, portable name, remote destination conflict를 검증하고 local manifest를
다시 확인한 뒤 remote mutation을 시작한다. folder 생성과 file upload는 순차 실행하며 각 file은
manifest와 동일한 열린 handle만 사용한다. 마지막에 local tree manifest를 다시 비교한다. 실패나 SIGINT가
발생하면 이미 생성한 remote folder/file을 자동 삭제하지 않고 구조화된 부분 전송 failure를 반환한다.

download는 원격 folder의 모든 direct child page를 순회해 topology와 file metadata manifest 및 local
path를 검증한 뒤 destination root를 만든다. 각 file의 content 요청 전 detail이 최초 manifest와 같은지
확인하고 순차 다운로드한다. 마지막에는 전체 remote tree를 다시 순회해 resource ID, parent, type, name,
size와 modified time을 최초 manifest와 비교한다. 미완성 temp file은 제거하지만 완료된 file/directory는
보존하고 구조화된 부분 전송 failure를 반환한다.

두 방향 모두 동시 전송을 추가하지 않는다. API 호출량, 오류 순서와 progress 출력을 결정적으로 유지한다.
folder tree 전체의 원자적 commit이나 rollback은 보장하지 않으며, 불확실한 소유권의 local/remote tree를
재귀 삭제하지 않는다.

## 진단 로그 계약

`--diagnostic-log <file>`은 사용자가 명시한 한 번의 실행을 독립 JSONL 파일로 기록한다. 자동 기본 경로,
상시 로그와 환경변수 별칭은 추가하지 않는다. 상대·절대 local file path를 허용하되 parent directory는
이미 존재해야 한다. 대상은 command의 config/PAT 로딩, MYBOX 요청과 local/remote mutation 전에
`wx` 방식으로 exclusive create하며 기존 file, directory와 symlink를 덮어쓰거나 따라가지 않는다.
열기 실패는 `local-file` / exit 7로 최종 출력하고 command 본문을 실행하지 않는다. POSIX에서는 mode
`0600`을 요청하고 Windows에서는 사용자 계정의 기존 parent ACL을 따른다.

`runCli`는 Commander parsing 전에 raw argv에서 `--diagnostic-log <file>` 위치만 bootstrap parsing한다.
`--diagnostic-log=<file>`도 같은 의미로 허용한다. option은 `--` separator 앞에 한 번만 허용하며 값 누락과
중복은 invalid-arguments / exit 2다. 이 경우 log target이 결정되지 않으므로 파일을 만들지 않는다. 이
선행 단계는 log path와 option value를 건너뛴 command candidate 외의 argument를 해석하거나 기록하지
않는다. 유효한 candidate는 `ls`를 `list`로 정규화하고, 알 수 없는 candidate는 parse error 진단을 위해
그대로 기록한다. log file을 먼저 연 뒤 Commander parse를 실행하므로 잘못된 command/option과 runtime
생성 실패도 가능한 경우 `run-completed`에 남긴다. 인자 없는 기본 help와 `--help`/`--version`은 command
operation이 아니므로 `--diagnostic-log`를 함께 지정해도 파일을 만들지 않고 기존 stdout/exit 0을 유지한다.

파일은 UTF-8 JSON Lines이며 모든 record에 `diagnosticSchemaVersion: 1`, UTC `timestamp`, UUID
`runId`, 0부터 단조 증가하는 `sequence`와 `type`을 둔다. 한 파일에는 다음 순서로 기록한다.

1. `run-started`: myboxctl version, canonical command, allowlist된 boolean option, `platform`, `arch`,
   runtime 이름과 version
2. `event`: 기존 `ObservabilityEvent`의 `level`, `event`, `command`, `data`
3. `run-completed`: 기존 success/failure envelope와 실제 exit code

allowlist option은 `json`, `verbose`, `quiet`, `recursive`, `mkdir`, `force`, `overwrite`, `parents`,
`ignoreMissing`이며 positional local/remote path와 diagnostic log path는 `run-started`에 넣지 않는다.
실패한 local filesystem operation의 path는 아래 제한된 `cause.path`에서만 기록할 수 있다.

```jsonl
{"diagnosticSchemaVersion":1,"timestamp":"2026-09-05T05:00:00.000Z","runId":"<uuid>","sequence":0,"type":"run-started","data":{"version":"0.2.3","command":"download","options":{"json":true,"verbose":true},"platform":"win32","arch":"x64","runtime":{"name":"node","version":"24.0.0"}}}
{"diagnosticSchemaVersion":1,"timestamp":"2026-09-05T05:00:01.000Z","runId":"<uuid>","sequence":1,"type":"run-completed","exitCode":7,"result":{"schemaVersion":1,"ok":false,"command":"download","error":{"kind":"local-file","message":"The local file could not be written.","retryable":false,"code":"EPERM","requestId":null,"retryAfterMs":null}},"cause":{"name":"Error","code":"EPERM","errno":-4048,"syscall":"open","path":"C:\\work\\report.pdf"}}
```

raw `argv` 전체는 기록하지 않는다. terminal renderer가 숨기는 info/progress event도 diagnostic sink에는
기록하므로 `--quiet`, `--json`과 TTY 여부가 파일 내용을 줄이지 않는다. console sink와 file sink를 fan-out
하되 file 기록이 다시 console event를 만들지 않게 한다. event 발생 순서와 final envelope는 기존
stdout/stderr 계약을 바꾸지 않는다. SIGINT와 terminal failure에서도 가능한 범위에서 마지막 record를
flush한 뒤 file handle을 닫는다.

기존 `EventSink.emit`이 동기 경계이므로 새 dependency 없이 한 file descriptor에 UTF-8 line을 순서대로
완전히 쓰는 작은 synchronous writer를 사용한다. partial write는 남은 byte를 이어 쓰며 error가 나면 아래
write failure 정책으로 전환한다. `runCli`가 diagnostic session의 생성과 종료를 소유하고, runtime에서는
console sink와 session sink를 합성한다. command action이 stdout을 직접 쓴 뒤 결과를 잃지 않도록 success와
failure envelope 생성, terminal 출력, `run-completed` 기록이 같은 최종 결과 객체를 사용하게 정리한다.

terminal failure의 diagnostic record에는 public failure envelope 외에 원본 `Error`에서 allowlist한
`name`, `message`, `code`, `errno`, `syscall`, `path`, redaction된 `stack`을 `cause`로 추가할 수 있다.
Windows file I/O의 `EPERM`, `EACCES`, `ENOENT`, invalid path와 긴 path 문제를 구분하기 위한 정보다.
local path와 stack은 사용자 환경 정보를 포함할 수 있으므로 opt-in 로그에만 기록하고 공유 전에 검토할
내용으로 문서화한다. PAT, Authorization, credentials, upload/download URL과 signed query는 기존
`sanitizeForOutput`을 모든 record에 적용해 제거한다. raw request/response header와 body는 기록하지 않는다.

명시적으로 요청한 로그를 실행 중 더 이상 쓸 수 없으면 stderr에 redaction된 warning을 한 번 출력하고
diagnostic sink만 비활성화한다. 이미 시작한 mutation을 로그 오류 때문에 중단하거나 재실행하지 않고 원래
command 결과와 exit code를 유지한다. 첫 write도 완료하지 못한 경우에는 command 본문 시작 전 open
failure와 같이 처리한다. 각 실행은 새 file을 요구하므로 append, rotation, 여러 process의 한 파일 공유와
로그 자동 삭제는 구현하지 않는다.

중간 write/close 실패 알림은 새 warning event `diagnostic.write-failed`로 console sink에만 보내며
`data`에는 `stage: "write" | "close"`와 redaction된 OS `code`만 허용한다. human mode는 한 줄 warning,
JSON mode는 한 JSONL record로 출력하고, 명시적으로 요청한 로그가 불완전하다는 사실이므로 `--quiet`도
이 알림을 숨기지 않는다. write가 일부 진행된 뒤 실패하면 파일의 마지막 line은 불완전할 수 있으며
reader는 newline으로 끝나지 않는 마지막 record를 무시한다. 첫 write 실패는 file handle을 닫고 command를
시작하지 않지만, 생성된 file을 임의 경로 판단으로 삭제하지 않는다.

## 요금제 설정과 API 호출량

이 절은 Phase 15에서 구현할 계약이다. 현재 production limiter는 보수적인 고정 한도를 사용하며,
사용자용 `plan` 설정이나 `MYBOX_PLAN`은 아직 지원하지 않는다.

### 사용자 설정

기본 설정 파일은 `~/.config/myboxctl/config.json`이며 `XDG_CONFIG_HOME`이 있으면
`${XDG_CONFIG_HOME}/myboxctl/config.json`을 사용한다. PAT는 기존 credentials 파일 또는 `MYBOX_PAT`로
계속 관리한다.

```json
{
  "plan": "180GB"
}
```

- 적용 우선순위는 `MYBOX_PLAN` 환경변수 → 설정 파일의 `plan` → 보수적인 기본값이다.
- 허용값은 아래 표의 요금제 이름이다. 적용할 값이 빈 문자열이거나 허용값이 아니면
  invalid-arguments / exit 2로 종료한다. 설정 파일이 없으면 기본값을 사용하고, 파일 읽기 실패나 잘못된
  JSON/구조는 설정 오류로 처리한다.
- 미설정 시 검색 10회/분, 삭제 60회/분, 기타 API별 60회/분을 적용한다. 일 한도 안내에는 최소
  500회/일을 보수적인 참고값으로 사용하고 사용자의 실제 요금제로 표시하지 않는다.
- 설정은 모든 command의 공통 runtime에 적용한다. 임의의 API별 숫자 override, limiter 해제와 CLI
  `--plan` option은 추가하지 않는다.
- 사용자가 선언한 요금제를 사용하며 자동 감지는 하지 않는다. `GET /v1/drive/storage`의 공개 응답에는
  요금제 식별자가 없고 `quotaBytes`는 나눠쓰기/메일 용량 분배까지 포함하므로 용량에서 요금제를
  역산하지 않는다.

### 공식 한도와 적용 정책

2026-09-05 확인한 [공식 사용 한도](https://developers.mybox.naver.com/getting-started)와
[내 파일 속성 API](https://developers.mybox.naver.com/docs/dms_storage)를 기준으로 한다.

| `plan` 값        | 검색/분 | 삭제/분 | 다운로드/일 |
| ---------------- | ------: | ------: | ----------: |
| `30GB`           |      10 |      60 |         500 |
| `80GB`           |      10 |      60 |       1,000 |
| `180GB`, `330GB` |      30 |     240 |       1,000 |
| `2TB`            |      30 |     240 |       2,000 |
| `5TB`            |      30 |     240 |       5,000 |
| `10TB`           |      30 |     240 |      20,000 |
| `20TB`           |      30 |     240 |      50,000 |

180GB 이상 삭제 한도는 공식 문서상 API별 기준이다. 현재 사용하는 resource delete bucket에 적용한다.
storage/root-list/folder-list/resource-detail/folder-create/upload-reservation은 요금제와 관계없이
각각 60회/분을 유지하고, file/folder search는 기존 공유 search bucket을 사용한다.

요금제 설정은 로컬 요청 속도를 조절할 뿐 서버 한도를 변경하지 않는다. 기존 60초 sliding window와
프로세스 간 호출 이력 공유를 유지한다. 요금제를 변경해도 요청 이력과 `blockedUntil`을 초기화하거나
요금제별 bucket으로 분리하지 않는다. `Retry-After` 우선과 operation별 retry/resume/reconcile 정책도
유지한다. 여러 기기나 다른 도구의 호출은 로컬 limiter가 조정할 수 없다.

### 정상 전송의 호출량 기준

`N`은 파일 수, `D`는 transfer tree 안의 폴더 수(root 포함), `P`는 remote tree를 한 번 순회하는 데
필요한 direct-child 목록 페이지 수다. 아래는 destination 준비, storage cache 갱신과 실패 복구를 제외한
정상 경로의 목표이며 실제 소요 시간 측정값이 아니다.

| 방향     | API 호출량 기준                                                                   |
| -------- | --------------------------------------------------------------------------------- |
| upload   | upload reservation `N`, 완료 resource detail `N`, folder create `D`               |
| download | 전후 resource detail `2N`, download URL 발급 `N`, 시작·종료 folder list 합계 `2P` |

- upload는 부모 ID와 target resolution을 재사용하고 정상 완료 응답의 resource ID로 postcondition을
  검증한다. 완료 응답이 없는 resume/reconcile 경로의 exact search polling은 기존 안전 정책을 유지한다.
- download는 manifest의 resource ID를 넘겨 child별 path search를 없앤다. 최초 manifest와 전송 직전
  metadata를 비교할 때 기존 `runDownload`의 전송 직전 detail 결과를 재사용해 세 번째 detail 호출을
  추가하지 않는다. 전송 직후 detail과 최종 tree 재순회는 유지한다.
- destination 준비를 마친 정상 전송에서 파일 수에 비례하는 search 호출이 발생하지 않아야 한다.
  direct-child pagination은 기존 기본 `count=1000`과 cursor 검증을 재사용한다.
- 다운로드는 파일당 detail 2회 때문에 지속 처리량이 최대 약 30파일/분이며, upload는 예약·완료 상세
  조회 각각 60회/분 한도를 받는다. 시작 시 남은 quota, 폴더 수, 네트워크와 파일 크기에 따라 실제
  처리량은 더 낮다. 상위 요금제나 병렬화로 이들 60회/분 한도를 높일 수는 없다.
- fake HTTP 요청 수와 fake clock 기반 limiter 테스트로 위 기준을 검증한다. 정상 경로와 오류 복구의
  추가 호출을 분리해 검증하고 실제 MYBOX 대량 호출로 한도를 소진하는 테스트는 추가하지 않는다.

### 다운로드 일 한도와 부분 실패

전체 manifest를 만든 뒤 최초 local mutation 전에 예상 download URL 발급 횟수(`N`)와 설정된 일 한도를
안내한다. 미설정이면 기본 참고값임을 밝힌다. 다른 도구·기기의 사용량을 알 수 없으므로 이 값을 실제
남은 횟수로 표시하거나 완료 가능성을 보장하지 않는다. 초기 구현에서는 일일 사용량 장부, 남은 quota
추정이나 다음 날까지 자동 대기하는 기능을 추가하지 않는다.

예상 횟수가 일 한도보다 많으면 중도 중단 가능성을 warning event로 알리되 이 비교만으로 전송을
차단하지 않는다. 다운로드 URL 발급이나 content 전송이 거부되면 기존 operation 정책대로 실패하고,
확정된 부분 결과와 `error.partialTransfer`를 보존한다. `429`만으로 분당 제한과 일 한도 소진을 구분할
수 있다고 가정하지 않으며 reset 시각을 추측하지 않는다.

폴더 전체 resume는 계속 비범위다. 부분 실패 후 같은 effective destination root로 다시 전송하면
conflict가 발생한다. 기존 directory를 container로 해석하는 destination 규칙 때문에 같은 인자를 다시
사용해도 같은 effective root가 되지 않을 수 있으므로, 재실행을 이어받기로 안내하지 않는다.
사용자 문서에는 완료된 파일을 확인한 뒤 남은 파일을 단일 파일 download로 받거나, 충분한 quota가
있을 때 새 destination으로 전체 전송을 다시 실행하는 절차를 설명한다. 자동 merge나 부분 tree 삭제는
수행하지 않는다.

## 출력 계약

folder 성공의 machine result는 기존 envelope를 유지하고 방향별 count를 제공한다.

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "download",
  "action": "downloaded",
  "data": {
    "type": "folder",
    "remotePath": "/reports",
    "localPath": "./reports",
    "resourceId": "folder-id",
    "filesDownloaded": 12,
    "foldersCreated": 4,
    "bytesDownloaded": 34567
  }
}
```

upload folder는 같은 위치에 `type: "folder"`, `filesUploaded`, `foldersCreated`, `bytesUploaded`를
제공한다. `resourceId`는 upload에서는 생성한 remote root folder ID, download에서는 source remote
folder ID다. folder count는 destination root를 포함한다. 빈 tree의 결과는 file 0개, folder 1개,
byte 0이며 byte count는 완료된 모든 regular file의 합이다. upload의 `foldersCreated`는 source manifest에
속한 transfer root와 child folder만 세며, `--mkdir`로 만든 destination parent/container는 제외한다.
human output은 source/destination, file/folder 수와 총 byte를 한 번 요약한다.

download는 `download.transfer-started`, `download.transfer-progress`,
`download.transfer-completed` event를 사용한다. 단일 파일에서는 response body에서 실제로 기록한 byte와
remote metadata의 전체 byte를 제공한다. recursive download에서는 현재 relative path, 현재 파일 byte와
전체 tree의 누적 file/byte를 함께 제공한다. byte는 단조 증가하고 완료 event는 검증된 최종 크기와
일치해야 한다. 기존 event 출력 정책에 따라 기본 human TTY에서는 500ms 이상 걸리는 전송을 한 줄로
갱신하고, non-TTY와 `--json`은 `--verbose`일 때만 line event를 출력한다.

`--json --verbose`의 진행 event에는 위 byte/count와 현재 relative path만 허용한다. 한도 안내 event에는
적용한 plan 또는 기본값 사용 여부, 예상 다운로드 횟수와 일 한도 참고값을 허용한다. 기존 rate-limit
wait event도 유지하며 `--quiet`는 event를 억제한다. PAT, Authorization header와 signed URL은 포함하지
않고 stdout의 최종 envelope는 유지한다.

mutation 전에 실패한 경우 기존 failure envelope를 그대로 사용한다. 하나 이상의 local/remote entry가
완료됐거나 mutation 응답 유실로 결과가 불확실한 경우에는 기존 `error.kind`, `code`와 exit code를
보존하면서 다음 optional field를 추가한다.

```json
{
  "error": {
    "partialTransfer": {
      "direction": "upload",
      "remoteRootPath": "/reports",
      "localRootPath": "./reports",
      "rootCreated": null,
      "filesCompleted": 2,
      "foldersCompleted": 1,
      "supportingFoldersCreated": 0,
      "bytesCompleted": 1234,
      "mutationMayHaveOccurred": true
    }
  }
}
```

`rootCreated`는 upload에서는 remote transfer root, download에서는 local destination root의 확정된 생성
여부이며 response-loss로 알 수 없으면 `null`이다. file/folder count와 byte는 source manifest 안에서
확인된 완료만 세고, `supportingFoldersCreated`는 upload `--mkdir`가 만든 parent/container 수다.
`partialTransfer`는 기존 required field를 바꾸지 않는 `schemaVersion: 1`의 additive field로 정의하고,
완료된 local/remote path 목록은 stdout에 추가하지 않는다. human error도 confirmed partial과 unknown
mutation을 구분해 한 번 알린다.

## 비범위

- MYBOX root `/` 전체 다운로드
- 기존 local/remote directory merge와 recursive overwrite
- folder operation 자체의 resume; 개별 file upload resume는 기존 정책 유지
- 여러 remote source를 한 번에 받는 문법
- include/exclude glob, depth/file-count/size filter
- parallel transfer와 concurrency option
- 자동 진단 로그, 기존 로그 append/overwrite, rotation, 원격 전송과 support bundle 생성
- 요금제 자동 감지, 임의 rate override, limiter 해제, 일일 잔여 quota 추정과 다음 날 자동 재개
- archive 생성 또는 stdout streaming
- 양방향 sync, remote 변경 감시와 local 삭제 전파
- symlink 생성, 권한·소유자·확장 attribute 보존
- 폴더 tree 전체의 atomic commit 또는 실패 시 recursive rollback

## 구현 순서

### P15-A — 공통 계약과 manifest

파일:

- `src/features/upload-command.ts`
- `src/features/download-command.ts`
- `src/errors.ts`
- `src/output.ts`
- `src/config.ts`와 `src/config.test.ts`
- `src/mybox/rate-limit.ts`와 `src/mybox/rate-limit.test.ts`
- `src/diagnostics.ts`와 unit test
- `src/observability.ts`
- `src/cli.ts`와 `src/cli.test.ts`
- `src/runtime.ts`
- 새 local/remote tree manifest module과 unit test
- `test/cli/upload.test.ts`
- `test/cli/download.test.ts`
- `test/cli/npm-package.test.ts`

작업:

- 설정 파일/환경변수 우선순위, 요금제 preset과 기본값을 구현한다. 잘못된 설정, 검색 10/30회와 삭제
  60/240회, 기타 API별 60회, 요금제 변경 전후 호출 이력·cooldown 보존을 fake clock으로 검증한다.
- `--diagnostic-log`를 공통 option으로 추가하고 runtime 생성 전에 exclusive file을 연다. injectable
  clock/UUID/writer로 `run-started` → 모든 typed event → `run-completed` 순서, sequence와 close를 검증한다.
- bootstrap option parser가 root/subcommand 앞뒤 위치와 `=` 형식, `--` separator, 공백·한글 path,
  missing/duplicate value, Commander parse error와 log를 만들지 않는 help/version을 처리하며 raw argv를
  record에 넣지 않는지 검증한다.
- command action과 top-level failure가 동일한 final envelope 객체를 console과 diagnostic session에
  전달하도록 출력 경계를 정리하고 기존 stdout/stderr shape와 exit code가 그대로인지 회귀 검증한다.
- console/file sink fan-out, presentation mode와 무관한 file event, success/failure exit code, SIGINT flush,
  open/first-write/mid-write failure 정책을 검증한다. mid-write failure는 warning 한 번 뒤 원래 command를
  계속하며 mutation을 반복하지 않아야 한다.
- `diagnostic.write-failed`가 file sink로 재진입하지 않고 human/JSON 형식을 지키며 `--quiet`에서도 한 번
  보이는지, reader가 불완전한 마지막 line만 무시하고 앞선 record를 보존하는지 검증한다.
- Node npm launcher를 포함한 subprocess test에서 error cause의 Windows-style `code`, `errno`, `syscall`,
  `path`, stack을 보존하고 PAT, Authorization, signed URL, raw HTTP payload를 제거하는지 검증한다.
- folder가 현재 실패하는 upload/download subprocess test를 기준으로 `--recursive` failing test를 먼저
  작성한다.
- local `lstat` walk와 remote direct-child pagination으로 deterministic manifest를 만든다.
- local file/directory identity와 remote file metadata를 manifest에 포함한다.
- symlink/non-regular entry, 모든 type의 duplicate resource ID, portable invalid name, Unicode/case
  collision과 tree 변경을 fail-closed한다.
- destination mapping, root, missing parent와 `--mkdir`, file/folder type과 option 조합의 오류를 고정한다.
- mutation 전 failure와 `error.partialTransfer`가 있는 confirmed/unknown partial failure를 구분하는 output
  contract test를 작성한다.

### P15-B — 순차 recursive upload

파일:

- `src/features/upload-command.ts`
- `src/features/upload.ts`
- `src/features/ensure-dir.ts`
- `src/runtime.ts`
- `test/http/upload.test.ts`
- `test/cli/upload.test.ts`

작업:

- destination parent/container에는 기존 idempotent ensure-dir를 사용하고, remote transfer root와
  children은 parent-first exclusive create로 생성한다.
- 기존 `runEnsureDir`와 `createFolderWithReconcile`의 idempotent public 동작은 바꾸지 않고 exclusive
  create를 별도 operation boundary로 둔다.
- exclusive create의 직접 성공, 409, response-loss 뒤 found/absent를 구분하며 uncertain 결과에서는 하위
  mutation 없이 부분 failure로 중단하고 POST를 반복하지 않는다.
- 각 file은 manifest identity와 일치하는 열린 handle을 기존 single-file upload core에 전달하고,
  effective target/resolution과 `parentId`도 함께 넘겨 부모를 포함한 중복 search를 피한다.
- 동일 parent의 파일 수를 늘리는 fake HTTP test에서 정상 search 호출 수가 증가하지 않고 예약·완료
  상세 조회가 각각 파일당 1회인지 검증한다. nested parent ID 재사용과 복구 polling은 별도로 검증한다.
- empty folder, 0-byte/Unicode file, missing parent matrix, manifest 이후 symlink/file/directory 교체, 중간
  mutation 실패와 SIGINT의 partial remote tree 정책을 검증한다.

### P15-C — 로컬 tree와 순차 recursive download

파일:

- `src/features/download-command.ts`
- `src/features/download.ts`
- `src/mybox/download.ts`
- `src/observability.ts`
- `src/local/`의 folder destination helper와 test
- `src/runtime.ts`

작업:

- destination parent의 `realpath`/identity anchor와 root를 `lstat`/exclusive create로 검증하고, anchor와
  생성한 tree의 directory identity를 이후 모든 mkdir/temp/commit 전에 재검증해 symlink와 교체를
  거부한다.
- empty folder를 포함한 하위 directory를 만들고 각 file은 기존 `runDownload` 경로를 재사용한다.
- 각 file의 최초 manifest metadata와 전송 직전 detail을 비교하고, 전송 완료 후 전체 topology와 file
  metadata manifest를 다시 조회한다. 기존 전송 직전 detail을 공유해 파일당 detail 2회를 유지한다.
- fake HTTP test에서 detail `2N`, URL 발급 `N`, 목록 `2P`와 child별 search 미호출을 검증한다.
- 일 한도 안내, 예상 횟수 초과 warning, URL 발급 429의 원인 미확정 처리와 부분 실패 뒤 동일
  effective destination root 재전송 conflict를 검증한다.
- file별 temp cleanup, manifest 이후 ancestor symlink 교체, 먼저 완료한 remote file의 후속 변경,
  SIGINT, remote-changed와 local conflict에서 부분 tree 정책을 검증한다.
- download stream에 실제 기록 byte 기반 progress callback을 추가하고 단일 파일과 recursive folder에서
  시작·중간·완료 event가 단조 증가하며 최종 metadata 크기와 일치하는지 검증한다.
- 전체 manifest를 메모리에 유지하되 file content는 기존 streaming으로 처리한다. 매우 큰 manifest의
  상한이 필요하다는 실제 증거가 생기기 전에는 임의 제한을 추가하지 않는다.

### P15-D — CLI output, 문서와 검증

파일:

- `src/cli.ts`
- `src/human-ui.ts`
- `src/output.ts`
- `test/cli/upload.test.ts`
- `test/cli/download.test.ts`
- `test/http/upload.test.ts`
- `test/http/download.test.ts`
- `README.md`
- `README.ko.md`
- `docs/reference/cli-contract.md`
- `docs/architecture/reliability.md`
- `docs/PROGRESS.md`
- `docs/HANDOFF.md`
- 필요 시 `.github/workflows/ci.yml`

작업:

- upload/download `--recursive`, folder summary JSON/human output과 safe progress event를 추가한다.
- `download.transfer-*`를 TTY 단일 progress line과 verbose non-TTY/JSONL event로 렌더링하고 Windows에서도
  cursor 제어 문자나 줄바꿈이 깨지지 않는지 fake writer 및 subprocess test로 검증한다.
- `--diagnostic-log` 사용법, 로그에 local path/stack이 포함될 수 있다는 공유 전 검토 안내와 현재
  `--json --verbose` stdout/stderr redirect 절차를 문서화한다.
- Windows npm launcher에서 공백·한글이 포함된 log path, 기존/symlink/directory target 거부, terminal에
  message/code/request ID가 남고 diagnostic file에 최종 failure와 exit code가 기록되는지 검증한다.
- 기존 single-file destination/options/JSON shape와 exit code가 바뀌지 않게 한다.
- 간결한 folder transfer 예시, portable name 규칙과 양방향 structured partial failure 정책을
  문서화한다.
- 구현된 요금제 설정/우선순위, 자동 감지 불가, API 호출량에 따른 처리량 한계, 일 한도와 부분 실패 후
  수동 처리 절차를 CLI contract와 reliability에 기록하고 README에서 간결하게 연결한다.
- Ubuntu, macOS와 Windows에서 portable invalid name/collision, manifest 이후 symlink·ancestor 교체
  거부와 파일별 안전 정책을 검증한다.
- 실제 MYBOX에서는 unique child 아래 nested/empty/Unicode/0-byte local/remote tree를 왕복하고 byte와
  구조를 확인한 뒤 resource ID 기반 cleanup을 수행한다.

## 검증

일반 검증:

```bash
bun run check
bun run build
```

실제 MYBOX 검증은 구현 후 별도 승인을 받아 실행한다.

```bash
MYBOX_INTEGRATION=1 bun test test/integration
```

## 완료 조건

- [ ] upload/download folder는 `--recursive`가 있을 때만 전송된다.
- [ ] 양방향 nested file과 empty folder가 정확한 relative path에 생성된다.
- [ ] missing parent와 `--mkdir`, 기존 destination, portable invalid name과 cross-platform collision이
      mutation 전에 결정적으로 처리된다.
- [ ] transfer root/child folder는 direct create 성공일 때만 소유권을 확정하며, 409와 response-loss
      uncertain 결과에서 기존 tree에 merge하거나 POST를 반복하지 않는다.
- [ ] symlink/non-regular entry와 manifest 이후 file/directory/ancestor 교체에서 tree 밖 content를
      읽거나 쓰기 전에 실패한다.
- [ ] file content는 bounded-memory로 전송되고 기존 upload resume/postcondition과 download atomic
      commit/metadata 검증을 유지한다.
- [ ] 단일 파일과 recursive download가 실제 기록 byte 기반의 단조 증가 progress를 제공하고 완료 값이
      remote metadata 및 최종 다운로드 byte와 일치한다.
- [ ] traversal 중 local identity, remote topology 또는 file metadata 변경을 감지해 실패한다.
- [ ] 실패/SIGINT에서 temp file이 남지 않고 pre-mutation failure와 confirmed/unknown partial transfer가
      human 및 `error.partialTransfer` JSON 계약으로 구분된다.
- [ ] 기존 단일 file upload/download 회귀와 JSON schema version 1이 유지된다.
- [ ] 요금제 preset, 설정 우선순위와 보수적 기본값이 적용되고 기존 공유 호출 이력·cooldown을 보존한다.
- [ ] 정상 전송에 파일별 search가 없고 upload/download API 호출량 기준을 fake HTTP로 검증한다.
- [ ] 일 한도 안내는 실제 잔여 quota로 표시하지 않으며, 한도 오류와 부분 실패 후 수동 처리 절차를 검증한다.
- [ ] `--diagnostic-log`는 기존 file/symlink를 덮어쓰지 않고 command 실행 전 시작되며, 모든 typed event와
      최종 envelope/exit code 및 allowlist된 OS 오류 정보를 presentation mode와 무관하게 JSONL로 기록한다.
- [ ] 진단 record와 write failure warning에 PAT, Authorization, credentials, signed URL 및 raw HTTP
      request/response가 없고, 로그 실패가 진행 중 mutation을 재시도하거나 원래 결과를 바꾸지 않는다.
- [ ] Windows npm launcher 실패에서 terminal message와 diagnostic file을 모두 회귀 검증한다.
- [ ] 일반 검사와 세 운영체제 local filesystem 검증이 통과한다.
- [ ] 승인된 실제 MYBOX folder round-trip acceptance와 unique resource cleanup이 통과한다.
- [ ] README, CLI contract, reliability, PROGRESS와 HANDOFF가 구현 사실과 일치한다.

## 중단 조건

- direct-child pagination으로 안정적인 tree manifest를 만들 수 없는 경우
- local/remote name을 반대편의 안전하고 결정적인 relative path로 표현할 수 없는 경우
- 기존 local/remote destination이나 symlink를 덮어쓸 가능성이 있는 경우
- manifest와 열린 file/directory identity를 비교해 tree 밖 read/write를 막을 수 없는 경우
- folder create/upload 응답 유실 뒤 mutation을 반복하거나 소유권이 불확실한 tree에 후속 mutation을 해야
  하는 경우
- 부분 전송 여부와 confirmed count를 기존 failure envelope에서 구조적으로 표현할 수 없는 경우
- signed URL, PAT 또는 Authorization 값이 output/event/error에 노출되는 경우
- diagnostic file을 command 시작 전에 안전하게 만들 수 없거나 terminal 출력과 다른 exit code를 기록하는 경우
- integration cleanup 대상이 `/myboxctl-integration-test/` 밖을 가리키는 경우
