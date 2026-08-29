# Phase 06 — `delete`

## 목표

remote path의 현재 resource를 MYBOX 휴지통으로 이동한다. 기본 명령은 idempotent하며 root 삭제와
resolve/delete race에서 의도하지 않은 다른 resource 삭제를 방지한다.

## 진입 조건

- Phase 05가 `complete`다.
- delete 204/404 behavior가 API ledger에 confirmed 상태다.
- 공식 delete 최저 한도 60회/분이 API ledger에 기록되어 있다.
- `docs/PROGRESS.md`의 Phase 06이 `in_progress`다.

## 구현 파일

```text
src/features/delete.ts
src/mybox/client.ts
src/mybox/rate-limit.ts
src/cli.ts
src/mybox/rate-limit.test.ts
test/http/delete.test.ts
test/cli/delete.test.ts
test/integration/delete.test.ts
```

## 테스트 우선 matrix

| 상황                              | 기본                | `--strict`          |
| --------------------------------- | ------------------- | ------------------- |
| file 존재, 204                    | deleted/0           | deleted/0           |
| folder 존재, 204                  | deleted/0           | deleted/0           |
| resolve 시 없음                   | already-absent/0    | not-found/4         |
| resolve 후 DELETE 404             | already-absent/0    | not-found/4         |
| `/`                               | invalid-arguments/2 | invalid-arguments/2 |
| DELETE timeout 후 ID 조회 404     | deleted/0           | deleted/0           |
| DELETE timeout 후 같은 ID 존재    | retryable failure   | retryable failure   |
| DELETE 429 후 ID 조회 404         | deleted/0           | deleted/0           |
| DELETE 429 후 ID 존재, 재시도 204 | deleted/0           | deleted/0           |
| DELETE 429가 재시도 후 반복       | rate-limit/8        | rate-limit/8        |

## 구현 절차

1. normalized path가 `/`이면 API 호출 전에 거부한다.
2. exact resolve한다.
3. absent면 mode에 따른 결과를 반환한다.
4. resolve한 exact `resourceId`로 DELETE한다.
5. 204면 deleted.
6. 404면 mode에 따른 결과.
7. timeout/5xx/429로 결과가 불명확하면 active exact path와 parent direct-child listing에서 기존
   ID의 membership을 교차 확인한다.
8. 양쪽에 기존 ID가 없을 때만 삭제 성공으로 reconcile한다. 휴지통 detail은 active membership
   증거로 사용하지 않는다.
9. path를 다시 resolve해 새 ID가 나타나더라도 그 새 resource를 삭제하지 않는다.

`SharedRateLimiter`에 origin별 `delete` bucket을 추가하고 가장 낮은 공식 한도인 60회/분 sliding
window를 적용한다. search와 같은 state/atomic lock을 사용하되 request timestamp와
`blockedUntil`은 bucket별로 분리한다.

Phase 10 probe에서 휴지통으로 이동한 ID의 detail GET이 200을 유지하는 것을 확인했다. 따라서
DELETE 429/timeout/5xx reconcile은 active exact path와 fully paginated parent listing 양쪽에서
기존 ID가 사라졌는지 확인한다. 사라졌으면 성공이며, 남아 있으면 429에 한해 `Retry-After` 또는
fallback 뒤 같은 ID로 DELETE를 한 번만 재시도한다. timeout/5xx에서는 DELETE를 반복하지 않는다.
path 재해석 후 새 ID를 자동 삭제하는 retry는 항상 금지한다.

## CLI

```bash
myboxctl delete <remote-path> [--strict] [--json]
```

JSON `data`에는 normalized path와 삭제한 경우 기존 `resourceId`, `type`을 넣을 수 있다. 이미
없는 경우 resourceId를 만들지 않는다.

## 검증

```bash
bun run check
bun run build
MYBOX_PAT=... bun run test:integration
```

integration test는 unique file과 non-empty test folder의 실제 MYBOX semantics를 별도로 확인한다.
non-empty folder 삭제가 허용되더라도 test prefix 밖의 folder에는 적용하지 않는다.
429를 만들기 위해 delete 한도를 고의로 소진하지 않는다. 실제 429가 자연 발생하면 sanitized
`Retry-After` 형식과 결과만 API ledger에 기록한다.

## 완료 조건

- idempotent/strict/root/race matrix가 test로 고정되어 있다.
- 새로운 같은-path resource를 잘못 삭제하지 않는다.
- 파일과 폴더가 실제 MYBOX 휴지통으로 이동한다.
- 두 번째 기본 delete가 `already-absent`다.
- cleanup 범위가 integration prefix로 제한된다.
- 두 limiter instance가 60회/분 delete slot과 429 cooldown을 공유한다.
- 429 operation-specific retry는 같은 resource ID로 한 번만 실행된다.

## Handoff

- DELETE timeout reconcile 방식
- non-empty folder 실제 동작
- strict/default subprocess 결과
- 휴지통에 남은 test resource 정보
- delete bucket slot/cooldown과 429 `retryAfterMs` test 결과
- check/build/integration 결과
