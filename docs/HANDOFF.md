# Current handoff

## 현재 상태

- Phase 00~10: `complete`
- Phase 11: `blocked`
- Phase 12: `in_progress`
- 활성 구현 phase: `12-cross-platform-unicode-filenames`
- 공개 릴리스: 보류
- PR: #9 `feat: implement cross-platform Unicode filename compatibility`
- Phase 10 기준 CI: run 33231710723
- Phase 10 live evidence: run 33230351165
- Phase 12 CI: run 33241717066 (CI 85)
- Phase 12 release smoke: run 33241717059 (Release 17)

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

Phase 12를 구현 중이다. `src/remote/path.ts`에 NFC canonical name/path helper를 추가하고,
`RemoteResolver`에 read exact-first fallback과 mutation canonical sibling 유일성 검사를 추가했다.
`ensure-dir`, `upload`, `put`, `stat`, `ls`, `download`, `delete`가 새 resolver 정책을 사용한다.

신규 원격 이름은 NFC로 생성하고, 기존 NFD resource를 fallback으로 찾으면 기존 ID와 spelling을
사용한다. canonical-equivalent 후보가 여러 개면 `UNICODE_NAME_COLLISION` conflict로 중단한다.
로컬 `localPath`는 정규화하지 않는다.

로컬 typecheck와 Biome 검사가 통과했고 CI 85 및 Release 17도 성공했다. 실제 MYBOX targeted
probe만 남아 있어 Phase 12는 아직 완료 처리하지 않는다. probe는 GitHub Actions
`workflow_dispatch`에서 `phase12_probe=true`를 선택해 실행하며, 이 연결에서는 workflow dispatch
작업 자체를 호출할 수 없다. Phase 11의 첫 public Release는 Phase 12 완료 후 재개한다.

## 다음 계획

사용자가 GitHub Actions에서 `phase12_probe=true`를 실행해 실제 MYBOX probe가 통과한 것을 확인하면
문서 상태를 `complete`로 바꾸고 Phase 11의 tag 기반 draft Release 검증을 재개한다. public Release, npm publish와 Homebrew 반영은 기존 공개
조건을 모두 확인한 뒤 별도로 실행한다.

이번 phase에는 case folding, 기존 resource 자동 migration, local rename, rename API 모사는 포함하지
않는다.
