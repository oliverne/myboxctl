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

### storage 속성

```http
GET /v1/drive/storage
```

공식 응답의 `fileCounts`, `maxFileBytes`, `quotaBytes`, `trashAutoDeleteDays`, `usedBytes`를
검증한다. `upload`와 mutation을 수행하는 `put`은 `maxFileBytes`를 upload URL 예약 전
preflight에 사용한다. 응답은 process-local 5분 cache를 사용하며 quota 부족은 클라이언트 계산 대신
서버의 507 응답으로 판정한다.

문서: <https://developers.mybox.naver.com/docs/dms_storage>

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

### API 사용 한도와 429

공식 Getting Started 문서의 `4. API 사용 한도`에 요금제별 호출 한도가 명시되어 있다.

| API      | 30GB     | 80GB       | 180GB ~ 330GB      | 2TB                | 5TB                | 10TB               | 20TB               |
| -------- | -------- | ---------- | ------------------ | ------------------ | ------------------ | ------------------ | ------------------ |
| 다운로드 | 500회/일 | 1,000회/일 | 1,000회/일         | 2,000회/일         | 5,000회/일         | 20,000회/일        | 50,000회/일        |
| 검색     | 10회/분  | 10회/분    | 30회/분            | 30회/분            | 30회/분            | 30회/분            | 30회/분            |
| 삭제     | 60회/분  | 60회/분    | API 1개당 240회/분 | API 1개당 240회/분 | API 1개당 240회/분 | API 1개당 240회/분 | API 1개당 240회/분 |

문서에는 복원 및 그 외 기능도 별도 한도로 기재되어 있으며, API별 분당 한도는 매분,
일일 한도는 매일 갱신된다고 설명한다. 또한 단시간 대량 호출이나 abuse가 감지되면 사전
경고 없이 서비스 이용이 제한될 수 있다고 명시한다.

현재 구현은 검색 10회/분, 삭제 60회/분을 별도 bucket으로 유지한다. storage, root 목록,
folder 목록, resource 상세, 폴더 생성, upload URL 예약은 공식 표현대로 operation별 독립 60회/분
bucket을 사용한다. 여러 CLI process가 같은 local state와 lock을 공유하며 mutation POST를 generic
retry하지 않는다.

공식 endpoint 문서의 오류 표에는 `429 / PLAT-429 / TOO_MANY_REQUESTS`가 포함되어 있다.
그러나 공식 문서에서 429의 정확한 `Retry-After` 헤더 형식, 제한 기준(PAT/account/IP),
sliding window 또는 endpoint별 상세 동작은 확인하지 못했다.

문서: <https://developers.mybox.naver.com/getting-started>

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

- 상태: confirmed
- `fileSize`와 multipart body의 실제 byte length를 일치시킨 0-byte 및 소형 파일이 성공했다.
- production `MyboxUploader`로 sparse 100MiB 파일을 offset 0부터 완료 전송했다. 파일 크기는
  104,857,600 bytes, 전송 중 peak RSS 증가는 23,609,344 bytes였다. 전체 multipart body를 메모리에
  만들지 않는 1MiB file-handle read 방식이 실제 MYBOX postcondition까지 성공했다.

### API-06 — resume offset과 required headers

- 상태: interruption recovery at offset 0 confirmed; non-zero offset not observed
- `resume: true`, `modifiedTime`을 포함한 예약이 `201`로 성공했고 latest run의 `offset`은 `0`이었다.
- offset에 맞춰 remaining bytes를 보내는 multipart upload도 `200`으로 성공했다.
- 최초 2026-08-23 Phase 04 targeted probe에서 body stream 중단 뒤 `resume` 예약 응답은
  `offset: 0`이었다. 그러나 이 probe는 임의 fetch 오류도 중단 성공으로 취급했고, 최초 reservation에
  resume identity가 없었으며, 8MiB read 직후 settle delay 없이 재예약했다. 결과는 inconclusive이며
  MYBOX가 partial data를 checkpoint하지 않았다고 단정하지 않는다.
- 수정된 probe는 최초/재예약 모두 같은 `resume: true`, `modifiedTime`, `isOverwrite`를 사용했다.
  64MiB read 뒤 in-process stream error, 즉시 worker `SIGKILL`, 2초 client-buffer drain 뒤 worker
  `SIGKILL` 세 조건을 실행했고, 각 조건에서 2초 settle 뒤 재예약했지만 모두 `201 / offset: 0`이었다.
- worker는 PAT를 상속하지 않고 signed URL을 transient environment로만 받았으며, URL과 오류 원문을
  명령행/stdout/stderr에 기록하지 않았다.
- production 정책은 재예약 응답의 offset을 권위 있는 값으로 사용한다. 0이면 전체 파일을 한 번
  다시 보내고, non-zero면 해당 지점부터 남은 byte만 보낸다. 복구 예약/전송은 한 번으로 제한하며
  guessed offset과 세 번째 시도는 사용하지 않는다.

### API-07 — overwrite 후 resourceId

- 상태: confirmed
- 같은 파일명에 `isOverwrite: true`로 재업로드한 뒤 `resourceId`가 유지되었고, 변경된 size가
  detail 조회에서 확인되었다.
- overwrite 예약과 content upload는 각각 `201`, `200`이었다.

### API-08 — modifiedAt과 timestamp precision

- 상태: metadata와 canonical resume identity confirmed; alternate literal not observed
- resource detail의 `modifiedAt`은 offset을 포함한 ISO 형태였으며 fractional second 없이
  second precision으로 관찰했다.
- 최초 2026-08-23 probe의 `offset: 0`은 probe 설계 결함 때문에 timestamp matching 증거로 사용할
  수 없다. 수정된 probe는 같은 canonical ISO literal을 재사용했다. 동일 instant의 `+09:00` 표기
  비교는 별도 자연 관찰 항목이며 `put`의 기본 tolerance는 계속 2초로 둔다.
- 수정된 probe에서 최초/재예약에 같은 canonical ISO literal을 사용한 예약은 모두 `201`이었다.
  다른 offset 표기의 동일 instant가 같은 identity로 취급되는지는 관찰하지 않았으며 production은
  최초 예약에 사용한 literal을 그대로 재사용한다.

## 2026-08-23 Phase 04 targeted upload probe

- 상태: offset 0 recovery와 100MiB bounded-memory completion confirmed; non-zero checkpoint not
  observed
- 실행: `bun run test:upload-probe` (실제 MYBOX에서 interruption 관찰 후 production completion까지
  재실행)
- 환경: Bun 1.4.0, macOS 개발 환경, `/myboxctl-integration-test/` 아래 unique child
- 요청: 100MiB sparse local file을 file handle 기반 `ReadableStream` multipart body로 전송하고,
  중단 후 `resume: true`와 `modifiedTime`을 포함한 reservation을 재발급했다.
- 최초 결과: fetch는 실패했고 resume reservation은 `201`과 `offset: 0`을 반환했다. 다만 의도한
  중단 여부, server-accepted byte, checkpoint 정착을 확인하지 못했으므로 결과는 inconclusive다.
- 수정 후 실행: 동일 identity와 64MiB read를 사용해 in-process stream error, 즉시 worker
  `SIGKILL`, 2초 drain 뒤 worker `SIGKILL`을 순서대로 실행했다. kill 뒤에는 2초 settle 후 한 번만
  재예약했다. 세 실행 모두 resume reservation은 `201 / offset: 0`이었다.
- cleanup: 각 실행 후 CLI `ls /myboxctl-integration-test/ --json`이 빈 `resources`를 반환했다.
- 정책 반영 후 결과: 재예약은 `201 / offset: 0`이었고 production `MyboxUploader`가 해당 offset부터
  100MiB 전체를 완료했다. storage response와 resource detail의 이름, 크기, ID postcondition이
  일치했다. peak RSS 증가는 23,609,344 bytes였으며 file/folder cleanup도 성공했다.
- 구현 영향: production은 server-returned offset 0부터 전체 파일을 한 번 재전송하고, 향후
  non-zero가 반환되면 남은 byte만 전송한다. guessed offset이나 세 번째 시도는 사용하지 않는다.
- 보안/정리: PAT, Authorization header, signed upload URL은 출력/문서에 기록하지 않았다.
  probe가 만든 unique resource의 cleanup은 종료 단계에서 오류 없이 수행됐다.

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
- production 기본 정책은 검색 10회/분 sliding window, header 우선, header가 없으면 60초 + jitter,
  GET 1회 재시도다. 이는 실제 header 계약 확정이 아니라 공식 최저 한도에 맞춘 보수적 정책이다.

### API-11 — 423 locked

- 상태: blocked
- 안전한 probe에서 `423`을 유발하지 않았고 해제/retry 특성을 확인하지 않았다.

## 2026-08-23 Phase 06 delete acceptance

- 상태: confirmed
- 실행: `MYBOX_INTEGRATION=1 bun test test/integration/delete.test.ts`
- 환경: Bun 1.4.0, macOS 개발 환경, `/myboxctl-integration-test/` 아래 unique child
- file과 non-empty folder를 exact resource ID로 DELETE했을 때 모두 `204`였고 active path 검색에서
  사라졌다.
- 휴지통으로 이동한 같은 resource ID에 DELETE를 다시 호출하면 `404`였다.
- CLI에서 두 번째 기본 delete는 `already-absent`, `--strict`는 not-found/exit 4였다.
- unique test root까지 휴지통으로 이동해 active integration prefix에 잔여 child가 없었다.
- 실제 429는 발생하지 않았으며 delete bucket의 60회/분 window와 429 cooldown/retry는 fake clock과
  fake HTTP test로 검증했다.

## 미확정 계약 해소 정책

미확정 항목은 필요한 phase와 안전한 검증 방법을 기준으로 다음처럼 처리한다.

| 항목                                    | 영향             | 해소 방법                                          |
| --------------------------------------- | ---------------- | -------------------------------------------------- |
| API-05 100MB 완료 streaming             | confirmed        | production uploader의 bounded-memory 완료 전송     |
| API-06 non-zero checkpoint              | 비차단 자연 관찰 | 서버가 반환할 때 remaining-byte 경로 확인          |
| API-08 alternate `modifiedTime` literal | 비차단 자연 관찰 | 동일 instant의 다른 offset 표기가 필요할 때 확인   |
| API-10 live `Retry-After` 형식          | 릴리스 비차단    | 자연 발생 시 sanitized 형식만 기록                 |
| API-11 423 해제 특성                    | 릴리스 비차단    | 자연 발생하거나 실제 command가 요구할 때 별도 조사 |

Phase 04는 API-05의 완료된 100MB bounded-memory 전송까지 확인해 완료됐다. API-06 non-zero
checkpoint와 API-08 alternate literal은 현재 서버가 제공하지 않거나 production에 필요하지 않으므로
자연 관찰 항목으로 둔다. API-10은 fixture와 보수적 fallback으로 동작을 고정하며 API-11도 423을
고의로 유발하지 않는다.

`test:contract` 전체 재실행은 endpoint/schema/upload protocol 변경 또는 API ledger와 모순되는
관찰이 있을 때만 수행한다. 한두 항목의 미확정 계약은 해당 항목 전용 opt-in probe로 검증한다.

## 2026-08-23 rate-limit 관찰

- `MYBOX_INTEGRATION=1 bun run test:integration` 실행에서 API contract test는 통과했다.
- 이어진 `ensure-dir` acceptance test의 첫 CLI 호출은 `429 / PLAT-429`를 받아 exit code `8`로
  종료했다.
- `sleep 45` 후 `MYBOX_INTEGRATION=1 bun test test/integration/ensure-dir.test.ts`를 단독 실행했을
  때는 Unicode 계층 생성, 두 번째 호출의 `existing`, cleanup이 모두 통과했다.
- 위 실행 순서와 결과는 API contract suite의 요청량과 rate limit 응답이 함께 관찰된 사실이다.
  다만 이 관찰만으로 제한의 직접 원인이 특정 endpoint인지, 요금제 한도인지, PAT/account/IP 중
  어떤 기준인지 단정할 수 없다.
- rate limit 응답에서 `Retry-After` 값을 별도로 보존하지 않았으므로 실제 대기 시간과 헤더 동작은
  여전히 미확정이다.
- test prefix `/myboxctl-integration-test/`를 재조회했을 때 남은 resource는 없었다.

## 2026-08-23 rate-limit 대응 검증

- 검색 GET을 origin별 10회/분 sliding window로 조정하고 local state를 CLI process 간 공유한다.
- `Retry-After`는 seconds와 HTTP-date를 상한 없이 처리한다. header가 없으면 60초 + jitter를
  적용하고 GET은 한 번만 재시도한다.
- Phase 00 contract probe는 `bun run test:contract`, command acceptance는
  `bun run test:integration`으로 분리했다.
- 변경 후 `bun run test:integration`은 contract 3건을 skip하고 ensure-dir acceptance 1건을
  통과했다. Unicode 계층 생성, 두 번째 호출의 `existing`, exact resource cleanup이 성공했다.
- 전체 실행은 60.96초였고 acceptance test body는 2.05초였다. 공유 window가 남은 검색 slot을
  기다렸지만 429는 발생하지 않았다.
- 이 실행에서도 live `Retry-After`는 관찰하지 않았으므로 API-10의 실제 header 형식은 계속
  미확정이다.

## Phase 00 resolver/upload 결정

1. `stat`/parent resolve는 folder exact `path` search, file `q + parentPath` search 후
   `path`/`parentPath`/`name` exact filter를 사용한다.
2. `ls`의 root는 root list endpoint, nested folder는 공식 direct-children endpoint를 사용한다.
3. cursor가 있으면 read-only list/search 요청만 pagination한다. 검색 결과의 첫 항목을 무조건
   채택하지 않는다.
4. upload는 reservation과 storage content transfer를 분리한다. storage transfer는
   `POST multipart/form-data` + exact `Filedata` part + exact `Content-Length`이며 PAT를 전달하지
   않는다.
5. 100MB bounded-memory, 실제 interruption resume와 resume 관련 `modifiedTime`은 Phase 04 targeted
   probe로 확인한다. 429 `Retry-After`와 423 해제 특성은 자연 관찰 전까지 미확정으로 남긴다. 이
   항목들을 추측하여 production contract를 확장하지 않는다.

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
