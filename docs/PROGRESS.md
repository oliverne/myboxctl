# Progress

이 문서는 프로젝트 상태의 단일 기준이다. 추측이나 예정된 결과가 아니라 현재 checkout에서
확인된 사실만 기록한다.

## 현재 상태

- 현재 phase: `00-api-contract`
- 상태: `pending`
- 다음 담당자: Luna
- 마지막 갱신: 2026-08-22

## Phase 상태

| Phase | 상태 | 완료 증거 | 문서 |
| --- | --- | --- | --- |
| 00 API contract | pending | 없음 | [`phases/00-api-contract.md`](phases/00-api-contract.md) |
| 01 Foundation | pending | 없음 | [`phases/01-foundation.md`](phases/01-foundation.md) |
| 02 Read commands | pending | 없음 | [`phases/02-read-commands.md`](phases/02-read-commands.md) |
| 03 Ensure directory | pending | 없음 | [`phases/03-ensure-dir.md`](phases/03-ensure-dir.md) |
| 04 Upload | pending | 없음 | [`phases/04-upload.md`](phases/04-upload.md) |
| 05 Put | pending | 없음 | [`phases/05-put.md`](phases/05-put.md) |
| 06 Delete | pending | 없음 | [`phases/06-delete.md`](phases/06-delete.md) |
| 07 Hardening | pending | 없음 | [`phases/07-hardening.md`](phases/07-hardening.md) |

## 초기화 상태

- [x] Git 저장소 초기화
- [x] Bun 1.4 package/tooling 정의
- [x] TypeScript CLI smoke scaffold
- [x] 프로젝트용 `AGENTS.md`
- [x] phase/reference/architecture 문서 구조
- [x] `bun install` 및 `bun.lock` 생성
- [x] `bun run check` — typecheck, Biome, Bun test 통과
- [x] `bun run build` — `dist/cli.js` 생성 및 help 실행 확인

Phase 00 integration test는 PAT가 필요한 다음 구현 작업이므로 아직 실행하지 않았다.

## 상태 변경 규칙

- phase를 시작할 때만 `pending → in_progress`로 변경한다.
- 외부 권한이나 API 제약으로 진행할 수 없을 때 `blocked`와 구체적인 해제 조건을 기록한다.
- phase 문서의 모든 완료 조건과 검증이 충족된 경우에만 `complete`로 변경한다.
- 다음 phase를 시작하기 전 이전 phase의 handoff 결과가 `HANDOFF.md`에 있어야 한다.
