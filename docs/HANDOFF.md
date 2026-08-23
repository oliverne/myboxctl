# Current handoff

## 요약

Phase 02 Read commands를 완료했다. POSIX remote path parser, exact path resolver, 공식 nested
folder direct-child listing, `stat`/`ls` vertical slice와 subprocess contract test를 구현했다.
다음 phase는 Phase 03 Ensure directory다.

## 현재 phase와 상태

- Phase: `02-read-commands`
- 상태: `complete`
- `docs/PROGRESS.md`와 일치한다.
- 다음 phase: Phase 03 Ensure directory (`pending`)

## 변경 파일

- `src/remote/path.ts`
  - `/`를 포함한 POSIX 절대 경로를 정규화한다.
  - 중복 slash와 trailing slash를 정리하고 `.`, `..`, backslash, NUL, 상대 경로와 빈 입력을
    `invalid-remote-path`로 거부한다.
  - root와 child를 discriminated union으로 구분하며 `parentPath`, `basename`, `components`
    순수 helper를 제공한다.
- `src/remote/resolver.ts`
  - folder는 exact `path` search, file은 `q + parentPath` search 후 exact `path`/`parentPath`/
    `name` 검사를 한다.
  - 모든 중간 component를 확인하므로 file을 directory로 사용한 경우 conflict를 반환한다.
  - 동일 resource ID는 중복 제거하지만 서로 다른 exact candidate가 둘 이상이면 conflict를
    반환한다.
  - 검색 결과의 optional `type`이 실제 응답에서 생략될 수 있어 endpoint 의미로 file/folder
    type을 보완한다. 선택적으로 `[0, 250, 1000, 2000]` elapsed schedule bounded polling을
    지원한다.
  - root는 API resource ID 없이 별도 root resolution으로 표현한다.
- `src/mybox/contract.ts`
  - 실제 search 응답에서 `type`이 생략될 수 있으므로 search resource의 `type`을 optional로
    조정했다. full root/detail resource schema는 기존 필수 계약을 유지한다.
  - 공식 검색 계약에서 optional인 `resources`와 `responseMetaData`가 생략되면 각각 `[]`와 `{}`로
    정규화한다.
- `src/mybox/client.ts`
  - `listFolderPage`/`listFolder`를 추가했다.
  - nested `ls`는 공식 `GET /v1/drive/folders/{folderId}/resources`를 사용하고 cursor cycle 및
    page limit 방어를 적용한다. root는 기존 `/v1/drive/resources`를 사용한다.
- `src/features/stat.ts`
  - found/absent 결과와 public resource metadata를 만든다.
  - root 결과는 `{ path: "/", name: "/", type: "folder" }`만 반환하며 가짜 `resourceId`를
    만들지 않는다.
- `src/features/ls.ts`
  - direct child를 public metadata로 변환하고 folder 먼저, 이후 이름의 Unicode code point
    오름차순으로 정렬한다.
- `src/runtime.ts`
  - `RemoteResolver`를 runtime에 조립한다.
- `src/cli.ts`
  - `stat`/`ls` command와 `--json`, human-readable 출력, JSON failure envelope 및 exit code
    처리를 등록했다. command layer에 직접 `fetch`/환경 접근은 없다.
  - Commander의 missing argument/unknown command도 process를 직접 종료하지 않고
    `invalid-arguments` JSON과 exit 2로 변환한다. help/version은 exit 0을 유지한다.
- 테스트
  - `src/remote/path.test.ts`, `src/remote/resolver.test.ts`
  - `test/http/client.test.ts`
  - `test/cli/read-commands.test.ts`
  - search contract의 omitted `type`과 optional envelope case를 `src/mybox/contract.test.ts`에
    추가했다.
  - subprocess test에서 missing argument와 unknown command의 JSON/stdout/stderr/exit code를
    검증한다.
- 문서
  - `docs/reference/mybox-api.md`에 공식 direct-child endpoint와 API-01 정정 내용을 기록했다.
  - `docs/reference/cli-contract.md`에 root resource ID 예외를 기록했다.

## resolver와 ls 규칙

1. root `/`는 검색하지 않고 root listing endpoint를 사용한다.
2. nested path는 component별로 folder/file exact candidate를 검색한다.
3. folder search candidate의 `path`가 없으면 exact folder로 채택하지 않는다.
4. file search candidate는 `name`이 일치하고 `path` 또는 `parentPath` 중 하나 이상의 exact
   evidence가 있어야 채택한다. 존재하는 evidence가 target과 다르면 무시한다.
5. nested folder `ls`는 exact resolve에서 얻은 folder ID로 direct-child endpoint를 호출한다.
   검색 결과를 전체 drive 목록으로 대체하지 않는다.
6. `ls` 결과는 `type === "folder"` 그룹을 먼저 두고 각 그룹을 Unicode code point 이름순으로
   정렬하며 이름이 같으면 resource ID로 tie-break한다.

## 검증

성공:

- `bun run check` — 53 pass, 3 integration skip, 0 fail
- `bun run build` — `dist/cli.js` 생성
- `bun test src/remote/path.test.ts src/remote/resolver.test.ts test/http/client.test.ts`
- `bun test test/cli/read-commands.test.ts` — subprocess stdout/stderr/exit code 검증
- `MYBOX_INTEGRATION=1 bun run test:integration` — 2026-08-23 재실행, 1 pass, 0 fail
- 실제 MYBOX smoke — root `stat`, existing nested prefix `stat`/`ls`, unique nested Unicode folder의
  `stat`/`ls` 성공. smoke에서 생성한 unique folder와 Unicode child는 exact resource ID로 cleanup했다.
- `bun run dist/cli.js stat / --json` — 실제 config로 exit 0 및 root JSON 확인

실제 smoke 출력/fixture에는 PAT, Authorization header, upload URL을 기록하지 않았다. integration
실행으로 `test/fixtures/mybox/api-contract.latest.json`의 sanitized `generatedAt`만 갱신됐다.

## 남은 API 미확정 사항

Phase 00에서 기록한 다음 항목은 여전히 미확정이다.

- 100MB bounded-memory upload probe
- 실제 interruption 후 non-zero resume
- 429 `Retry-After` live 형식
- 423 해제 및 retry 특성

다음 phase에서는 `ensure-dir`의 계층 생성, root parent 처리, concurrent 409 reconcile을 구현하며,
mutation POST를 generic retry하지 않는다.
