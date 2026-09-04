# npm 배포

이 문서는 `@oliverne/myboxctl`을 npm에 배포하는 절차다. 배포 대상은 Node.js 20 이상에서
실행되는 npm package이며 GitHub Release, standalone 실행파일, Homebrew와 Scoop은 사용하지 않는다.

현재 `v0.2.2`가 게시되어 있고 root help 수정의 다음 후보는 `v0.2.3`이다. npm에 게시된 version은
덮어쓸 수 없으므로 기존 tag를 이동하지 않는다.

## 1. npm 계정과 scope 확인

1. <https://www.npmjs.com/>에 로그인하고 계정에 2단계 인증을 설정한다.
2. npm 사용자명 또는 조직 `oliverne`에 `@oliverne/myboxctl`을 공개할 권한이 있는지 확인한다.
3. 로컬에서 로그인 계정을 확인한다.

```bash
npm whoami
```

계정 또는 scope 소유권이 다르면 여기서 중단한다. package 이름이나 scope를 즉석에서 바꾸지 않는다.

## 2. publish token 확인

GitHub Actions가 아직 trusted publishing을 사용하지 않는다면 granular access token이 필요하다. 기존
`NPM_TOKEN`이 유효하면 새 token을 만들지 않고 secret 존재만 확인한다.

1. npm 웹사이트의 프로필 메뉴에서 **Access Tokens**를 연다.
2. **Generate New Token**을 선택한다.
3. 다음과 같이 제한한다.
   - 이름: `myboxctl-github-actions-publish`
   - package/scope 권한: `@oliverne`에 `Read and write`
   - 2FA 우회: 비대화형 GitHub Actions publish를 위해 활성화
   - 만료일: 배포와 OIDC 전환에 필요한 가장 짧은 기간
   - Allowed IP ranges: GitHub-hosted runner의 주소가 고정되지 않으므로 비워 둠
4. token을 생성하고 즉시 복사한다. 전체 token은 생성 직후에만 표시된다.

token을 shell 인자, 파일, Git history 또는 채팅에 남기지 않는다. GitHub CLI의 보안 입력으로 repository
secret을 만든다.

```bash
gh secret set NPM_TOKEN --repo oliverne/myboxctl
```

프롬프트가 나타나면 token을 붙여 넣고 입력을 종료한다. 값 자체는 다시 출력하지 않고 secret 이름만
확인한다.

```bash
gh secret list --repo oliverne/myboxctl
```

`NPM_TOKEN`이 없으면 publish를 시작하지 않는다.

## 3. 배포 commit 검증

배포 수정이 commit되어 `origin/main`에 push되고 CI가 성공한 뒤 진행한다.

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short
bun install --frozen-lockfile
bun run check
bun run build
```

통과 기준:

- `git status --short` 출력이 없다.
- `bun run check`와 `bun run build`가 exit 0이다.
- 최신 `main` CI의 `Bun 1.4 / Ubuntu 24.04` 및 세 운영체제 download job이 모두 성공했다.

하나라도 실패하면 tag를 생성하지 않는다.

## 4. `v0.2.3` tag 생성

기존 tag는 이력으로 유지하고 이동하거나 덮어쓰지 않는다.

```bash
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git tag -a v0.2.3 -m "myboxctl v0.2.3"
git push origin v0.2.3
git ls-remote --tags origin v0.2.3
```

로컬과 원격 tag가 배포 commit을 가리키는지 확인한다. 잘못된 commit에 tag를 붙였다면 publish하지 말고
새 버전 번호를 사용한다.

## 5. npm publish workflow 실행

```bash
gh workflow run publish-npm.yml \
  --repo oliverne/myboxctl \
  -f tag=v0.2.3

gh run list \
  --repo oliverne/myboxctl \
  --workflow publish-npm.yml \
  --limit 1
```

출력에서 run ID를 확인한 다음 완료될 때까지 감시한다.

```bash
gh run watch <RUN_ID> --repo oliverne/myboxctl --exit-status
```

workflow는 tag checkout, 일반 검사, Node bundle 생성, package 준비, `--version`/`--help` 및
`npm pack --dry-run` 검증 후 `npm publish --access public`을 실행한다. 실패한 workflow를 원인 확인 없이
반복 실행하지 않는다. 동일한 version이 이미 게시됐다면 npm에서 덮어쓸 수 없으므로 새 patch version이
필요하다.

## 6. registry 설치 smoke

registry 전파 후 다음 결과를 확인한다.

```bash
npm view @oliverne/myboxctl@0.2.3 version dist-tags.latest
npx --yes @oliverne/myboxctl@0.2.3 --version
npx --yes @oliverne/myboxctl@0.2.3
npx --yes @oliverne/myboxctl@0.2.3 --help
npx --yes @oliverne/myboxctl@0.2.3 --version | wc -l
```

통과 기준:

- `version`과 `latest`가 모두 `0.2.3`이다.
- `--version`이 `0.2.3`을 정확히 한 줄 출력하고 exit 0이다.
- 인자 없는 실행이 root help를 stdout에 출력하고 exit 0이다.
- `--help`에 canonical command `list`, `info`, `mkdir`, `upload`, `download`, `delete`가 보인다.

실사용 설치는 다음과 같다.

```bash
npm install -g @oliverne/myboxctl@0.2.3
myboxctl --version
```

## 7. trusted publishing 전환 후 token 폐기

npm package 설정에서 GitHub Actions trusted publisher를 구성한다.

- GitHub 사용자/조직: `oliverne`
- Repository: `myboxctl`
- Workflow filename: `publish-npm.yml`
- Allowed action: `npm publish`

workflow를 OIDC 방식으로 전환하고 검증한 뒤 `NPM_TOKEN`을 npm과 GitHub 양쪽에서
폐기한다. OIDC 전환은 별도 변경으로 진행하며, token이 필요한 현재 workflow에서 secret부터 삭제하지
않는다.

## 참고

- [npm granular access token 생성](https://docs.npmjs.com/creating-and-viewing-access-tokens/)
- [npm package publish의 2FA 요구사항](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
