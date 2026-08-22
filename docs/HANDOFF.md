# Current handoff

## 요약

Phase 00 MYBOX API contract 검증을 완료했다. production client/feature command는 아직 구현하지
않았고, probe 전용 integration test와 sanitized fixture만 추가했다.

## 현재 phase와 상태

- Phase: `00-api-contract`
- 상태: `complete`
- `docs/PROGRESS.md`와 일치한다.
- 다음 phase: Phase 01 Foundation (`pending`)

## 변경 파일

- `test/integration/helpers.ts`
  - PAT를 노출하지 않는 probe HTTP helper
  - read-only GET의 timeout 및 429/5xx backoff
  - multipart storage upload probe
  - cursor pagination 및 응답 shape 검사
- `test/integration/api-contract.test.ts`
  - opt-in 안전장치
  - unique child 생성 및 exact resourceId cleanup
  - root/detail/search/folder/upload/overwrite/resume/error contract probe
- `test/fixtures/mybox/api-contract.latest.json`
  - upload URL/query/PAT/resource ID를 제외한 최신 sanitized 관찰 결과
- `docs/reference/mybox-api.md`
  - API-01~API-11 상태, resolver/upload 결정, 미확정 범위 기록
- `docs/PROGRESS.md`
  - Phase 00을 `complete`로 기록

기존에 수정되어 있던 `AGENTS.md`는 그대로 유지했다.

## 검증

성공:

- `bun run check`
  - typecheck 통과
  - Biome 통과
  - unit test 1 pass, integration suite는 opt-in으로 skip
- `bun run build` 통과
- `bun run test:integration` 성공 4회
  - 매 실행 unique child 생성
  - 매 실행 exact child folder cleanup `204`
  - cleanup되지 않은 test resource 없음

실제 관찰:

- PAT 인증 및 전용 prefix 사용 가능
- root `count=1` cursor pagination에서 3개 page와 `nextCursor` 관찰
- resource detail folder 응답에 `fileCount`, `subFolderCount`가 있으나 children 배열은 없음
- 폴더 생성 `POST /v1/drive/folders` → `201`, response keys `name`, `resourceId`
- exact folder search 및 file `q + parentPath` search 결과를 post-filter하여 resolve 가능
- unique folder와 small file은 latest run에서 첫 `0ms` probe에 검색됨
- upload reservation `POST /v1/drive/files` → `201`, response keys `offset`, `uploadUrl`
- storage content transfer는 `POST multipart/form-data`, `Content-Length`, exact `Filedata` part,
  `application/octet-stream`이며 PAT Authorization header를 보내지 않음
- storage 성공 응답 `200`, keys `resourceId`, `name`, `fileSize`
- 0-byte와 소형 파일 업로드 성공
- overwrite 전후 resourceId 유지 및 size 변경 확인
- 중복 folder/file 및 file/folder type conflict는 `409`
- no-auth `401 PLAT-401`, valid-shape missing resource `404 PLAT-404`, invalid folder request
  `400 PLAT-400`; error body keys는 `code`, `message`, `requestId`, `timestamp`
- 자연적인 rate limit `429 PLAT-429`는 초기 probe에서 관찰했으나 Retry-After 값은 보존하지 못함

## 결정

1. resolver는 folder exact `path` search, file `q + parentPath` search 후
   `path`/`parentPath`/`name` exact filter를 사용한다.
2. search/root GET만 cursor pagination과 operation-specific backoff 대상이다. mutation은 generic
   retry하지 않는다.
3. storage upload은 `POST multipart/form-data` + exact `Filedata` part + exact
   `Content-Length`로 구현한다. upload URL query credential과 PAT는 서로 다른 trust boundary이며
   storage host에 PAT를 전달하지 않는다.
4. overwrite는 `isOverwrite: true` 예약 후 같은 upload protocol을 사용하며 resourceId가 유지되는
   것을 확인했다.
5. direct children endpoint, 100MB bounded-memory 전송, 실제 연결 중단 후 non-zero resume offset,
   429 Retry-After 형식, 423 해제 특성은 확정하지 않았다. 이 항목들은 production에서 추측으로
   채우지 않는다.

## 다음 작업

1. Phase 01 문서의 진입 조건을 확인한다.
2. `docs/PROGRESS.md`에서 Phase 01을 `in_progress`로 변경한다.
3. config/PAT 보호, domain error, JSON envelope/exit code, MYBOX transport를 구현한다.
4. 실제 API probe가 아닌 local fake HTTP server test를 먼저 추가한다.
5. integration helper는 production client로 재사용하지 않는다.
6. Phase 01의 `bun run check`, `bun run build` 및 관련 test를 실행한다.

## 미확정/차단 요소

- `ls`의 direct-child exact contract는 아직 별도 확정하지 않았다. Phase 02에서 `parentPath`
  search 결과의 직접 자식 필터를 검증하거나, 불가능하면 범위를 축소/blocked로 기록해야 한다.
- resume interruption은 실제 raw connection interruption을 재현해야 한다. Phase 04에서
  non-zero offset과 `Content-Range`를 별도 검증하기 전에는 resume을 완전 지원한다고 표시하지
  않는다.
- 대용량 bounded-memory는 아직 검증하지 않았다. production 구현은 multipart body 전체를
  메모리에 만들지 않아야 한다.
