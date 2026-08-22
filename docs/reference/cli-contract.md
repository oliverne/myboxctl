# CLI contract

이 문서는 Hermes와 `myboxctl` 사이의 안정적인 public contract다. API 응답 구조가 달라져도
이 계약은 명시적인 version change 없이 바꾸지 않는다.

## 공통 규칙

- 모든 remote path는 `/`로 시작해야 한다.
- 모든 agent용 명령은 `--json`을 지원한다.
- JSON mode에서 stdout에는 정확히 하나의 JSON document와 마지막 newline만 출력한다.
- JSON mode의 예상 가능한 실패도 stdout에 JSON으로 출력하고 non-zero exit code를 사용한다.
- stderr는 `--verbose` diagnostics와 process-level 예외에만 사용한다.
- PAT 또는 credential 성격 URL은 어느 출력에도 포함하지 않는다.

## 성공 envelope

```ts
type Success<T> = {
  ok: true;
  command: "stat" | "ls" | "ensure-dir" | "upload" | "put" | "delete";
  action: string;
  data: T;
};
```

`data`가 필요 없는 명령도 `{}`를 사용하여 필드를 생략하지 않는다.

## 실패 envelope

```ts
type Failure = {
  ok: false;
  command: string;
  error: {
    kind:
      | "invalid-arguments"
      | "authentication"
      | "not-found"
      | "conflict"
      | "rate-limit"
      | "api-unavailable"
      | "invalid-remote-path"
      | "local-file"
      | "local-file-changed"
      | "unexpected";
    message: string;
    retryable: boolean;
    code?: string;
    requestId?: string;
  };
};
```

`message`는 비밀정보를 포함하지 않는 안정적인 설명이다. stack trace와 raw response body를
JSON에 넣지 않는다.

## Exit code

| Code | 의미 |
| --- | --- |
| 0 | 성공, `skipped`, `existing`, `already-absent` 포함 |
| 2 | 잘못된 argument/config/remote path |
| 3 | 인증 또는 권한 실패 |
| 4 | strict not found |
| 5 | remote path/type/newer-resource conflict |
| 6 | network 또는 MYBOX API 실패 |
| 7 | 로컬 파일 시스템 실패 또는 업로드 중 파일 변경 |
| 8 | rate limit/retry exhausted |
| 70 | 분류하지 못한 내부 오류 |

## 명령

### `stat <remote-path>`

없는 경로는 조회 결과이므로 exit 0과 `resource: null`을 반환한다.

```json
{
  "ok": true,
  "command": "stat",
  "action": "found",
  "data": {
    "resource": {
      "resourceId": "...",
      "path": "/agents/report.md",
      "name": "report.md",
      "type": "file",
      "size": 12345,
      "modifiedAt": "2026-08-22T10:00:00+09:00"
    }
  }
}
```

없는 경우 `action`은 `absent`, `data.resource`는 `null`이다.

### `ls <remote-directory>`

direct child만 반환한다. 결과 순서는 folder 먼저, 이후 file이며 각 그룹에서 Unicode code
point 기준 이름 오름차순으로 CLI에서 고정한다. API 응답 순서에 의존하지 않는다.

```json
{
  "ok": true,
  "command": "ls",
  "action": "listed",
  "data": {
    "path": "/agents",
    "resources": []
  }
}
```

없는 경로는 exit 4, 파일 경로는 exit 5다.

### `ensure-dir <remote-directory>`

모든 parent를 계층적으로 생성한다.

- 새로 하나 이상 생성: `action: "created"`
- 전부 존재: `action: "existing"`
- 중간 component가 file: exit 5

`data`에는 normalized `path`, 최종 `resourceId`, `createdPaths: string[]`를 반환한다.

### `upload <local-path> <remote-path>`

조건 비교 없이 신규 업로드한다. 대상이 존재하면 기본 exit 5다. `--overwrite`가 있을 때만
기존 파일을 덮어쓴다. parent가 없으면 기본 not found이며 `--mkdir`로 생성할 수 있다.

성공 action은 `uploaded` 또는 `overwritten`이다.

### `put <local-path> <remote-path>`

지원 옵션은 `--force`, `--mkdir`, `--json`이다.

성공 action:

- `uploaded`: 원격에 없어서 생성
- `overwritten`: 정책 또는 force에 따라 덮어씀
- `skipped`: 현재 metadata상 업로드 불필요

원격이 명확히 더 최신이면 기본 exit 5다. `--force`는 이를 overwrite한다.

`data.reason`은 다음 안정적인 값 중 하나다.

```text
remote-absent
size-different
local-newer
forced
remote-is-current
remote-newer
remote-type-conflict
```

### `delete <remote-path>`

기본은 idempotent다.

- 삭제 성공: `action: "deleted"`
- 이미 없음: `action: "already-absent"`, exit 0
- `--strict`에서 없음: exit 4

`/` 삭제는 항상 argument 오류로 거부한다.
