# Release 운영

Phase 11의 배포는 하나의 tag와 standalone binary set을 기준으로 한다. GitHub Release, npm,
Homebrew, Linux installer와 Scoop이 서로 다른 build를 만들지 않는다.

## 공개 전 조건

- `main`의 일반 CI와 Phase 11 release smoke가 통과해야 한다.
- 저장소를 public으로 전환하고 공개 코드와 문서에 secret이 없는지 다시 확인한다.
- npm의 `@oliverne` scope에 package를 게시할 권한을 확인한다.
- `oliverne/homebrew-tap` 저장소와 `Formula/` 디렉터리를 준비한다.
- repository secret `NPM_TOKEN`과 `HOMEBREW_TAP_TOKEN`은 각각 필요한 최소 권한만 부여한다.
- MYBOX PAT는 release, npm, Homebrew workflow에 전달하지 않는다.

저장소가 private인 동안에는 GitHub artifact attestation과 공개 package 설치를 완료 조건으로 취급하지
않는다.

## 첫 Release

1. SemVer를 정하고 `main`에서 annotated tag를 만든다.
2. tag를 push하면 `Release` workflow가 5개 target을 build한다.
3. macOS arm64/x64, Linux arm64/x64, Windows x64 runner의 `--version`/`--help` smoke를 확인한다.
4. workflow가 만든 draft GitHub Release에서 archive, `SHA256SUMS`, `install.sh`,
   `myboxctl.rb`, `myboxctl.json`을 확인한다.
5. draft를 공개한다.
6. `Publish npm packages` workflow에 같은 tag를 입력한다.
7. `Update Homebrew tap` workflow에 같은 tag를 입력한다.
8. 새 환경에서 Homebrew, npm, Linux installer와 Scoop 설치를 각각 확인한다.

```bash
git tag -a v0.1.0 -m "myboxctl v0.1.0"
git push origin v0.1.0
```

Release workflow는 draft를 자동으로 공개하지 않는다. 동일 tag의 workflow를 다시 실행하면 기존 draft
asset을 `--clobber`로 교체하지만, 이미 사용자에게 공개한 Release asset을 임의로 다시 build해
교체하지 않는다.

## npm

npm workflow는 공개 Release의 archive를 다시 내려받아 checksum을 검증한 뒤 다음 순서로 게시한다.

1. `@oliverne/myboxctl-darwin-arm64`
2. `@oliverne/myboxctl-darwin-x64`
3. `@oliverne/myboxctl-linux-arm64`
4. `@oliverne/myboxctl-linux-x64`
5. `@oliverne/myboxctl-windows-x64`
6. `@oliverne/myboxctl` launcher

launcher를 마지막에 게시하므로 지원 platform package가 없는 짧은 불완전 상태를 만들지 않는다.
부분 게시 실패 시 이미 게시한 동일 version을 덮어쓰지 말고, 원인을 수정한 뒤 아직 없는 package만
확인하여 새 SemVer로 재배포한다.

## Homebrew

`Update Homebrew tap` workflow는 공개 Release의 `myboxctl.rb`를
`oliverne/homebrew-tap/Formula/myboxctl.rb`에 commit한다. tap 전용 token에는 해당 저장소의 contents
write만 부여한다.

```bash
brew update
brew install oliverne/tap/myboxctl
myboxctl --version
```

## rollback

GitHub Release asset은 immutable artifact처럼 취급한다. 문제가 있으면 기존 asset을 교체하기보다 수정
버전을 새 tag로 배포한다. npm은 게시 version을 재사용하지 않으며 Homebrew formula는 새 정상 version
또는 이전 정상 version의 URL/checksum으로 명시적으로 되돌린다.
