# Phase 15 — Recursive Folder Transfer

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 현재 단일 파일 전용인 `upload`와 `download`를
명시적인 폴더 재귀 전송까지 확장하는 실행 계획이다.

## 상태와 진입 조건

- 상태: `pending`
- 활성 phase: 없음
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

기존 단일 파일 upload의 metadata 정책, mutation reconcile/resume과 로컬 변경 감지, download의
bounded-memory streaming, signed URL 보호, 전송 전후 metadata 검증과 파일별 atomic commit 계약을
그대로 재사용한다.

## Public CLI 계약

```text
upload <local-path> [remote-destination] [--recursive] [--mkdir] [--force] [--json]
download <remote-path> [local-destination] [--recursive] [--overwrite] [--json]
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
  재사용한다. manifest에서 검증한 열린 file handle과 effective target/resolution을 전달하며 path를 다시
  검색하는 중복 resolve는 추가하지 않는다.

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

`--json --verbose`의 진행 event에는 현재 relative path와 누적 file/byte만 허용하며 PAT,
Authorization header와 signed URL은 포함하지 않는다.

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
- 새 local/remote tree manifest module과 unit test
- `test/cli/upload.test.ts`
- `test/cli/download.test.ts`

작업:

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
  effective target/resolution도 함께 넘겨 중복 search를 피한다.
- empty folder, 0-byte/Unicode file, missing parent matrix, manifest 이후 symlink/file/directory 교체, 중간
  mutation 실패와 SIGINT의 partial remote tree 정책을 검증한다.

### P15-C — 로컬 tree와 순차 recursive download

파일:

- `src/features/download-command.ts`
- `src/features/download.ts`
- `src/local/`의 folder destination helper와 test
- `src/runtime.ts`

작업:

- destination parent의 `realpath`/identity anchor와 root를 `lstat`/exclusive create로 검증하고, anchor와
  생성한 tree의 directory identity를 이후 모든 mkdir/temp/commit 전에 재검증해 symlink와 교체를
  거부한다.
- empty folder를 포함한 하위 directory를 만들고 각 file은 기존 `runDownload` 경로를 재사용한다.
- 각 file의 최초 manifest metadata와 전송 직전 detail을 비교하고, 전송 완료 후 전체 topology와 file
  metadata manifest를 다시 조회한다.
- file별 temp cleanup, manifest 이후 ancestor symlink 교체, 먼저 완료한 remote file의 후속 변경,
  SIGINT, remote-changed와 local conflict에서 부분 tree 정책을 검증한다.
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
- 기존 single-file destination/options/JSON shape와 exit code가 바뀌지 않게 한다.
- 간결한 folder transfer 예시, portable name 규칙과 양방향 structured partial failure 정책을
  문서화한다.
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
- [ ] traversal 중 local identity, remote topology 또는 file metadata 변경을 감지해 실패한다.
- [ ] 실패/SIGINT에서 temp file이 남지 않고 pre-mutation failure와 confirmed/unknown partial transfer가
      human 및 `error.partialTransfer` JSON 계약으로 구분된다.
- [ ] 기존 단일 file upload/download 회귀와 JSON schema version 1이 유지된다.
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
- integration cleanup 대상이 `/myboxctl-integration-test/` 밖을 가리키는 경우
