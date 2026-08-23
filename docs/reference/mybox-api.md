# MYBOX API contract ledger

이 문서는 구현에서 사용할 외부 API 사실과 아직 확인되지 않은 가정을 구분한다. 공식 문서와
integration test가 다르면 실제 관찰을 우선하되 날짜, 재현 절차, sanitized fixture를 함께
기록한다.

Base URL:

```text
https://open-api.mybox.naver.com
```

인증:

```http
Authorization: Bearer <MYBOX_PAT>
```

## 공식 문서로 확인됨

### 루트 목록

```http
GET /v1/drive/resources?count=1000&cursor=...
```

- cursor pagination
- 응답: `resources`, `responseMetaData.nextCursor`, `fileCount`, `subFolderCount`
- page count 최대 1,000

문서: <https://developers.mybox.naver.com/docs/dms_root>

### 특정 폴더 내 목록

```http
GET /v1/drive/folders/{folderId}/resources?count=1000&cursor=...&sort=name,asc
```

- 특정 폴더 바로 아래의 파일/폴더 목록
- cursor pagination
- `count` 최대 1,000

문서: <https://developers.mybox.naver.com/docs/dms_list>

### resource 속성

```http
GET /v1/drive/resources/{resourceId}
```

주요 필드: `resourceId`, `parentId`, `name`, `type`, `size`, `createdAt`, `modifiedAt`,
`accessedAt`.

문서: <https://developers.mybox.naver.com/docs/dms_resourceId>

### 파일/폴더 검색

```http
GET /v1/search/resources/files
GET /v1/search/resources/folders
```

- page count 20~200
- 파일은 `q`, `parentPath`; 폴더는 추가로 exact `path` 조건 지원
- 결과 필드는 optional이므로 runtime validation과 exact post-filter가 필요

문서:

- <https://developers.mybox.naver.com/docs/search_files_resources>
- <https://developers.mybox.naver.com/docs/search_folders_resources>

### 폴더 생성

```http
POST /v1/drive/folders
Content-Type: application/json

{
  "folderName": "reports",
  "parentId": "optional-parent-id"
}
```

성공은 201이며 `name`, `resourceId`를 반환한다.

문서: <https://developers.mybox.naver.com/docs/files_create_folder>

### 업로드 URL 생성

```http
POST /v1/drive/files
Content-Type: application/json
```

요청 필드:

```ts
type BaseUploadRequest = {
  fileName: string;
  fileSize: number;
  parentId?: string;
  isOverwrite?: boolean;
};

type UploadRequest =
  | (BaseUploadRequest & { resume?: false; modifiedTime?: never })
  | (BaseUploadRequest & { resume: true; modifiedTime: string });
```

`modifiedTime`은 문서상 `resume`과 함께 입력한다. 성공은 201이며 `uploadUrl`과 optional
`offset`을 반환한다.

문서: <https://developers.mybox.naver.com/docs/files_upload>

### 삭제

```http
DELETE /v1/drive/resources/{resourceId}
```

성공은 204이며 resource는 휴지통으로 이동한다.

문서: <https://developers.mybox.naver.com/docs/files_delete>

## Phase 00에서 확인할 계약

아래 항목은 확인 전까지 production code에 고정하지 않는다.

| ID     | 미확인 항목                                       | 필요한 증거                                   |
| ------ | ------------------------------------------------- | --------------------------------------------- |
| API-01 | 하위 폴더 direct children 목록 endpoint           | 공식 문서 URL 또는 sanitized request/response |
| API-02 | 검색 기반 exact resolve의 read-after-write 가시성 | 생성 직후 반복 조회 latency 기록              |
| API-03 | upload URL의 method/header                        | 성공하는 최소 request fixture                 |
| API-04 | upload content 성공 status/body                   | sanitized response fixture                    |
| API-05 | Bun stream body와 Content-Length 요구             | 0B/소형/100MB test 결과                       |
| API-06 | resume offset의 단위와 required headers           | 중단 후 재개 재현 결과                        |
| API-07 | overwrite 후 resourceId 유지 여부                 | 전/후 stat 비교                               |
| API-08 | modifiedTime 반영 및 timestamp precision          | local/remote epoch 비교                       |
| API-09 | duplicate name/type 허용 여부                     | 같은 parent에서 생성 matrix                   |
| API-10 | 429 Retry-After 형식                              | 실제 또는 문서화된 응답 fixture               |
| API-11 | 423의 해제 및 retry 특성                          | 실제 응답과 후속 성공 관찰                    |

## Phase 00 실측 결과

- 확인일: 2026-08-22
- 실행 환경: Bun 1.4.0, macOS 개발 환경
- 테스트 prefix: `/myboxctl-integration-test/` 아래의 실행별 unique child
- 반복 횟수: 성공한 contract suite 4회
- sanitized fixture: [`../../test/fixtures/mybox/api-contract.latest.json`](../../test/fixtures/mybox/api-contract.latest.json)
- PAT, Authorization header, upload URL 및 query token은 fixture와 문서에 기록하지 않았다.

### API-01 — 하위 폴더 direct children 목록 endpoint

- 상태: confirmed
- 공식 문서의 `GET /v1/drive/folders/{folderId}/resources`가 특정 폴더 바로 아래의 파일/폴더를
  페이지 단위로 반환한다.
- `count`는 최대 1,000이며 `cursor` pagination을 사용한다. 응답은 `resourceItem` 목록과
  `fileCount`, `subFolderCount`, `responseMetaData`를 포함한다.
- Phase 00에서 시도한 `/v1/drive/resources/{resourceId}/children` 및
  `/v1/drive/resources/{resourceId}/resources`는 404였지만, 이는 공식 경로가 아니었다.
- 문서: <https://developers.mybox.naver.com/docs/dms_list>
- 구현 영향: `ls`는 nested folder를 exact resolve한 뒤 이 endpoint를 사용하고, `/`는 기존
  root list endpoint를 사용한다.

### API-02 — 검색 기반 exact resolve 및 read-after-write

- 상태: confirmed
- 폴더는 `GET /v1/search/resources/folders`의 exact `path` 검색으로 확인했다.
- 파일은 `q + parentPath`로 검색한 뒤 `path`, `parentPath`, `name`을 exact post-filter했다.
- 실행별 unique folder와 소형 파일 모두 latest run의 첫 `0ms` probe에서 확인되었고, 각 흐름은
  반복 실행에서 성공했다.
- 검색 응답은 cursor pagination을 지원하며, root 목록은 `count=1` 요청에서 3개 page와
  `responseMetaData.nextCursor`를 관찰했다.

### API-03 — upload URL의 method/header

- 상태: confirmed
- 예약: `POST /v1/drive/files` → `201`, 응답 keys는 `offset`, `uploadUrl`이다.
- 실제 storage upload URL에는 `POST`를 사용한다.
- 전체 body는 `multipart/form-data; boundary=...`이며 `Content-Length`를 보낸다.
- multipart part 이름은 정확히 `Filedata`, part content type은
  `application/octet-stream`이다.
- storage upload 요청에는 MYBOX PAT를 담은 `Authorization` header를 보내지 않는다.
- upload URL의 host/path/query는 credential 성격 정보이므로 기록하지 않았다.

### API-04 — upload content 성공 status/body

- 상태: confirmed
- 0-byte와 소형 텍스트 upload 모두 storage 응답은 `200`이었다.
- 응답 keys는 `resourceId`, `name`, `fileSize`이며 예약한 파일명과 정확한 byte size를 검증했다.

### API-05 — Bun stream, Content-Length, 크기

- 상태: 0-byte/소형 confirmed; 100MB blocked
- `fileSize`와 multipart body의 실제 byte length를 일치시킨 0-byte 및 소형 파일이 성공했다.
- 현재 contract probe는 100MB payload를 전송하지 않았으므로 대용량 bounded-memory 주장은 아직
  확정하지 않는다. production upload는 전체 multipart body를 메모리에 만들지 않고 stream해야 한다.

### API-06 — resume offset과 required headers

- 상태: resume 예약/offset confirmed; 실제 interruption blocked
- `resume: true`, `modifiedTime`을 포함한 예약이 `201`로 성공했고 latest run의 `offset`은 `0`이었다.
- offset에 맞춰 remaining bytes를 보내는 multipart upload도 `200`으로 성공했다.
- 실제 연결 중단 후 재예약하여 non-zero offset을 얻는 흐름은 이번 probe에서 시도하지 않았다.
  따라서 interruption/recovery와 `Content-Range`의 live contract는 Phase 04 전 별도 검증이 필요하다.

### API-07 — overwrite 후 resourceId

- 상태: confirmed
- 같은 파일명에 `isOverwrite: true`로 재업로드한 뒤 `resourceId`가 유지되었고, 변경된 size가
  detail 조회에서 확인되었다.
- overwrite 예약과 content upload는 각각 `201`, `200`이었다.

### API-08 — modifiedAt과 timestamp precision

- 상태: metadata confirmed; local `modifiedTime` matching blocked
- resource detail의 `modifiedAt`은 offset을 포함한 ISO 형태였으며 fractional second 없이
  second precision으로 관찰했다.
- resume 예약에 ISO `modifiedTime`을 보낸 것은 성공했지만, 동일 instant의 timezone 표기 차이와
  exact literal matching은 확인하지 않았다. `put`의 기본 tolerance는 계속 2초로 둔다.

### API-09 — duplicate name/type

- 상태: confirmed
- 같은 parent에서 두 번째 동일 folder name 생성은 `409`였다.
- 기존 file과 같은 이름의 non-overwrite reservation은 `409`였다.
- 기존 folder와 같은 이름으로 file을 예약한 경우도 `409`였다.

### API-10 — 429 Retry-After

- 상태: blocked
- 초기 probe 과정에서 자연적으로 `429 PLAT-429`가 발생했으나 의도적인 과부하는 유발하지 않았다.
- 해당 응답의 `Retry-After` 값을 별도로 보존하지 못했으므로 header 형식은 미확정이다. GET에는
  operation-specific backoff를 적용하되, mutation을 generic retry하지 않는다.

### API-11 — 423 locked

- 상태: blocked
- 안전한 probe에서 `423`을 유발하지 않았고 해제/retry 특성을 확인하지 않았다.

## Phase 00 resolver/upload 결정

1. `stat`/parent resolve는 folder exact `path` search, file `q + parentPath` search 후
   `path`/`parentPath`/`name` exact filter를 사용한다.
2. `ls`의 root는 root list endpoint, nested folder는 공식 direct-children endpoint를 사용한다.
3. cursor가 있으면 read-only list/search 요청만 pagination한다. 검색 결과의 첫 항목을 무조건
   채택하지 않는다.
4. upload는 reservation과 storage content transfer를 분리한다. storage transfer는
   `POST multipart/form-data` + exact `Filedata` part + exact `Content-Length`이며 PAT를 전달하지
   않는다.
5. 100MB bounded-memory probe, 실제 interruption resume, 429 `Retry-After`, 423 해제 특성은
   미확정으로 남긴다. 이 미확정 항목을 추측하여 production contract를 확장하지 않는다.

## 오류 mapping 초안

| HTTP          | Domain kind                   | Retry 기본값                    |
| ------------- | ----------------------------- | ------------------------------- |
| 400, 422      | invalid-arguments             | false                           |
| 401, 403      | authentication                | false                           |
| 404           | not-found                     | false                           |
| 409           | conflict                      | false, operation reconcile 가능 |
| 423           | api-unavailable               | 미확정                          |
| 429           | rate-limit                    | GET true, mutation별 정책       |
| 500, 502, 503 | api-unavailable               | GET true, mutation별 정책       |
| 507           | conflict 또는 api-unavailable | false                           |

raw API message는 public JSON에 그대로 노출하지 않는다. `code`, `requestId`, status는 sanitized
context로 유지한다.

## 관찰 기록 형식

새 계약을 확정할 때 다음 형식을 사용한다.

```markdown
### API-NN — 제목

- 상태: confirmed | contradicted | blocked
- 확인일: YYYY-MM-DD
- 환경: Bun, Ubuntu/macOS, test prefix
- 요청: token과 signed URL을 제거한 method/path/header/body
- 응답: secret을 제거한 status/body/header
- 반복 결과: 횟수와 일관성
- 구현 영향: 변경할 파일/정책
```
