# Phase 10 — Cross-implementation hardening

## 상태

- 상태: `in_progress`
- 시작일: 2026-08-29
- 선행 조건: Phase 00~09 `complete`
- 구현 브랜치: `phase-10-cross-implementation-hardening`

## 목표

외부 PHP/Flysystem 구현체의 관찰을 그대로 복제하지 않고, 현재 CLI의 경로 안전성과 delete
reconcile 계약에 직접 도움이 되는 항목만 자체 테스트와 실제 MYBOX targeted probe로 검증한다.

## 비범위

- generic mutation retry
- quota exhaustion 유도
- trash purge, root clear, move/copy
- full MYBOX API wrapper
- resumable upload의 KST literal, overwrite offset, 423 probe
- command-scoped directory snapshot 최적화

마지막 두 항목은 실제 우선순위나 검색 비용 문제가 확인될 때 별도 phase로 승격한다.

## P10-A — Remote path control-character rejection

- 각 remote path component에서 C0 control(`U+0000..U+001F`)과 DEL(`U+007F`)을 거부한다.
- root `/`, Unicode/한글, 공백, 일반 특수문자의 기존 계약은 유지한다.
- 오류는 기존 `invalid-remote-path` DomainError와 CLI argument exit contract를 사용한다.
- unit test와 CLI subprocess test에서 JSON redaction/한 줄 오류 계약을 확인한다.

## P10-B — Delete targeted reconciliation probe

실제 MYBOX의 unique child에서 file을 생성하고 삭제한 뒤 다음 세 read model을 비교한다.

1. 삭제 전 resource ID의 detail lookup
2. 삭제한 active path의 exact resolve
3. parent direct-child listing

삭제 후 기대값은 기존 ID detail이 not-found이고, active path와 parent listing에도 삭제 대상이 없는
것이다. 관찰 결과가 다르면 production delete 정책을 추측으로 변경하지 않고 API ledger에 기록해
`blocked` 또는 후속 설계 결정을 남긴다.

## P10-C — Name semantics targeted probe

unique parent 안에서 다음 이름을 별도 resource로 생성해 exact resolver와 parent listing을 비교한다.

- NFC와 NFD로 표현한 동일한 사용자 표시 문자열
- ASCII 대소문자만 다른 이름

서버가 동일시하거나 충돌시키는지, 별도 resource로 저장하는지, 반환 이름을 정규화하는지를
관찰한다. 결과 확정 전에는 production path parser/resolver에 Unicode normalization이나 case
folding을 추가하지 않는다.

## 구현 원칙

- 모든 live mutation은 `/myboxctl-integration-test/` 아래 실행별 unique child에서만 수행한다.
- PAT, Authorization header, upload/download URL을 출력하거나 fixture에 저장하지 않는다.
- API 호출량을 최소화하고 의도적인 429, quota exhaustion, 423을 유발하지 않는다.
- live probe가 실패해도 exact cleanup을 시도하고 cleanup 결과를 기록한다.
- targeted probe 관찰과 production behavior를 분리한다.

## 검증

일반 검증:

```bash
bun run check
bun run build
```

targeted live probe:

```bash
MYBOX_PHASE10_PROBE=1 bun test test/integration/cross-implementation-hardening.test.ts
```

완료 조건:

- [ ] C0/DEL 경로가 parser와 CLI에서 mutation 전에 결정적으로 거부된다.
- [ ] 기존 remote path unit/CLI regression이 통과한다.
- [ ] delete detail/path/parent-listing 관찰이 재현 가능하게 기록된다.
- [ ] NFC/NFD 및 대소문자 관찰이 재현 가능하게 기록된다.
- [ ] unique live resource cleanup이 확인된다.
- [ ] 일반 GitHub Actions CI가 통과한다.
- [ ] live probe 결과에 맞춰 `docs/reference/mybox-api.md`를 갱신한다.
- [ ] `docs/PROGRESS.md`와 `docs/HANDOFF.md`를 사실 기준으로 갱신한다.

## 중단 조건

- 예상하지 못한 서버-side normalization 때문에 exact cleanup 대상을 식별할 수 없는 경우
- probe가 integration prefix 밖의 resource를 가리키는 경우
- rate limit 또는 권한 오류로 관찰을 확정할 수 없는 경우

중단 시 production resolver/delete 정책은 변경하지 않고 Phase 10을 `blocked`로 기록한다.
