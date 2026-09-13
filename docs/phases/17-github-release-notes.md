# Phase 17 — GitHub Release Notes

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 npm version을 배포할 때 같은 tag의 GitHub Release에
사용자 관점의 간단한 변경 사항을 함께 게시하는 실행 계획과 완료 기준을 정의한다.

## 상태와 진입 조건

- 상태: `complete`
- 활성 phase: 없음 (P17-A–C 및 `v0.4.0` 외부 검증 완료)
- Phase 00~16과 npm `v0.3.2` 배포가 완료된 상태에서 시작했고, `v0.4.0` 배포에서 외부 검증까지 완료했다.
- note 검증, workflow job 분리, 운영 문서와 외부 release 검증을 모두 마쳤다.
- commit/push, tag push와 npm/GitHub publish는 각각 별도 승인 경계를 유지한다.

## 목표

다음 npm release부터 package version, Git tag와 GitHub Release가 같은 version을 가리키고, GitHub
Release 본문에서 주요 변경 사항을 짧게 확인할 수 있게 한다.

자동 생성 내용만 사용하지 않고 release마다 검토한 3~6개 bullet을 source-controlled Markdown으로
관리한다. GitHub가 제공하는 full changelog 링크는 보조 정보로 사용할 수 있다.

## 범위

### 포함

- `docs/releases/vX.Y.Z.md` 형식의 version별 release note
- tag와 note version 일치 검증
- npm publish 성공 이후 GitHub Release를 생성하는 별도 workflow job
- npm publish job과 GitHub Release job의 최소 권한 분리
- 기존 tag만 사용하고 tag를 workflow에서 만들거나 이동하지 않는 정책
- release note 누락, 기존 Release 충돌과 부분 실패의 명시적 처리
- 운영 문서와 정적 workflow 회귀 검증

### 비범위

- standalone archive, checksum 또는 binary asset 첨부
- Homebrew formula 갱신
- package version 자동 결정, 자동 tag 생성 또는 기존 tag 이동
- commit message나 AI 요약만으로 검토 없이 본문 생성
- npm publish 실패 상태에서 GitHub Release 선행 생성

## Release note 계약

- note 파일명은 publish 대상 tag와 정확히 같은 `docs/releases/vX.Y.Z.md`다.
- 본문은 사용자에게 영향을 주는 기능, 수정과 호환성 변경만 3~6개 bullet로 요약한다.
- 내부 refactor, 문서 정리와 dependency 갱신은 사용자 영향이 있을 때만 포함한다.
- PAT, workflow credential, request ID, upload/download URL과 로컬 경로를 넣지 않는다.
- 배포 commit에 note 파일이 없거나 version이 다르면 publish 전에 실패한다.

## Workflow와 권한 경계

현재 `publish-npm.yml`의 tag 입력과 npm Trusted Publishing 흐름은 유지한다.

1. npm publish job은 `contents: read`, `id-token: write`만 사용한다.
2. GitHub Release job은 npm publish job 성공 뒤 실행하며 `contents: write`만 사용한다.
3. Release job은 checkout한 tag의 note 파일을 본문으로 사용하고 같은 tag의 Release를 생성한다.
4. 이미 같은 tag의 Release가 있으면 자동 수정하거나 덮어쓰지 않고 현재 상태를 보고한다.
5. npm publish는 성공했지만 Release 생성만 실패하면 GitHub Actions의 failed-job rerun으로 Release
   job만 재실행한다. 이미 게시된 npm version을 다시 publish하지 않는다.

GitHub Release 생성도 외부 공개 mutation이다. tag와 publish 승인이 없으면 workflow를 실행하지 않는다.

## 구현 순서

### P17-A — note source와 검증

- `docs/releases/`의 파일 형식과 작성 규칙을 정의한다.
- tag에서 note 경로를 결정하고 파일 존재 및 SemVer 일치를 검증하는 작은 script/test를 추가한다.
- 대표 release note fixture로 누락, 잘못된 version과 정상 경로를 검증한다.

### P17-B — workflow 분리

- npm publish와 GitHub Release를 job으로 분리한다.
- job별 최소 permission과 `needs` 순서를 고정한다.
- Release가 npm publish보다 먼저 생성되지 않는지 정적으로 검증한다.

### P17-C — 운영 문서와 실제 release

- `docs/operations/npm-release.md`에 note 작성, tag, publish, failed-job rerun과 확인 절차를 반영한다.
- 다음 승인된 version에서 npm registry와 GitHub Release의 tag/version/body를 확인한다.

## 검증

로컬:

```bash
bun run check
bun run build
bun run verify:release-notes -- --tag vX.Y.Z
git diff --check
```

`bun run check`는 `docs/releases/*.md` 전체와 `publish-npm.yml` 구조를 정적으로 회귀 검증한다.
`verify:release-notes`는 실제 note 파일이 있는 version에서만 통과한다.

외부 release 검증은 `v0.4.0` 배포(2026-09-13)에서 수행했다.

- npm version과 Git tag가 일치한다. `@oliverne/myboxctl@0.4.0`, tag `v0.4.0` → `3838c02`.
- GitHub Release가 같은 tag를 가리킨다. `release` job(run 34758012146)이 생성했고 draft/prerelease가
  아니다.
- 본문이 해당 version의 source-controlled note와 일치한다. `docs/releases/v0.4.0.md`와 Release body가
  같고 차이는 후행 빈 줄 하나뿐이다. workflow 비교는 command substitution을 사용해 후행 개행을
  제거하므로 idempotent 재실행도 성공한다.
- standalone asset은 생성하거나 첨부하지 않는다. asset 0개다.
- registry와 npm provenance attestation(`slsa.dev/provenance/v1`)을 확인했고 `latest`가 `0.4.0`이다.
- publish 성공 직후 약 1–2분간 registry read가 이전 version을 반환했다. publish 직후의 `npm view`
  E404를 publish 실패로 단정하지 않는다.

## 완료 조건

- note 누락과 version 불일치가 publish 전에 차단된다.
- npm job은 OIDC 권한만, Release job은 contents write 권한만 가진다.
- 승인된 실제 version에서 npm publish 뒤 GitHub Release가 생성된다. `v0.4.0`에서 확인했다.
- registry와 GitHub 양쪽의 version 및 본문 확인이 기록된다.
- `PROGRESS.md`와 `HANDOFF.md`가 실제 검증 결과로 갱신된다.
