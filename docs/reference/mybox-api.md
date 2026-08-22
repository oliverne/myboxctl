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

| ID | 미확인 항목 | 필요한 증거 |
| --- | --- | --- |
| API-01 | 하위 폴더 direct children 목록 endpoint | 공식 문서 URL 또는 sanitized request/response |
| API-02 | 검색 기반 exact resolve의 read-after-write 가시성 | 생성 직후 반복 조회 latency 기록 |
| API-03 | upload URL의 method/header | 성공하는 최소 request fixture |
| API-04 | upload content 성공 status/body | sanitized response fixture |
| API-05 | Bun stream body와 Content-Length 요구 | 0B/소형/100MB test 결과 |
| API-06 | resume offset의 단위와 required headers | 중단 후 재개 재현 결과 |
| API-07 | overwrite 후 resourceId 유지 여부 | 전/후 stat 비교 |
| API-08 | modifiedTime 반영 및 timestamp precision | local/remote epoch 비교 |
| API-09 | duplicate name/type 허용 여부 | 같은 parent에서 생성 matrix |
| API-10 | 429 Retry-After 형식 | 실제 또는 문서화된 응답 fixture |
| API-11 | 423의 해제 및 retry 특성 | 실제 응답과 후속 성공 관찰 |

## 오류 mapping 초안

| HTTP | Domain kind | Retry 기본값 |
| --- | --- | --- |
| 400, 422 | invalid-arguments | false |
| 401, 403 | authentication | false |
| 404 | not-found | false |
| 409 | conflict | false, operation reconcile 가능 |
| 423 | api-unavailable | 미확정 |
| 429 | rate-limit | GET true, mutation별 정책 |
| 500, 502, 503 | api-unavailable | GET true, mutation별 정책 |
| 507 | conflict 또는 api-unavailable | false |

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
