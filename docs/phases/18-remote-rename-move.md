# Phase 18 — Remote Rename & Move

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 MYBOX 서버 안에서 기존 파일 또는 폴더의 이름과
위치를 안전하게 변경하는 두 command의 실행 계획과 완료 기준을 정의한다.

## 상태와 진입 조건

- 상태: `pending`
- 활성 phase: 없음
- Phase 17 완료 후 시작한다.
- 구현을 시작할 때 `docs/PROGRESS.md`에서 Phase 18만 `in_progress`로 변경한다.
- 실제 mutation probe는 `/myboxctl-integration-test/` 아래 unique child에만 수행한다.

## 목표

한 번의 command가 한 번의 MYBOX mutation endpoint에 대응하도록 이름 변경과 위치 이동을 분리한다.

```bash
myboxctl rename /reports/draft.md final.md --json
myboxctl move /reports/final.md /archive/ --json
```

`rename`은 같은 parent 안에서 basename만 바꾸고, `move`는 basename을 유지한 채 기존 destination
directory로 옮긴다. 이동과 이름 변경을 한 command에서 연속 수행하지 않는다.

## 공식 API와 미확인 경계

- rename: `POST /v1/drive/resources/{resourceId}/rename`, body `{ name }`
- move: `POST /v1/drive/resources/{resourceId}/move`, body `{ parentId }`
- 공식 문서는 rename 뒤 `resourceId` 유지와 두 endpoint의 성공 200을 설명한다.
- conflict, no-op, folder descendant 이동, read-after-write와 응답 유실 뒤 관찰은 targeted probe에서
  필요한 범위만 확정한다.

공식 문서 또는 재현 가능한 probe로 확인하지 않은 mutation retry나 overwrite 의미를 만들지 않는다.

## Public CLI 계약

```text
rename <remote-path> <new-name> [--json]
move <remote-path> <destination-directory> [--json]
```

### 공통

- source는 root가 아닌 exact active file/folder여야 한다.
- encrypted folder와 shared-with-me 영역은 기존 미지원 정책을 유지한다.
- source를 mutation 직전에 다시 확인하고 최초에 resolve한 `resourceId`만 변경한다.
- 성공 결과는 `resourceId`, 이전/이후 remote path와 `action`을 제공한다.
- `--force`, recursive tree rewrite, 여러 source와 glob은 포함하지 않는다.

### `rename`

- `new-name`은 path가 아닌 단일 component다. 빈 값, `.`, `..`, separator, C0/DEL과 기존 portable-name
  금지 문자를 mutation 전에 거부한다.
- canonical-equivalent sibling과 같은 이름의 resource가 있으면 conflict다.
- 현재 실제 이름과 정확히 같으면 mutation 없이 `action: "unchanged"`로 성공한다.
- 다른 resource를 삭제하거나 overwrite하지 않는다.

### `move`

- destination은 기존 directory여야 하며 trailing `/` 유무와 관계없이 directory로만 해석한다.
- destination root `/`는 허용하되 source root는 허용하지 않는다.
- 현재 parent와 같은 destination이면 mutation 없이 `action: "unchanged"`로 성공한다.
- folder를 자기 자신 또는 descendant 아래로 옮기는 요청은 mutation 전에 거부한다.
- destination의 same-name/canonical-equivalent resource는 conflict다.
- Phase 18에서는 공식 `isOverwrite`를 사용하지 않는다.

## Mutation과 reconcile 정책

- preflight는 source ID, source parent/name과 destination 상태를 확정한다.
- POST는 한 번만 수행하며 generic retry wrapper를 사용하지 않는다.
- 성공 응답 뒤 같은 `resourceId`의 detail과 before/after exact path를 확인한다.
- timeout, 5xx 또는 잘못된 응답처럼 결과가 불확실하면 이전 경로와 예상 새 경로를 모두 조회한다.
- 예상 새 경로에서 원래 `resourceId`가 유일하게 확인되고 이전 경로에서 사라졌을 때만 성공으로
  reconcile한다.
- 원래 ID가 이전/새 경로 양쪽에서 확인되지 않거나 다른 ID와 충돌하면 mutation을 반복하지 않고
  `api-unavailable`의 불확실한 결과로 종료한다.

## 구현 순서

### P18-A — targeted contract probe

- file/folder rename과 move의 request/response 및 ID 유지 여부를 확인한다.
- same-name, same-parent, destination conflict와 descendant 이동 응답을 확인한다.
- active old/new path와 resource detail의 read-after-write 가시성을 기록한다.
- fixture와 출력에 PAT, Authorization과 원본 HTTP body를 남기지 않는다.

### P18-B — schema와 transport

- Zod schema에서 rename/move request/response type을 파생한다.
- `src/mybox/`에 operation별 method를 추가하고 generic mutation retry를 금지한다.
- endpoint별 shared limiter, redaction과 typed error를 fake HTTP로 검증한다.

### P18-C — command vertical slices

- `rename`과 `move`를 각각 `src/features/` vertical slice로 구현한다.
- preflight conflict/no-op에서는 mutation이 0회인지 behavior test로 고정한다.
- human/JSON output, exit code, event와 diagnostic log를 기존 계약에 연결한다.

### P18-D — 문서와 live acceptance

- README, CLI/API reference와 reliability 문서를 실제 계약으로 갱신한다.
- unique test child에서 file/folder rename과 move round-trip 후 root ID로 정리한다.

## 검증

```bash
bun run check
bun run build
```

별도 승인 후 targeted probe와 실제 acceptance를 실행한다. mutation은 unique integration prefix 밖에서
수행하지 않는다.

## 완료 조건

- `rename`과 `move`가 각각 한 endpoint만 호출한다.
- conflict/no-op/root/descendant 안전 조건이 mutation 전에 검증된다.
- retryable 또는 응답 유실 경로에서 POST를 반복하지 않고 ID 기반 reconcile을 수행한다.
- fake HTTP, CLI subprocess와 승인된 live acceptance가 통과한다.
- official API inventory의 rename/move가 `implemented`로 변경된다.
