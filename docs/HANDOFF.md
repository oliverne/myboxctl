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

## 현재 작업

Phase 12를 구현 중이다. `src/remote/path.ts`에 NFC canonical name/path helper를 추가하고,
`RemoteResolver`에 read exact-first fallback과 mutation canonical sibling 유일성 검사를 추가했다.
`ensure-dir`, `upload`, `put`, `stat`, `ls`, `download`, `delete`가 새 resolver 정책을 사용한다.

신규 원격 이름은 NFC로 생성하고, 기존 NFD resource를 fallback으로 찾으면 기존 ID와 spelling을
사용한다. canonical-equivalent 후보가 여러 개면 `UNICODE_NAME_COLLISION` conflict로 중단한다.
로컬 `localPath`는 정규화하지 않는다.

현재까지 로컬 typecheck와 Biome 검사가 통과했다. Bun test와 실제 MYBOX targeted probe는 CI에서
검증해야 하며, Phase 12는 아직 완료 처리하지 않는다. Phase 11의 첫 public Release는 Phase 12
완료 후 재개한다.

## 다음 계획

Phase 12의 전체 테스트와 실제 MYBOX probe가 통과하면 문서 상태를 `complete`로 바꾸고 Phase 11의
tag 기반 draft Release 검증을 재개한다. public Release, npm publish와 Homebrew 반영은 기존 공개
조건을 모두 확인한 뒤 별도로 실행한다.

이번 phase에는 case folding, 기존 resource 자동 migration, local rename, rename API 모사는 포함하지
않는다.
