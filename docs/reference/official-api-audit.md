# NAVER MYBOX Open API 전수 조사

- 조사일: 2026-08-24
- 기준: <https://developers.mybox.naver.com/>
- 대상 구현: Phase 08 alignment branch based on `e08e5fed0944e9b5ddccb6d8948ab904cb1632ab`
- 목적: 공식 Open API 문서 전체를 현재 `myboxctl` 구현과 대조하고, 구현하지 않은 기능을 의도적 비범위 또는 후속 과제로 분류한다.

이 문서는 **API coverage audit**다. 실제로 구현에 사용 중인 endpoint의 세부 계약과 integration probe 결과는
[`mybox-api.md`](mybox-api.md)를 계속 단일 contract ledger로 사용한다.

## 1. 조사 결과 요약

2026-08-24 기준 공식 사이트에서 확인한 문서화된 endpoint operation은 20개다. 현재
`MyboxClient`가 직접 사용하는 operation은 10개이며, 나머지 10개는 구현하지 않았다.

- 현재 구현: 10/20
- 미구현: 10/20
- Phase 08 반영:
  - `GET /v1/drive/storage`와 `maxFileBytes` upload preflight
  - 현재 사용 operation별 독립 60회/분 bucket
  - file/folder search option type 분리와 undocumented file `path` 제거

이 수치는 목표 coverage가 아니다. `myboxctl`은 MYBOX API 전체 wrapper가 아니며, 필요한 기능만 좁게
제공한다.

## 2. Open API 공통 제약

공식 Getting Started 문서에서 다음을 확인했다.

### PAT

- PAT는 계정당 최대 5개까지 생성할 수 있다.
- 유효기간은 30/60/90/180일 중 선택한다.
- 토큰 값은 생성 시 한 번만 노출된다.
- 만료되거나 삭제된 PAT로는 API를 사용할 수 없다.
- 계정이 용량 초과 또는 징계 상태이면 API 호출이 실패할 수 있다.
- 휴면 계정에서 기존 PAT 호출은 서비스 로그인으로 간주되어 휴면이 해제될 수 있다.

문서: <https://developers.mybox.naver.com/getting-started>

### Open API 접근 범위

- MYBOX에 저장된 일반 파일/폴더는 Open API로 작업할 수 있다.
- **암호 폴더는 지원하지 않는다.**
- **공유 받은 폴더는 지원하지 않는다.**

따라서 이 두 영역은 `myboxctl`에서 별도 구현으로 해결할 수 있는 미지원 기능이 아니라 NAVER Open API
자체의 제한이다.

### 사용 한도

| 구분       | 공식 최소 한도 | 비고                                         |
| ---------- | -------------: | -------------------------------------------- |
| 다운로드   |       500회/일 | 요금제에 따라 최대 50,000회/일               |
| 검색       |        10회/분 | 180GB 이상은 30회/분                         |
| 삭제       |        60회/분 | 180GB 이상은 API별 240회/분                  |
| 복원       |       180회/분 | 문서 표의 별도 복원 한도                     |
| 그 외 기능 |  API별 60회/분 | 요금제와 무관하게 문서 표에 60회/분으로 기재 |

일일 한도는 매일, API별 분당 한도는 매분 갱신된다. 단시간 대량 호출이나 abuse로 판단되면 별도 제한이
적용될 수 있다.

현재 구현은 검색 10회/분, 삭제 60회/분과 함께 storage/root-list/folder-list/resource-detail,
폴더 생성, upload reservation을 각각 독립된 API operation bucket으로 프로세스 간 공유 조정한다.
선제 throttle은 호출 전에 대기하며 mutation 요청을 generic retry하지 않는 정책은 그대로 유지한다.

문서: <https://developers.mybox.naver.com/getting-started>

## 3. 공식 API inventory와 구현 대조

상태 의미:

- `implemented`: 현재 코드가 직접 사용하며 CLI 기능에서 필요하다.
- `follow-up`: 현재 MVP 안정성/계약 정합성 때문에 Phase 08에서 검토 또는 구현한다.
- `planned`: 후속 phase로 선택됐지만 아직 production code에서 사용하지 않는다.
- `future`: 공식 API에는 있지만 현재 프로젝트 목표상 구현하지 않는다. 실제 사용 사례가 생길 때 검토한다.

|   # | 공식 기능                  | Method / Path                                      | 상태        | 현재 프로젝트 판단                                                             |
| --: | -------------------------- | -------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
|   1 | 내 파일 속성 조회          | `GET /v1/drive/storage`                            | implemented | `maxFileBytes`를 upload/put 내부 preflight에 사용. CLI command는 노출하지 않음 |
|   2 | 루트 목록 조회             | `GET /v1/drive/resources`                          | implemented | `ls /`, resolver에서 사용                                                      |
|   3 | 특정 폴더 목록 조회        | `GET /v1/drive/folders/{folderId}/resources`       | implemented | nested `ls`에서 사용                                                           |
|   4 | 개별 속성 조회             | `GET /v1/drive/resources/{resourceId}`             | implemented | `stat`, postcondition에서 사용                                                 |
|   5 | 즐겨찾기 표시              | `POST /v1/drive/resources/{resourceId}/favorite`   | future      | 현재 파일 관리 최소 범위에 필요 없음                                           |
|   6 | 즐겨찾기 해제              | `POST /v1/drive/resources/{resourceId}/unfavorite` | future      | 현재 파일 관리 최소 범위에 필요 없음                                           |
|   7 | 파일 검색                  | `GET /v1/search/resources/files`                   | implemented | exact path resolve의 일부로 사용                                               |
|   8 | 폴더 검색                  | `GET /v1/search/resources/folders`                 | implemented | exact path resolve의 일부로 사용                                               |
|   9 | 폴더 생성                  | `POST /v1/drive/folders`                           | implemented | `ensure-dir`, `--mkdir`에서 사용                                               |
|  10 | 업로드 URL 생성            | `POST /v1/drive/files`                             | implemented | `upload`, `put`에서 reservation에 사용                                         |
|  11 | 다운로드 URL 생성          | `GET /v1/drive/files/{fileId}/download`            | implemented | `download`에서 사용. URL은 1회용이며 PAT 없는 signed GET에만 전달              |
|  12 | 이름 변경                  | `POST /v1/drive/resources/{resourceId}/rename`     | future      | 필요 사례가 확인될 때 command 후보                                             |
|  13 | 이동                       | `POST /v1/drive/resources/{resourceId}/move`       | future      | 필요 사례가 확인될 때 command 후보                                             |
|  14 | 복사                       | `POST /v1/drive/resources/{resourceId}/copy`       | future      | 필요 사례가 확인될 때 command 후보                                             |
|  15 | 삭제(휴지통 이동)          | `DELETE /v1/drive/resources/{resourceId}`          | implemented | `delete`에서 사용                                                              |
|  16 | 휴지통 목록                | `GET /v1/drive/trash`                              | future      | 현재 delete는 휴지통 이동까지만 책임짐                                         |
|  17 | 휴지통 복원                | `POST /v1/drive/trash/{resourceId}/restore`        | future      | delete undo 기능을 요구할 때 검토                                              |
|  18 | 휴지통 개별 영구 삭제      | `DELETE /v1/drive/trash/{resourceId}`              | future      | 파괴적 작업이라 기본 범위에 넣지 않음                                          |
|  19 | 휴지통 전체 삭제           | `DELETE /v1/drive/trash`                           | future      | 매우 파괴적이며 기본 범위에 넣지 않음                                          |
|  20 | 휴지통 자동 삭제 주기 설정 | `PATCH /v1/drive/storage`                          | future      | 계정 설정 변경은 CLI의 현재 목적 밖                                            |

### 공식 문서 URL

- 내 파일 속성: <https://developers.mybox.naver.com/docs/dms_storage>
- 루트 목록: <https://developers.mybox.naver.com/docs/dms_root>
- 특정 폴더 목록: <https://developers.mybox.naver.com/docs/dms_list>
- 개별 속성: <https://developers.mybox.naver.com/docs/dms_resourceId>
- 즐겨찾기: <https://developers.mybox.naver.com/docs/dms_favorite>
- 즐겨찾기 해제: <https://developers.mybox.naver.com/docs/dms_unfavorite>
- 파일 검색: <https://developers.mybox.naver.com/docs/search_files_resources>
- 폴더 검색: <https://developers.mybox.naver.com/docs/search_folders_resources>
- 폴더 생성: <https://developers.mybox.naver.com/docs/files_create_folder>
- 업로드 URL: <https://developers.mybox.naver.com/docs/files_upload>
- 다운로드 URL: <https://developers.mybox.naver.com/docs/files_download>
- 이름 변경: <https://developers.mybox.naver.com/docs/files_rename>
- 이동: <https://developers.mybox.naver.com/docs/files_move>
- 복사: <https://developers.mybox.naver.com/docs/files_copy>
- 삭제: <https://developers.mybox.naver.com/docs/files_delete>
- 휴지통 목록: <https://developers.mybox.naver.com/docs/dms_trash_list>
- 휴지통 복원: <https://developers.mybox.naver.com/docs/files_trash_restore>
- 휴지통 개별 영구 삭제: <https://developers.mybox.naver.com/docs/files_trash_clean_resourceId>
- 휴지통 전체 삭제: <https://developers.mybox.naver.com/docs/files_trash_clean>
- 휴지통 자동 삭제 주기: <https://developers.mybox.naver.com/docs/dms_trash_routine>

## 4. 현재 구현 상세 대조

### 4.1 구현 endpoint

`src/mybox/client.ts`에서 직접 사용하는 공식 endpoint는 다음 9개다.

```text
GET    /v1/drive/storage
GET    /v1/drive/resources
GET    /v1/drive/folders/{folderId}/resources
GET    /v1/drive/resources/{resourceId}
GET    /v1/search/resources/files
GET    /v1/search/resources/folders
POST   /v1/drive/folders
POST   /v1/drive/files
DELETE /v1/drive/resources/{resourceId}
```

실제 storage upload URL의 multipart protocol은 공식 endpoint 문서만으로 충분히 설명되지 않아 기존
integration probe 결과를 [`mybox-api.md`](mybox-api.md)에 별도로 유지한다.

### 4.2 공식 계약과 일치하는 보수적 정책

- search limiter는 최저 요금제 한도인 10회/분을 사용한다.
- delete limiter는 최저 요금제 한도인 60회/분을 사용한다.
- search 결과의 optional field는 runtime validation과 exact post-filter로 처리한다.
- root/folder list는 공식 최대 `count=1000`을 사용한다.
- upload reservation에서 `resume: true`이면 `modifiedTime`을 함께 전송한다.
- mutation은 generic retry하지 않고 operation-specific reconcile/resume 정책을 사용한다.

### 4.3 Phase 08 반영 항목

#### A08-01 — `GET /v1/drive/storage` 기반 upload preflight

공식 응답에는 `maxFileBytes`, `quotaBytes`, `usedBytes`가 있다. upload/put의 mutation 경로는 열린 로컬 파일 크기와 계정별 최대 업로드 크기를 사전 비교한다.

Phase 08에서는 다음 정책을 반영했다.

1. `storage`를 public CLI command로 노출하지 않는다.
2. upload/put mutation 전에 `maxFileBytes`를 검사한다.
3. quota 부족은 실제 reservation의 `507 INSUFFICIENT_STORAGE` 처리에 맡긴다.
4. storage 조회는 독립 60회/분 bucket과 process-local 5분 cache를 사용한다.

#### A08-02 — 현재 사용 중인 `그 외 기능`의 60회/분

조사 당시 공유 limiter는 search와 delete만 선제 관리했다. 공식 문서는 root/list/detail/create
folder/upload reservation 등의 기능도 각각 60회/분 한도로 설명하므로, Phase 08에서 storage를
포함한 **API operation별 독립 bucket**을 추가했다. 선제 throttle은 호출 전에 기다리는 정책이고,
mutation 재전송은 계속 금지한다.

#### A08-03 — file search의 `path` 타입 노출

공식 파일 검색 문서에는 `path` query가 없고 `q`, `category`, 날짜 범위, `parentPath`가 있다. `path`는
폴더 검색에만 문서화되어 있다.

조사 당시에는 `SearchOptions`를 file/folder 검색이 공유해 `searchFilesPage()`가 `path`를 query로
보낼 수 있었다. Phase 08에서 `FileSearchOptions`와 `FolderSearchOptions`를 분리하고 file search
직렬화에서 `path`를 제거해, undocumented query를 public client contract와 요청 모두에서 표현할 수
없도록 바로잡았다.

#### A08-04 — 공통 오류/계정 상태 문서화

공식 endpoint들은 공통적으로 400, 401, 403, 404, 409, 422, 423, 429, 500, 502, 503, 507을 문서화한다.
현재 transport는 이 상태를 domain error로 정규화하며 429/5xx는 기존 reliability 정책을 따른다.
423의 실제 해제 특성과 429 `Retry-After` live 형식은 기존 ledger의 자연 관찰 항목으로 유지한다.

PAT 만료, 계정 용량 초과, 암호 폴더/공유 받은 폴더 미지원은 사용자 문서에 명시하고 코드에서 임의로
우회하지 않는다.

## 5. 의도적으로 구현하지 않는 API와 향후 후보

다음 항목은 **누락 버그가 아니라 현재 비범위**다. 사용 사례가 확인되기 전에는 구현하지 않는다.

| 후보             | 관련 공식 API       | 검토 조건                                                |
| ---------------- | ------------------- | -------------------------------------------------------- |
| `rename`         | 이름 변경           | 별도 rename이 upload/put보다 명확한 사용 사례를 가질 때  |
| `move`           | 이동                | 원격 파일 재배치 요구가 확인될 때                        |
| `copy`           | 복사                | 서버 측 복사가 upload보다 유리한 실제 workflow가 있을 때 |
| favorite 제어    | favorite/unfavorite | 에이전트 workflow에서 favorite가 의미 있는 상태가 될 때  |
| trash 조회/복원  | trash list/restore  | delete undo가 제품 요구가 될 때                          |
| trash 영구 삭제  | single/all clean    | 강한 안전장치와 명시적 파괴적 command 요구가 있을 때     |
| 휴지통 보존 설정 | storage PATCH       | 계정 설정 관리가 프로젝트 범위로 승인될 때               |

특히 휴지통 영구 삭제와 전체 비우기는 단순 편의 기능으로 추가하지 않는다.

## 6. 조사에서 확인한 주요 API 특성

- 다운로드 URL은 **1회용이며 10분간 유효**하고 응답 `expiresIn` 예시는 600초다.
- rename은 이름 변경 후에도 `resourceId`가 유지된다고 문서화되어 있다.
- copy는 기본적으로 원본 이름을 사용하고 `parentId` 생략 시 루트에 복사하며 성공은 201이다.
- move는 `parentId`가 필수이고 성공은 200이다.
- restore는 원래 위치로 복원하며 `isOverwrite`를 선택적으로 받는다.
- trash list는 cursor pagination과 최대 `count=1000`을 지원한다.
- trash auto-delete는 0(off), 5, 15, 30, 50일 중 하나를 설정한다.
- `GET /v1/drive/storage`는 `maxFileBytes`, `quotaBytes`, `usedBytes`, `fileCounts`,
  `trashAutoDeleteDays`를 반환한다.

## 7. 유지 규칙

- 공식 API 문서에 endpoint가 추가/삭제/변경되면 이 inventory를 갱신한다.
- 현재 구현 endpoint의 실제 관찰과 protocol detail은 `mybox-api.md`에 기록한다.
- `planned` API는 production coverage에 포함하지 않고 phase 완료 후 `implemented`로 변경한다.
- `future` API는 inventory에 존재한다는 이유만으로 구현하지 않는다.
- `follow-up` 항목은 [`../phases/08-official-api-alignment.md`](../phases/08-official-api-alignment.md)의
  완료 조건을 따른다.
- 공식 문서와 실제 integration 관찰이 충돌하면 기존 ledger 원칙대로 날짜와 fixture를 남기고 실제
  관찰을 우선한다.
