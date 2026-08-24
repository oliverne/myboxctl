# Contributing to myboxctl

기여에 관심을 가져 주셔서 감사합니다.

`myboxctl`은 NAVER MYBOX의 모든 기능을 구현하는 프로젝트가 아니라, 사람과 자동화 도구, AI 에이전트가
파일을 다루는 데 필요한 작은 CLI 기능을 안정적으로 제공하는 것을 목표로 합니다. 기능을 추가할 때도
이 방향을 가능한 한 유지하려고 합니다.

## 먼저 확인해 주세요

버그 수정, 문서 개선, 테스트 보강처럼 범위가 명확한 변경은 바로 PR을 열어도 좋습니다.

다음과 같이 프로젝트 범위를 크게 바꾸는 제안은 구현 전에 issue에서 먼저 논의해 주세요.

- MYBOX API의 광범위한 기능 추가
- MCP server
- 양방향 sync 또는 mirror
- daemon/watch service
- GUI/TUI
- 새로운 credential 저장 방식
- public JSON schema 또는 exit code 변경
- mutation retry 정책 변경

새 기능 자체를 반대하는 의미는 아닙니다. 작은 CLI라는 프로젝트 성격을 유지하면서 실제 사용 사례가
있는 기능부터 추가하기 위한 절차입니다.

## 개발 환경

필요한 환경은 다음과 같습니다.

- Bun 1.4 이상
- TypeScript
- 실제 integration test를 실행할 때만 NAVER MYBOX PAT

의존성을 설치합니다.

```bash
bun install --frozen-lockfile
```

변경 전후에 일반 검증을 실행해 주세요.

```bash
bun run check
bun run build
bun run test:release
```

일반 unit/HTTP/CLI 테스트는 실제 MYBOX 계정 없이 실행됩니다.

## 실제 MYBOX 테스트

실제 계정을 사용하는 테스트는 opt-in입니다.

```bash
MYBOX_PAT=... bun run test:integration
```

API 계약 자체를 다시 검증해야 하는 경우에만 다음 probe를 사용합니다.

```bash
MYBOX_PAT=... bun run test:contract
MYBOX_PAT=... bun run test:upload-probe
```

실제 MYBOX 테스트는 반드시 프로젝트의 전용 integration prefix 안에서만 mutation을 수행해야 합니다.
중요한 개인 데이터나 기존 폴더를 테스트 대상으로 사용하지 마세요.

## Pull Request

PR은 가능한 한 한 가지 목적에 집중해 주세요.

좋은 PR에는 보통 다음 내용이 포함됩니다.

- 변경 이유
- 사용자에게 보이는 동작 변화
- 추가하거나 변경한 테스트
- 직접 실행한 검증 명령
- 알려진 제한 또는 후속 작업

공개 CLI 계약을 변경한다면 관련 reference 문서도 함께 갱신해 주세요.

## 코드와 설계 원칙

- CLI command에서 직접 HTTP 요청을 만들기보다 기존 client/feature 계층을 사용합니다.
- mutation은 단순한 generic retry보다 operation별 reconcile 정책을 우선합니다.
- stdout JSON과 exit code는 자동화된 호출자가 의존하는 public contract로 취급합니다.
- PAT, Authorization header, signed upload URL 같은 secret은 출력하지 않습니다.
- 새로운 dependency는 꼭 필요한 경우에만 추가합니다.
- 구현보다 단순한 해결책이 있으면 단순한 쪽을 선호합니다.

자세한 설계는 [`docs/architecture/overview.md`](docs/architecture/overview.md)와
[`docs/reference/cli-contract.md`](docs/reference/cli-contract.md)를 참고해 주세요.

## AI-assisted contributions

AI 코딩 도구를 사용한 기여도 괜찮습니다. 이 저장소 자체도 AI 코딩 에이전트를 적극적으로 활용해
개발하고 있습니다.

다만 제출자가 변경 내용을 이해하고 검증할 책임이 있습니다. AI가 생성한 코드라는 이유만으로 테스트나
리뷰를 생략하지 말아 주세요. 가능하면 변경에 맞는 테스트를 함께 추가해 주세요.

## Security

PAT, 실제 Authorization header, credentials 파일, signed upload URL을 issue나 PR에 게시하지 마세요.

보안 관련 문제를 재현할 때도 secret 값은 반드시 제거하거나 가짜 값으로 바꿔 주세요.

## License

기여한 코드는 별도 합의가 없는 한 저장소와 동일한 [MIT License](LICENSE) 아래 제공되는 것으로
간주합니다.
