# Phase 05 — `put`

## 목표

로컬/원격 metadata를 순수 정책으로 비교하여 upload, overwrite, skip, conflict 중 하나를
결정하고 Phase 04 uploader를 재사용한다.

## 진입 조건

- Phase 04가 `complete`다.
- 실제 timestamp precision과 tolerance가 reference에 기록되어 있다.
- `docs/PROGRESS.md`의 Phase 05가 `in_progress`다.

## 구현 파일

```text
src/features/put/decision.ts
src/features/put/decision.test.ts
src/features/put/command.ts
src/cli.ts
test/cli/put.test.ts
test/integration/put.test.ts
```

## 1. decision type

reason은 public CLI contract와 같은 안정적인 literal을 사용한다.

```ts
type PutDecision =
  | { action: "upload"; reason: "remote-absent" | "forced" }
  | { action: "overwrite"; reason: "size-different" | "local-newer" | "forced" }
  | { action: "skip"; reason: "remote-is-current" }
  | { action: "conflict"; reason: "remote-newer" | "remote-type-conflict" };
```

함수 입력에는 epoch millisecond와 byte size만 전달한다. Date/string parsing, filesystem, client는
함수 밖에서 처리한다.

## 2. table-driven unit tests

다음 우선순서를 고정한다.

| Force | Remote | 비교                         | 결정                     |
| ----- | ------ | ---------------------------- | ------------------------ |
| true  | absent | 무관                         | upload/forced            |
| true  | file   | 무관                         | overwrite/forced         |
| true  | folder | 무관                         | conflict/type            |
| false | absent | 무관                         | upload/absent            |
| false | folder | 무관                         | conflict/type            |
| false | file   | remote가 tolerance 초과 최신 | conflict/remote-newer    |
| false | file   | size 다름                    | overwrite/size-different |
| false | file   | local이 tolerance 초과 최신  | overwrite/local-newer    |
| false | file   | 나머지                       | skip/current             |

boundary는 정확히 `±tolerance`, 1ms 안/밖, 동일 size/mtime을 포함한다. invalid/NaN/negative size는
호출 전에 config/local/API validation에서 거부한다.

## 3. command orchestration

```bash
myboxctl put <local-path> <remote-path> [--force] [--mkdir] [--json]
```

1. Phase 04와 같은 방식으로 local handle open/stat
2. parent resolve 또는 ensure
3. remote exact resolve
4. timestamp parse/validation
5. pure decision
6. upload/overwrite이면 Phase 04 protocol 실행
7. skip/conflict면 upload URL을 생성하지 않음
8. local stable/postcondition 확인
9. reference JSON 출력

`put`과 `upload`가 file open, parent resolve, upload protocol을 공유할 수는 있지만 generic
`FileService` 같은 계층을 만들지 않는다. 명확한 작은 함수만 추출한다.

## 4. subprocess와 integration test

fake server에서 각 decision이 올바른 HTTP 호출 수로 이어지는지 확인한다. 특히 skip/conflict에서는
mutation 요청이 0회여야 한다.

integration 흐름:

1. absent → uploaded
2. 같은 local file → skipped
3. local content/mtime 변경 → overwritten
4. remote를 별도로 최신 상태로 변경 → conflict
5. 같은 상태에 `--force` → overwritten
6. missing parent 기본 not found
7. `--mkdir` → parent 생성 후 uploaded

hash가 없으므로 동일 size/유사 mtime의 다른 content가 skip될 수 있음을 README에 명시한다.

## 검증

```bash
bun run check
bun run build
MYBOX_PAT=... bun run test:integration
```

## 완료 조건

- decision은 I/O 없는 pure function이고 table 전체가 unit test로 고정되어 있다.
- remote-newer 기본 conflict와 force overwrite가 실제 CLI에서 동작한다.
- skip/conflict에서 mutation이 발생하지 않는다.
- `--mkdir`가 Phase 03 구현을 재사용한다.
- integration flow가 unique prefix에서 반복 통과한다.

## Handoff

- 최종 tolerance와 integration 근거
- decision table 변경 여부와 이유
- metadata 비교 한계에 대한 README 위치
- HTTP call-count test 결과
- 실제 resource cleanup 상태
- check/build/integration 결과
