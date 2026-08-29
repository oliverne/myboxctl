# Current handoff

## 현재 상태

- Phase 00~09: `complete`
- Phase 10: `in_progress`
- 공개 릴리스: 보류
- 구현 브랜치: `phase-10-cross-implementation-hardening`
- 현재 단계: P10-A remote path C0/DEL 거부 구현 전
- phase 문서: [`phases/10-cross-implementation-hardening.md`](phases/10-cross-implementation-hardening.md)

## 승인된 범위

1. remote path component의 C0 control(`U+0000..U+001F`)과 DEL(`U+007F`) 거부
2. delete 이후 기존 ID detail, active path, parent listing targeted probe
3. NFC/NFD와 대소문자 name semantics targeted probe

resumable upload의 KST literal/overwrite offset/423과 directory snapshot 최적화는 조건부 후보로
남긴다. generic mutation retry, quota exhaustion, purge/root clear, move/copy, full API wrapper는
비범위다.

## 다음 작업

1. `src/remote/path.ts`에 component 단위 C0/DEL validation 추가
2. unit 및 CLI subprocess regression test 추가
3. Phase 10 전용 opt-in integration probe 구현
4. 일반 CI 통과 후 live probe 실행
5. 관찰을 API ledger에 기록하고 phase 상태 판정

## 안전 규칙

- live mutation은 `/myboxctl-integration-test/` 아래 unique child에서만 수행한다.
- PAT, Authorization header와 signed URL을 출력하거나 저장하지 않는다.
- API 사실은 targeted probe 결과가 확인된 뒤에만 ledger와 production 정책에 반영한다.
- cleanup 대상을 exact resolve할 수 없으면 production 변경 없이 probe를 중단한다.
