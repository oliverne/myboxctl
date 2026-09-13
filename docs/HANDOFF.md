# Current handoff

## 인수 목적

Phase 00~15의 구현과 필수 로컬/CI/live 검증, Phase 16의 OIDC 배포 전환과 외부 운영 절차를 완료했다.
현재 활성 구현 phase는 없으며, 다음 담당자는
새 phase 또는 release 범위를 정하면 된다. 전체 phase 상태와 최신 검증 수치는
[`PROGRESS.md`](PROGRESS.md)가 소유한다.

## 현재 상태

- 작업 브랜치: `main`
- Phase 00~16: 모두 `complete`
- 현재 배포: `@oliverne/myboxctl@0.3.2`, npm 단독 배포
- standalone/Homebrew/Scoop/install script 경로: 폐기
- 최신 로컬 검사: `bun run check` 261 pass, 38 skip, 0 fail; `bun run build` 통과
- 최신 publish: `v0.3.2` OIDC workflow 성공, registry `latest`와 provenance 확인 완료
- 사용자 확인: `v0.3.2` npx/global install smoke와 기존 npm publish token 및 GitHub `NPM_TOKEN`
  secret 폐기 완료 (2026-09-13)
- Agent Skill: `.agents/skills/myboxctl/`에 설치와 대표 명령 예제 중심의 교차 호스트 절차 및 독립 CLI
  contract reference를 추가하고 영문·국문 README에서 안내; Hermes 사용자 스킬 형식 및 정적 검증
  완료, 실제 호출은 미검증

## 구현된 현재 계약

### CLI와 출력

canonical command는 `list`/`ls`, `info`, `mkdir`, `upload`, `download`, `delete`다. `--json`은
versioned envelope를 stdout에 내고, event는 stderr 정책을 따른다. 상세 command/JSON/exit code 계약은
[`reference/cli-contract.md`](reference/cli-contract.md)를 기준으로 한다.

### Recursive transfer

- folder upload/download에는 명시적인 `--recursive`가 필요하다.
- manifest를 먼저 만들고 portable name, collision, symlink/non-regular entry와 identity/topology 변경을
  fail-closed로 검증한다.
- transfer tree는 exclusive create이며 기존 tree와 merge하거나 recursive overwrite하지 않는다.
- mutation 응답이 불확실할 때 POST를 반복하지 않고 `error.partialTransfer`로 확인된 결과와 불확실성을
  구분한다.
- download는 bounded-memory stream, 실제 기록 byte progress, 파일별 atomic commit을 사용한다.
- `MYBOX_PLAN` → XDG/default `config.json`의 `plan` → 보수적 기본값 순으로 limiter preset을 선택하며,
  shared request history와 cooldown은 유지한다.
- `--diagnostic-log`는 명시적으로 요청한 경우에만 exclusive JSONL을 만들며 PAT, Authorization, signed
  URL과 raw HTTP/argv를 기록하지 않는다.

세부 설계·완료 조건·실행 증거는 [`phases/15-recursive-folder-transfer.md`](phases/15-recursive-folder-transfer.md)와
[`architecture/reliability.md`](architecture/reliability.md)에 있다.

## 검증과 안전 경계

- 일반 검증은 저장소 루트에서 `bun run check` 후 `bun run build`를 순서대로 실행한다.
- 실제 MYBOX test는 `MYBOX_INTEGRATION=1 bun test test/integration`이며, mutation은
  `/myboxctl-integration-test/` 아래 unique child로 제한한다.
- live mutation, credential 변경, commit, push, tag와 publish는 서로 다른 승인 범위로 취급한다.
- PAT, Authorization header, upload/download URL과 token은 출력·로그·문서에 남기지 않는다.
- npm publish는 `id-token: write`를 사용하는 Trusted Publishing(OIDC) 방식이다. npm package의
  Trusted Publisher 등록, 첫 OIDC publish와 registry/provenance 및 설치 smoke 확인, 기존 npm publish
  token과 GitHub `NPM_TOKEN` secret 폐기를 완료했다.

## 기준 문서

- 범위와 phase 순서: [`PLAN.md`](PLAN.md)
- 현재 상태: [`PROGRESS.md`](PROGRESS.md)
- 문서 구조: [`README.md`](README.md)
- CLI 계약: [`reference/cli-contract.md`](reference/cli-contract.md)
- MYBOX API 관찰: [`reference/mybox-api.md`](reference/mybox-api.md)
- 공식 API coverage: [`reference/official-api-audit.md`](reference/official-api-audit.md)
- 배포 절차: [`operations/npm-release.md`](operations/npm-release.md)
- npm Trusted Publishing 전환: [`phases/16-npm-trusted-publishing.md`](phases/16-npm-trusted-publishing.md)
- 과거 결정/완료 phase 색인: [`reference/project-history.md`](reference/project-history.md)

## 로컬 시작

```bash
git fetch origin
git switch main
git pull --ff-only origin main
bun install --frozen-lockfile
bun run check
```

다음 작업을 시작하면 `PROGRESS.md`에서 해당 phase만 `in_progress`로 바꾸고, 범위 변경이 있으면
`PLAN.md`와 phase 문서를 함께 갱신한다.
