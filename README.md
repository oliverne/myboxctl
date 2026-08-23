# myboxctl

`myboxctl`은 NAVER MYBOX Open API를 사용하는 홈서버용 단방향 파일 관리 CLI다.
로컬 AI 에이전트 등 자동화된 호출자가 subprocess와 JSON으로 안정적으로 사용할 수 있도록 하는 것을
우선하며, 양방향 sync는 제공하지 않는다.

현재 Phase 03 Ensure directory까지 완료했다. 원격 경로의 exact `stat`, direct-child `ls`,
누락 계층을 만드는 `ensure-dir`를 제공하며, 명령 구현 상태와 다음 작업은 [`docs/PROGRESS.md`](docs/PROGRESS.md),
[`docs/HANDOFF.md`](docs/HANDOFF.md)를 확인한다.

## 요구사항

- Bun 1.4 이상
- NAVER MYBOX PAT: 실제 integration test에서만 필요

## 시작하기

```bash
bun install
bun run check
bun run build
bun run dev -- --help
bun run dev -- stat /agents/output/report.md --json
bun run dev -- ls /agents/output --json
```

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

실제 계정을 사용하는 integration test는 명시적으로 opt-in한다.

```bash
MYBOX_PAT=... bun run test:integration
MYBOX_PAT=... bun run test:contract
```

`test:integration`은 command acceptance를 실행한다. `test:contract`는 endpoint/schema/protocol
변경 또는 기존 API ledger와 모순되는 관찰을 조사할 때만 실행하며, 일반 phase 검증에는 포함하지
않는다.
