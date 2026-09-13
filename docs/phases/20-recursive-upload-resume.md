# Phase 20 — Recursive Upload Resume

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 중단된 recursive folder upload를 명시적인 local
checkpoint로 안전하게 이어가는 실행 계획과 완료 기준을 정의한다.

설계 결정: [`../architecture/recursive-upload-resume.md`](../architecture/recursive-upload-resume.md)

## 상태와 진입 조건

- 상태: `pending`
- 활성 phase: 없음
- Phase 19 완료 후 시작한다.
- 구현을 시작할 때 `docs/PROGRESS.md`에서 Phase 20만 `in_progress`로 변경한다.
- 기존 manifest-first, exclusive transfer tree, no-merge와 operation-specific retry 정책을 유지한다.

## 목표

첫 실행이 생성한 checkpoint와 remote root ownership을 근거로 완료된 folder/file을 재검증하고 다음
deterministic entry부터 업로드를 계속한다.

```bash
myboxctl upload ./reports /backup/ --recursive --checkpoint ./reports.upload.json
myboxctl upload ./reports /backup/ --recursive --resume ./reports.upload.json
```

첫 명령은 새 checkpoint를 exclusive create한다. 두 번째 명령은 기존 checkpoint를 읽기 전용 근거가
아니라 재개 상태로 열고, local/remote 검증 뒤에만 갱신한다.

## 범위

### 포함

- versioned JSON checkpoint schema와 Zod validation
- local manifest fingerprint와 entry identity 보존
- remote root/folder/file resource ID와 완료 metadata 보존
- mutation 전 `inFlight` intent와 완료 후 atomic checkpoint commit
- completed entry 재검증과 deterministic skip/progress
- 중단, crash와 checkpoint write failure의 fail-closed 처리
- 성공 후 checkpoint 완료 처리와 안전한 정리
- machine-readable resume progress와 불확실한 결과

### 비범위

- checkpoint 없는 기존 remote tree 재개 또는 merge
- 여러 machine/process가 한 checkpoint를 공유하는 distributed lock
- local 변경을 remote에 덮어쓰는 sync
- remote extra entry 삭제, tree rollback 또는 uncertain tree 자동 cleanup
- recursive download resume
- 전송 병렬화

## CLI와 상태 계약

- `--checkpoint <file>`과 `--resume <file>`은 서로 배타적이다.
- 두 옵션은 directory source와 `--recursive`에서만 허용한다.
- 새 checkpoint의 parent는 기존 실제 directory여야 하며 symlink를 따라가지 않는다.
- 기존 checkpoint는 `--resume`에서만 열 수 있고 schema, root와 manifest가 다르면 mutation 전에
  `local-file-changed` 또는 `conflict`로 실패한다.
- checkpoint를 다른 process가 사용 중이면 local lock conflict로 실패한다. crash가 남긴 lock은 owner
  metadata와 process 생존 여부로 사용 중이 아님을 증명할 수 있을 때만 회수하며 시간만으로 stale을
  추측하지 않는다.
- 성공하면 최종 completed state를 durable commit한 뒤 checkpoint와 자신이 만든 lock만 정리한다.
- 부분 실패에서는 checkpoint를 보존하고 JSON failure에 `resumeCheckpointPath`를 additive field로
  제공한다.

## 재개 알고리즘

1. checkpoint schema와 local root anchor를 확인한다.
2. 새로 만든 manifest가 저장된 fingerprint 및 모든 identity와 일치하는지 확인한다.
3. remote root path와 resource ID를 detail/path 양쪽에서 확인한다.
4. completed folder/file의 ID, parent, name, size와 modified time을 재검증한다.
5. `inFlight`가 있으면 Decision의 idempotency 경계로 reconcile하고 확정할 수 없으면
   `api-unavailable`/`RESUME_UNCERTAIN`으로 중단한다.
6. 확인된 completed entry만 skip하고 다음 deterministic entry부터 순차 실행한다.
7. 각 mutation 전후로 checkpoint를 atomic commit한다.
8. 마지막 local manifest와 remote result를 검증하고 성공 상태를 기록한다.

checkpoint write가 remote mutation 전에 실패하면 mutation을 수행하지 않는다. remote mutation 이후
checkpoint commit이 실패하면 자동으로 다음 mutation을 시작하지 않고 partial failure로 중단한다.

## 구현 순서

### P20-A — checkpoint schema와 storage

- Decision을 구현 가능한 Zod schema와 TypeScript type으로 옮긴다.
- exclusive create, same-directory atomic replace, lock과 cleanup을 filesystem test로 검증한다.
- secret이 schema와 serializer에 들어갈 수 없도록 테스트한다.

### P20-B — recursive orchestration

- 기존 manifest와 resource ID 흐름에 checkpoint boundary를 삽입한다.
- 새 upload의 결과와 checkpoint 없는 기존 동작을 바꾸지 않는다.
- completed skip, in-flight reconcile, local/remote mismatch와 write failure를 behavior test로 고정한다.

### P20-C — crash/subprocess와 교차 운영체제 검증

- folder create 전후, upload 완료 전후와 checkpoint commit 전후의 interruption fixture를 둔다.
- Ubuntu, macOS와 Windows에서 atomic replace, lock, resume와 cleanup을 검증한다.

### P20-D — live acceptance와 문서

- unique integration child에서 의도적 중단 후 같은 checkpoint로 재개한다.
- 완료 파일이 다시 업로드되지 않고 최종 tree가 manifest와 일치하는지 확인한다.
- README, CLI contract와 reliability 문서를 실제 구현 결과로 갱신한다.

## 검증

```bash
bun run check
bun run build
```

live interruption/resume는 credential과 mutation 승인을 받은 뒤 unique integration prefix에서만
수행한다.

## 완료 조건

- checkpoint가 없으면 현재 exclusive one-shot 계약이 그대로 유지된다.
- checkpoint가 있을 때만 소유한 tree의 확인된 완료 entry를 건너뛴다.
- local/remote mismatch와 uncertain in-flight mutation은 mutation 반복 없이 실패한다.
- crash boundary, 세 운영체제와 승인된 live resume 검증이 통과한다.
- checkpoint와 JSON failure에는 secret 또는 signed URL이 없다.
