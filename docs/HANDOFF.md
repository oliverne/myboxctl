# Current handoff

## 인수 목적

Phase 00–16과 Phase 18 Remote Rename & Move의 구현과 필수 로컬/live 검증을 완료했다. Phase 17 GitHub
Release Notes는 로컬 구현과 로컬 검증을 마쳤고, Phase 18을 포함한 다음 version을 `v0.4.0`으로 정해
`docs/releases/v0.4.0.md`를 작성했다. 남은 것은 배포 commit push/CI, tag 생성, npm publish와 GitHub
Release 확인이며 모두 별도 승인 대상이다. 다음 계획 phase는 Phase 19 Automatic Failure Diagnostics다.
전체 phase 상태와 최신 검증 수치는 [`PROGRESS.md`](PROGRESS.md)가 소유한다.

## 현재 상태

- 작업 브랜치: `main`
- Phase 00–16, 18: 모두 `complete`
- Phase 17: `in_progress`; note 검증·workflow job 분리와 정적 회귀 테스트는 구현 완료, 실제
  npm publish 뒤 GitHub Release 생성은 미검증. Phase 18을 포함한 version 배포에서 함께 검증한다
- Phase 19–22: 모두 `pending`; Phase 17의 잔여 배포 검증 뒤 순차 진행
- 다음 배포 note: `docs/releases/v0.4.0.md`(6 bullet) 작성 완료;
  `bun run verify:release-notes -- --tag v0.4.0`, prettier check, `bun run check`(305 pass, 57 skip,
  0 fail) 통과. 배포 commit push/CI, tag, npm publish와 GitHub Release는 미실행
- 현재 배포: `@oliverne/myboxctl@0.3.2`, npm 단독 배포
- standalone/Scoop/install script 경로: 폐기 유지
- Homebrew: Phase 22에서 standalone 부활 없이 npm tarball 기반 Node formula로 계획
- 최신 로컬 검사: `bun run check` 305 pass, 57 skip, 0 fail; `bun run build`와 `git diff --check` 통과
- 최신 publish: `v0.3.2` OIDC workflow 성공, registry `latest`와 provenance 확인 완료
- 사용자 확인: `v0.3.2` npx/global install smoke와 기존 npm publish token 및 GitHub `NPM_TOKEN`
  secret 폐기 완료 (2026-09-13)
- Agent Skill: `.agents/skills/myboxctl/`에 설치와 대표 명령 예제 중심의 교차 호스트 절차 및 독립 CLI
  contract reference를 추가하고 영문·국문 README에서 안내; Hermes 사용자 스킬 형식 및 정적 검증
  완료, 실제 호출은 미검증
- Phase 17 구현: `docs/releases/` note 규칙과 `src/release/notes.ts` +
  `scripts/verify-release-notes.ts` 검증, `publish-npm.yml`의 `publish`/`release` job 권한 분리,
  idempotent Release 생성, note/workflow 정적 회귀 테스트를 추가했다. `bun run check`, `bun run build`,
  `git diff --check`를 통과했다; 실제 npm publish와 GitHub Release 생성은 미실행
- Phase 18 구현: `rename`/`move` CLI command, `MyboxClient.renameResource`/`moveResource`, endpoint별
  limiter bucket, `RemoteResolver.rootResourceId`와 공유 relocation helper를 추가했다. targeted probe
  10 pass/0 fail, 신규 fake HTTP·CLI subprocess 20 pass/0 fail, live acceptance 6 pass/0 fail(965.73s)를
  완료했다. live root destination 이동과 429/응답 유실 reconcile은 fake HTTP로만 검증했다.
- Phase 18 review 후속 수정: 불확실한 rename/move mutation을 ID로 reconcile하고, `move` destination을
  mutation용 canonical resolver로 해석하며, postcondition/descendant 검사를 resolver가 선택한 실제
  canonical spelling으로 수행한다. contract probe는 정확한 status/code와 poll predicate를 단정한다.
  코드 리뷰 뒤 `hasControlCharacter` 중복 구현을 `remote/path.ts` export 한 곳으로 통합하고, 아래
  destination root 서술을 실제 동작(record의 `resourceId`를 move body `parentId`로 사용)으로
  교정했다. rename/move limiter bucket의 `other` 공유는 유지했다.
  신규 회귀 7개를 포함해 `bun run check` 305 pass, 57 skip, 0 fail, `bun run build`를 통과했다. live
  재실행은 미수행이다.
- pi-lens 참고: `src/output.ts`의 `sanitizeValue`는 `SanitizedValue`, `src/cli.ts`의
  `normalizeMachineData`는 `MachineData` 반환 타입으로 `no-unknown-returns` heuristic을 피한다.
  `no-runtime-typeof`, `no-conditional-empty-object-spread`, `no-unsafe-dictionary-unknown` 같은
  heuristic hint는 남아 있지만 `bun run check`의 gate는 아니다.

## 구현된 현재 계약

### CLI와 출력

canonical command는 `list`/`ls`, `info`, `mkdir`, `upload`, `download`, `delete`다. `--json`은
versioned envelope를 stdout에 내고, event는 stderr 정책을 따른다. 상세 command/JSON/exit code 계약은
[`reference/cli-contract.md`](reference/cli-contract.md)를 기준으로 한다.

### Rename과 move

- `rename <remote-path> <new-name>`은 같은 parent에서 basename만 바꾸고,
  `move <remote-path> <destination-directory>`는 basename을 유지한 채 기존 directory로 옮긴다. 둘 다
  `resourceId`를 유지하고 endpoint 하나만 호출한다.
- `new-name`은 단일 component다. 빈 값, `.`, `..`, separator, C0/DEL과 portable 금지 문자는 mutation
  전에 exit 2다. 이름은 NFC로 자동 변환하지 않고 준 그대로 전송한다.
- destination에 NFC 기준 같은 이름의 다른 resource가 있으면 `NAME_CONFLICT` exit 5이며, no-op이면
  mutation 없이 `action: "unchanged"`다. `move`는 destination이 기존 folder여야 하고 자기 자신 또는
  descendant로의 이동을 거부한다.
- POST는 한 번만 수행한다. 성공 뒤 실제 canonical spelling 경로의 exact resolve가 같은 ID를
  유일하게 반환하고 이전 path가 그 ID를 더 이상 반환하지 않아야 성공이다. timeout/5xx/429 또는
  잘못된 성공 body처럼 결과가 불확실하면 POST를 반복하지 않고 이전/새 path를 같은 ID로 관찰해
  성공/미적용/불확정을 구분하고, 확정할 수 없으면 `MUTATION_UNCONFIRMED`다.
- `move` destination은 mutation용 canonical resolver로 해석해 Unicode fallback, canonical 충돌과
  중간 file component를 검사하고 실제 folder spelling/ID로 이동한다. descendant 거부도 실제
  component spelling으로 다시 확인한다.
- destination root `/`는 `GET /v1/search/resources/folders?path=/`의 단일 record의 `resourceId`를
  move body의 `parentId`로 사용한다.

세부 계약은 [`reference/cli-contract.md`](reference/cli-contract.md)와 API-15
([`reference/mybox-api.md`](reference/mybox-api.md))에 있다.

### Recursive transfer

- folder upload/download에는 명시적인 `--recursive`가 필요하다.
- manifest를 먼저 만들고 portable name, collision, symlink/non-regular entry와 identity/topology 변경을
  fail-closed로 검증한다.
- transfer tree는 exclusive create이며 기존 tree와 merge하거나 recursive overwrite하지 않는다.
- mutation 응답이 불확실할 때 POST를 반복하지 않고 `error.partialTransfer`로 확인된 결과와 불확실성을
  구분한다.
- download는 bounded-memory stream, 실제 기록 byte progress, 파일별 atomic commit을 사용한다.
- `MYBOX_PLAN` → XDG/default `config.json`의 `plan` → 보수적 기본값 순으로 limiter preset을 선택하며,
  shared request history와 cooldown은 유지한다.
- `--diagnostic-log`는 명시적으로 요청한 경우에만 exclusive JSONL을 만들며 PAT, Authorization, signed
  URL과 raw HTTP/argv를 기록하지 않는다.

세부 설계·완료 조건·실행 증거는 [`phases/15-recursive-folder-transfer.md`](phases/15-recursive-folder-transfer.md)와
[`architecture/reliability.md`](architecture/reliability.md)에 있다.

### Release notes와 배포

- npm publish 대상 version의 본문은 `docs/releases/vX.Y.Z.md`에 두고 사용자 영향만 3~6개 bullet로
  적는다. 작성 규칙은 [`releases/README.md`](releases/README.md)를 따른다.
- `bun run verify:release-notes -- --tag vX.Y.Z`가 파일 존재, tag/version 일치와 bullet 개수를 검증한다.
  `bun run check`는 `docs/releases/*.md` 전체와 `publish-npm.yml` 구조를 정적으로 회귀 검증한다.
- `publish-npm.yml`은 `publish` job(`contents: read`, `id-token: write`)과 `release` job
  (`contents: write`, `needs: publish`)으로 나뉜다. 둘 다 같은 tag를 checkout한다.
- `publish` job은 build 이전에 note를 검증하고, `release` job은 publish 성공 뒤 같은 note로 GitHub
  Release를 생성한다. 이미 존재하는 Release는 note 본문·draft/prerelease가 일치할 때만 성공으로
  보고하고, 다르면 덮어쓰지 않고 실패한다.
- npm publish는 성공했지만 Release만 실패하면 **Re-run failed jobs**로 `release` job만 재실행한다.

## 계획된 후속 로드맵

1. Phase 17(잔여): `docs/releases/v0.4.0.md`를 배포 commit에 포함해 push하고 CI 성공을 확인한 뒤
   tag를 만들고 npm publish 뒤 GitHub Release의 tag/version/본문을 확인한다
2. Phase 19: config opt-in, 성공 시 무파일, 실패 시 bounded 자동 diagnostic JSONL
3. Phase 20: explicit local checkpoint를 사용하는 recursive upload 재개
4. Phase 21: unknown-size stdin을 secure temp file에 spool한 뒤 단일 파일 업로드
5. Phase 22: npm tarball과 Node를 사용하는 personal Homebrew tap

built-in tar/zip은 구현하지 않고 Phase 21의 stdin upload와 외부 `tar`를 조합한다. Phase 20은 arbitrary
existing tree를 merge하지 않으며 checkpoint가 소유하고 검증한 tree만 재개한다. 상태/transaction 결정은
[`architecture/recursive-upload-resume.md`](architecture/recursive-upload-resume.md)를 따른다.

## 검증과 안전 경계

- 일반 검증은 저장소 루트에서 `bun run check` 후 `bun run build`를 순서대로 실행한다.
- release note 검증은 `bun run verify:release-notes -- --tag vX.Y.Z`로 수행하고, `bun run check`가
  `docs/releases/*.md`와 `publish-npm.yml` 구조를 함께 검증한다.
- rename/move 계약은 `bun run test:rename-move-probe`(live read/write probe, 10 pass), 일반 suite에
  포함되는 fake HTTP·CLI subprocess 회귀 27개(review 후속 7개 포함), `MYBOX_INTEGRATION=1 bun test
test/integration/rename-move.test.ts`(live acceptance, 6 pass)로 검증한다.
- 실제 MYBOX test는 `MYBOX_INTEGRATION=1 bun test test/integration`이며, mutation은
  `/myboxctl-integration-test/` 아래 unique child로 제한한다.
- live mutation, credential 변경, commit, push, tag, npm publish와 GitHub Release 생성은 서로 다른
  승인 범위로 취급한다.
- PAT, Authorization header, upload/download URL과 token은 출력·로그·문서에 남기지 않는다.
- npm publish는 `id-token: write`를 사용하는 Trusted Publishing(OIDC) 방식이다. npm package의
  Trusted Publisher 등록, 첫 OIDC publish와 registry/provenance 및 설치 smoke 확인, 기존 npm publish
  token과 GitHub `NPM_TOKEN` secret 폐기를 완료했다.

## 기준 문서

- 범위와 phase 순서: [`PLAN.md`](PLAN.md)
- 현재 상태: [`PROGRESS.md`](PROGRESS.md)
- 문서 구조: [`README.md`](README.md)
- CLI 계약: [`reference/cli-contract.md`](reference/cli-contract.md)
- MYBOX API 관찰: [`reference/mybox-api.md`](reference/mybox-api.md)
- 공식 API coverage: [`reference/official-api-audit.md`](reference/official-api-audit.md)
- 배포 절차: [`operations/npm-release.md`](operations/npm-release.md)
- release note 규칙: [`releases/README.md`](releases/README.md)
- npm Trusted Publishing 전환: [`phases/16-npm-trusted-publishing.md`](phases/16-npm-trusted-publishing.md)
- 현재 구현 phase: [`phases/18-remote-rename-move.md`](phases/18-remote-rename-move.md) (`complete`)
- 후속 phase: [`phases/19-automatic-failure-diagnostics.md`](phases/19-automatic-failure-diagnostics.md),
  [`phases/20-recursive-upload-resume.md`](phases/20-recursive-upload-resume.md),
  [`phases/21-stdin-upload.md`](phases/21-stdin-upload.md),
  [`phases/22-homebrew-tap.md`](phases/22-homebrew-tap.md)
- 과거 결정/완료 phase 색인: [`reference/project-history.md`](reference/project-history.md)

## 로컬 시작

```bash
git fetch origin
git switch main
git pull --ff-only origin main
bun install --frozen-lockfile
bun run check
```

Phase 17은 `in_progress`이며 로컬 구현과 로컬 검증이 끝났고, Phase 18은 구현과 live acceptance까지
`complete`다. 남은 작업은 Phase 18을 포함한 다음 user-facing version에서 `docs/releases/vX.Y.Z.md`를
작성하고 npm publish 뒤 GitHub Release를 확인하는 것이다. 범위 변경이 있으면 `PLAN.md`와 해당 phase
문서를 함께 갱신한다. 계획 문서 반영 자체는 구현, external publish, commit 또는 push를 의미하지 않는다.
