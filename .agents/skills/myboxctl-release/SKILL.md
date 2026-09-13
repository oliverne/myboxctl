---
name: myboxctl-release
description: Release @oliverne/myboxctl to npm and GitHub through the OIDC publish workflow. Use when a task is to publish or deploy a new myboxctl version, choose or bump a version, write or fix docs/releases/vX.Y.Z.md notes, create a vX.Y.Z tag, run .github/workflows/publish-npm.yml, verify a published version in the registry or GitHub Releases, or diagnose a failed or half-finished publish.
---

# myboxctl release

`@oliverne/myboxctl`은 npm 단독 배포다. `publish-npm.yml`(workflow_dispatch, 입력 `tag`)이 npm publish와
같은 tag의 GitHub Release를 함께 만든다. 인증은 npm Trusted Publishing(OIDC)이라 CI에도 로컬에도 npm
token이 없다. 로컬 `npm publish`는 시도하지 않는다 — `ENEEDAUTH`로 실패하는 것이 정상이다.

정식 절차는 [`docs/operations/npm-release.md`](../../../docs/operations/npm-release.md)에 있다. 이 skill은
그 절차를 실행할 때의 판단 기준과, 실제로 실패하기 쉬운 지점을 담는다.

## 승인 경계

commit, push, tag, workflow dispatch와 Release 생성은 서로 다른 승인 범위다. 사용자가 "배포"라고 하면
배포에 필요한 범위를 승인한 것으로 보고 순서대로 진행하되, 각 단계의 검증이 실패하면 다음 단계로
넘어가지 않고 멈춘다. push 전에 push할 commit 목록을 확인하고, tag는 `HEAD`와 `origin/main`이 같을
때만 만든다.

## 1. 시작 전 확인

```bash
git fetch origin && git switch main && git pull --ff-only origin main
git status --short           # 비어 있어야 한다
bun install --frozen-lockfile
bun run check && bun run build
gh auth status
npm view @oliverne/myboxctl dist-tags.latest
git tag --sort=-creatordate | head -3   # 기존 tag와 version 선택 기준
gh release list --repo oliverne/myboxctl --limit 5
```

`bun run check`는 typecheck·lint·build·test를 모두 포함한다. 실패하면 tag를 만들지 않는다.
`gh release list`에는 이전 version의 Release만 있고, Release는 publish workflow만 만든다. 사람이 직접
`gh release create`하지 않는다.

## 2. version 선택

npm `latest`가 기준선이고 `git tag --sort=-creatordate | head -3`이 로컬 tag 기준선이다. 기존 tag는
이동하거나 덮어쓰지 않는다.

- 새 command나 option 같은 사용자 기능 추가: minor (`0.4.0` → `0.5.0`)
- 버그 수정과 내부 변경만: patch
- 이미 게시된 version은 npm에서 덮어쓸 수 없다. 실수로 게시했다면 patch를 올린다.

tag는 `vX.Y.Z`만 지원한다(prerelease와 build metadata 미지원). `docs/releases/vX.Y.Z.md`의 파일명이
tag와 정확히 같아야 하고, 다르면 workflow가 publish 전에 실패한다.

## 3. release note 작성

`docs/releases/vX.Y.Z.md`에 사용자 영향만 3~6 bullet로 적는다. 규칙은
[`docs/releases/README.md`](../../../docs/releases/README.md)에 있다.

독자는 내부 구현을 모르는 CLI 사용자다. 한 bullet에 한 주제만 담고, 무엇이 가능해졌는지 먼저 말한다.
내부 식별자(`resourceId`), 구현 메커니즘(canonical spelling, reconcile), exit code 표는 넣지 않는다.
사용자가 실제로 조치해야 하는 제약(예: "destination이 이미 존재해야 합니다")은 평범한 문장으로 남긴다.

- 복잡한 예: `새 rename <remote-path> <new-name> command로 같은 folder 안에서 file 또는 folder의 이름을 바꿀 수 있다.`
- 사용자 관점 예: `이제 myboxctl rename <remote-path> <new-name>으로 원격 파일과 폴더의 이름을 바꿀 수 있습니다.`

내부 refactor, 문서 정리, dependency 갱신은 사용자 영향이 있을 때만 적는다. PAT, credential, request ID,
signed URL, 로컬 절대 경로는 넣지 않는다.

**이미 배포된 note는 수정하지 않는다.** Release 본문과 note가 달라지면 workflow의 idempotent 비교가
실패해 `release` job 재실행이 막힌다. 오타가 보여도 다음 version에서 고친다.

```bash
bun run verify:release-notes -- --tag vX.Y.Z
```

## 4. commit, push, CI

note를 배포 commit에 포함하고 함께 `docs/PROGRESS.md`와 `docs/HANDOFF.md`를 갱신한다. push한 뒤 CI가
끝날 때까지 기다린다.

```bash
git commit -m "docs: add vX.Y.Z release notes"
git push origin main
gh run list --repo oliverne/myboxctl --workflow CI --limit 1 \
  --json databaseId,headSha,conclusion --jq '.[0]'
```

최신 run의 `headSha`가 push한 commit이고 `conclusion`이 `success`여야 한다.

## 5. tag

```bash
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git tag -a vX.Y.Z -m "myboxctl vX.Y.Z"
git push origin vX.Y.Z
git ls-remote --tags origin vX.Y.Z   # tag가 배포 commit을 가리키는지 확인
```

## 6. publish workflow 실행

```bash
gh workflow run publish-npm.yml --repo oliverne/myboxctl -f tag=vX.Y.Z
gh run list --repo oliverne/myboxctl --workflow publish-npm.yml --limit 1 --json databaseId
gh run watch <RUN_ID> --repo oliverne/myboxctl --exit-status
```

`publish` job(note 검증 → check → build → package 검증 → npm publish)과 `release` job(GitHub Release)이
순서대로 실행된다. `release`는 npm publish가 성공한 뒤에만 시작된다.

## 7. registry 전파 대기

npm이 publish를 받아도 registry read가 즉시 바뀌지 않는다. `v0.4.0`에서는 약 1–2분 동안 이전 version이
보였고, 새 version은 `E404`였다. **이 지연을 publish 실패로 단정하지 않는다.** workflow 로그의
`+ @oliverne/myboxctl@X.Y.Z` 줄과 job success를 먼저 확인하고, `dist-tags.latest`를 반영될 때까지
재조회한다.

## 8. 배포 검증

```bash
V=0.5.0
npm view "@oliverne/myboxctl@$V" version dist-tags.latest
npm view "@oliverne/myboxctl@$V" dist.attestations --json | head
npx --yes "@oliverne/myboxctl@$V" --version | wc -l        # 정확히 한 줄
npx --yes "@oliverne/myboxctl@$V" --help                   # exit 0, canonical command 노출
gh release view "v$V" --repo oliverne/myboxctl \
  --json tagName,isDraft,isPrerelease,body,assets
```

- provenance attestation(`slsa.dev/provenance/v1`)이 있어야 한다. OIDC 배포의 증거다.
- Release의 `body`는 note와 같다. GitHub API가 끝에 빈 줄을 하나 더하므로 후행 개행 차이는 정상이다.
- asset은 0개여야 한다. standalone 배포는 폐기했다.
- 전역 설치 스모크는 사용자 환경을 바꾸지 않도록 임시 prefix를 쓴다.

```bash
npm install -g --prefix /tmp/myboxctl-smoke "@oliverne/myboxctl@$V"
/tmp/myboxctl-smoke/bin/myboxctl --version
rm -rf /tmp/myboxctl-smoke
```

## 9. 문서 갱신

`docs/PROGRESS.md`의 최신 배포 검증과 phase 상태, `docs/HANDOFF.md`의 현재 배포·publish 증거를 사실만
적는다. run ID, tag → commit, registry 결과, Release 확인, smoke 결과를 남기면 다음 사람이 재검증 없이
상태를 신뢰할 수 있다.

## 실패 대응

- **publish 성공, Release 실패**: Actions에서 **Re-run failed jobs**로 `release` job만 재실행한다. 이미
  게시된 version은 다시 publish하지 않는다.
- **같은 version이 이미 게시됨**: npm은 덮어쓰기를 허용하지 않는다. patch version으로 새로 진행한다.
- **publish job의 `ENEEDAUTH`/`E404`**: Trusted Publisher 설정(organization, repository, workflow
  filename, environment)과 workflow의 `id-token: write`를 대조한다. 로컬 token을 만들지 않는다.
- **Release가 이미 존재하고 본문이 다름**: workflow는 덮어쓰지 않고 실패한다. 임의로 수정하거나
  삭제하지 말고 사용자와 상의한다.
- **잘못된 commit에 tag를 붙임**: 그 tag로 publish하지 않는다. tag를 옮기지 않고 새 version을 쓴다.

## 보고

결과는 단계별 증거와 함께 보고한다: CI run ID, tag → commit, publish run ID와 job 결과, registry
`version`/`latest`와 provenance, Release 상태와 본문 일치, 설치 smoke. secret은 어떤 형태로도 출력하지
않는다.
