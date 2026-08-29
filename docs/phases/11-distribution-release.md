# Phase 11 — Distribution & Release

## 상태

- 상태: `blocked`
- 시작일: 2026-08-29
- 선행 조건: Phase 00~10 `complete`
- 구현 브랜치: `phase-11-distribution-release`

Phase 11의 배포 구현과 native smoke는 완료했지만, 첫 public Release는 Phase 12의 크로스 플랫폼
Unicode filename 호환성 검증이 끝날 때까지 보류한다. tag 기반 draft Release 확인은 Phase 12 이후
재개한다.

## 목표

사용자가 저장소를 clone하거나 Bun을 먼저 설치하지 않아도 `myboxctl`을 설치할 수 있는 재현 가능한
배포 경로를 만든다. 모든 배포 경로는 같은 tag에서 만든 Bun standalone executable과 SHA-256을
사용하며 `myboxctl --version`으로 설치 결과를 확인할 수 있어야 한다.

## 지원 대상

| 배포 target       | Release asset  | 설치 경로                                    |
| ----------------- | -------------- | -------------------------------------------- |
| macOS arm64       | `darwin-arm64` | Homebrew, npm, 직접 다운로드                 |
| macOS x64         | `darwin-x64`   | Homebrew, npm, 직접 다운로드                 |
| Linux glibc arm64 | `linux-arm64`  | Homebrew, npm, install script, 직접 다운로드 |
| Linux glibc x64   | `linux-x64`    | Homebrew, npm, install script, 직접 다운로드 |
| Windows x64       | `windows-x64`  | Scoop, npm, 직접 다운로드                    |

Windows arm64와 Linux musl은 실제 수요가 확인될 때 추가한다.

## P11-A — Versioned standalone build

- `vX.Y.Z` 또는 SemVer prerelease tag에서 CLI version을 build-time constant로 주입한다.
- Bun 1.4의 `--compile` cross target으로 위 5개 executable을 만든다.
- Unix는 `.tar.gz`, Windows는 `.zip`으로 패키징한다.
- archive 이름, 내부 executable 이름, version 출력은 deterministic contract로 테스트한다.
- 기존 `dist/cli.js` 개발 빌드와 release executable 계약을 함께 유지한다.

## P11-B — GitHub Release

- `v*` tag push가 일반 check와 release asset build를 수행한다.
- 모든 archive와 `SHA256SUMS`, Linux installer, Homebrew formula, Scoop manifest를 draft Release에
  업로드한다.
- rerun은 같은 draft Release asset을 안전하게 교체할 수 있어야 한다.
- Release publish는 사람이 draft 내용과 smoke 결과를 확인한 뒤 수행한다.

## P11-C — Package managers

- npm은 `@oliverne/myboxctl` launcher와 5개 optional platform package로 분리한다.
- npm platform package는 GitHub Release와 동일한 standalone executable을 포함한다.
- Homebrew는 `oliverne/homebrew-tap`의 `myboxctl` formula가 4개 macOS/Linux asset과 checksum을
  사용한다.
- Scoop manifest는 Windows x64 asset과 checksum을 사용한다.
- npm/Homebrew 실제 publish는 registry/tap credential과 공개 Release가 준비된 뒤 명시적 workflow로
  실행한다.

## P11-D — Installer and documentation

- Linux installer는 architecture를 판별하고 archive와 checksum을 HTTPS로 내려받아 검증한다.
- 기본 설치 위치는 쓰기 가능한 `/usr/local/bin`, 아니면 `$HOME/.local/bin`이다.
- README에 Homebrew, npm, Linux installer, Scoop, 직접 다운로드 순서와 `--version` 검증을 안내한다.
- upgrade/rollback은 versioned Release asset을 기준으로 설명한다.

## 검증

```bash
bun run check
bun run build
bun run test:release
bun run build:release -- --version 0.1.0-test --target bun-linux-x64
bun run verify:release -- --version 0.1.0-test --target bun-linux-x64
```

완료 조건:

- [x] 일반 check/build/release contract가 통과한다.
- [x] 5개 target asset과 `SHA256SUMS`가 생성된다.
- [x] 각 운영체제의 native runner에서 archive를 풀어 `--version`과 `--help` smoke가 통과한다.
- [x] npm launcher가 지원 target을 정확한 optional package로 연결하고 exit code를 보존한다.
- [x] Linux installer, Homebrew formula, Scoop manifest가 checksum을 사용한다.
- [ ] tag workflow가 draft Release를 만들고 asset을 재실행 가능하게 업로드한다.
- [x] README와 운영 문서가 clone/Bun 없이 설치하는 경로를 설명한다.
- [x] `docs/PROGRESS.md`와 `docs/HANDOFF.md`를 사실 기준으로 갱신한다.

## 공개 전 중단 조건

다음 조건에서는 구현과 CI smoke까지만 완료하고 실제 publish를 중단한다.

- 저장소가 private이거나 Release가 draft인 경우
- npm package scope 또는 `oliverne/homebrew-tap` 소유권이 확인되지 않은 경우
- `NPM_TOKEN` 또는 tap 전용 token이 준비되지 않은 경우
- macOS/Windows native smoke가 실패한 경우

credential을 우회하거나 Release를 자동으로 공개하지 않는다.
