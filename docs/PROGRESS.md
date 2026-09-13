# Progress

이 문서는 프로젝트의 현재 상태와 phase 상태의 단일 기준이다. 과거의 상세 실행 기록은
[`reference/project-history.md`](reference/project-history.md)와 각 phase 문서, Git history를 참조한다.

## 현재 상태

- 마지막 완료 phase: `Phase 18 Remote Rename & Move`
- 활성 구현 phase: 없음; 다음 단계는 `Phase 19 Automatic Failure Diagnostics`다
- 다음 phase: `Phase 19 Automatic Failure Diagnostics` (`pending`)
- 전체 상태: `in_progress`
- 배포: standalone 실행파일은 폐기했고 npm(Node 기반) 단독 배포를 사용한다. 현재 npm `latest`는
  `v0.4.0`다. Phase 22에서 standalone 부활 없이 Node 기반 Homebrew tap을 계획한다.
- npm 배포 인증: Phase 16에서 GitHub Actions OIDC Trusted Publishing으로 전환했다. 첫 OIDC publish와
  registry/provenance 및 설치 smoke를 확인했고, 기존 npm publish token과 GitHub `NPM_TOKEN` secret을
  폐기했다 (2026-09-13 사용자 확인). 로컬 `~/.npmrc`의 잔여 `_authToken` 항목도 같은 날 제거해 로컬
  npm publish는 ENEEDAUTH가 되고, 배포는 workflow OIDC로만 수행된다.
- 최신 로컬 검사: `bun run check` 305 pass, 57 skip, 0 fail; 별도 `bun run build` 통과
- 문서 윤문: `README.ko.md`, `CONTRIBUTING.md` 보수적 윤문 완료; `git diff --check` 통과
- 최신 배포 검증: `v0.4.0` OIDC publish workflow의 `publish`·`release` job 성공, npm registry
  `0.4.0`/`latest`와 provenance attestation 확인, GitHub Release `v0.4.0`(draft/prerelease 아님,
  본문이 `docs/releases/v0.4.0.md`와 일치, asset 0개) 확인 완료
- 설치 smoke: `npx @oliverne/myboxctl@0.4.0 --version`(0.4.0 한 줄), 인자 없는 실행 root help exit 0,
  `--help`에 `rename`/`move` 포함, 임시 prefix global install의 `--version`/`--help` exit 0 확인 완료
- registry 전파: publish 성공 직후 registry read가 약 1–2분간 기존 version을 반환했고, 그 뒤
  `0.4.0`과 `latest`가 반영됐다. `npm view`의 E404를 publish 실패로 단정하지 않는다
- Agent Skill: Hermes 등 셸 실행이 가능한 에이전트 호스트용 `.agents/skills/myboxctl/`을 설치와
  대표 명령 예제 중심으로 작성하고 영문·국문 README에 사용 경로 소개; 정적 검증 완료
- Release Skill: `v0.4.0` 배포 절차를 기반으로 `.agents/skills/myboxctl-release/SKILL.md`를 추가했다.
  승인 경계, version 선택, 사용자 관점 release note 문체, tag/workflow/전파 대기/검증과 실패 대응을
  담았고 `docs/releases/README.md`에 같은 문체 규칙을 명문화했다. 실제 호출 검증은 미수행이다.
- Phase 17 로컬 구현: `docs/releases/` note 규칙과 `src/release/notes.ts` +
  `scripts/verify-release-notes.ts` 검증, `publish-npm.yml`의 `publish`/`release` job 권한 분리,
  idempotent Release 생성, note/workflow 정적 회귀 테스트를 추가했다. `bun run check`(278 pass,
  37 skip, 0 fail), `bun run build`, `git diff --check`를 통과했다.
- Phase 17 외부 검증: `v0.4.0` 배포에서 `publish` job의 note 검증 후 npm publish, `release` job의
  GitHub Release 생성이 모두 성공했고 Release의 tag/본문 일치를 확인해 Phase 17을 `complete`로 바꿨다.
- Phase 18 구현·검증: `rename`/`move` command, `MyboxClient.renameResource`/`moveResource`, endpoint별
  limiter와 `RemoteResolver.rootResourceId`를 추가했다. targeted probe 10 pass/0 fail, 신규 fake HTTP와
  CLI subprocess test 20 pass/0 fail, 승인된 live acceptance 6 pass/0 fail(965.73s)를 완료했다.
  상세 계약은 [`reference/mybox-api.md`](reference/mybox-api.md) API-15에 기록했다.
- Phase 18 review 후속 수정: 불확실한 rename/move mutation의 ID 기반 reconcile, canonical
  destination resolver, 실제 canonical spelling postcondition/descendant 검사, contract probe의
  정확한 status/code와 poll predicate 단정을 반영했다. 코드 리뷰 뒤 `hasControlCharacter` 중복을
  `remote/path.ts` 한 곳으로 통합하고, HANDOFF의 destination root `parentId` 획득 서술을 실제
  동작(record의 `resourceId`를 move body `parentId`로 사용)으로 교정했다. 신규 회귀 7개를 포함해
  `bun run check` 305 pass, 57 skip, 0 fail, `bun run build`를 통과했다. live 재실행은 미수행이다.
- Phase 17 배포 검증 결과: 다음 version을 `v0.4.0`으로 정하고 Phase 18 사용자 영향 6 bullet의
  `docs/releases/v0.4.0.md`를 배포 commit(`3838c02`)에 포함해 push했고, CI 성공 뒤 tag를 만들어
  publish workflow를 성공시켰다.
- 후속 로드맵: Phase 19–22와 recursive upload checkpoint Decision을 `pending` 계획으로 유지한다.

## Phase 상태

| Phase                             | 상태     | 현재 근거                                                                             | 문서                                                                                             |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 00 API contract                   | complete | contract probe와 API ledger 완료                                                      | [`phases/00-api-contract.md`](phases/00-api-contract.md)                                         |
| 01 Foundation                     | complete | config/error/output/client와 fake HTTP 검증 완료                                      | [`phases/01-foundation.md`](phases/01-foundation.md)                                             |
| 02 Read commands                  | complete | path, resolver, stat, list 검증 완료                                                  | [`phases/02-read-commands.md`](phases/02-read-commands.md)                                       |
| 03 Ensure directory               | complete | ensure-dir와 shared search limiter 검증 완료                                          | [`phases/03-ensure-dir.md`](phases/03-ensure-dir.md)                                             |
| 04 Upload                         | complete | streaming, resume, overwrite와 acceptance 완료                                        | [`phases/04-upload.md`](phases/04-upload.md)                                                     |
| 05 Put                            | complete | decision policy와 metadata flow 검증 완료                                             | [`phases/05-put.md`](phases/05-put.md)                                                           |
| 06 Delete                         | complete | delete, ID reconcile와 limiter 검증 완료                                              | [`phases/06-delete.md`](phases/06-delete.md)                                                     |
| 07 Hardening                      | complete | CI와 통합 live acceptance 완료                                                        | [`phases/07-hardening.md`](phases/07-hardening.md)                                               |
| 08 Official API alignment         | complete | 공식 API correction과 live acceptance 완료                                            | [`phases/08-official-api-alignment.md`](phases/08-official-api-alignment.md)                     |
| 09 Download                       | complete | targeted probe, 3-OS 검증과 live acceptance 완료                                      | [`phases/09-download.md`](phases/09-download.md)                                                 |
| 10 Cross-implementation hardening | complete | path/delete/Unicode hardening과 live probe 완료                                       | [`phases/10-cross-implementation-hardening.md`](phases/10-cross-implementation-hardening.md)     |
| 11 Distribution & Release         | complete | native smoke와 release 경계 검증 완료                                                 | [`phases/11-distribution-release.md`](phases/11-distribution-release.md)                         |
| 12 Cross-platform Unicode names   | complete | 3-OS local 검증과 Unicode live probe 완료                                             | [`phases/12-cross-platform-unicode-filenames.md`](phases/12-cross-platform-unicode-filenames.md) |
| 13 Observability & test latency   | complete | event 출력, limiter 계측과 live acceptance 완료                                       | [`phases/13-observability-and-test-latency.md`](phases/13-observability-and-test-latency.md)     |
| 14 CLI UX & Agent Contract        | complete | canonical surface와 versioned output contract 완료                                    | [`phases/14-cli-ux-and-agent-contract.md`](phases/14-cli-ux-and-agent-contract.md)               |
| 15 Recursive folder transfer      | complete | local 구현, 3-OS matrix, live round-trip과 failure-path 회귀 완료                     | [`phases/15-recursive-folder-transfer.md`](phases/15-recursive-folder-transfer.md)               |
| 16 npm Trusted Publishing         | complete | Trusted Publisher 등록, 첫 OIDC publish·provenance·설치 smoke 및 기존 token 폐기 완료 | [`phases/16-npm-trusted-publishing.md`](phases/16-npm-trusted-publishing.md)                     |
| 17 GitHub Release Notes           | complete | `v0.4.0` 배포에서 note 검증, npm publish와 GitHub Release 생성·본문 일치 확인 완료    | [`phases/17-github-release-notes.md`](phases/17-github-release-notes.md)                         |
| 18 Remote Rename & Move           | complete | probe·fake HTTP/CLI 회귀·live acceptance 통과; live root destination 미검증           | [`phases/18-remote-rename-move.md`](phases/18-remote-rename-move.md)                             |
| 19 Automatic Failure Diagnostics  | pending  | opt-in config, bounded buffer와 실패 시 자동 JSONL 계획                               | [`phases/19-automatic-failure-diagnostics.md`](phases/19-automatic-failure-diagnostics.md)       |
| 20 Recursive Upload Resume        | pending  | explicit checkpoint, atomic state와 fail-closed 재개 계획                             | [`phases/20-recursive-upload-resume.md`](phases/20-recursive-upload-resume.md)                   |
| 21 stdin Upload                   | pending  | unknown-size stdin의 secure temp spool과 기존 uploader 재사용 계획                    | [`phases/21-stdin-upload.md`](phases/21-stdin-upload.md)                                         |
| 22 Homebrew Tap                   | pending  | standalone 없는 npm tarball 기반 Node formula 계획                                    | [`phases/22-homebrew-tap.md`](phases/22-homebrew-tap.md)                                         |

## 검증 경계

- 로컬: `bun run check`, `bun run build`가 위 결과로 통과했다.
- 3-OS/CI: Phase 15 local contract matrix와 일반 Ubuntu check가 성공했다. CI 증거는 Phase 15 문서와
  GitHub Actions history에 둔다.
- live: recursive transfer는 `/myboxctl-integration-test/` 아래 unique child만 사용한 왕복 acceptance와
  cleanup을 통과했다. 추가 live mutation은 별도 승인 대상이다.
- release: `v0.4.0` tag/workflow와 package 검증, npm registry/provenance 및 설치 smoke를 완료했다.
- npm Trusted Publishing: npm package 설정과 실제 OIDC publish, registry/provenance 및 설치 smoke,
  기존 token 폐기까지 완료했다 (2026-09-13 사용자 확인). `v0.4.0`도 같은 OIDC 경로로 배포했다.
- Phase 17 배포: note 검증 script/단위 테스트, workflow 정적 계약 테스트와 `bun run check`(305 pass,
  57 skip, 0 fail)가 통과했다. `v0.4.0` publish workflow에서 `publish`·`release` job이 모두 성공했고
  GitHub Release 본문이 note와 일치함을 확인했다.
- Phase 18 로컬: `bun run test:rename-move-probe` 10 pass/0 fail, 신규 rename/move fake HTTP·CLI
  subprocess test 27 pass/0 fail(review 후속 7개 포함), `bun run check`(305 pass, 57 skip, 0 fail),
  `bun run build`, `git diff --check`가 통과했다.
- Phase 18 live: `MYBOX_INTEGRATION=1 bun test test/integration/rename-move.test.ts` 6 pass/0 fail
  (965.73s). mutation은 `/myboxctl-integration-test/` 아래 unique child로 제한했다. destination root `/`
  실이동과 429/응답 유실 reconcile은 fake HTTP test로만 검증했고 live 미검증으로 남긴다.

## 다음 작업

1. Phase 19 Automatic Failure Diagnostics를 `in_progress`로 시작한다: config opt-in, 성공 시 무파일,
   실패 시 bounded 자동 diagnostic JSONL.
2. Phase 20–22는 앞선 phase가 완료된 뒤 순서대로 진행한다.

## 상태 변경 규칙

- `PROGRESS.md`만 phase 상태를 소유한다.
- 상태 값은 `pending`, `in_progress`, `blocked`, `complete`만 사용한다.
- 검증이 빠졌거나 실패한 phase는 `complete`로 표시하지 않는다.
- `HANDOFF.md`에는 현재 이어받기에 필요한 문맥만 두고, 과거 일지는 남기지 않는다.
