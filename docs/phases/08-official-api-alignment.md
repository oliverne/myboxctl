# Phase 08 — Official API alignment

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 Phase 08의 실행 범위, 근거, 완료 조건만 정의한다.

## 목적

2026-08-24 NAVER MYBOX Open API 전수 조사에서 확인한 **현재 구현 관련 계약 차이만** 정리한다.
MYBOX Open API 전체를 구현하는 phase가 아니다.

근거:

- [`../reference/official-api-audit.md`](../reference/official-api-audit.md)
- [`../reference/mybox-api.md`](../reference/mybox-api.md)
- <https://developers.mybox.naver.com/getting-started>

## 비목표

다음은 Phase 08에서 구현하지 않는다.

- MYBOX API 전체 wrapper
- download command
- rename/move/copy command
- favorite/unfavorite command
- trash list/restore/영구 삭제 command
- 휴지통 자동 삭제 설정 command
- MCP, sync, daemon, FUSE 기능
- 암호 폴더 또는 공유 받은 폴더 우회 지원

위 공식 API들은 존재 자체를 inventory에 남기되 실제 사용 사례가 확인될 때 별도 범위로 승인한다.

## 배경

공식 API 문서 전체를 현재 `src/mybox/client.ts`와 대조한 결과, 구현 endpoint 8개와 미구현 endpoint
12개를 확인했다. 미구현 12개 대부분은 의도적인 비범위이며, 그중 `GET /v1/drive/storage`만 현재
upload/put 안정성과 직접 관련된 후속 API로 분류했다.

별도로 이미 구현된 API와 공식 계약을 대조하면서 다음 정합성 항목을 확인했다.

1. `GET /v1/drive/storage`의 `maxFileBytes`를 upload/put이 사용하지 않는다.
2. 공식 `그 외 기능`의 API별 60회/분 한도를 현재 공유 limiter가 선제 관리하지 않는다.
3. file search client type이 공식 문서에 없는 `path` query를 표현하고 전송할 수 있다.

## Task 08-01 — storage preflight 정책

공식 API:

```http
GET /v1/drive/storage
```

응답에서 현재 phase가 관심을 가지는 필드:

- `maxFileBytes`
- `quotaBytes`
- `usedBytes`

구현 원칙:

- public `storage` command는 추가하지 않는다.
- upload/put의 실제 안전성에 필요한 최소 정보만 내부에서 사용한다.
- `maxFileBytes`를 hard-code하지 않고 서버 응답을 권위 있는 값으로 사용한다.
- 매 upload마다 무조건 storage API를 호출해 새로운 rate-limit 문제를 만들지 않는다.
- cache를 도입한다면 process-local 또는 매우 단순한 bounded TTL 수준에서 시작한다.
- quota 계산을 client가 복제하지 않는다. 최종 storage 부족은 서버의 507도 계속 처리한다.

결정해야 할 항목:

- storage 조회 시점
- cache/TTL 여부
- storage 조회 실패가 upload를 차단하는지 또는 reservation으로 fallback하는지
- `maxFileBytes` 초과의 public error kind/code

## Task 08-02 — 현재 사용 API의 60회/분 alignment

공식 Getting Started는 검색/삭제/복원 외 기능을 **API 1개당 60회/분**으로 문서화한다.

현재 선제 limiter가 관리하는 bucket:

```text
search: 10 / minute
DELETE /v1/drive/resources/{id}: 60 / minute
```

Phase 08에서는 현재 실제 사용하는 나머지 operation을 검토한다.

```text
GET  /v1/drive/resources
GET  /v1/drive/folders/{folderId}/resources
GET  /v1/drive/resources/{resourceId}
POST /v1/drive/folders
POST /v1/drive/files
```

원칙:

- 공식 표현인 **API별** 한도를 하나의 전역 60회 bucket으로 합치지 않는다.
- 여러 CLI process가 같은 PAT/account를 사용할 수 있으므로 기존 shared state/lock 방식을 재사용한다.
- 선제 throttle과 retry를 분리한다. mutation을 429 때문에 generic retry하지 않는다.
- 현재 search/delete의 더 보수적인 최소 요금제 정책은 유지한다.
- limiter state에는 PAT, URL query, request body를 저장하지 않는다.

테스트:

- operation별 독립 bucket
- 두 process의 slot 공유
- 429 cooldown 공유
- search/delete 기존 bucket regression 없음
- mutation POST가 limiter 대기 후에도 한 번만 전송됨

## Task 08-03 — file/folder search option type 분리

공식 계약:

- 파일 검색: `q`, `category`, `startDate`, `endDate`, `dateField`, `parentPath`, pagination
- 폴더 검색: 위 유사 조건에 더해 exact `path`

현재 구현은 `SearchOptions`를 공유해 file search에도 `path`가 노출된다. 실제 resolver는 file resolve에서
`q + parentPath`를 사용하지만 library contract는 공식 문서보다 넓다.

변경 방향:

```text
FileSearchOptions
FolderSearchOptions
```

- `path`는 folder option에만 둔다.
- 현재 CLI behavior는 변경하지 않는다.
- 현재 사용하지 않는 category/date filter를 Phase 08에서 억지로 추가하지 않는다.
- public type 변경 영향은 tests와 reference에 기록한다.

## Task 08-04 — 사용자/운영 문서 정합성

다음 공식 제약이 README 또는 운영 문서에 명확히 남아 있어야 한다.

- PAT 최대 5개
- PAT 유효기간 30/60/90/180일
- 암호 폴더 미지원
- 공유 받은 폴더 미지원
- 요금제/API별 사용 한도
- download를 향후 추가할 경우 daily limit와 1회용 10분 URL을 함께 고려해야 함

이 phase에서는 PAT 자동 갱신이나 토큰 관리 API를 만들지 않는다. 공식 Open API에는 PAT lifecycle을
programmatically 관리하는 endpoint가 문서화되어 있지 않다.

## Future backlog — Phase 08 밖

다음 공식 API는 inventory에만 남기고 구현하지 않는다.

- download URL
- rename
- move
- copy
- favorite/unfavorite
- trash list
- trash restore
- trash single clean
- trash all clean
- trash auto-delete settings

각 기능은 실제 agent workflow가 필요성을 보여줄 때 별도 phase/issue로 승격한다.

## 완료 조건

Phase 08을 `complete`로 변경하려면 다음을 모두 만족해야 한다.

1. `GET /v1/drive/storage` 사용 여부와 upload preflight 정책이 코드/reference/test에 일치한다.
2. 현재 사용 중인 공식 `그 외 기능` operation의 60회/분 정책이 누락 없이 반영된다.
3. file search가 undocumented `path` query를 public type이나 request에 노출하지 않는다.
4. 기존 search 10회/분, delete 60회/분 정책이 regression 없이 유지된다.
5. mutation generic retry 금지 원칙이 유지된다.
6. README/reference가 PAT lifecycle, unsupported folder scope, usage limit을 설명한다.
7. `bun run check`와 `bun run build`가 통과한다.
8. 실제 MYBOX acceptance가 필요한 변경은 unique test prefix에서 검증하고 cleanup한다.
9. `docs/PROGRESS.md`와 `docs/HANDOFF.md`를 완료 상태로 갱신한다.

## Handoff

Phase 07이 완료되기 전에는 Phase 08을 `in_progress`로 바꾸지 않는다. 현재 문서 작업은 공식 API 전수
조사와 다음 phase의 범위를 준비하는 작업이며 production code는 변경하지 않는다.
