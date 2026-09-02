# v0.2.0 첫 공개 배포 체크리스트

이 문서는 `myboxctl`의 첫 공개 버전을 `v0.2.0`으로 배포할 때 사용자가 직접 수행할 작업을 순서대로
정리한 how-to guide다. 일반적인 배포 구조와 rollback 정책은 [`release.md`](release.md)를 따른다.

현재 `v0.1.0` tag와 draft Release는 Phase 14 이전 코드로 만들어졌으므로 공개하지 않는다. `v0.2.0`은
현재 `main`에서 새로 build한 artifact와 native smoke 결과만 사용한다.

## 1. 실행 중인 MYBOX acceptance 완료 확인

현재 실행 중인 다음 명령이 끝날 때까지 tag를 만들지 않는다.

```bash
MYBOX_INTEGRATION=1 bun test test/integration
```

확인할 내용:

- 모든 enabled integration test가 통과한다.
- 실패가 `timeout`이나 rate limit 대기 때문이어도 원인을 확인하기 전에는 배포를 진행하지 않는다.
- `/myboxctl-integration-test/` 아래에서 만든 고유 테스트 resource가 cleanup됐는지 확인한다.
- 전체 실행 결과의 pass/skip/fail 수와 소요 시간을 기록한다.

검색 API는 계정 기준 최저 10회/분으로 제한된다. 여러 integration test가 같은 runner에서 공유
limiter를 사용하므로 전체 실행에는 수 분 이상 걸릴 수 있다. limiter를 우회해 테스트 시간을 줄이지
않는다.

## 2. acceptance 결과와 배포 문서 commit

1단계가 끝나면 전체 pass/skip/fail 수, 소요 시간과 cleanup 결과를 `docs/PROGRESS.md`와
`docs/HANDOFF.md`에 반영한다. 현재 체크리스트를 포함한 문서 변경을 검토한 뒤 별도 commit으로
`main`에 push한다.

```bash
git diff -- docs
git status --short
git add docs/operations/release-v0.2.0-checklist.md \
  docs/operations/release.md \
  docs/README.md \
  docs/PROGRESS.md \
  docs/HANDOFF.md
git diff --cached --check
git commit -m "docs: v0.2.0 공개 배포 절차 정리"
git push origin main
```

commit과 push는 문서 내용과 acceptance 결과를 사용자가 확인한 뒤 수행한다. 관련 없는 working tree
변경은 함께 stage하지 않는다.

## 3. 현재 `main`과 기본 검증 확인

```bash
git switch main
git fetch origin
git pull --ff-only origin main
git status --short --branch
bun install --frozen-lockfile
bun run check
bun run build
bun run test:release
git diff --check
```

다음 조건을 모두 만족해야 한다.

- local `main`과 `origin/main`이 같은 commit이다.
- working tree가 깨끗하다.
- `bun run check`, `bun run build`, `bun run test:release`, `git diff --check`가 모두 성공한다.
- 같은 `main` commit의 GitHub `CI` workflow가 성공 상태다.

확인 예시:

```bash
gh run list --repo oliverne/myboxctl --workflow CI --branch main --limit 5
```

루트 `package.json`의 `version: "0.0.0"`과 `private: true`는 개발 package 설정이므로 직접 바꾸지
않는다. Release version과 npm용 package version은 `v0.2.0` tag에서 주입된다.

## 4. 미공개 v0.1.0 draft와 tag 정리

`v0.1.0`은 공개되지 않았고 현재 CLI contract보다 오래된 artifact를 담고 있다. 첫 공개 버전과
혼동되지 않도록 draft와 tag를 제거한다.

먼저 대상을 확인한다.

```bash
gh release view v0.1.0 --repo oliverne/myboxctl
git show --no-patch --decorate v0.1.0
```

확인 후 다음 삭제 작업을 수행한다. 이 작업은 되돌리기 어려우므로 대상이 `v0.1.0`인지 다시 확인한다.

```bash
gh release delete v0.1.0 --repo oliverne/myboxctl --cleanup-tag --yes
git tag -d v0.1.0
```

원격 tag가 별도로 남아 있다면 다음 명령으로 제거한다.

```bash
git push origin :refs/tags/v0.1.0
```

## 5. v0.2.0 tag 생성 및 push

동일한 tag나 Release가 없는지 먼저 확인한다.

```bash
git tag --list v0.2.0
gh release view v0.2.0 --repo oliverne/myboxctl
```

두 항목이 모두 없고 1~3단계가 통과했으면 현재 `main`에 annotated tag를 만든다.

```bash
git tag -a v0.2.0 -m "myboxctl v0.2.0"
git show --no-patch --decorate v0.2.0
git push origin v0.2.0
```

tag push는 `Release` workflow를 시작한다. tag가 잘못된 commit을 가리킨다면 draft를 공개하지 말고
중단한다. 공개된 tag나 artifact를 이동하거나 교체하지 않는다.

## 6. GitHub Release workflow 확인

```bash
gh run list --repo oliverne/myboxctl --workflow Release --limit 5
gh run watch RUN_ID --repo oliverne/myboxctl --exit-status
```

GitHub Actions에서 다음 job을 확인한다.

- `Build release assets`
- `Smoke / bun-darwin-arm64`
- `Smoke / bun-darwin-x64`
- `Smoke / bun-linux-arm64`
- `Smoke / bun-linux-x64`
- `Smoke / bun-windows-x64`
- `Create draft GitHub Release`

로컬에서도 cross-build는 가능하지만 모든 대상 binary를 실제 운영체제와 architecture에서 실행하는
native smoke는 GitHub Actions 결과를 공개 기준으로 사용한다. 하나라도 실패하면 draft를 공개하지
않는다.

## 7. v0.2.0 draft 검수

```bash
gh release view v0.2.0 --repo oliverne/myboxctl
```

draft에 다음 9개 asset이 있어야 한다.

- `myboxctl-v0.2.0-darwin-arm64.tar.gz`
- `myboxctl-v0.2.0-darwin-x64.tar.gz`
- `myboxctl-v0.2.0-linux-arm64.tar.gz`
- `myboxctl-v0.2.0-linux-x64.tar.gz`
- `myboxctl-v0.2.0-windows-x64.zip`
- `SHA256SUMS`
- `install.sh`
- `myboxctl.rb`
- `myboxctl.json`

추가 확인:

- Release 제목과 release notes가 `v0.2.0` 기준이다.
- 5개 archive가 `SHA256SUMS`와 일치한다.
- 각 native smoke에서 `myboxctl --version`이 `0.2.0`을 출력한다.
- `--help`에 `list`, `info`, `mkdir`, `upload`, `download`, `delete`가 노출된다.
- PAT, Authorization header, upload/download URL 또는 signed query가 log와 asset에 없다.

## 8. 저장소 공개 전환

저장소를 공개하기 전에 현재 파일뿐 아니라 Git history에도 credential이 없는지 확인한다. 특히 PAT,
Authorization header, npm token, GitHub token, signed upload/download URL이 없어야 한다.

확인이 끝나면 GitHub 저장소의 **Settings → General → Change repository visibility**에서
`oliverne/myboxctl`을 public으로 전환한다. 공개 전환 직후 README, LICENSE, Actions, draft Release가
의도대로 보이는지 로그아웃 상태 또는 별도 브라우저 세션에서 확인한다.

저장소가 private이면 공개 Release와 package manager 배포를 진행하지 않는다.

## 9. GitHub Release 공개

`v0.2.0` draft의 notes와 9개 asset을 마지막으로 확인한 뒤 GitHub UI에서 **Publish release**를
실행한다. 공개 직후 다음을 확인한다.

```bash
gh release view v0.2.0 --repo oliverne/myboxctl
```

- `isDraft`가 `false`다.
- `v0.2.0`이 latest Release로 표시된다.
- 로그아웃 상태에서 Release와 asset을 내려받을 수 있다.
- `releases/latest/download/install.sh`와 Scoop manifest URL이 접근 가능하다.

공개한 asset은 immutable artifact처럼 취급한다. 문제가 발견되면 asset을 교체하지 말고 수정 후 새
SemVer를 배포한다.

## 10. npm 게시 준비 및 실행

1. npm에서 `@oliverne` scope package를 public으로 게시할 권한을 확인한다.
2. publish에 필요한 최소 권한의 npm token을 만든다.
3. token을 GitHub repository secret으로 등록한다.

```bash
gh secret set NPM_TOKEN --repo oliverne/myboxctl
```

`v0.2.0` Release가 공개 상태일 때 workflow를 실행한다.

```bash
gh workflow run publish-npm.yml --repo oliverne/myboxctl -f tag=v0.2.0
```

workflow가 5개 platform package를 먼저 게시하고 launcher를 마지막에 게시했는지 확인한다. 성공 후 새
환경에서 검증한다.

```bash
npm install --global @oliverne/myboxctl@0.2.0
myboxctl --version
myboxctl --help
```

일부 package만 게시된 상태에서 실패하면 같은 version을 덮어쓰지 않는다. 게시된 package 범위를
확인하고 원인을 수정한 뒤 새 SemVer로 재배포한다.

## 11. Homebrew tap 준비 및 반영

1. public 저장소 `oliverne/homebrew-tap`을 만든다.
2. 기본 branch를 준비한다.
3. 해당 저장소의 contents write만 허용한 fine-grained token을 만든다.
4. token을 GitHub repository secret으로 등록한다.

```bash
gh secret set HOMEBREW_TAP_TOKEN --repo oliverne/myboxctl
```

그다음 workflow를 실행한다.

```bash
gh workflow run publish-homebrew.yml --repo oliverne/myboxctl -f tag=v0.2.0
```

성공 후 새 환경에서 검증한다.

```bash
brew update
brew install oliverne/tap/myboxctl
myboxctl --version
myboxctl --help
```

## 12. Linux installer와 Scoop 검증

Linux 새 환경에서:

```bash
curl -fsSL https://github.com/oliverne/myboxctl/releases/latest/download/install.sh | sh
myboxctl --version
myboxctl --help
```

Windows PowerShell 새 환경에서:

```powershell
scoop install https://github.com/oliverne/myboxctl/releases/latest/download/myboxctl.json
myboxctl --version
myboxctl --help
```

현재 Scoop manifest는 GitHub Release에서 직접 설치할 수 있다. 공식 Scoop bucket 또는 별도 registry
등록은 첫 공개 Release의 필수 조건이 아니며, 필요할 때 별도 작업으로 진행한다.

## 13. 배포 완료 기록

모든 배포 경로의 결과를 확인한 뒤 다음 문서를 실제 결과로 갱신한다.

- [`../PROGRESS.md`](../PROGRESS.md): Release, npm, Homebrew, 설치 smoke의 최종 상태
- [`../HANDOFF.md`](../HANDOFF.md): tag, commit, workflow run, Release URL과 남은 작업
- [`../../README.md`](../../README.md): “첫 공개 Release 전” 안내 제거 및 활성 설치 경로 확인

최종 기록에는 다음 사실을 포함한다.

- `v0.2.0` tag가 가리키는 commit
- CI와 Release workflow run ID 및 결과
- 공개 Release URL과 asset 수
- npm 6개 package의 `0.2.0` 게시 결과
- Homebrew formula commit과 설치 결과
- Linux installer와 Scoop 설치 결과
- 실행하지 않았거나 실패한 검증

## 즉시 중단 조건

다음 중 하나라도 해당하면 이후 publish 단계를 진행하지 않는다.

- MYBOX acceptance, local check, main CI 또는 native smoke 실패
- `v0.2.0` tag가 의도한 `main` commit과 다름
- draft asset 누락 또는 checksum 불일치
- credential이나 signed URL 노출 가능성 발견
- 저장소가 여전히 private
- npm scope 소유권 또는 `NPM_TOKEN` 미확인 상태에서 npm workflow 실행 시도
- Homebrew tap 또는 전용 token 미준비 상태에서 Homebrew workflow 실행 시도
