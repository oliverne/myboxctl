# 문서 안내

이 디렉터리는 독자의 목적에 따라 문서를 분리한다. 같은 사실을 여러 문서에 복사하지 말고
안정적인 계약은 reference, 변경 이유는 architecture, 실행 순서는 phase 문서에 둔다.

## 구현을 시작할 때

다음 순서로 읽는다.

1. [`../PLAN.md`](../PLAN.md)
2. [`PROGRESS.md`](PROGRESS.md)
3. [`HANDOFF.md`](HANDOFF.md)
4. `PROGRESS.md`에서 `in_progress`로 표시된 phase 문서
5. phase 문서가 링크한 architecture/reference 문서

## 문서 종류

### 실행 계획

[`phases/`](phases/)에는 Luna가 순서대로 수행할 phase별 작업, 테스트, 완료 조건, handoff
요구사항이 있다. 작업 체크 여부는 phase 문서가 아니라 `PROGRESS.md`에서 관리한다.

### 설계 설명

- [`architecture/overview.md`](architecture/overview.md): 구조, 책임, 의존성 방향
- [`architecture/reliability.md`](architecture/reliability.md): overwrite, retry, race, 파일 안정성

### 계약 reference

- [`reference/cli-contract.md`](reference/cli-contract.md): 명령, JSON, exit code
- [`reference/mybox-api.md`](reference/mybox-api.md): 구현 endpoint의 공식 계약과 실제 integration 관찰
- [`reference/official-api-audit.md`](reference/official-api-audit.md): 공식 Open API 전체 inventory,
  현재 구현 coverage, 의도적 비범위와 후속 과제
- [`reference/php-implementation-audit.md`](reference/php-implementation-audit.md): PHP SDK/Flysystem
  구현과의 소스 교차 감사, 도입 후보·비도입 항목·후속 검증 순서

### 운영

- [`operations/ubuntu-24.04.md`](operations/ubuntu-24.04.md): Ubuntu Server 24.04 설치, credentials,
  AI 에이전트 subprocess 호출, 업그레이드·rollback
- [`operations/release.md`](operations/release.md): standalone build, draft Release, npm과 Homebrew
  publish 순서 및 rollback
- [`operations/release-v0.2.0-checklist.md`](operations/release-v0.2.0-checklist.md): 첫 공개
  `v0.2.0`을 위한 사용자 실행 순서, 검증 기준과 중단 조건

## 유지 규칙

- `PROGRESS.md`만 phase 상태를 소유한다.
- `HANDOFF.md`는 현재 작업의 사실만 담고 과거 일지는 만들지 않는다. Git history가 과거 기록이다.
- 새로운 API 관찰은 재현 절차와 함께 `reference/mybox-api.md`에 추가한다.
- 공식 API endpoint inventory나 coverage가 바뀌면 `reference/official-api-audit.md`를 갱신한다.
- 기존 설계를 바꾸면 해당 architecture 문서에 이유와 영향을 기록한다.
- phase 범위가 바뀌면 `PLAN.md`, 해당 phase 문서, `PROGRESS.md`를 함께 갱신한다.
