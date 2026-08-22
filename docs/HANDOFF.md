# Current handoff

## 요약

- 현재 구현 phase는 아직 시작하지 않았다.
- Git/Bun/TypeScript 프로젝트 scaffold, lockfile, 구현 문서 구조를 생성했다.
- 다음 담당자는 Phase 00 API contract 검증부터 시작해야 한다.

## 다음 작업

1. [`phases/00-api-contract.md`](phases/00-api-contract.md)의 사전 조건을 확인한다.
2. 실제 MYBOX PAT와 전용 `/myboxctl-integration-test/` 사용 권한을 확보한다.
3. `PROGRESS.md`의 Phase 00을 `in_progress`로 변경한다.
4. mutation 안전장치부터 작성한 뒤 API contract test를 구현한다.

## 확인된 사실

- 로컬 Bun 버전: `1.4.0`
- 프로젝트 런타임 기준: Bun 1.4 이상
- package manager pin: `bun@1.4.0`
- 현재 제품 코드는 CLI 이름/version smoke scaffold뿐이다.

## 초기화 변경 파일

- `AGENTS.md`: Bun/architecture/workflow/MYBOX safety 지침
- `package.json`, `bun.lock`, `tsconfig.json`, `biome.json`: Bun 프로젝트 설정
- `src/cli.ts`, `src/cli.test.ts`: 최소 실행 가능한 CLI와 smoke test
- `PLAN.md`: phase 로드맵과 전체 MVP 완료 조건
- `docs/phases/*.md`: Luna용 phase별 상세 실행 계획
- `docs/architecture/*.md`, `docs/reference/*.md`: 설계 및 안정적 계약

## 검증

- `bun install`: 통과, `bun.lock` 생성
- `bun run check`: 통과, typecheck/Biome/Bun test 1개
- `bun run build`: 통과, `dist/cli.js` 생성
- `bun run dist/cli.js --help`: 통과
- 실제 MYBOX integration test: 미실행, PAT 필요

## 미확인 사항

- 실제 MYBOX 계정/PAT 사용 가능 여부
- 하위 폴더 목록 endpoint의 존재와 형태
- 검색 API의 생성 직후 read-after-write 일관성
- upload URL에 파일을 보내는 method/header/응답
- resume/offset/overwrite의 실제 동작

## 작업 종료 전 갱신 형식

다음 담당자에게 넘기기 전에 아래 항목으로 이 문서를 교체한다.

```text
요약: 무엇이 현재 checkout에 구현되었는가
현재 phase와 상태: PROGRESS.md와 일치하는가
변경 파일: 중요한 파일과 역할
검증: 실행한 명령, 통과/실패/미실행
결정: 새로 확정한 API/설계 사실
남은 작업: 다음의 첫 번째 구체적 행동
차단 요소: 해제 조건을 포함
```
