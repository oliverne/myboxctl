# myboxctl

`myboxctl`은 NAVER MYBOX Open API를 얄팍하게 감싼 파일 관리 CLI입니다.

이 프로젝트의 목표는 MYBOX의 모든 기능을 구현하는 것이 아닙니다.(API가 모든 기능을 제공하지 않습니다.)
MCP 서버나 범용 MYBOX 클라이언트(혹은 SDK)를 만드는 것도 아닙니다.
대신 AI 에이전트가 MYBOX에 파일을 올리고, 확인하고, 필요할 때 삭제하는 데 필요한 **작고 예측 가능한 CLI 기능**을 제공하는게 목표입니다.

예를 들어 에이전트가 다음처럼 단순한 subprocess 호출만으로 작업할 수 있는 형태를 목표로 합니다.

```bash
myboxctl stat /agents/output/report.md --json
myboxctl put ./report.md /agents/output/report.md --mkdir --json
myboxctl download /agents/output/report.md ./report.md --json
myboxctl delete /agents/output/old-report.md --json
```

현재 구현 및 검증 상태는 [`docs/PROGRESS.md`](docs/PROGRESS.md),
[`docs/HANDOFF.md`](docs/HANDOFF.md)에서 확인할 수 있습니다.

## 왜 만들었나요?

요즘 AI 에이전트는 CLI를 잘 다룹니다. 제가 Hermes Agent에서 쓰려고 만들었어요.

`myboxctl`은 다음 원칙을 따릅니다.

- 사람이 터미널에서 직접 사용할 수 있어야 합니다.
- AI 에이전트는 안정적인 JSON과 exit code만으로 결과를 판단할 수 있어야 합니다.
- 원격 파일 변경은 명시적이고 예측 가능해야 합니다.
- MYBOX API의 전체 기능을 감싸기보다는 실제 필요한 기능만 추가합니다.
- MCP, Daemon, Sync Engine, SDK를 만들 생각 없습니다.

## 현재 제공하는 기능

```text
stat        원격 파일/폴더 메타데이터 조회
ls          폴더의 direct children 조회
ensure-dir  원격 폴더 계층 보장
upload      신규 업로드 및 명시적 overwrite
put         로컬/원격 metadata를 비교한 조건부 업로드
download    원격 파일의 안전한 streaming download
delete      원격 파일/폴더를 MYBOX 휴지통으로 이동
```

긴 대기나 자동 재시도는 stderr event로 확인할 수 있습니다. `--json`에서는 최종 결과 한 개만
stdout에 유지하고 실행 중 event는 JSON Lines로 stderr에 출력합니다.

```bash
myboxctl put ./report.md /agents/output/report.md --json --verbose \
  2>myboxctl-events.jsonl
```

`--verbose`는 단계와 upload/put 진행률을 추가하고, `--quiet`는 실행 중 event만 억제합니다. 두
옵션은 함께 사용할 수 없습니다. 기본 human 오류는 stderr에 `Error:`로 한 번만 출력됩니다.

NAVER 공식 API에는 rename, move, copy, favorite, 휴지통 복원/영구 삭제 같은 기능도 있지만,
`myboxctl`은 모든 API를 구현하는게 목표가 아닙니다. 실제 agent workflow에서 필요성이 확인되면
선택적으로 추가합니다.

## 사용하기 전에

이 프로젝트는 AI 코딩 에이전트를 적극적으로 사용했습니다. 거의 다 에이전트가 구현했습니다. AI가 없었으면 귀찮아서 시작하지 못했을 겁니다.
사람이 설계 방향과 정책을 정하고 자동화된 테스트와 실제 MYBOX integration test로 검증하고 있지만,
AI가 작성한 ~~AI Slops 같은~~ 코드가 포함되어 있다는 점을 고려해 사용해 주세요.

많은 부분이 테스트 코드로 검증한 것 같지만, 제가 직접 쓰면서 검증하는 중입니다. 아직 무슨 일이 벌어질지 모릅니다.

`myboxctl`은 NAVER의 공식 제품이 아니며 NAVER와 아무 상관이 없는 프로젝트입니다.

## NAVER Open API 제약

MYBOX Open API에는 다음 제약이 있습니다.

- PAT는 계정당 최대 5개이며, 유효기간은 30/60/90/180일입니다.
- **암호 폴더와 공유 받은 폴더는 지원하지 않습니다.**
- 호출 한도는 요금제와 API마다 다릅니다. 최소 기준은 검색 10회/분, 삭제 60회/분, 그 외 API
  60회/분이며 다운로드에는 일일 한도가 있습니다.
- 용량 초과나 계정 제한 상태에서는 호출이 실패할 수 있습니다.

`myboxctl`은 검색·삭제 호출을 프로세스 간 보수적으로 조정하고, 업로드 전에 파일 크기 제한을
확인합니다. 전체 API 범위와 구현 현황은
[`공식 API 대조표`](docs/reference/official-api-audit.md)를 참고하세요.

[NAVER MYBOX Open API 문서](https://developers.mybox.naver.com/getting-started)

## 설치

현재 첫 공개 Release 전이라 아래 경로는 아직 활성화되지 않았습니다. 공개 후에는 standalone
executable을 사용하므로 실행에 Bun이나 Node.js가 필요하지 않습니다.

```bash
# macOS / Linux
brew install oliverne/tap/myboxctl

# Linux
curl -fsSL https://github.com/oliverne/myboxctl/releases/latest/download/install.sh | sh

# npm
npm install --global @oliverne/myboxctl
```

npm 설치에는 Node.js가 필요하지만 `myboxctl` 실행에는 필요하지 않습니다.

```powershell
# Windows
scoop install https://github.com/oliverne/myboxctl/releases/latest/download/myboxctl.json
```

직접 설치하거나 checksum을 확인하려면 [GitHub Releases](https://github.com/oliverne/myboxctl/releases)를
사용하세요.

## 여러 운영체제에서의 파일명

원격 파일·폴더의 새 이름은 NFC로 저장합니다. 기존 NFD resource도 조회할 수 있지만, 같은 parent에
동등한 이름이 여러 개 있으면 변경 작업은 `UNICODE_NAME_COLLISION`으로 중단됩니다. 로컬 경로는
정규화하지 않고 사용자가 입력한 그대로 사용합니다.

## 소스에서 개발하기

소스 개발에는 Bun 1.4 이상이 필요합니다. 저장소를 clone한 뒤 다음을 실행하세요.

```bash
bun install --frozen-lockfile
bun run check
bun run build
bun run dev -- --help
```

PAT는 `MYBOX_PAT` 환경 변수나 credentials 파일로 전달할 수 있습니다. PAT와 credentials는 저장소에
커밋하지 마세요. 설정 예시는 [`.env.example`](.env.example)을 참고하세요.

## `put` 주의사항

`put`은 content hash 대신 파일 크기와 수정 시각을 비교합니다. 크기가 같고 수정 시각 차이가 2초
이내면 내용이 달라도 `skipped`가 될 수 있습니다. 원격 파일이 더 최신이면 기본적으로 conflict를
반환하므로, 덮어쓰려면 `--force`를 사용하세요.

## 테스트

유닛 테스트는 MYBOX 계정 없이 실행할 수 있습니다.

```bash
bun run check
bun run build
bun run test:release
```

실제 MYBOX 계정 테스트는 PAT를 설정하고 선택적으로 실행할 수 있습니다.

```bash
MYBOX_PAT=... bun run test:integration
```

MYBOX API 동작 확인 테스트(`test:contract`, `test:upload-probe`, `test:download-probe`)는 필요한 경우에만 별도로 실행합니다.

## 더 보기

프로젝트 문서는 [`PLAN.md`](PLAN.md), [`docs/PROGRESS.md`](docs/PROGRESS.md),
[`docs/HANDOFF.md`](docs/HANDOFF.md)에서 확인할 수 있습니다. CLI 명세와
[`docs/reference/cli-contract.md`](docs/reference/cli-contract.md), Ubuntu 운영 방법은
[`docs/operations/ubuntu-24.04.md`](docs/operations/ubuntu-24.04.md), 기여 방법은
[`CONTRIBUTING.md`](CONTRIBUTING.md)을 참고하세요.

버그 리포트, 문서 개선, 테스트 케이스, 코드 기여를 환영합니다.

## License

`myboxctl`은 [MIT License](LICENSE)로 배포됩니다.
