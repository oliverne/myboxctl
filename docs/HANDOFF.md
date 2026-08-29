# Current handoff

## 현재 상태

- Phase 00~10: `complete`
- Phase 11: `in_progress`
- Phase 12: `complete`
- 활성 구현 phase: `11-distribution-release`
- 공개 릴리스: 보류
- PR: #9 `feat: implement cross-platform Unicode filename compatibility`
- Phase 10 기준 CI: run 33231710723
- Phase 10 live evidence: run 33230351165
- Phase 12 CI: run 33243933045 (CI 90)
- Phase 12 release smoke: run 33243933046 (Release 21)
- Phase 12 live evidence: run 33244082095

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

- 일반 CI: run 33241717066 성공 (Bun check/build/full tests, Ubuntu/macOS/Windows local download regression)
- build/typecheck/Biome/diff: 성공
- release smoke: run 33241717059 성공 (5개 native executable target)
- live integration: 8 pass
- targeted download probe: 1 pass
- Phase 10 targeted probe: 2 pass
- unique remote/local cleanup: 성공

## 현재 작업

Phase 12 구현을 완료했다. `src/remote/path.ts`에 NFC canonical name/path helper를 추가하고,
`RemoteResolver`에 read exact-first fallback과 mutation canonical sibling 유일성 검사를 추가했다.
`ensure-dir`, `upload`, `put`, `stat`, `ls`, `download`, `delete`가 새 resolver 정책을 사용한다.

CI 90과 Release 21이 성공했고, 실제 MYBOX targeted probe run 33244082095에서 신규 NFC 생성,
기존 NFD fallback 조회·다운로드, canonical collision 차단과 ID 기반 cleanup을 1 pass/0 fail로
확인했다. 로컬 `localPath`는 정규화하지 않는다.

Phase 12 완료에 따라 Phase 11의 tag 기반 draft Release 검증을 재개한다. public Release는 별도 승인과
권한 확인 후 진행한다.

## 다음 계획

Phase 12가 완료되었으므로 Phase 11의 tag 기반 draft Release 검증을 재개한다. `v*` tag를 생성하면
Release workflow가 5개 native asset smoke 후 draft Release를 만들며, public publish는 별도 승인 후
실행한다. public Release, npm publish와 Homebrew 반영은 기존 공개
조건을 모두 확인한 뒤 별도로 실행한다.

이번 phase에는 case folding, 기존 resource 자동 migration, local rename, rename API 모사는 포함하지
않는다.
