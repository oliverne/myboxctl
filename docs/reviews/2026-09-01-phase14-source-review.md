# Phase 14 최근 소스 리뷰

검토 기준: `main` HEAD `18afe8e9156854e2c4e76bc9c46533c22ac19f15`

## 결론

Phase 14의 CLI surface 재구성과 agent contract 정리는 전반적으로 의도와 맞는다. 현재 확인된 범위에서 데이터 손상이나 release를 즉시 막아야 할 blocker는 없으며, HEAD 기준 CI도 성공했다.

다만 공개 Release 전에 다음 세 가지 후속 보완을 권장한다. 모두 구현 자체의 방향을 바꾸는 항목은 아니며, 현재 Phase 14 contract를 더 정확하게 지키기 위한 hardening으로 본다.

## Follow-up findings

### P2 — upload local basename은 host OS path semantics를 그대로 사용

현재 `src/features/upload-command.ts`의 local basename 계산은 local path의 모든 `\\`를 `/`로 바꾼 뒤 `basename()`을 호출한다.

이 방식은 Windows 입력을 보정하려는 의도는 이해할 수 있지만, POSIX에서는 `\\`가 path separator가 아니라 정상적인 filename 문자다. Linux/macOS에서 실제 이름이 `report\\2026.txt`인 파일을 업로드하면 remote basename을 `2026.txt`로 잘못 계산할 수 있다.

권장 방향:

- `node:path`의 host-native `basename(localPath)`를 그대로 사용한다.
- local filesystem path spelling은 임의로 normalize하거나 separator를 치환하지 않는다.
- POSIX에서 basename에 `\\`가 포함된 실제 파일을 대상으로 regression test를 추가한다.

이 항목은 드문 edge case지만 effective remote target이 달라질 수 있으므로 세 항목 중 우선순위가 가장 높다.

### P2 — human `list` table은 긴 이름과 CJK display width에 안전해야 함

현재 human table은 `TYPE NAME SIZE MODIFIED` 순서에서 `padEnd()`로 고정 폭을 만든다.

문제:

- 긴 filename은 NAME column 폭을 넘어서 SIZE/MODIFIED column을 밀어낸다.
- JS string length와 terminal display width가 다른 한글/CJK 이름은 정렬이 깨질 수 있다.

새 display-width dependency를 추가하는 것보다 NAME을 마지막 column으로 이동하는 단순한 형태를 우선 검토한다.

예:

```text
TYPE    SIZE      MODIFIED          NAME
file    12.3 KiB  2026-09-01 ...    아주 긴 한글 보고서.pdf
```

권장 regression test:

- 긴 ASCII filename
- 한글 filename
- 한글과 ASCII가 섞인 여러 row

JSON contract에는 영향이 없어야 한다.

### P2 — public resource normalization은 알 수 없는 API 값을 추정하지 않음

현재 `src/features/public-resource.ts`는 `type`이 `file`이 아니면 모두 `folder`로 정규화하고, `modifiedAt`이 존재하지만 parse할 수 없을 때도 `null`로 바꾼다.

이 방식은 upstream API 이상을 정상적인 public contract 값으로 위장할 수 있다. Agent-facing contract에서는 추정보다 fail-closed가 안전하다.

권장 방향:

- `type === file` → `file`
- `type === folder` → `folder`
- 그 외 값 → API response error
- `modifiedAt === undefined` → `null`
- `modifiedAt` 값이 존재하지만 invalid date → API response error

가능하면 MYBOX response schema 단계에서 type/date를 더 강하게 검증하고, public-resource adapter는 정상화만 담당하도록 유지한다.

권장 regression test:

- unknown resource type 거부
- invalid modifiedAt 거부
- optional modifiedAt 부재는 `null`

## 확인된 양호한 변경

다음 Phase 14 변경은 현재 contract와 구현이 잘 맞는다.

- `upload file.zip /store`에서 기존 `/store`가 directory이면 `/store/file.zip`으로 해석
- trailing `/` directory intent 보존
- destination 생략 또는 `/`에서 root + basename 업로드
- `download`의 canonical resolution 재사용과 atomic local commit 유지
- `mkdir`과 `mkdir -p` semantics 분리
- delete 기본 not-found + `--ignore-missing` idempotent 성공
- `schemaVersion: 1` success/failure envelope
- default `--json`에서 stderr event 억제, `--json --verbose`에서만 JSONL progress 출력
- built CLI artifact 수준의 help/version/JSON failure contract 검증

## 다음 작업

후속 구현은 작은 hardening change로 묶는 것을 권장한다.

1. upload basename 계산 수정 + POSIX regression test
2. list human table column 구조 수정 + CJK/long-name test
3. public resource fail-closed 검증 + malformed API regression test
4. `bun run check`, `bun run build`, `bun run test:release` 실행
5. CLI contract의 observable output이 바뀌는 경우에만 `docs/reference/cli-contract.md` 갱신

이 작업에서는 CLI 명령 이름, JSON schemaVersion, destination semantics를 다시 변경하지 않는다.
