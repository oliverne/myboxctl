# Current handoff

## 현재 상태

- Phase 00~10: `complete`
- 활성 구현 phase: 없음
- 공개 릴리스: 보류
- PR: #6 `feat: harden remote paths and probe MYBOX name semantics`
- Phase 10 기준 CI: run 33231710723
- Phase 10 live evidence: run 33230351165

## Phase 10 완료 결과

- remote path component의 C0 control과 DEL을 mutation 전에 거부한다.
- multipart filename boundary도 같은 문자를 방어적으로 거부한다.
- 삭제된 ID의 detail은 휴지통에서 200을 유지할 수 있으므로 active membership 증거로 사용하지 않는다.
- retryable DELETE 뒤 active exact path와 fully paginated parent listing 양쪽에서 기존 ID가
  사라진 경우만 삭제 성공으로 reconcile한다.
- 같은 path의 다른 ID는 절대 삭제하지 않으며 membership 증거가 불일치하면 fail-closed한다.
- NFC/NFD spelling은 별도 resource로 보존한다.
- ASCII case만 다른 create는 conflict였지만 production resolver는 exact spelling 정책을 유지한다.

## 검증

- 일반 CI: 191 pass, 31 opt-in skip, 0 fail
- build/typecheck/Biome/diff: 성공
- download regression: Ubuntu 24.04, macOS Latest, Windows Latest 성공
- live integration: 8 pass
- targeted download probe: 1 pass
- Phase 10 targeted probe: 2 pass
- unique remote/local cleanup: 성공

## 다음 결정

새 phase는 실제 agent workflow 요구가 확인될 때만 시작한다. 현재 조건부 후보는 ASCII
case-insensitive lookup의 필요성, resumable upload KST literal/overwrite offset/423, 검색 비용이
확인된 경우의 directory snapshot이다. generic mutation retry, quota exhaustion, purge/root clear,
move/copy와 full API wrapper는 계속 비범위다.
