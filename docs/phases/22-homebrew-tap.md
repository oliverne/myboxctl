# Phase 22 — Homebrew Tap

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 standalone binary를 부활시키지 않고 현재 npm package를
Homebrew formula로 설치하는 배포 경로의 계획과 완료 기준을 정의한다.

## 상태와 진입 조건

- 상태: `pending`
- 활성 phase: 없음
- Phase 21 완료 후 시작한다.
- 구현을 시작할 때 `docs/PROGRESS.md`에서 Phase 22만 `in_progress`로 변경한다.
- npm registry package와 실제 tap repository의 소유권 및 쓰기 권한을 확인한다.
- tap 생성/변경, commit, push와 공개 배포는 각각 별도 승인 범위다.

## 목표

Node.js 의존을 허용하는 사용자가 다음 명령으로 npm에 게시된 동일한 `myboxctl` package를 설치할 수
있게 한다.

```bash
brew install oliverne/tap/myboxctl
myboxctl --version
```

Homebrew는 별도 product artifact를 빌드하지 않고 npm tarball을 source of truth로 사용한다.

## 배포 계약

- tap은 `oliverne/homebrew-tap`, formula는 `myboxctl`을 기준으로 계획한다.
- stable npm registry tarball URL과 SHA-256 및 필요한 dependency resource를 version별로 고정한다.
- formula는 `depends_on "node"`와 Homebrew의 `std_npm_args`를 사용해 `libexec`에 설치한다.
- npm이 만든 executable을 Homebrew `bin`에 symlink하고 `--version`/`--help`로 검증한다.
- formula version은 npm registry version 및 Git tag와 정확히 일치해야 한다.
- 첫 공개 version은 formula 갱신과 tap commit/push를 수동 검토한다.
- cross-repository 자동 갱신 credential과 bot PR은 실제 반복 비용이 확인될 때 별도 범위로 검토한다.

## 범위

### 포함

- personal tap의 Node-based formula
- macOS arm64/x64 설치 smoke
- 지원 가능한 범위의 Linux Homebrew install smoke
- `brew style`, `brew audit`, formula test와 uninstall/reinstall 확인
- npm/GitHub release 절차에 formula version/checksum 확인 단계 추가
- README의 Homebrew 설치 및 npm fallback 안내

### 비범위

- Bun standalone build와 GitHub Release binary asset
- Scoop, Linux curl installer와 Homebrew core 제출
- Node runtime을 포함한 self-contained bottle
- tap repository 자동 생성 또는 무승인 push
- 장기 credential을 추가하는 자동 formula publish

## 구현 순서

### P22-A — package/install spike

- npm tarball을 Homebrew sandbox에서 offline 설치할 수 있는 최소 formula를 local tap에서 검증한다.
- scoped package URL, dependency resource, executable symlink와 Node runtime 요구를 확인한다.
- formula가 npm global directory나 사용자 npm cache를 변경하지 않는지 확인한다.

### P22-B — tap 검증

- 실제 `oliverne/homebrew-tap` 소유권과 repository 상태를 확인한다.
- formula, test와 checksum update 절차를 준비하고 `brew style`/`brew audit`을 통과한다.
- macOS arm64/x64에서 clean install, version/help, reinstall과 uninstall을 검증한다.

### P22-C — 공개와 운영 문서

- 명시적 승인 후 tap 변경만 선택적으로 commit/push한다.
- `brew install oliverne/tap/myboxctl`을 새 환경에서 확인한다.
- npm version 배포 뒤 formula를 갱신하는 수동 checklist를 `docs/operations/npm-release.md`에 추가한다.

## 실패와 rollback

- npm tarball checksum이나 version이 다르면 formula를 게시하지 않는다.
- npm publish가 성공하기 전에 formula version을 먼저 올리지 않는다.
- 잘못된 formula를 고치기 위해 기존 Git tag나 npm version을 이동하거나 덮어쓰지 않는다.
- Homebrew 경로 실패는 npm package 배포 성공을 취소하거나 standalone 부활을 자동 결정하지 않는다.
- rollback은 tap에서 이전 정상 formula version을 명시적으로 복원하며 별도 승인 후 수행한다.

## 검증

저장소 변경:

```bash
bun run check
bun run build
git diff --check
```

tap에서는 설치 전에 현재 Homebrew가 요구하는 style/audit 명령을 확인하고 macOS clean environment의
실제 install smoke를 수행한다. 외부 tap mutation은 별도 승인 없이는 실행하지 않는다.

## 완료 조건

- standalone 없이 npm tarball 기반 formula가 설치된다.
- `myboxctl --version`과 `--help`가 npm package와 같은 결과를 낸다.
- formula version/checksum과 npm/Git tag가 일치한다.
- macOS 지원 architecture의 install smoke와 formula audit가 통과한다.
- tap 운영 경계와 npm fallback이 문서화된다.
