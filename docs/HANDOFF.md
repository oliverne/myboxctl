# Current handoff

## 인수 목적

이 문서는 다음 Codex CLI 세션이 Phase 11의 마지막 작업인 **tag 기반 draft GitHub Release 검증**을
바로 이어서 수행하기 위한 실행 기준이다. 현재 기능 구현을 다시 설계하거나 Phase 12를 재작업하지
않는다.

## 저장소 상태

- 저장소: `oliverne/myboxctl` (private)
- 기본 브랜치: `main`
- 현재 `main` HEAD: `a9f0f66552c04bc1f019d0d00f399f2b8ab4d60b`
- HEAD 내용: `feat: implement cross-platform Unicode filename compatibility (#9)`
- 원격 브랜치: `main`만 존재
- 열린 PR: 없음
- 열린 issue: 없음
- GitHub Release: 없음
- 최신 main CI: run 33244880883 (CI 97), 성공
- 공개 릴리스: 보류

작업 시작 시 원격 상태가 바뀌었는지 먼저 확인한다. 위 HEAD와 다르면 새 커밋, PR, tag, Release와
문서를 대조한 뒤 이 문서를 현재 사실에 맞게 갱신한다.

## Phase 상태

- Phase 00~10: `complete`
- Phase 11 Distribution & Release: `in_progress`
- Phase 12 Cross-platform Unicode filenames: `complete`
- 활성 phase: `11-distribution-release`

Phase 11의 코드, 5개 standalone target, checksum, installer, Homebrew formula, Scoop manifest, npm
optional platform package 생성과 native smoke는 완료했다. 남은 완료 조건은 실제 `v*` tag workflow가
draft Release를 만들고 asset을 재실행 가능하게 업로드하는지 확인하는 것이다.

Phase 12는 CI 90, Release 21과 실제 MYBOX targeted probe run 33244082095를 통과했다. 새 원격 이름은
NFC로 생성하고, 기존 NFD resource는 canonical fallback으로 찾으며, canonical-equivalent 후보가
여러 개이면 mutation 없이 `UNICODE_NAME_COLLISION`로 중단한다. 로컬 `localPath`는 정규화하지
않는다.

## 이번 세션의 목표

현재 `main`에 annotated tag `v0.1.0`을 생성해 Release workflow를 실행하고, 생성된 draft Release와
asset 재업로드 계약을 검증한다. 성공하면 Phase 11 문서를 완료 상태로 갱신하고 일반 PR 절차로
병합한 뒤 작업 브랜치를 정리한다.

## 실행 순서

### 1. 시작 상태 확인

```bash
git switch main
git pull --ff-only
git status --short
git rev-parse HEAD
git branch -r
gh pr list --state open
gh issue list --state open
gh release list
git tag --list 'v*'
```

필수 조건:

- working tree가 깨끗하다.
- `main` HEAD가 원격 `main`과 일치한다.
- `v0.1.0` tag와 같은 이름의 Release가 아직 없다.
- 새 PR이나 계획되지 않은 변경이 없다.

`v0.1.0` tag 또는 Release가 이미 있으면 다시 만들거나 tag를 이동하지 말고 기존 workflow와
Release 상태부터 조사한다.

### 2. tag 생성 및 push

```bash
git tag -a v0.1.0 -m "myboxctl v0.1.0"
git push origin v0.1.0
```

tag는 검증 뒤에도 이동하거나 덮어쓰지 않는다. tag 대상은 검증한 `main` HEAD여야 한다.

### 3. Release workflow 확인

tag push로 시작된 Release workflow를 찾아 완료까지 확인한다.

```bash
gh run list --workflow Release --limit 10
gh run watch <run-id> --exit-status
```

workflow 이름이 다르면 `.github/workflows/release.yml`의 실제 이름을 기준으로 조회한다. 실패하면
job log와 artifact를 확인하고 원인을 문서화한다. secret이나 signed URL을 출력하지 않는다.

### 4. draft Release 및 asset 검증

```bash
gh release view v0.1.0 --json isDraft,isPrerelease,tagName,targetCommitish,assets,url
```

다음을 확인한다.

- Release가 `draft`이며 자동 공개되지 않았다.
- tag가 검증한 `main` commit을 가리킨다.
- macOS arm64/x64, Linux glibc arm64/x64, Windows x64 archive가 모두 있다.
- `SHA256SUMS`, `install.sh`, `myboxctl.rb`, `myboxctl.json`이 있다.
- workflow의 5개 native runner에서 checksum, `--version`, `--help` smoke가 성공했다.
- version 출력이 `0.1.0`과 일치한다.
- Release asset과 로그에 PAT, Authorization header, signed upload/download URL이 없다.

### 5. draft asset 재실행 검증

성공한 동일 Release workflow를 GitHub Actions의 rerun 기능으로 한 번 다시 실행한다. rerun이 기존
draft Release를 중복 생성하지 않고 같은 tag의 asset을 `--clobber` 방식으로 안전하게 교체하는지
확인한다.

이미 공개된 Release에는 이 검증을 수행하지 않는다. workflow가 draft가 아닌 Release를 만들었다면
즉시 중단하고 상태만 보고한다.

### 6. Phase 11 완료 문서 PR

검증이 모두 성공하면 새 문서 브랜치를 만들고 최소한 다음 파일을 실제 run ID와 Release URL에 맞춰
갱신한다.

- `docs/phases/11-distribution-release.md`
- `docs/PROGRESS.md`
- `docs/HANDOFF.md`

Phase 11의 마지막 미완료 checkbox를 완료하고 상태를 `complete`로 바꾼다. public Release, npm
publish, Homebrew tap 반영은 완료했다고 쓰지 않는다.

문서 검증 후 PR을 생성하고 CI 성공을 확인해 병합한다. 병합 후 원격 작업 브랜치를 삭제하고
`main`만 남긴다.

## 완료 조건

- [ ] `v0.1.0` annotated tag가 검증한 `main` HEAD를 가리킨다.
- [ ] tag 기반 Release workflow가 성공한다.
- [ ] draft Release가 생성되고 필요한 asset이 모두 존재한다.
- [ ] 5개 native executable smoke가 성공한다.
- [ ] workflow rerun이 동일 draft의 asset을 안전하게 갱신한다.
- [ ] Phase 11 관련 문서가 실제 증거와 일치한다.
- [ ] 문서 PR의 CI가 성공하고 `main`에 병합된다.
- [ ] 작업 브랜치와 열린 PR이 남지 않는다.

## 명시적 중단 경계

다음 작업은 사용자의 별도 승인 없이는 수행하지 않는다.

- draft Release 공개
- 저장소 public 전환
- npm package publish
- `oliverne/homebrew-tap` 생성 또는 갱신
- Scoop registry 등록
- `NPM_TOKEN`, `HOMEBREW_TAP_TOKEN` 등 credential 구성
- 기존 tag 이동, 삭제 또는 동일 version의 공개 asset 교체
- MYBOX PAT가 필요한 live test 재실행

Release workflow나 asset 검증이 실패해 코드 수정이 필요하면 기존 `v0.1.0` tag를 이동하지 않는다.
실패 원인과 tag 상태를 기록하고, 수정 PR과 다음 SemVer 전략은 사용자에게 보고한 뒤 결정한다.

## 참고 문서

- `PLAN.md`
- `docs/PROGRESS.md`
- `docs/phases/11-distribution-release.md`
- `docs/phases/12-cross-platform-unicode-filenames.md`
- `docs/operations/release.md`
- `docs/reference/cli-contract.md`
