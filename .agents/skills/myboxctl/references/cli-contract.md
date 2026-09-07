# myboxctl CLI contract

이 reference는 `schemaVersion: 1` 자동화에 필요한 공개 계약을 요약한다. 설치된 CLI가 다른 schema를
반환하면 추측해 처리하지 말고 호환성 문제를 보고한다.

## 공통 출력

- `--json`: stdout에 마지막 newline을 포함한 JSON document 하나를 출력하고 stderr는 비운다.
- `--json --verbose`: 최종 envelope는 stdout에 하나, progress/warning event는 stderr JSONL로 출력한다.
- 성공 envelope: `{ "schemaVersion": 1, "ok": true, "command": string, "action": string, "data": object }`
- 실패 envelope: `{ "schemaVersion": 1, "ok": false, "command": string, "error": { "kind": string,
"message": string, "retryable": boolean, "code": string | null, "requestId": string | null,
"retryAfterMs": number | null } }`
- resource는 `resourceId`, `path`, `name`, `type`, `sizeBytes`, `modifiedAt`을 가진다. `type`은 `file` 또는
  `folder`, `sizeBytes`는 byte 단위, 알려지지 않은 값은 `null`이다.

| Exit | 의미                                                |
| ---: | --------------------------------------------------- |
|    0 | 성공 (`skipped`, `existing`, `already-absent` 포함) |
|    2 | argument, config 또는 remote path 오류              |
|    3 | 인증 또는 권한 실패                                 |
|    4 | 원격 또는 필요한 대상이 없음                        |
|    5 | type, conflict 또는 remote-newer 충돌               |
|    6 | 네트워크 또는 MYBOX API 실패                        |
|    7 | 로컬 파일 시스템 또는 전송 중 로컬 파일 변경 실패   |
|    8 | rate limit 또는 재시도 소진                         |
|   70 | 분류하지 못한 내부 오류                             |

## 명령과 destination

### `list [remote-path]`

생략 시 `/`의 direct children을 반환한다. file path면 resource 한 개를 같은 row shape로 반환한다. alias
`ls`를 사용해도 JSON의 `command`는 `list`다. 부재는 exit 4다.

### `info <remote-path>`

file 또는 folder 하나를 반환한다. `/`는 root folder다. 부재는 exit 4다.

### `mkdir [-p|--parents] <remote-directory>`

기본 모드는 기존 parent 아래 한 단계만 만들며 target이 이미 있으면 exit 5다. `--parents`는 누락된
계층을 만들고 기존 target도 `action: "existing"`으로 성공한다. `/ --parents`도 성공한다.

### `upload <local-path> [remote-destination] [--recursive]`

- 기존 directory destination에는 local basename을 붙인다. destination 생략 또는 `/`는
  `/<local-basename>`이다.
- trailing `/`는 directory intent다. 존재하지 않는 directory intent는 `--mkdir` 없이는 exit 4다.
- 파일은 크기와 수정 시각을 비교한다. 같으면 `skipped`, 원격이 2초 tolerance를 넘어 더 최신이면
  conflict다. content hash는 비교하지 않는다. `--force`는 파일 overwrite를 강제한다.
- local directory에는 `--recursive`가 필수다. 기존 remote tree와 병합하지 않고, folder upload와
  `--force`를 함께 쓸 수 없다.

### `download <remote-path> [local-destination] [--recursive]`

- destination 생략 또는 `.`은 `./<remote-basename>`이다. 기존 local directory에는 basename을 붙인다.
  그 외 path는 정확한 file destination이다.
- local parent는 자동 생성하지 않는다. 기존 regular file은 `--overwrite` 없이는 exit 5다.
- remote folder에는 `--recursive`가 필수다. `/` 전체 download, 기존 local tree merge와 folder
  `--overwrite`는 거부한다.
- file은 임시 파일에 받은 뒤 metadata와 byte count를 검증하고 atomic commit한다.

### `delete [--ignore-missing] <remote-path>`

file 또는 folder를 MYBOX 휴지통으로 이동한다. folder는 subtree 전체가 함께 이동한다. 부재는 기본 exit
4이며 `--ignore-missing`일 때만 `action: "already-absent"`와 exit 0이다. `/` 삭제는 exit 2다.

## 재귀 전송

- 전체 manifest를 mutation 전에 검증하고 빈 folder를 포함해 순차 처리한다.
- symlink와 non-regular local entry를 따르지 않는다. source/destination ancestor identity나 manifest가
  바뀌면 중단한다.
- separator, control 문자, Windows 금지 문자와 예약 basename, 끝의 ASCII space/dot을 거부한다. 같은
  parent 아래 NFC 및 소문자 기준 collision도 거부한다.
- 실패 envelope에 `error.partialTransfer`가 있을 수 있다. 여기에는 direction, 양쪽 root, root 생성
  여부, 완료한 file/folder/byte 수와 `mutationMayHaveOccurred`가 포함된다. 완료 path 목록은 없다.
- 재귀 download의 예상 횟수 warning은 실제 남은 quota가 아니다. 부분 실패 후 같은 destination으로
  재실행해 이어받는 기능은 없다.

## 설정과 보안

- PAT: `MYBOX_PAT` 또는 `${XDG_CONFIG_HOME:-~/.config}/myboxctl/credentials`의 토큰 한 줄. POSIX
  credentials 파일은 mode `600`으로 보호한다.
- 요금제: `MYBOX_PLAN`, 다음으로 `config.json`의 `plan`, 다음으로 보수적 기본값을 사용한다. 허용값은
  `30GB`, `80GB`, `180GB`, `330GB`, `2TB`, `5TB`, `10TB`, `20TB`다. 자동 감지하지 않는다.
- PAT, Authorization header, upload/download URL과 query token은 출력하지 않는다. diagnostic log도
  기존 파일을 덮어쓰지 않지만 로컬 경로가 포함될 수 있다.
