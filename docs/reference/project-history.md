# 프로젝트 이력 참조

이 문서는 과거의 주요 결정과 완료 증거를 찾기 위한 색인이다. 현재 상태의 기준은
[`PROGRESS.md`](../PROGRESS.md), 다음 작업의 기준은 [`HANDOFF.md`](../HANDOFF.md), 범위의 기준은
[`PLAN.md`](../PLAN.md)와 각 phase 문서다. 이 문서의 이력은 현재 상태를 덮어쓰지 않는다.

## 완료 phase 색인

| 범위        | 주요 결과                                                                         | 상세 문서                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 00~08 | API 계약, CLI 기반, 읽기/생성/업로드/put/delete, hardening과 공식 API 정합성 완료 | [`phases/00-api-contract.md`](../phases/00-api-contract.md) ~ [`phases/08-official-api-alignment.md`](../phases/08-official-api-alignment.md)                                    |
| Phase 09    | signed URL 기반 download와 no-clobber/atomic local commit 완료                    | [`phases/09-download.md`](../phases/09-download.md)                                                                                                                              |
| Phase 10    | cross-implementation 감사에서 채택한 path/delete/Unicode hardening 완료           | [`phases/10-cross-implementation-hardening.md`](../phases/10-cross-implementation-hardening.md), [`reference/php-implementation-audit.md`](php-implementation-audit.md)          |
| Phase 11~12 | 배포 경로 검증과 cross-platform Unicode filename 정책 완료                        | [`phases/11-distribution-release.md`](../phases/11-distribution-release.md), [`phases/12-cross-platform-unicode-filenames.md`](../phases/12-cross-platform-unicode-filenames.md) |
| Phase 13    | observability, human/JSONL 출력과 rate-limit 지연 분석 완료                       | [`phases/13-observability-and-test-latency.md`](../phases/13-observability-and-test-latency.md), [`test-latency-investigation.md`](test-latency-investigation.md)                |
| Phase 14    | canonical CLI surface, destination semantics와 versioned JSON contract 완료       | [`phases/14-cli-ux-and-agent-contract.md`](../phases/14-cli-ux-and-agent-contract.md), [`cli-contract.md`](cli-contract.md)                                                      |
| Phase 15    | recursive folder transfer, partial failure, plan preset과 diagnostic log 완료     | [`phases/15-recursive-folder-transfer.md`](../phases/15-recursive-folder-transfer.md), [`architecture/reliability.md`](../architecture/reliability.md)                           |
| Phase 16    | npm `NPM_TOKEN` 배포를 GitHub Actions OIDC Trusted Publishing으로 전환             | [`phases/16-npm-trusted-publishing.md`](../phases/16-npm-trusted-publishing.md), [`operations/npm-release.md`](../operations/npm-release.md)                          |

## 주요 배포 전환

- standalone 실행파일, Homebrew, Scoop 경로는 폐기하고 npm(Node launcher) 단독 배포로 전환했다.
  현재 버전과 배포 검증 절차는 [`operations/npm-release.md`](../operations/npm-release.md)와
  [`PROGRESS.md`](../PROGRESS.md)에 둔다.
- Phase 15 완료 후 `v0.3.0`을 배포했고, Node ReadableStream upload 호환성 수정으로 `v0.3.1`을
  추가 배포했다. tag와 workflow의 세부 증거는 Git history와 npm 운영 문서에서 확인한다.

## 이력 원칙

- 과거의 상세 실행 로그, 중간 test count와 superseded 계획은 이 문서에 복사하지 않는다.
- 특정 구현의 이유는 해당 architecture/reference 문서에, phase 실행 증거는 해당 phase 문서에 둔다.
- 날짜별 commit, tag, CI run의 전체 순서는 Git history를 기준으로 확인한다.
