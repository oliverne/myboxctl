# npm 배포

이 문서는 `@oliverne/myboxctl`을 npm에 배포하는 절차다. 배포 대상은 Node.js 20 이상에서
실행되는 npm package이며 GitHub Release, standalone 실행파일, Homebrew와 Scoop은 사용하지 않는다.

GitHub Actions 배포 인증은 npm Trusted Publishing(OIDC)을 사용한다. 따라서 배포 workflow에는
장기 보관하는 `NPM_TOKEN`이 없고, npm CLI가 GitHub Actions의 단기 OIDC 자격 증명을 사용한다.
Trusted Publishing에는 Node.js 22.14.0 이상과 npm CLI 11.5.1 이상이 필요하며, 이 저장소의
publish workflow는 Node.js 24를 사용한다.

현재 npm `latest`는 `v0.3.2`다. 첫 OIDC 배포와 registry/provenance 및 설치 smoke, 기존 token 폐기를
완료했다 (2026-09-13 사용자 확인). 아래 명령은 다음 미게시 version을
선택해 실행하는 형식 예시다. 실제 배포 때는 게시되지 않은 version을 선택하며 기존 tag를 이동하지 않는다.

## 1. npm 계정과 scope 확인

1. <https://www.npmjs.com/>에 로그인하고 계정에 2단계 인증을 설정한다.
2. npm 사용자명 또는 조직 `oliverne`에 `@oliverne/myboxctl`을 공개할 권한이 있는지 확인한다.
3. package 설정의 **Trusted Publisher**에서 **GitHub Actions**를 추가한다.
   - Organization or user: `oliverne`
   - Repository: `myboxctl`
   - Workflow filename: `publish-npm.yml`
   - Environment name: 비워 둠
   - Allowed actions: 직접 배포를 위해 `npm publish` 허용

workflow 파일명은 `.github/workflows/`를 제외한 정확한 파일명이어야 한다. 저장소, 사용자/조직,
workflow 파일명과 선택한 environment가 실제 실행과 하나라도 다르면 npm이 publish를 거부한다.
Trusted Publisher 등록은 npm 웹사이트의 **Packages → @oliverne/myboxctl → Settings → Trusted
Publishing**에서 수행한다.

계정 또는 scope 소유권이 다르면 여기서 중단한다. package 이름이나 scope를 즉석에서 바꾸지 않는다.

## 2. 배포 commit 검증

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

## 3. tag 생성

기존 tag는 이력으로 유지하고 이동하거나 덮어쓰지 않는다.

```bash
release_version=0.3.2
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git tag -a "v${release_version}" -m "myboxctl v${release_version}"
git push origin "v${release_version}"
git ls-remote --tags origin "v${release_version}"
```

로컬과 원격 tag가 배포 commit을 가리키는지 확인한다. 잘못된 commit에 tag를 붙였다면 publish하지 말고
새 버전 번호를 사용한다.

## 4. npm publish workflow 실행

```bash
release_version=0.3.2
gh workflow run publish-npm.yml \
  --repo oliverne/myboxctl \
  -f tag="v${release_version}"

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
`npm pack --dry-run` 검증 후 `npm publish --access public`을 실행한다. `id-token: write` 권한과
Trusted Publisher 설정이 OIDC 인증에 사용되며 `NPM_TOKEN`, `NODE_AUTH_TOKEN`, 임시 `.npmrc`는
필요하지 않다. GitHub Actions에서 OIDC로 publish하면 npm이 provenance attestation도 자동 생성하므로
별도의 `--provenance` 플래그를 추가하지 않는다.

실패한 workflow를 원인 확인 없이 반복 실행하지 않는다. 동일한 version이 이미 게시됐다면 npm에서
덮어쓸 수 없으므로 새 patch version이 필요하다. `ENEEDAUTH` 또는 `E404`가 발생하면 먼저
Trusted Publisher의 repository, workflow filename, environment와 workflow의 `id-token: write`를
대조한다.

## 5. registry 설치 smoke

registry 전파 후 다음 결과를 확인한다.

```bash
release_version=0.3.2
npm view "@oliverne/myboxctl@${release_version}" version dist-tags.latest
npx --yes "@oliverne/myboxctl@${release_version}" --version
npx --yes "@oliverne/myboxctl@${release_version}"
npx --yes "@oliverne/myboxctl@${release_version}" --help
npx --yes "@oliverne/myboxctl@${release_version}" --version | wc -l
```

통과 기준:

- `version`과 `latest`가 선택한 version과 같다.
- `--version`이 선택한 version을 정확히 한 줄 출력하고 exit 0이다.
- 인자 없는 실행이 root help를 stdout에 출력하고 exit 0이다.
- `--help`에 canonical command `list`, `info`, `mkdir`, `upload`, `download`, `delete`가 보인다.

실사용 설치는 다음과 같다.

```bash
npm install -g "@oliverne/myboxctl@${release_version}"
myboxctl --version
```

## 6. 기존 token 폐기

`v0.3.2` 첫 OIDC publish와 registry smoke 확인 뒤 기존 npm publish token과 GitHub `NPM_TOKEN`
secret을 폐기했다 (2026-09-13 사용자 확인). 아래 절차는 향후 credential 전환 시의 안전 순서다.

OIDC publish가 실제로 한 번 성공하고 registry smoke까지 확인된 뒤에만 기존 publish token을 폐기한다.
먼저 npm의 **Access Tokens**에서 해당 granular token을 revoke한 다음, 남아 있다면 GitHub repository
secret도 삭제한다.

```bash
gh secret delete NPM_TOKEN --repo oliverne/myboxctl
```

이 저장소의 publish workflow에는 더 이상 `NPM_TOKEN`을 참조하는 코드가 없으므로, Trusted Publisher
등록과 첫 OIDC publish가 확인되기 전에는 secret을 먼저 삭제하지 않는다.

## 참고

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements/)
