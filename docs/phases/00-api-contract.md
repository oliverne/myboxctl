# Phase 00 — MYBOX API contract

## 목표

resolver와 uploader 설계를 좌우하는 외부 API 계약을 실제 계정의 격리된 prefix에서 검증한다.
이 phase는 production 기능 구현이 아니라 잘못된 가정 제거가 목적이다.

## 진입 조건

- `bun install`, `bun run check`, `bun run build`가 통과한다.
- 테스트용 MYBOX PAT가 준비되어 있다.
- `/myboxctl-integration-test/` 아래의 unique child만 변경한다는 데 동의되어 있다.
- `docs/PROGRESS.md`의 Phase 00이 `in_progress`다.

PAT가 없으면 phase를 `blocked`로 표시하고 mock으로 실제 결과를 추측하지 않는다.

## 산출물

- `test/integration/api-contract.test.ts`
- 필요 시 `test/integration/helpers.ts`
- secret을 제거한 `test/fixtures/mybox/*.json`
- 관찰이 반영된 `docs/reference/mybox-api.md`
- 완료 증거가 반영된 `docs/PROGRESS.md`와 `docs/HANDOFF.md`

probe를 production client로 재사용하려고 추상화하지 않는다. contract가 확정된 후 Phase 01에서
client를 설계한다.

## 실행 순서

### 1. 안전장치부터 작성

- `MYBOX_CONTRACT === "1"`이 아니면 전체 suite를 skip한다.
- PAT가 없으면 명확한 skip 또는 사전 조건 실패를 반환한다.
- 실행마다 `/myboxctl-integration-test/<timestamp>-<random>/`를 생성한다.
- cleanup 함수는 생성한 exact `resourceId`만 삭제하고 root/prefix parent는 삭제하지 않는다.
- cleanup 대상 path가 허용 prefix 밖이면 즉시 실패한다.
- request/response logging에서 Authorization, signed URL, query string을 제거한다.

### 2. 읽기와 경로 해석 계약 검증

다음을 순서대로 확인한다.

1. root cursor pagination response shape
2. 공식 문서 또는 실제 동작에서 direct children endpoint 존재 여부
3. exact folder `path` 검색
4. 파일 `q + parentPath` 검색 후 exact `path/name` 필터
5. 생성 직후 0ms, 250ms, 1s, 2s 간격의 검색 가시성
6. 같은 이름의 file/folder/duplicate 생성 허용 여부
7. 한글, 공백, `#`, `%`, `+` 이름의 encoding

direct child 목록이 없다면 `stat`, nested `ls`, resolver를 각각 구현 가능한지 분리하여 판단한다.
정확한 nested `ls`가 불가능하면 Phase 02 범위를 임의의 full-drive 검색으로 대체하지 말고
`blocked` 또는 공식적으로 지원 가능한 축소 계약을 기록한다.

### 3. 업로드 계약 검증

0-byte와 작은 text 파일로 다음 matrix를 확인한다.

1. upload URL 생성 request/response
2. 실제 content method, required header, Content-Length
3. 성공 status/body/header
4. `resume: false`와 `modifiedTime` 조합의 오류 여부
5. `resume: true + modifiedTime`의 offset
6. 중간 전송 중단 후 새 URL 발급과 이어올리기
7. `isOverwrite: false/true` 동작
8. overwrite 전후 resourceId, size, modifiedAt
9. upload 완료 직후 stat/search 가시성

Bun stream을 사용하되, 실패했다고 파일 전체 `arrayBuffer()`를 production 방식으로 채택하지
않는다. stream에 필요한 Bun/fetch option을 관찰 결과로 남긴다.

### 4. 오류와 retry hint 검증

안전하게 유발 가능한 범위에서 401, 404, 409, 422를 확인한다. 429/423은 인위적으로 과도한
요청을 발생시키지 말고 공식 문서 또는 자연 발생 응답이 있을 때만 기록한다.

확인 항목:

- error body의 `code`, `message`, `requestId`, `timestamp`
- `Retry-After` header 유무와 형식
- upload URL이 error body나 Location header에 노출되는지

## 검증

```bash
bun run check
MYBOX_PAT=... bun run test:contract
```

같은 핵심 contract test를 최소 2회 실행하여 cleanup과 반복 가능성을 확인한다.

## 완료 조건

- `API-01`부터 `API-09`까지 confirmed/contradicted/blocked 상태가 기록되어 있다.
- resolver 구현 전략이 하나로 결정되어 있다.
- upload content protocol과 resume 가능 범위가 기록되어 있다.
- secret이 fixture, stdout, stderr, Git diff에 없다.
- 생성한 unique test resource가 cleanup되었거나 남은 exact path/ID가 handoff에 기록되어 있다.
- Phase 01이 production client를 추측 없이 구현할 수 있다.

## Handoff

`docs/HANDOFF.md`에 다음을 남긴다.

- 선택한 resolver 알고리즘과 배제한 대안
- 실제 upload method/header/status와 sanitized fixture 경로
- timestamp precision과 권장 tolerance
- operation별 retry/reconcile에 필요한 관찰
- cleanup되지 않은 test resource의 exact path/resourceId
- 실행한 integration 명령과 반복 횟수
