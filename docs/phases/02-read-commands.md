# Phase 02 — `stat` and `ls`

## 목표

사용자 remote path를 exact MYBOX resource로 해석하고 첫 번째 완전한 CLI vertical slice인
`stat`과 `ls`를 제공한다.

## 진입 조건

- Phase 01이 `complete`다.
- Phase 00에서 nested resolver와 direct child listing 전략이 확정되어 있다.
- `docs/PROGRESS.md`의 Phase 02가 `in_progress`다.

## 구현 파일

```text
src/remote/path.ts
src/remote/resolver.ts
src/features/stat.ts
src/features/ls.ts
src/cli.ts
test/cli/stat.test.ts
test/cli/ls.test.ts
```

## 작업 순서

### 1. remote path pure tests

지원:

```text
/
/foo
/foo/bar.txt
/foo//bar/ -> /foo/bar
한글, 공백, #, %, +
```

거부:

```text
빈 문자열
상대 경로
../foo
/foo/../bar
backslash
NUL
```

normalized path, parent path, basename, components 함수를 순수 함수로 구현한다. `/`에는 parent와
basename이 없음을 type으로 표현한다.

### 2. resolver HTTP tests

Phase 00에서 선택한 알고리즘만 구현한다.

- root resolve
- nested folder exact resolve
- nested file exact resolve
- absent
- file을 중간 folder로 탐색하는 conflict
- 동일/부분 이름 결과의 exact filter
- pagination 마지막 page에서 match
- malformed optional search result 무시 또는 contract error 정책
- 생성 직후 가시성에 필요한 bounded polling

resolver는 검색 결과 하나를 임의로 선택하지 않는다. exact candidate가 둘 이상이면 conflict를
반환한다.

### 3. `stat` vertical slice

`stat <remote-path> [--json]`을 등록한다.

- found: normalized path와 public resource metadata
- absent: exit 0, `action: absent`, `resource: null`
- root: folder resource로 표현하되 가짜 `resourceId`를 만들지 않음
- JSON contract와 human-readable 출력

### 4. `ls` vertical slice

`ls <remote-directory> [--json]`을 등록한다.

- direct child 전체 pagination
- folder/file 및 이름 기준 deterministic sort
- empty directory
- absent exit 4
- file target exit 5
- root와 nested folder

Phase 00에서 nested direct listing이 불가능하다고 결론 났다면 이 단계 전에 public contract와
PLAN을 합의된 범위로 수정한다. 부정확한 결과를 제공하지 않는다.

### 5. subprocess tests

`MYBOX_BASE_URL`을 fake server로 지정하여 실제 `bun run src/cli.ts` process의 stdout, stderr,
exit code를 검증한다.

## 검증

```bash
bun run check
bun run build
bun run dist/cli.js stat / --json
```

마지막 명령은 fake base URL 없이 호출하면 PAT/config 오류가 예상되므로 실제 실행 여부와 결과를
handoff에 정확히 기록한다. 자동 test에서는 fake server를 사용한다.

## 완료 조건

- path parser와 resolver edge case test가 통과한다.
- `stat`/`ls` subprocess JSON이 reference와 일치한다.
- pagination과 deterministic ordering이 test로 고정되어 있다.
- command layer에 직접 `fetch`가 없다.
- 실제 MYBOX에서 root/nested/Unicode smoke test가 통과한다.

## Handoff

- resolver의 exact match와 polling 규칙
- root resource 표현 방식
- `ls` ordering과 pagination 동작
- 실제 API smoke path와 cleanup 결과
- check/build/integration 결과
