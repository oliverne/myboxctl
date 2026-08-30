# Current handoff

## 인수 목적

이 문서는 다음 Codex CLI 세션이 Phase 11의 마지막 작업인 **tag 기반 draft GitHub Release 검증**을
바로 이어서 수행하기 위한 실행 기준이다. 현재 기능 구현을 다시 설계하거나 Phase 12를 재작업하지
않는다.

## 저장소 상태

- 저장소: `oliverne/myboxctl` (private)
- 기본 브랜치: `main`
- 마지막 기능 구현 기준점: `a9f0f66552c04bc1f019d0d00f399f2b8ab4d60b`
- 기준점 내용: `feat: implement cross-platform Unicode filename compatibility (#9)`
- 이후 변경: release handoff, README 정리와 pending Phase 13 계획 문서가 존재하며 production code는
  변경하지 않았다.
- 최신 변경은 Phase 13 계획 보완 문서이며 production code는 변경하지 않았다. 작업 시작 시 local/remote
  HEAD와 working tree를 다시 확인한다.
- 원격 브랜치: `main`만 존재
- 열린 PR: 없음
- 열린 issue: 없음
- GitHub Release: 없음
- README 하단 문서 정리를 추가로 진행했으며 production code와 릴리스 상태는 변경하지 않았다.
- 기능 구현 기준 main CI: run 33244880883 (CI 97), 성공
- 최신 문서 커밋의 CI는 작업 시작 시 성공 여부를 다시 확인
- 공개 릴리스: 보류

작업 시작 시 `origin/main`의 최신 HEAD와 CI를 다시 확인한다. 위 기능 구현 기준점 이후에 문서 변경만
존재하는 것은 정상이다. 다른 코드 변경, PR, tag 또는 Release가 있으면 내용을 대조한 뒤 진행한다.

## Phase 상태

- Phase 00~10: `complete`
- Phase 11 Distribution & Release: `in_progress`
- Phase 12 Cross-platform Unicode filenames: `complete`
- Phase 13 Observability & test latency: `pending`
- 활성 phase: `11-distribution-release`

Phase 11의 코드, 5개 standalone target, checksum, installer, Homebrew formula, Scoop manifest, npm
optional platform package 생성과 native smoke는 완료했다. 남은 완료 조건은 실제 `v*` tag workflow가
draft Release를 만들고 asset을 재실행 가능하게 업로드하는지 확인하는 것이다.

Phase 12는 CI 90, Release 21과 실제 MYBOX targeted probe run 33244082095를 통과했다. 새 원격 이름은
NFC로 생성하고, 기존 NFD resource는 canonical fallback으로 찾으며, canonical-equivalent 후보가
여러 개이면 mutation 없이 `UNICODE_NAME_COLLISION`로 중단한다. 로컬 `localPath`는 정규화하지
않는다.

Phase 13 계획은 integration 지연을 local limiter, 서버 429 retry와 polling으로 구분해 계측하고,
관측 결과로 GET 429 정책을 유지·조정·fail-fast 중 하나로 결정한다. 별도 format option 없이 기본
모드는 사람이 읽는 stdout 성공 결과와 stderr 오류/event를, `--json`은 stdout의 단일 최종 envelope와
stderr JSON Lines event를 사용한다. `--quiet`는 event만 억제하고 최종 오류는 유지한다. upload/put byte
progress도 같은 event boundary에 포함한다. 로컬 `my-cli` prototype의 실제 non-TTY capture를 조사해
TTY에서만 redraw/countdown을 사용하고, non-TTY에는 line log만 남기며 범용 UI dependency는 추가하지
않는 것으로 계획했다. Phase 13은 아직 시작하지 않았고 live probe도 실행하지 않았다.

Phase 13을 먼저 시작하려면 Phase 11과 동시에 `in_progress`로 두지 말고 사용자가 활성 phase 변경을
명시한 뒤 `docs/PROGRESS.md`를 갱신한다.

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
- 로컬 `main` HEAD가 최신 `origin/main`과 일치한다.
- 최신 `origin/main`이 위 기능 구현 기준점을 포함하고 최신 main CI가 성공했다.
- `v0.1.0` tag와 같은 이름의 Release가 아직 없다.
- 새 PR이나 계획되지 않은 변경이 없다.

`v0.1.0` tag 또는 Release가 이미 있으면 다시 만들거나 tag를 이동하지 말고 기존 workflow와
Release 상태부터 조사한다.

### 2. tag 생성 및 push

```bash
git tag -a v0.1.0 -m "myboxctl v0.1.0"
git push origin v0.1.0
```

tag는 검증 뒤에도 이동하거나 덮어쓰지 않는다. tag 대상은 pull과 CI 확인을 마친 최신
`origin/main` HEAD여야 한다.

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
- `docs/phases/13-observability-and-test-latency.md`
- `docs/reference/test-latency-investigation.md`
- `docs/reference/human-cli-ui-investigation.md`
- `docs/operations/release.md`
- `docs/reference/cli-contract.md`
