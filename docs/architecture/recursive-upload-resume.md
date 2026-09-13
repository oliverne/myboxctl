# Decision — Recursive upload checkpoint와 재개 경계

## 상태

- 결정: accepted for Phase 20 planning
- 구현: pending

## 배경

현재 recursive upload는 manifest를 먼저 검증한 뒤 transfer root와 child folder를 exclusive create하고
파일을 순차 업로드한다. 부분 실패 결과는 보존하지만, 새 실행은 이미 존재하는 root와 충돌하므로 이전
실행의 완료 지점부터 안전하게 이어갈 수 없다.

원격 tree만 보고 같은 이름과 metadata의 항목을 임의로 건너뛰면 다른 process나 사용자가 만든 resource를
이번 실행의 결과로 오인할 수 있다. 따라서 재개 권한과 완료 사실을 로컬 checkpoint가 소유한다.

## 결정

### 저장 모델

- 사용자가 지정한 local JSON checkpoint를 사용한다.
- schema version, local root realpath/identity, manifest fingerprint, remote root path/resource ID와 생성한
  folder ID를 기록한다.
- 완료 파일은 relative path, local identity, size/mtime, remote resource ID와 검증된 metadata를 기록한다.
- 현재 mutation을 나타내는 단일 `inFlight` intent를 mutation 전에 atomic commit한다.
- PAT, Authorization, upload URL, request/response body와 credential은 저장하지 않는다.
- POSIX에서는 `0600`으로 exclusive create하고 checkpoint 갱신은 같은 directory의 temp file과 검증된
  atomic replace를 사용한다.

### transaction 경계

remote mutation과 local checkpoint commit을 하나의 분산 transaction으로 만들 수 없으므로 다음 작은
경계를 사용한다.

1. local/remote precondition을 확인한다.
2. `inFlight` intent를 checkpoint에 durable commit한다.
3. remote mutation을 정확히 한 번 실행한다.
4. resource ID/path/metadata postcondition을 확인한다.
5. 확인된 결과를 completed set에 넣고 `inFlight`를 지우는 checkpoint commit을 수행한다.

step 3과 5 사이에 process가 종료되면 다음 실행은 `inFlight`를 reconcile한다. 원래 resource ID 또는
서버가 권위 있게 제공한 upload resume identity로 결과를 확정할 수 있을 때만 완료로 채택한다. 같은
path에 resource가 있다는 사실만으로 소유권을 추정하지 않는다.

### idempotency와 재개 경계

- checkpoint가 기록한 동일 local manifest와 동일 remote root ID만 재개할 수 있다.
- completed set의 entry는 remote ID/path/metadata가 모두 일치할 때만 skip한다.
- local root, manifest, file identity 또는 remote root가 바뀌면 mutation 전에 실패한다.
- `inFlight` 결과가 없거나 다른 ID와 충돌하면 POST를 반복하지 않고 `api-unavailable`과 stable code
  `RESUME_UNCERTAIN`으로 중단한다.
- checkpoint 없는 기존 remote tree, 다른 checkpoint가 소유한 tree와 임의 merge하지 않는다.
- 재개는 upload에만 적용하며 recursive download resume나 양방향 sync를 의미하지 않는다.

## 결과

- 정상 재개는 이미 확정된 folder/file을 건너뛰고 다음 deterministic entry부터 진행할 수 있다.
- crash window의 불확실성을 숨기지 않으며 일부 상황은 수동 확인이 필요하다.
- checkpoint에는 로컬 경로와 파일 metadata가 있으므로 diagnostic log와 같은 민감한 local artifact로
  취급한다.
- arbitrary existing tree merge, tree-wide rollback과 자동 remote cleanup은 계속 제공하지 않는다.
