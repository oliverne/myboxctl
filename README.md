# myboxctl

> [!WARNING]
> **Pre-release / testing software.** `myboxctl`은 아직 배포 준비가 완료되지 않았으며 실제 NAVER MYBOX
> 계정과 데이터를 대상으로 검증 중이다. 중요한 데이터에는 사용하지 말고, 별도의 테스트 경로와
> 복구 가능한 데이터로 먼저 검증해야 한다.

`myboxctl`은 NAVER MYBOX Open API를 사용하는 단방향 파일 관리 CLI다. 홈서버, 스크립트, 로컬 AI
에이전트 등 자동화된 호출자가 subprocess와 JSON으로 안정적으로 사용할 수 있도록 하는 것을
우선하며, 양방향 sync는 제공하지 않는다.

현재 핵심 명령 구현은 완료했고 Phase 07 안정화·배포 검증을 진행 중이다. 원격 경로의 exact `stat`,
direct-child `ls`, 누락 계층을 만드는 `ensure-dir`, bounded-memory streaming `upload`, metadata 기반
조건부 `put`, idempotent `delete`를 제공한다. 최신 구현 및 검증 상태는
[`docs/PROGRESS.md`](docs/PROGRESS.md), [`docs/HANDOFF.md`](docs/HANDOFF.md)를 확인한다.

## 사용 전 주의사항

이 프로젝트의 상당 부분은 AI 코딩 에이전트의 도움을 받아 구현·리뷰·문서화되었다. 자동화된 테스트와
실제 MYBOX integration test를 함께 사용하고 있지만, 이것이 소프트웨어의 정확성이나 데이터 안전성을
보장하지는 않는다.

특히 다음 사항을 전제로 사용한다.

- 아직 안정 버전이 아니며 CLI/API 계약이 변경될 수 있다.
- `upload`, `put`, `delete`는 실제 원격 데이터를 변경한다.
- 중요한 데이터나 유일한 사본에는 사용하지 않는다.
- 처음 사용할 때는 `/myboxctl-integration-test/` 같은 별도 테스트 경로에서 검증한다.
- PAT, credentials 파일, signed upload URL을 로그나 issue에 첨부하지 않는다.
- 자동화 또는 AI 에이전트에 연결할 경우 실행 가능한 명령과 원격 경로를 제한하는 것을 권장한다.

이 프로젝트는 NAVER의 공식 제품이 아니며 NAVER와 제휴하거나 보증을 받지 않았다.

## 현재 지원 범위

```text
stat       원격 파일/폴더 메타데이터 조회
ls         폴더의 direct children 조회
ensure-dir 원격 폴더 계층 보장
upload     신규 업로드 및 명시적 overwrite
put        로컬/원격 metadata를 비교한 조건부 업로드
 delete     원격 파일/폴더를 MYBOX 휴지통으로 이동
```

지원하지 않는 범위:

- 양방향 sync
- 로컬 삭제의 자동 원격 반영
- 전체 디렉터리 미러링
- daemon/watch mode
- FUSE mount, GUI, TUI
- 다중 MYBOX 계정

## 요구사항

- Bun 1.4 이상
- NAVER MYBOX PAT: 실제 MYBOX API를 사용할 때 필요

## 시작하기

```bash
bun install --frozen-lockfile
bun run check
bun run build
bun run dev -- --help
```

PAT는 환경 변수 또는 권한이 제한된 credentials 파일로 전달하고 저장소에 커밋하지 않는다.

```bash
export MYBOX_PAT='...'
```

기본 사용 예:

```bash
bun run dev -- stat /agents/output/report.md --json
bun run dev -- ls /agents/output --json
bun run dev -- ensure-dir /agents/output --json
bun run dev -- upload ./report.md /agents/output/report.md --mkdir --json
bun run dev -- put ./report.md /agents/output/report.md --mkdir --json
bun run dev -- delete /agents/output/report.md --json
```

빌드 후에는 `dist/cli.js`를 직접 실행하거나 Bun으로 실행할 수 있다.

```bash
bun run test:release
./dist/cli.js --version
./dist/cli.js stat /agents/output/report.md --json
```

Ubuntu Server 24.04의 설치·credentials·업그레이드 절차는
[`docs/operations/ubuntu-24.04.md`](docs/operations/ubuntu-24.04.md)를 따른다. MVP에서는 daemon이나
systemd service를 제공하지 않으며, 자동화된 호출자가 필요할 때 CLI subprocess를 한 번 호출한다.

## 설정과 credentials

실제 PAT는 `.env` 또는 배포 환경의 secret 파일로 전달하고 커밋하지 않는다.

```bash
cp .env.example .env
```

credentials와 관련된 기본 원칙:

- 저장소, CI 로그, issue, PR에 PAT를 포함하지 않는다.
- 서버에서 credentials 파일을 사용할 경우 권한을 `0600`으로 제한한다.
- 일반 GitHub Actions push/PR CI에는 MYBOX PAT를 전달하지 않는다.
- 실제 MYBOX integration은 명시적으로 opt-in한다.

## 문서 안내

- [`PLAN.md`](PLAN.md): 전체 범위, phase 순서, 완료 정의
- [`docs/README.md`](docs/README.md): 문서 탐색 안내
- [`docs/PROGRESS.md`](docs/PROGRESS.md): phase 및 작업 상태의 단일 기준
- [`docs/HANDOFF.md`](docs/HANDOFF.md): 다음 구현 에이전트가 이어서 할 작업
- [`docs/architecture/overview.md`](docs/architecture/overview.md): 구조와 의존성 방향
- [`docs/reference/cli-contract.md`](docs/reference/cli-contract.md): CLI/JSON/exit code 계약
- [`docs/reference/mybox-api.md`](docs/reference/mybox-api.md): 검증된 API 사실과 미확인 항목

## 개발 및 검증

일반 검증:

```bash
bun install --frozen-lockfile
bun run check
bun run build
bun run test:release
```

`bun run check`는 typecheck, Biome, build artifact, 전체 Bun test를 순서대로 실행한다.

실제 계정을 사용하는 integration test는 명시적으로 opt-in한다.

```bash
MYBOX_PAT=... bun run test:integration
MYBOX_PAT=... bun run test:contract
MYBOX_PAT=... bun run test:upload-probe
```

`test:integration`은 command acceptance를 실행한다. `test:contract`는 endpoint/schema/protocol 변경 또는
기존 API ledger와 모순되는 관찰을 조사할 때만 실행하며 일반 검증에는 포함하지 않는다.
`test:upload-probe`는 100MiB streaming과 interruption resume 계약을 다시 검증해야 할 때만 실행한다.

## `put` 비교 한계

`put`은 SHA-256 같은 content hash 없이 파일 크기와 수정 시각만 비교한다. 따라서 로컬과 원격의
크기가 같고 수정 시각 차이가 2초 이내이면 실제 내용이 달라도 `skipped`가 될 수 있다. 이 경우
내용을 반드시 반영하려면 `--force`를 사용한다.

## Contributing

버그 리포트, 문서 개선, 테스트 케이스, 코드 기여를 환영한다. 현재는 pre-release 단계이므로 큰 기능을
구현하기 전에 issue에서 범위와 설계 방향을 먼저 논의하는 것을 권장한다.

기여 절차와 개발 규칙은 [`CONTRIBUTING.md`](CONTRIBUTING.md)를 참고한다.

보안 문제나 credential 노출 가능성을 발견한 경우 PAT나 실제 signed URL을 공개 issue에 첨부하지
않는다.

## License

MIT License. 자세한 내용은 [`LICENSE`](LICENSE)를 참고한다.
