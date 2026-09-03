# myboxctl

`myboxctl`은 NAVER MYBOX Open API를 얇게 감싼 파일 관리 CLI입니다.

AI 에이전트가 MYBOX에 파일을 올리고, 확인하고, 내려받고, 필요할 때 삭제하도록 작고 예측 가능한
명령만 제공합니다. MYBOX 전체 API wrapper, MCP 서버, 범용 SDK, sync 도구가 목표는 아닙니다.

제가 Hermes Agent와 Codex CLI에서 쓰려고 만들었습니다. 사람이 터미널에서 직접 사용해도 이해할 수
있는 CLI를 목표로 합니다.

## 할 수 있는 일

| 명령          | 기능                                          |
| ------------- | --------------------------------------------- |
| `list` (`ls`) | 폴더 내용 또는 단일 resource 조회             |
| `info`        | 파일·폴더 정보 조회                           |
| `mkdir`       | 원격 폴더 생성 (`-p` 지원)                    |
| `upload`      | 파일을 metadata 기준으로 안전하게 업로드·갱신 |
| `download`    | 원격 파일을 안전하게 다운로드                 |
| `delete`      | 파일·폴더를 MYBOX 휴지통으로 이동             |

명령별 사용법과 AI 에이전트용 JSON/exit code 계약은 [`llms.txt`](llms.txt)를 참고하세요. 사람이
빠르게 확인할 수 있는 cheat sheet이기도 합니다. 변경에 강한 전체 계약은
[`docs/reference/cli-contract.md`](docs/reference/cli-contract.md)에 있습니다.

## 설치

공개 배포는 npm으로만 제공하며 실행에는 Node.js 20 이상이 필요합니다(Bun 불필요).

```bash
npm install -g @oliverne/myboxctl
myboxctl --version
```

소스에서 빌드·개발하려면 Bun 1.4 이상이 필요합니다.

```bash
bun install --frozen-lockfile
bun run build
./dist/cli.js --help
```

실행에는 MYBOX PAT가 필요합니다. `MYBOX_PAT` 환경 변수나 사용자 전용 credentials 파일을 사용하며,
PAT를 명령 인자·소스·로그·저장소에 넣지 마세요. 운영 환경의 설치와 credentials 설정은
[`docs/operations/ubuntu-24.04.md`](docs/operations/ubuntu-24.04.md)에 정리되어 있습니다.

## 사용하기 전에

- `myboxctl`은 NAVER의 공식 제품이 아니며 NAVER와 아무 상관이 없는 프로젝트입니다.
- MYBOX의 암호 폴더와 공유 받은 폴더는 지원하지 않습니다.
- 원격 변경은 되돌릴 수 있는 작업이라고 가정하지 마세요. `delete`는 MYBOX 휴지통으로 이동하지만,
  자동 sync나 백업 도구는 아닙니다.
- `upload`는 파일 내용이 아니라 크기와 수정 시각을 비교합니다. `download`는 기존 로컬 파일을
  기본적으로 덮어쓰지 않습니다.
- macOS의 한글·악센트 파일명은 원격 저장 시 정규화하지만, 같은 화면 이름이 여러 개면 안전을 위해
  중단합니다.

이 프로젝트는 AI 코딩 에이전트를 적극적으로 사용해 구현했습니다.

## 개발

```bash
bun run check
bun run build
```

실제 MYBOX를 변경하는 통합 테스트는 별도 opt-in입니다.

```bash
MYBOX_PAT=... bun run test:integration
```

## 문서

- [`llms.txt`](llms.txt) — 명령·옵션·자동화 계약 요약
- [`docs/reference/cli-contract.md`](docs/reference/cli-contract.md) — versioned CLI contract
- [`docs/reference/official-api-audit.md`](docs/reference/official-api-audit.md) — 공식 API와 구현 범위 대조
- [NAVER MYBOX Open API 문서](https://developers.mybox.naver.com/getting-started)

## License

[`MIT License`](LICENSE)
