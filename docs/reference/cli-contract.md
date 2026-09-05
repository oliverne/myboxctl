# CLI contract

이 문서는 `myboxctl`의 versioned public CLI contract다. API 응답 구조가 바뀌어도 이 문서의
`schemaVersion`을 명시적으로 올리지 않는 한 자동화 호출자가 의존하는 출력 규칙을 바꾸지 않는다.

## 공통 규칙

- 인자 없이 실행하면 root help를 stdout에 출력하고 exit 0으로 종료한다. 이 경로는 설정이나 PAT를
  읽거나 MYBOX API를 호출하지 않는다.
- 원격 경로는 `/`로 시작하는 absolute path다. `.`/`..`, glob, remote cwd는 지원하지 않는다.
- 새 원격 이름은 NFC로 저장하고, Unicode-equivalent mutation 충돌은 임의 선택하지 않고 실패한다.
- 로컬 경로는 사용자가 입력한 spelling 그대로 사용한다.
- 모든 명령은 `--json`을 지원한다. `--json`은 stdout에 마지막 newline을 포함한 JSON document 하나만
  출력하고 stderr는 비운다.
- `--json --verbose`를 사용하면 최종 envelope는 stdout에 하나, 안전한 progress/warning event JSONL은
  stderr에 출력한다. `--quiet`는 실행 event만 숨긴다. `--verbose`와 `--quiet`는 함께 쓸 수 없다.
- PAT, `Authorization` header, upload/download URL과 query token은 어느 stream에도 출력하지 않는다.
- `--diagnostic-log <file>`은 기존 path를 덮어쓰지 않고 실행별 JSONL을 기록한다. local path와 redaction된
  stack이 포함될 수 있으므로 공유 전에 검토한다.
- 성공/실패의 exit code는 다음과 같다.

| Code | 의미                                                |
| ---- | --------------------------------------------------- |
| 0    | 성공 (`skipped`, `existing`, `already-absent` 포함) |
| 2    | argument/config/remote path 오류                    |
| 3    | 인증 또는 권한 실패                                 |
| 4    | 원격 또는 필요한 대상이 없음                        |
| 5    | type/conflict/remote-newer 충돌                     |
| 6    | 네트워크 또는 MYBOX API 실패                        |
| 7    | 로컬 파일 시스템 또는 업로드 중 파일 변경 실패      |
| 8    | rate limit 또는 재시도 소진                         |
| 70   | 분류하지 못한 내부 오류                             |

## JSON envelope

모든 성공 결과는 다음 공통 shape를 사용한다.

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "list",
  "action": "listed",
  "data": {}
}
```

실패 결과는 다음 shape를 사용하며 nullable field도 항상 존재한다.

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "info",
  "error": {
    "kind": "not-found",
    "message": "The remote resource was not found.",
    "retryable": false,
    "code": null,
    "requestId": null,
    "retryAfterMs": null
  }
}
```

mutation이 시작됐거나 응답 유실로 결과가 불확실한 폴더 전송 실패는 기존 필드에
`error.partialTransfer`를 추가한다. `direction`, 양쪽 root path, `rootCreated`, 완료한 file/folder/byte 수,
지원용 parent folder 수와 `mutationMayHaveOccurred`를 포함하며 완료 path 목록은 출력하지 않는다.

공통 resource shape는 다음과 같다.

```ts
type Resource = {
  resourceId: string | null;
  path: string;
  name: string;
  type: "file" | "folder";
  sizeBytes: number | null;
  modifiedAt: string | null; // UTC ISO 8601
};
```

`sizeBytes`는 byte 단위이며 folder와 API가 시간을 주지 않는 resource는 `null`이다. `type`은 항상
소문자다. `action`은 명령별로 `list: listed`, `info: found`, `mkdir: created|existing`,
`upload: uploaded|overwritten|skipped`, `download: downloaded`, `delete: deleted|already-absent`로
고정한다.

## 명령

### `list [remote-path]` (alias: `ls`)

경로를 생략하면 `/`의 direct children을 표시한다. 대상이 file이면 해당 resource 한 개를 같은 row
shape로 반환한다. missing은 exit 4다. JSON의 `command`는 alias를 사용해도 항상 `list`다.

### `info <remote-path>`

file 또는 folder의 정보를 반환한다. `/`는 `resourceId: null`, `sizeBytes: null`, `modifiedAt: null`인
root folder다. missing은 성공 결과가 아니라 exit 4 failure다.

### `mkdir [-p|--parents] <remote-directory>`

기본 모드는 parent가 이미 존재할 때 한 단계만 만들고, target이 이미 있으면 exit 5다. `-p` 또는
`--parents`는 누락된 parent를 계층적으로 만들고 target이 이미 있어도 `action: "existing"`으로 성공한다.
중간 component가 file이면 exit 5다. `/`와 `-p`는 이미 존재하는 root로 성공한다.

### `upload <local-path> [remote-destination] [--recursive]`

기존 directory destination에는 local basename을 붙이고, destination을 생략하거나 `/`를 주면
`/<local-basename>`을 사용한다. trailing `/`는 directory intent다. intent가 있는 missing directory는
`--mkdir` 없이는 exit 4이며, intent가 없는 missing path는 정확한 새 file path다.

size와 modified time을 비교하는 안전한 조건부 업로드다. 같은 metadata는 `skipped`, local이 변경되었거나
없으면 `uploaded`/`overwritten`, remote가 tolerance(2초)를 넘어 더 최신이면 `REMOTE_NEWER` conflict다.
`--force`는 file overwrite를 강제하고 `--mkdir`는 missing parent/directory destination을 만든다.
content hash 비교는 하지 않는다.

local path가 directory이면 `--recursive`가 필수다. 전체 manifest와 portable name을 mutation 전에
검증하고 빈 folder를 포함해 순차 전송한다. 기존 remote destination tree에는 병합하지 않으며 folder
upload와 `--force`는 함께 쓸 수 없다. transfer root와 child folder는 exclusive create한다.

### `download <remote-path> [local-destination] [--recursive]`

destination을 생략하거나 `.`을 주면 `./<remote-basename>`을 사용한다. 기존 local directory에는
basename을 붙이고, 그 외 path는 정확한 file destination이다. trailing separator인데 directory가 없으면
실패하며 local parent directory는 자동 생성하지 않는다. 기존 regular file은 `--overwrite` 없이는
exit 5다. 전송은 임시 파일에 한 뒤 metadata와 byte count를 확인하고 atomic commit한다.

remote path가 folder이면 `--recursive`가 필수다. `/` 전체 download, 기존 local tree merge와
`--overwrite` 조합은 거부한다. 전체 remote manifest를 먼저 만든 뒤 빈 folder와 file을 순차 생성하고,
완료 후 topology와 file metadata를 다시 검증한다.

재귀 전송 이름은 separator, C0/DEL, Windows 금지 문자, 끝의 ASCII space/dot, Windows 예약 basename을
거부한다. 같은 parent 아래 NFC 후 소문자 collision도 거부한다. symlink와 non-regular local entry를
따르지 않으며 source/destination ancestor identity가 달라지면 중단한다.

### `delete [--ignore-missing] <remote-path>`

file 또는 folder를 MYBOX trash로 이동한다. folder는 subtree 전체가 함께 이동한다. missing은 기본 exit 4,
`--ignore-missing`일 때만 `action: "already-absent"`와 exit 0이다. `/` 삭제는 항상 exit 2다.

## Human output

`--json` 없이 실행하면 self-describing한 출력이 나온다. `list`는 `TYPE SIZE MODIFIED NAME` table과
빈 결과의 `No items in ...` 문장을 사용하고, `info`는 `Path/Type/Size/Modified` key/value를 사용한다.
mutation과 download는 `Created`, `Uploaded`, `Updated`, `Skipped`, `Downloaded`, `Deleted`,
`Folder moved to trash`, `Already absent` 형식의 짧은 문장을 사용한다. 오류는 stderr의 `Error:`와
필요한 `Code:`, `Request ID:`, `Retry after:`로 한 번만 출력한다. 부분 전송은 완료 count와 mutation
불확실성을 추가로 알린다.

## Presentation option 위치

`--json`, `--verbose`, `--quiet`, `--diagnostic-log`는 root 또는 subcommand 앞/뒤 어느 위치에도 둘 수 있으며 의미가 같다.
예를 들어 `myboxctl --json list /`와 `myboxctl list / --json`은 같은 machine mode다.

## 요금제와 처리량

`MYBOX_PLAN` → XDG 지원 `config.json`의 `plan` → 보수적 기본값 순서로 적용한다. 허용값은 `30GB`,
`80GB`, `180GB`, `330GB`, `2TB`, `5TB`, `10TB`, `20TB`다. 미설정 기본은 검색 10회/분, 삭제
60회/분, 기타 API별 60회/분과 다운로드 500회/일 참고값이다. 180GB 이상은 검색 30회/분, 삭제
240회/분이며 다운로드 참고값은 요금제에 따라 1,000~50,000회/일이다. 저장 API에서 요금제를 자동
감지하지 않는다.

재귀 upload 정상 경로는 file마다 예약과 완료 detail을 한 번씩 사용하고, download는 file마다 detail
두 번과 URL 발급 한 번을 사용한다. download manifest의 예상 file 수가 일 한도 참고값보다 많으면
warning을 내지만 차단하거나 잔여 quota/reset 시각을 추측하지 않는다. 부분 실패 뒤에는 완료 파일을
확인해 단일 파일로 받거나 충분한 quota가 있을 때 새 destination으로 전체 전송한다.
