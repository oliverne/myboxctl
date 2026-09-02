# myboxctl

`myboxctl`은 NAVER MYBOX Open API를 얄팍하게 감싼 파일 관리 CLI입니다.

이 프로젝트의 목표는 MYBOX의 모든 기능을 구현하는 것이 아닙니다.(API가 모든 기능을 제공하지 않습니다.)
MCP 서버나 범용 MYBOX 클라이언트(혹은 SDK)를 만드는 것도 아닙니다.
대신 AI 에이전트가 MYBOX에 파일을 올리고, 확인하고, 필요할 때 삭제하는 데 필요한 **작고 예측 가능한 CLI 기능**을 제공하는게 목표입니다.

예를 들어 에이전트가 다음처럼 단순한 subprocess 호출만으로 작업할 수 있는 형태를 목표로 합니다.

```bash
myboxctl info /agents/output/report.md --json
myboxctl upload ./report.md /agents/output/ --mkdir --json
myboxctl download /agents/output/report.md ./report.md --json
myboxctl delete /agents/output/old-report.md --json
```

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
list (ls)   폴더 내용 또는 단일 resource 조회 (생략 시 /)
info        원격 파일/폴더 메타데이터 조회
mkdir       원격 폴더 생성 (-p/--parents 지원)
upload      metadata 기반 조건부 업로드/갱신
download    원격 파일의 안전한 streaming download
delete      원격 파일/폴더를 MYBOX 휴지통으로 이동
```

긴 대기나 자동 재시도 event가 필요할 때만 `--json --verbose`를 사용하세요. 기본 `--json`은 최종
결과 한 개만 stdout에 출력하고 stderr는 비워 둡니다.

```bash
myboxctl upload ./report.md /agents/output/ --mkdir --json --verbose \
  2>myboxctl-events.jsonl
```

`--verbose`는 단계와 upload 진행률을 추가하고, `--quiet`는 실행 중 event만 억제합니다. 두 옵션은
함께 사용할 수 없으며 root/subcommand 앞뒤 어느 위치에도 둘 수 있습니다. 기본 human 오류는
stderr에 `Error:`로 한 번만 출력됩니다.

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

- TBD

직접 설치하거나 checksum을 확인하려면 [GitHub Releases](https://github.com/oliverne/myboxctl/releases)를
사용하세요.

## macOS에서 파일명을 사용할 때

- macOS에서 만든 한글이나 악센트가 있는 파일명을 업로드할 때, 파일명 자체를 따로 바꿀 필요는
  없습니다. `myboxctl`이 원격에 저장되는 이름을 자동으로 처리합니다.
- 기존에 다른 방식으로 저장된 원격 파일·폴더도 이름이 같다면 `myboxctl`이 찾아줍니다.
- 단, 같은 원격 폴더에 화면상 같은 이름의 항목이 여러 개 있으면 어느 항목인지 구분할 수 없습니다.
  이 경우 변경 작업이 `UNICODE_NAME_COLLISION` 오류로 중단됩니다.
- 로컬 파일 경로와 파일명은 사용자가 입력한 그대로 유지되고, 원격에 저장되는 이름만 자동으로
  처리됩니다.

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

## 업로드 주의사항

- `upload`는 파일 내용 전체를 비교하지 않고 파일 크기와 수정 시각을 비교합니다.
- 파일 크기가 같고 수정 시각 차이가 2초 이내면, 실제 내용이 달라도 업로드를 건너뛸 수 있습니다.
  이때 결과는 `skipped`입니다.
- 파일 크기가 다르거나 로컬 파일이 더 최신이면 자동으로 덮어씁니다. 반대로 원격 파일이 2초 이상 더
  최신이면 안전을 위해 `conflict`를 반환합니다. 이 경우 `--force`를 사용하면 강제로 덮어쓸 수 있습니다.
- destination을 생략하거나 `/`로 지정하면 로컬 파일 이름을 그대로 사용해 루트에 업로드합니다. 기존
  디렉터리를 destination으로 지정하면 그 디렉터리 안에 로컬 파일 이름으로 업로드합니다.

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

## License

`myboxctl`은 [MIT License](LICENSE)로 배포됩니다.
