# myboxctl

[English](https://github.com/oliverne/myboxctl/blob/main/README.md)

`myboxctl`은 NAVER MYBOX Open API를 얇게 감싼 작고 예측 가능한 파일 관리 CLI입니다.

AI 에이전트가 MYBOX에 파일을 올리고, 확인하고, 내려받고, 필요할 때 삭제하는 데 필요한 명령만
제공합니다. sync 도구, SDK, MCP 서버, MYBOX 전체 API wrapper가 목표는 아닙니다.

제가 Hermes Agent와 Codex CLI 등에서 쓰려고 만들었습니다. 사람이 터미널에서 직접 사용해도 이해할 수
있는 CLI를 목표로 합니다. NAVER의 공식 제품은 아닙니다.

## 명령

| 명령          | 기능                                        |
| ------------- | ------------------------------------------- |
| `list` / `ls` | 폴더 내용 또는 단일 resource 조회           |
| `info`        | 파일·폴더 정보 조회                         |
| `mkdir`       | 원격 폴더 생성 (`-p` 지원)                  |
| `upload`      | 크기와 수정 시각을 기준으로 안전하게 업로드 |
| `download`    | 기존 로컬 파일을 보존하며 다운로드          |
| `delete`      | 원격 파일·폴더를 MYBOX 휴지통으로 이동      |

## 설치

Node.js 20 이상이 필요합니다.

```bash
npm install -g @oliverne/myboxctl
myboxctl --version
```

MYBOX PAT는 `MYBOX_PAT` 환경 변수로 설정하거나, PAT 한줄만 `~/.config/myboxctl/credentials`에 저장하세요.
credentials 파일은 `chmod 600`으로 보호하세요. PAT를 명령 인자·소스·로그·Git에 넣으면 안 됩니다.

## 빠른 시작

원격(MYBOX) 경로는 `/`로 시작하는 POSIX 스타일의 절대 경로입니다.

```bash
myboxctl list /agents
myboxctl info /agents/report.md
myboxctl mkdir -p /agents/output
myboxctl upload ./report.md /agents/output/ --mkdir
myboxctl download /agents/output/report.md ./report.md
myboxctl delete /agents/output/report.md
```

꼭 알아둘 동작:

- `upload`는 content hash가 아니라 크기와 수정 시각을 비교합니다. 같은 파일은 건너뛰고 원격 파일이
  명백하게 더 최신 파일이면 중단합니다. 의도적으로 덮어쓸 때만 `--force`를 사용하세요.
- `download`는 `--overwrite`를 지정하지 않으면 기존 로컬 파일을 덮어 쓰지 않습니다.
- `delete`는 대상 파일을 MYBOX 휴지통으로 이동합니다. 암호 폴더, 공유 폴더는 지원하지 않습니다.
- 원격 파일명은 NFC(윈도우, 리눅스 스타일)로 저장하며, NFC(맥 스타일)와 파일명이 충돌할 경우 파일을 변경하지 않습니다.

## AGENT Rules

AI 에이전트는 `--json` 옵션을 사용하고 exit code를 먼저 확인하세요. stdout에는 `schemaVersion: 1` JSON 결과 하나가
출력됩니다. `--verbose`를 함께 사용하면 안전한 진행 event가 stderr JSON Lines로 출력됩니다. PAT와
서명된 전송 URL은 노출하지 않습니다.

```bash
myboxctl upload ./report.md /agents/output/ --mkdir --json
```

| Exit | 의미                          |
| ---: | ----------------------------- |
|    0 | 성공                          |
|  2–5 | 입력·인증·대상 없음·충돌      |
|  6–8 | API·로컬 파일·rate limit 오류 |
|   70 | 분류하지 못한 내부 오류       |

정확한 JSON 필드, action, option과 exit code 의미는
[versioned CLI contract](docs/reference/cli-contract.md)를 기준으로 합니다.

## 개발

소스 개발에는 Bun 1.4 이상이 필요합니다.

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

실제 MYBOX를 변경하는 테스트는 PAT를 설정하고 선택적으로 실행할 수 있습니다.

```bash
MYBOX_PAT=<YOUR_PAT> bun run test:integration
```

## 문서

- [CLI contract](docs/reference/cli-contract.md)
- [NAVER MYBOX Open API](https://developers.mybox.naver.com/getting-started)

## License

[MIT](LICENSE)
