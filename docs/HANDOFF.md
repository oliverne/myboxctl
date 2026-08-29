# Current handoff

## 현재 상태

- Phase 00~09: `complete`
- Phase 10: `in_progress`
- 공개 릴리스: 보류
- 구현 브랜치: `phase-10-cross-implementation-hardening`
- 현재 단계: 일반 CI 통과, Phase 10 live probe 실행 대기
- phase 문서: [`phases/10-cross-implementation-hardening.md`](phases/10-cross-implementation-hardening.md)

## 승인된 범위

1. remote path component의 C0 control(`U+0000..U+001F`)과 DEL(`U+007F`) 거부
2. delete 이후 기존 ID detail, active path, parent listing targeted probe
3. NFC/NFD와 대소문자 name semantics targeted probe

resumable upload의 KST literal/overwrite offset/423과 directory snapshot 최적화는 조건부 후보로
남긴다. generic mutation retry, quota exhaustion, purge/root clear, move/copy, full API wrapper는
비범위다.

## 완료된 검증

- PR #6 CI run 33229198802: Ubuntu 24.04/Bun 1.4 check/build/diff 성공
- 전체 test: 188 pass, 31 opt-in skip, 0 fail
- download local commit regression: Ubuntu/macOS/Windows 성공

## 다음 작업

1. PR #6 브랜치에서 Actions `CI` workflow를 수동 실행하고 `phase10_probe=true` 선택
2. live job의 sanitized `phase10DeleteObservation`과 `phase10NameObservation` 확인
3. 관찰을 `docs/reference/mybox-api.md`에 기록
4. 관찰이 요구할 때만 delete reconcile production 정책과 fake HTTP test 수정
5. Phase 10 상태와 PR body를 최종 갱신

## 안전 규칙

- live mutation은 `/myboxctl-integration-test/` 아래 unique child에서만 수행한다.
- PAT, Authorization header와 signed URL을 출력하거나 저장하지 않는다.
- API 사실은 targeted probe 결과가 확인된 뒤에만 ledger와 production 정책에 반영한다.
- cleanup 대상을 exact resolve할 수 없으면 production 변경 없이 probe를 중단한다.
