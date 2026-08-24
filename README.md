# myboxctl

`myboxctl`은 NAVER MYBOX Open API 위에 얇게 만든 파일 관리 CLI입니다.

이 프로젝트의 목표는 MYBOX의 모든 기능을 다시 구현하는 것이 아닙니다. MCP 서버나 범용 MYBOX
클라이언트를 만드는 것도 아닙니다. 대신 홈서버, 스크립트, AI 에이전트가 파일을 올리고, 확인하고,
필요할 때 삭제하는 데 필요한 **작고 예측 가능한 CLI 기능**을 제공하는 데 집중합니다.

예를 들어 에이전트가 다음처럼 단순한 subprocess 호출만으로 작업할 수 있는 형태를 목표로 합니다.

```bash
myboxctl stat /agents/output/report.md --json
myboxctl put ./report.md /agents/output/report.md --mkdir --json
myboxctl delete /agents/output/old-report.md --json
```

현재 핵심 명령 구현은 완료했고, 실제 공개·배포 전 마지막 안정화와 검증을 진행하고 있습니다.

> [!IMPORTANT]
> **현재는 pre-release / testing 단계입니다.**
> 아직 안정 버전으로 배포하지 않았으며 실제 MYBOX 계정과 데이터를 대상으로 계속 검증하고 있습니다.
> 중요한 데이터나 유일한 사본에는 사용하지 말고, 처음에는 별도의 테스트 경로에서 동작을 확인해 주세요.

최신 구현 및 검증 상태는 [`docs/PROGRESS.md`](docs/PROGRESS.md),
[`docs/HANDOFF.md`](docs/HANDOFF.md)에서 확인할 수 있습니다.

## 왜 만들었나요?

AI 에이전트나 자동화 도구가 클라우드 스토리지를 사용할 때 항상 큰 SDK나 복잡한 protocol이 필요한 것은
아닙니다. 파일 작업처럼 범위가 명확한 경우에는 작은 CLI가 오히려 다루기 쉽습니다.

`myboxctl`은 다음 원칙을 따릅니다.

- 사람이 터미널에서 직접 사용할 수 있어야 합니다.
- AI 에이전트는 안정적인 JSON과 exit code만으로 결과를 판단할 수 있어야 합니다.
- 원격 파일 변경은 명시적이고 예측 가능해야 합니다.
- MYBOX API의 전체 기능을 감싸기보다는 실제 필요한 기능만 추가합니다.
- MCP, daemon, sync engine 같은 별도 계층은 필요성이 확인되기 전까지 추가하지 않습니다.

## 현재 제공하는 기능

```text
stat        원격 파일/폴더 메타데이터 조회
ls          폴더의 direct children 조회
ensure-dir  원격 폴더 계층 보장
upload      신규 업로드 및 명시적 overwrite
put         로컬/원격 metadata를 비교한 조건부 업로드
delete      원격 파일/폴더를 MYBOX 휴지통으로 이동
```

현재 의도적으로 지원하지 않는 기능도 있습니다.

- MYBOX 전체 API 기능
- MCP server
- 양방향 sync
- 전체 디렉터리 미러링
- 로컬 삭제의 자동 원격 반영
- daemon/watch mode
- FUSE mount, GUI, TUI
- 다중 MYBOX 계정

NAVER 공식 API에는 download, rename, move, copy, favorite, 휴지통 복원/영구 삭제 같은 기능도 있지만,
`myboxctl`은 API coverage 자체를 목표로 하지 않습니다. 실제 agent workflow에서 필요성이 확인되면
선택적으로 추가합니다.

이 범위는 프로젝트의 제약이라기보다 방향에 가깝습니다. 실제로 필요한 기능이 생기면 추가할 수 있지만,
작고 단순한 CLI라는 성격은 유지하려고 합니다.

## 사용하기 전에

이 프로젝트의 구현, 테스트 작성, 코드 리뷰, 문서화에는 AI 코딩 에이전트를 적극적으로 사용했습니다.
사람이 설계 방향과 정책을 정하고 자동화된 테스트와 실제 MYBOX integration test로 검증하고 있지만,
AI가 작성한 코드가 포함되어 있다는 점을 고려해 사용해 주세요.

특히 현재 pre-release 기간에는 다음 정도의 주의를 권장합니다.

- `upload`, `put`, `delete`는 실제 원격 데이터를 변경합니다.
- 중요한 데이터에는 먼저 충분히 테스트한 뒤 사용해 주세요.
- 처음에는 `/myboxctl-integration-test/` 같은 별도 경로를 사용하는 것이 좋습니다.
- PAT, credentials 파일, signed upload URL은 저장소나 issue에 올리지 마세요.
- AI 에이전트에 연결할 경우 허용할 명령과 원격 경로를 제한하는 편이 안전합니다.
- CLI/JSON 계약은 안정화 과정에서 아직 변경될 수 있습니다.

`myboxctl`은 NAVER의 공식 제품이 아니며 NAVER와 제휴하거나 보증을 받은 프로젝트가 아닙니다.

## NAVER Open API 제약

`myboxctl` 자체의 설계와 별개로 NAVER MYBOX Open API에 다음 제약이 있습니다.

- PAT는 계정당 최대 5개까지 만들 수 있고 유효기간은 30/60/90/180일 중 선택합니다.
- **암호 폴더와 공유 받은 폴더는 Open API에서 지원하지 않습니다.**
- 요금제와 API 종류에 따라 호출 한도가 있습니다.
  - 검색: 최소 요금제 기준 10회/분
  - 삭제: 최소 요금제 기준 60회/분
  - 그 외 기능: API별 60회/분
  - 다운로드: 요금제별 일일 한도
- 계정이 용량 초과 또는 제한 상태이면 API 호출이 실패할 수 있습니다.

현재 `myboxctl`은 search 10회/분과 delete 60회/분을 보수적으로 여러 CLI process 사이에서
조정합니다. 공식 API 전수 조사에서 나머지 현재 사용 endpoint의 API별 60회/분과 upload 최대 크기
조회(`maxFileBytes`)를 추가로 정리할 필요가 확인되어 Phase 08 후속 과제로 기록했습니다.

전체 공식 API inventory, 현재 구현 coverage와 후속 과제는
[`docs/reference/official-api-audit.md`](docs/reference/official-api-audit.md)를 참고해 주세요.

공식 문서: <https://developers.mybox.naver.com/getting-started>

## 요구사항

- Bun 1.4 이상
- NAVER MYBOX PAT

## 시작하기

저장소를 clone한 뒤 의존성을 설치하고 먼저 일반 테스트를 실행합니다.

```bash
bun install --frozen-lockfile
bun run check
bun run build
bun run dev -- --help
```

PAT는 환경 변수 또는 권한이 제한된 credentials 파일로 전달할 수 있습니다. 저장소에는 커밋하지 마세요.

```bash
export MYBOX_PAT='...'
```

기본 사용 예시는 다음과 같습니다.

```bash
bun run dev -- stat /agents/output/report.md --json
bun run dev -- ls /agents/output --json
bun run dev -- ensure-dir /agents/output --json
bun run dev -- upload ./report.md /agents/output/report.md --mkdir --json
bun run dev -- put ./report.md /agents/output/report.md --mkdir --json
bun run dev -- delete /agents/output/report.md --json
```

빌드 후에는 `dist/cli.js`를 직접 실행할 수 있습니다.

```bash
bun run test:release
./dist/cli.js --version
./dist/cli.js stat /agents/output/report.md --json
```

Ubuntu Server 24.04에서 사용하는 방법은
[`docs/operations/ubuntu-24.04.md`](docs/operations/ubuntu-24.04.md)에 정리되어 있습니다.

## 설정과 credentials

예제 설정은 `.env.example`을 참고할 수 있습니다.

```bash
cp .env.example .env
```

credentials를 다룰 때는 다음 원칙을 권장합니다.

- 저장소, CI 로그, issue, PR에 PAT를 포함하지 않습니다.
- 서버에서 credentials 파일을 사용한다면 권한을 `0600`으로 제한합니다.
- 일반 GitHub Actions push/PR CI에는 MYBOX PAT를 전달하지 않습니다.
- 실제 MYBOX integration test는 명시적으로 opt-in합니다.
- PAT는 만료 전에 교체하고 더 이상 사용하지 않는 토큰은 MYBOX 웹에서 삭제합니다.

## `put`의 비교 방식

`put`은 현재 content hash 대신 파일 크기와 수정 시각을 비교합니다.

따라서 로컬과 원격 파일의 크기가 같고 수정 시각 차이가 2초 이내라면 실제 내용이 달라도
`skipped`가 될 수 있습니다. 내용을 반드시 반영하려면 `--force`를 사용하세요.

이 동작은 현재 MVP에서 의도한 단순한 metadata 기반 정책이며, 향후 필요성이 확인되면 hash 기반 비교를
추가할 수 있습니다.

## 개발 및 테스트

일반 검증은 실제 MYBOX 계정 없이 실행할 수 있습니다.

```bash
bun install --frozen-lockfile
bun run check
bun run build
bun run test:release
```

실제 계정을 사용하는 integration test는 별도로 실행합니다.

```bash
MYBOX_PAT=... bun run test:integration
MYBOX_PAT=... bun run test:contract
MYBOX_PAT=... bun run test:upload-probe
```

- `test:integration`: 실제 command acceptance
- `test:contract`: MYBOX API 계약을 다시 확인해야 할 때 사용하는 probe
- `test:upload-probe`: 100MiB streaming 및 interruption/resume 검증

일반적인 개발 과정에서는 `test:contract`나 `test:upload-probe`를 매번 실행할 필요는 없습니다.

## 문서

프로젝트 내부 설계나 구현 상태를 더 자세히 보고 싶다면 다음 문서부터 보는 것이 좋습니다.

- [`PLAN.md`](PLAN.md) — 프로젝트 범위와 phase
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — 현재 구현 및 검증 상태
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — 현재 작업 문맥과 다음 단계
- [`docs/architecture/overview.md`](docs/architecture/overview.md) — 구조와 설계 방향
- [`docs/reference/cli-contract.md`](docs/reference/cli-contract.md) — JSON과 exit code 계약
- [`docs/reference/mybox-api.md`](docs/reference/mybox-api.md) — 구현 API의 공식 계약과 실제 관찰
- [`docs/reference/official-api-audit.md`](docs/reference/official-api-audit.md) — 공식 API 전체 inventory와
  현재 구현 대조

## Contributing

버그 리포트, 문서 개선, 테스트 케이스, 코드 기여를 환영합니다.

이 프로젝트는 의도적으로 범위를 작게 유지하고 있기 때문에 큰 기능을 구현하기 전에 issue에서 먼저
필요성과 방향을 이야기해 주시면 좋습니다. 특히 MYBOX 전체 기능 지원, MCP, sync, daemon처럼 프로젝트
성격을 크게 바꾸는 기능은 바로 구현하기보다 사용 사례를 먼저 확인하고 싶습니다.

개발 환경과 PR 작성 방법은 [`CONTRIBUTING.md`](CONTRIBUTING.md)를 참고해 주세요.

보안 문제나 credential 노출 가능성을 발견했다면 실제 PAT나 signed URL을 공개 issue에 첨부하지
말아 주세요.

## License

`myboxctl`은 [MIT License](LICENSE)로 배포됩니다.
