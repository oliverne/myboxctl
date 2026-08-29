# Current handoff

## 현재 상태

- Phase 00~10: `complete`
- Phase 11: `in_progress`
- 활성 구현 phase: `11-distribution-release`
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

## 현재 작업

Phase 11에서 Bun standalone 5개 target, GitHub draft Release, SHA256, npm optional platform
packages, Homebrew tap formula, Linux installer와 Scoop manifest를 구현한다. 실제 publish는 저장소 공개,
native smoke, package/tap 소유권과 credential 확인 전까지 수행하지 않는다.

로컬 Bun 1.4.0 검증은 194 pass, 31 opt-in skip, 0 fail이며 release contract 3 pass다.
`0.1.0-test` 5개 archive와 배포 metadata 생성을 완료했고 Linux x64 standalone/npm launcher,
Windows zip integrity와 installer shell syntax가 통과했다.

PR #8 Release workflow run 33235460712에서 macOS arm64/x64, Linux arm64/x64, Windows x64 native
smoke와 Homebrew formula syntax가 모두 통과했고 일반 CI run 33235460718도 성공했다. 남은 Phase 11
완료 조건은 실제 tag에서 draft Release 생성·asset 업로드를 확인하는 것이다. 실제 npm/Homebrew
publish와 Release 공개는 저장소 public 전환, package/tap 소유권 및 전용 token 준비 전에는 실행하지
않는다.

## 다음 계획

Phase 12는 `pending`이다. macOS/Windows/WSL2의 NFC/NFD 차이를 흡수하기 위해 새 원격 이름은
NFC로 만들고, 기존 NFD resource는 exact lookup 실패 시 단일 canonical fallback으로 찾는다.
여러 canonical-equivalent 후보가 있으면 mutation 없이 conflict로 중단하며 local path는 절대
정규화하지 않는다. Phase 11의 draft Release 검증은 계속할 수 있지만 Phase 12 완료 전에는 첫
public Release를 게시하지 않는다.

상세 범위와 검증 조건은
[`phases/12-cross-platform-unicode-filenames.md`](phases/12-cross-platform-unicode-filenames.md)을
따른다. ASCII case-insensitive lookup, 기존 resource 자동 migration, resumable upload
KST literal/overwrite offset/423과 directory snapshot은 이번 범위에 포함하지 않는다.
