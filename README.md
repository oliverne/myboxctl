# myboxctl

`myboxctl`은 NAVER MYBOX Open API를 사용하는 홈서버용 단방향 파일 관리 CLI다.
로컬 AI 에이전트 등 자동화된 호출자가 subprocess와 JSON으로 안정적으로 사용할 수 있도록 하는 것을
우선하며, 양방향 sync는 제공하지 않는다.

현재 Phase 06 Delete까지 완료했고 Phase 07 안정화·배포 검증을 진행 중이다. 원격 경로의 exact `stat`,
direct-child `ls`, 누락 계층을 만드는 `ensure-dir`, bounded-memory streaming `upload`, metadata 기반
조건부 `put`, idempotent `delete`를 제공하며 상태는
[`docs/PROGRESS.md`](docs/PROGRESS.md), [`docs/HANDOFF.md`](docs/HANDOFF.md)를 확인한다.

## 요구사항

- Bun 1.4 이상
- NAVER MYBOX PAT: 실제 integration test에서만 필요

## 시작하기

```bash
bun install --frozen-lockfile
bun run check
bun run build
bun run dev -- --help
bun run dev -- stat /agents/output/report.md --json
bun run dev -- ls /agents/output --json
bun run dev -- upload ./report.md /agents/output/report.md --mkdir --json
bun run dev -- put ./report.md /agents/output/report.md --mkdir --json
```

빌드 후에는 `dist/cli.js`를 직접 실행하거나 Bun으로 실행할 수 있다. 릴리스 산출물의 실행 계약은
다음 명령으로 검증한다.

```bash
bun run test:release
./dist/cli.js --version
./dist/cli.js stat /agents/output/report.md --json
```

Ubuntu Server 24.04의 설치·credentials·업그레이드 절차는
[`docs/operations/ubuntu-24.04.md`](docs/operations/ubuntu-24.04.md)를 따른다. MVP에서는 daemon이나
systemd service를 제공하지 않으며, AI 에이전트가 필요할 때 CLI subprocess를 한 번 호출한다.

실제 PAT는 `.env` 또는 배포 환경의 secret 파일로 전달하고 커밋하지 않는다.

```bash
cp .env.example .env
```

## 문서 안내

- [`PLAN.md`](PLAN.md): 전체 범위, phase 순서, 완료 정의
- [`docs/README.md`](docs/README.md): 문서 탐색 안내
- [`docs/PROGRESS.md`](docs/PROGRESS.md): phase 및 작업 상태의 단일 기준
- [`docs/HANDOFF.md`](docs/HANDOFF.md): 다음 구현 에이전트가 이어서 할 작업
- [`docs/architecture/overview.md`](docs/architecture/overview.md): 구조와 의존성 방향
- [`docs/reference/cli-contract.md`](docs/reference/cli-contract.md): CLI/JSON/exit code 계약
- [`docs/reference/mybox-api.md`](docs/reference/mybox-api.md): 검증된 API 사실과 미확인 항목

## 일반 검증

```bash
bun run check
bun run build
```

`bun run check`는 typecheck, Biome, build artifact, 전체 Bun test를 순서대로 실행한다. 산출물만
검증하려면 `bun run test:release`를 사용한다.

실제 계정을 사용하는 integration test는 명시적으로 opt-in한다.

```bash
MYBOX_PAT=... bun run test:integration
MYBOX_PAT=... bun run test:contract
MYBOX_PAT=... bun run test:upload-probe
```

`test:integration`은 command acceptance를 실행한다. `test:contract`는 endpoint/schema/protocol
변경 또는 기존 API ledger와 모순되는 관찰을 조사할 때만 실행하며, 일반 phase 검증에는 포함하지
않는다. `test:upload-probe`는 Phase 04의 100MiB streaming과 interruption resume 계약을 검증할
때만 실행한다. 일반 `upload` acceptance는 `test:integration`에 포함되며 격리 prefix 아래의 0-byte,
Unicode, conflict, explicit overwrite를 확인한다.

## `put` 비교 한계

`put`은 SHA-256 같은 content hash 없이 파일 크기와 수정 시각만 비교한다. 따라서 로컬과 원격의
크기가 같고 수정 시각 차이가 2초 이내이면 실제 내용이 달라도 `skipped`가 될 수 있다. 이 경우
내용을 반드시 반영하려면 `--force`를 사용한다.
