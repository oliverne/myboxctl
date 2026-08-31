# Architecture overview

## 목적

다양한 AI 에이전트가 subprocess와 JSON으로 호출할 수 있는 단방향 MYBOX CLI를 구현한다.
특정 에이전트에 종속되지 않으며, 핵심 품질은 correctness, deterministic behavior, 단순한
구조, agent-friendly output 순이다.

## 의존성 방향

```text
CLI bootstrap
    ↓
feature command
    ↓
remote resolver / put decision
    ↓
MYBOX client
    ↓
Bun fetch + filesystem
```

- `src/cli.ts`는 argument parsing과 process exit만 담당한다.
- `src/features/`는 한 명령의 입력을 application operation으로 변환한다.
- `src/remote/`는 사용자 경로를 MYBOX ID와 exact resource로 해석한다.
- `src/mybox/`는 HTTP transport, runtime response validation, upload protocol을 담당한다.
- `src/output.ts`는 모든 명령의 성공/실패 envelope를 출력한다.
- `src/errors.ts`는 transport 오류를 안정적인 domain error로 변환한다.

CLI command는 `fetch`, `process.env`, 임의의 `console.log`를 직접 사용하지 않는다. runtime
조립 지점에서 config, client, resolver를 만들어 command에 전달한다.

## 목표 파일 구조

파일은 필요할 때 생성한다. 빈 디렉터리와 미사용 abstraction을 미리 만들지 않는다.

```text
src/
├── cli.ts
├── runtime.ts
├── config.ts
├── errors.ts
├── output.ts
├── mybox/
│   ├── client.ts
│   ├── contract.ts
│   └── upload.ts
├── remote/
│   ├── path.ts
│   ├── destination.ts
│   └── resolver.ts
└── features/
    ├── public-resource.ts
    ├── info.ts
    ├── list.ts
    ├── mkdir.ts
    ├── upload-command.ts
    ├── ensure-dir.ts
    ├── upload.ts
    ├── download-command.ts
    ├── download.ts
    ├── delete.ts
    └── put/
        ├── command.ts
        ├── decision.ts
        └── decision.test.ts
```

단순 명령은 파일 하나로 유지한다. metadata 기반 업로드 정책처럼 정책과 orchestration을 분리해야
테스트가 쉬운 경우에만 하위 디렉터리를 만든다.

## API contract와 domain model

MYBOX 응답은 경계에서 Zod로 검증한다. `contract.ts`의 schema에서 `z.infer`로 타입을 만들고,
동일 구조를 별도 interface로 다시 작성하지 않는다.

API response DTO와 CLI JSON은 같은 타입이 아니다. CLI는 API 필드 변경과 무관하게
[`../reference/cli-contract.md`](../reference/cli-contract.md)의 안정적인 contract를 유지한다.

## Remote path

- 입력은 `/`로 시작하는 POSIX 형식 절대 경로다.
- `\`, NUL, `.`, `..`, root를 벗어나는 표현은 거부한다.
- 중복 slash와 불필요한 trailing slash는 정규화한다. 단 `/`는 유지한다.
- URL encoding은 path parser가 아니라 MYBOX client가 query/path parameter 경계에서 수행한다.
- exact resource 판정은 반환된 `path`, `parentPath`, `name`을 비교하여 수행한다.
- 검색 결과의 첫 항목을 무조건 채택하지 않는다.

resolver의 최종 알고리즘은 Phase 00 결과로 확정한다. 문서에 없는 `listChildren` endpoint를
가정하지 않는다.

## 테스트 경계

- 순수 정책과 path parser: 구현 파일 옆 Bun unit test
- HTTP transport와 pagination: `test/http/`의 로컬 fake server
- CLI stdout/stderr/exit code: `test/cli/`의 subprocess test
- 실제 API contract와 acceptance: opt-in `test/integration/`

실제 API 테스트는 unique prefix를 생성하고 해당 prefix만 정리한다.
