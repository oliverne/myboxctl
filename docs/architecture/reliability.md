# Reliability policy

## `put`의 안전한 기본 정책

`put`은 conflict engine이 아니지만 명확히 더 최신인 원격 데이터를 자동으로 덮어쓰지 않는다.
시간 비교는 ISO 문자열이 아니라 epoch milliseconds로 변환한 뒤 수행한다.

기본 tolerance는 2초이며 Phase 00 integration 결과로 조정할 수 있다.

```text
force                                  → upload/overwrite
remote 없음                            → upload
remote가 folder                        → conflict
remote mtime > local mtime + tolerance → conflict
size 다름                              → overwrite
local mtime > remote mtime + tolerance → overwrite
그 외                                  → skip
```

metadata만으로 실제 content 동일성을 완전히 판정할 수 없으므로 `--force`를 제공한다. MVP에는
local state DB나 hash 동기화를 추가하지 않는다.

## Retry 분류

공통 transport는 timeout과 오류 변환을 제공하지만 모든 요청을 자동 재시도하지 않는다.

### 자동 재시도 가능

- GET 요청의 network timeout, connection reset, 429, 500, 502, 503
- 재사용 가능하다고 실제 계약으로 확인된 read-only 요청

network/5xx의 기본 최대 attempt는 최초 요청을 포함해 4회다. delay는 500ms, 1s, 2s에 jitter를
더한다. 429는 이 짧은 backoff와 분리한다. 서버가 `Retry-After`를 제공하면 그대로 우선하고,
없으면 60초에 최대 1초 jitter를 더한 뒤 GET을 한 번만 재시도한다. sleep과 random 함수는
테스트에서 주입한다.

### 검색 API budget

검색은 가장 낮은 요금제의 공식 한도인 10회/분을 안전한 기본값으로 사용한다. 각 CLI process의
메모리만으로는 여러 로컬 AI 에이전트를 조정할 수 없으므로 최근 검색 요청 시각과 429
`blockedUntil`을 local state 파일에 저장한다. sliding window slot 예약과 상태 갱신은 atomic
directory lock 아래에서 수행한다.

- 기본 경로: `${XDG_STATE_HOME}/myboxctl/rate-limit.json`
- XDG 미설정 시: 사용자 local state 디렉터리 아래 `myboxctl/rate-limit.json`
- override: `MYBOX_RATE_LIMIT_STATE_PATH`
- bucket key: MYBOX API origin과 `search`
- 저장 금지: PAT, Authorization, URL query, request/response body

현재 구현은 공식 한도와 실제 사용이 확인된 `/v1/search/` GET만 선제 조정한다. Phase 06은
`DELETE /v1/drive/resources/{resourceId}`에 최저 요금제 기준 60회/분 bucket을 추가한다. upload
reservation과 signed storage transfer는 검색/delete bucket에 섞지 않고 operation-specific
resume/reconcile 정책을 사용한다. download/other bucket은 해당 command가 추가될 때만 문서상
한도와 실제 호출 형태를 확인해 확장한다.

모든 bucket은 같은 state/lock 구현을 재사용한다. 새 bucket을 추가할 때는 limit/window, bucket
classifier, 429 `blockedUntil`, 여러 limiter instance의 slot 공유를 unit test로 고정한다. 실제
429를 만들기 위해 한도를 고의로 소진하지 않는다.

### operation별 처리

- `createFolder`: 실패 후 같은 exact path를 조회한다. 폴더가 있으면 성공으로 reconcile하고,
  파일이면 conflict를 반환한다. 확인되지 않은 상태에서 POST를 반복하지 않는다.
- `createUpload`: Phase 00에서 같은 file identity에 대한 재호출 의미를 확인하기 전까지 자동
  재시도하지 않는다.
- `uploadContent`: 일반 재전송이 아니라 검증된 `resume + modifiedTime + offset` 흐름을 사용한다.
- `deleteResource`: 429는 같은 `resourceId`를 조회해 먼저 reconcile한다. ID가 남아 있을 때만
  `Retry-After` 후 같은 ID로 한 번 재시도하며, 404는 이미 삭제된 성공 상태로 처리한다.
  timeout/5xx 뒤 ID가 남아 있으면 DELETE를 자동 반복하지 않는다.

400, 401, 403, 409, 422, 507은 자동 재시도하지 않는다. 423은 live 해제 특성이 미확정이므로
자동 재시도하지 않는다. 실제 command에서 자연 발생해 정책이 필요해질 때 별도 targeted probe로
확정한다.

## 로컬 파일 안정성

업로드 대상은 path 문자열만 넘기지 않고 file handle을 열어 다음 절차를 따른다.

1. read-only file handle open
2. `fstat`으로 size, mtime 수집
3. 같은 handle에서 stream 생성
4. upload 완료
5. 같은 handle을 다시 `fstat`
6. size 또는 mtime이 바뀌었으면 `local-file-changed` 실패
7. handle close

모든 실패와 SIGINT 경로에서 handle과 response body를 정리한다. 파일 전체를 메모리에 읽지
않는다.

## 원격 race

- resolve 후 upload 전에 대상이 생기면 409를 최신 원격 상태와 함께 conflict로 변환한다.
- ensure-dir 중 다른 프로세스가 같은 폴더를 만들면 다시 exact resolve한다.
- delete 전에 대상이 사라지면 기본 모드에서는 `already-absent`, `--strict`에서는 not-found다.
- path가 같은 새 resource로 바뀌어도 이미 resolve한 다른 `resourceId`를 임의로 삭제하지 않는다.

## 비밀정보

다음은 debug mode에서도 원문을 출력하지 않는다.

- PAT와 Authorization header
- upload/download URL 전체
- query string에 포함된 token
- credential 파일 내용

오류 context에는 HTTP status, MYBOX code, request ID, retryable 여부만 허용한다.
