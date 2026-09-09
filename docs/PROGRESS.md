# Progress

이 문서는 프로젝트의 현재 상태와 phase 상태의 단일 기준이다. 과거의 상세 실행 기록은
[`reference/project-history.md`](reference/project-history.md)와 각 phase 문서, Git history를 참조한다.

## 현재 상태

- 마지막 완료 phase: `Phase 16 npm Trusted Publishing`
- 활성 구현 phase: 없음
- 전체 상태: `complete`
- 배포: standalone 실행파일은 폐기했고 npm(Node 기반) 단독 배포를 사용한다. 현재 npm `latest`는
  `v0.3.1`이다.
- npm 배포 인증: Phase 16에서 GitHub Actions OIDC Trusted Publishing으로 전환했으며, 기존
  `NPM_TOKEN` 폐기는 첫 OIDC publish와 registry smoke 뒤에 수행한다.
- 최신 로컬 검사: `bun run check` 262 pass, 37 opt-in skip, 0 fail; 별도 `bun run build` 통과
- 문서 윤문: `README.ko.md`, `CONTRIBUTING.md` 보수적 윤문 완료; `git diff --check` 통과
- 최신 배포 검증: `v0.3.1` Node launcher upload 회귀, tag와 npm publish workflow
  [`33975001755`](https://github.com/oliverne/myboxctl/actions/runs/33975001755) 성공
- 사용자 확인: `v0.3.1` registry 설치 smoke와 global install 확인 완료, 사용 중 이상 없음 (2026-09-06)
- Agent Skill: Hermes 등 셸 실행이 가능한 에이전트 호스트용 `.agents/skills/myboxctl/`을 설치와
  대표 명령 예제 중심으로 작성하고 영문·국문 README에 사용 경로 소개; 정적 검증 완료

## Phase 상태

| Phase                             | 상태     | 현재 근거                                                         | 문서                                                                                             |
| --------------------------------- | -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 00 API contract                   | complete | contract probe와 API ledger 완료                                  | [`phases/00-api-contract.md`](phases/00-api-contract.md)                                         |
| 01 Foundation                     | complete | config/error/output/client와 fake HTTP 검증 완료                  | [`phases/01-foundation.md`](phases/01-foundation.md)                                             |
| 02 Read commands                  | complete | path, resolver, stat, list 검증 완료                              | [`phases/02-read-commands.md`](phases/02-read-commands.md)                                       |
| 03 Ensure directory               | complete | ensure-dir와 shared search limiter 검증 완료                      | [`phases/03-ensure-dir.md`](phases/03-ensure-dir.md)                                             |
| 04 Upload                         | complete | streaming, resume, overwrite와 acceptance 완료                    | [`phases/04-upload.md`](phases/04-upload.md)                                                     |
| 05 Put                            | complete | decision policy와 metadata flow 검증 완료                         | [`phases/05-put.md`](phases/05-put.md)                                                           |
| 06 Delete                         | complete | delete, ID reconcile와 limiter 검증 완료                          | [`phases/06-delete.md`](phases/06-delete.md)                                                     |
| 07 Hardening                      | complete | CI와 통합 live acceptance 완료                                    | [`phases/07-hardening.md`](phases/07-hardening.md)                                               |
| 08 Official API alignment         | complete | 공식 API correction과 live acceptance 완료                        | [`phases/08-official-api-alignment.md`](phases/08-official-api-alignment.md)                     |
| 09 Download                       | complete | targeted probe, 3-OS 검증과 live acceptance 완료                  | [`phases/09-download.md`](phases/09-download.md)                                                 |
| 10 Cross-implementation hardening | complete | path/delete/Unicode hardening과 live probe 완료                   | [`phases/10-cross-implementation-hardening.md`](phases/10-cross-implementation-hardening.md)     |
| 11 Distribution & Release         | complete | native smoke와 release 경계 검증 완료                             | [`phases/11-distribution-release.md`](phases/11-distribution-release.md)                         |
| 12 Cross-platform Unicode names   | complete | 3-OS local 검증과 Unicode live probe 완료                         | [`phases/12-cross-platform-unicode-filenames.md`](phases/12-cross-platform-unicode-filenames.md) |
| 13 Observability & test latency   | complete | event 출력, limiter 계측과 live acceptance 완료                   | [`phases/13-observability-and-test-latency.md`](phases/13-observability-and-test-latency.md)     |
| 14 CLI UX & Agent Contract        | complete | canonical surface와 versioned output contract 완료                | [`phases/14-cli-ux-and-agent-contract.md`](phases/14-cli-ux-and-agent-contract.md)               |
| 15 Recursive folder transfer      | complete | local 구현, 3-OS matrix, live round-trip과 failure-path 회귀 완료 | [`phases/15-recursive-folder-transfer.md`](phases/15-recursive-folder-transfer.md)               |
| 16 npm Trusted Publishing         | complete | workflow OIDC 권한·Node 24 런타임·token 없는 배포 문서 반영 완료; 외부 publisher 등록·첫 publish·token 폐기는 사용자 release 절차 | [`phases/16-npm-trusted-publishing.md`](phases/16-npm-trusted-publishing.md) |

## 검증 경계

- 로컬: `bun run check`, `bun run build`가 위 결과로 통과했다.
- 3-OS/CI: Phase 15 local contract matrix와 일반 Ubuntu check가 성공했다. CI 증거는 Phase 15 문서와
  GitHub Actions history에 둔다.
- live: recursive transfer는 `/myboxctl-integration-test/` 아래 unique child만 사용한 왕복 acceptance와
  cleanup을 통과했다. 추가 live mutation은 별도 승인 대상이다.
- release: tag/workflow와 package 검증 및 사용자 registry 설치 smoke를 완료했다.
- npm Trusted Publishing: 저장소 workflow와 운영 문서 변경은 로컬 검증 대상이며, npm package 설정·실제
  publish·기존 token 폐기는 별도 외부 운영 단계다.

## 다음 작업

1. 다음 phase 또는 npm release 범위를 새로 정할 때 `PLAN.md`와 해당 phase 문서를 갱신한다.

## 상태 변경 규칙

- `PROGRESS.md`만 phase 상태를 소유한다.
- 상태 값은 `pending`, `in_progress`, `blocked`, `complete`만 사용한다.
- 검증이 빠졌거나 실패한 phase는 `complete`로 표시하지 않는다.
- `HANDOFF.md`에는 현재 이어받기에 필요한 문맥만 두고, 과거 일지는 남기지 않는다.
