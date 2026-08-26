# Phase 09 — `download`

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 Phase 09의 실행 범위, 순서, 검증과 완료 조건을
정의한다.

## 목표

정확한 MYBOX 원격 파일을 사용자가 지정한 로컬 파일로 안전하게 streaming한다.

```bash
myboxctl download <remote-file> <local-path> [--overwrite] [--json]
```

원격 MYBOX 상태는 변경하지 않는다. 로컬에는 완료된 파일만 공개하며, 기존 destination은
`--overwrite`가 없으면 절대 변경하지 않는다. AI 에이전트는 JSON과 exit code만으로 download 성공,
원격 부재/type conflict, 로컬 충돌과 전송 실패를 구분할 수 있어야 한다.

## 진입 조건

- Phase 00~08이 모두 `complete`다.
- `docs/PROGRESS.md`의 Phase 09가 구현 시작 시 `in_progress`다.
- 공식 `GET /v1/drive/files/{fileId}/download` 문서가 계속 유효하다.
- PAT를 사용하는 실제 MYBOX integration은 opt-in이며 `/myboxctl-integration-test/` 아래의 unique
  child만 준비·정리한다.

현재 문서는 계획만 승인된 상태다. `pending`인 동안 production code와 integration resource를
변경하지 않는다.

## 공식 계약과 미확인 경계

공식 문서는 download URL 발급에 다음 계약을 제공한다.

- `GET /v1/drive/files/{fileId}/download`
- 응답 `200`: `{ downloadUrl: string, expiresIn: integer }`
- `downloadUrl`: 1회용, 10분간 유효
- 최소 요금제 기준 다운로드 500회/일

공식 문서만으로 signed storage URL의 실제 content method/status/header, redirect, 빈 파일 동작과
중간 실패 후 재사용 가능 여부를 production 계약으로 고정하지 않는다. P09-A targeted probe에서
필요한 최소 항목만 확인한다. PAT, Authorization header, signed URL 원문은 fixture, 예외, stdout,
stderr에 남기지 않는다.

## 범위

### 포함

- 기존 resolver를 사용한 exact remote file resolve
- remote root, absent, folder/type conflict 처리
- Zod 기반 download URL response schema와 `MyboxClient` method
- PAT가 없는 별도 signed content downloader
- response body의 bounded-memory streaming과 byte count 검증
- sibling temporary file과 성공 후 local commit
- destination no-clobber 기본값과 명시적 `--overwrite`
- remote metadata의 size/modified time postcondition
- 실패와 SIGINT의 response/file handle/temp cleanup
- human/JSON output과 기존 exit code 체계
- download URL 발급 및 content transfer의 operation-specific retry 정책
- fake HTTP, CLI subprocess, opt-in targeted probe와 실제 MYBOX acceptance
- Ubuntu 24.04, macOS Latest, Windows 11의 local commit 동작 검증

### 비범위

- directory recursive download
- remote path를 기준으로 local destination을 자동 추론
- local parent directory 자동 생성
- interrupted download resume 또는 Range request
- download cache, checksum DB, sync, watch
- 공유 링크 생성 또는 signed URL 출력
- download URL 미리 발급·저장
- rename, move, copy, favorite 또는 trash API

## 명령 계약

### 입력

```text
download <remote-file> <local-path> [--overwrite] [--json]
```

- `remote-file`은 기존 명령과 같은 POSIX absolute remote path다.
- `local-path`는 최종 파일 경로이며 생략할 수 없다.
- local parent가 없거나 directory가 아니면 `local-file`로 실패한다.
- 기존 destination은 기본적으로 `conflict`다.
- `--overwrite`는 기존 regular file만 교체한다. directory, symbolic link와 기타 non-regular entry는
  옵션 유무와 관계없이 거부하며 따라가지 않는다.
- destination conflict는 download URL 발급 전에 판정한다.

### 성공 출력

```json
{
  "ok": true,
  "command": "download",
  "action": "downloaded",
  "data": {
    "remotePath": "/agents/output/report.md",
    "localPath": "./report.md",
    "resourceId": "resource-id",
    "size": 1234,
    "modifiedAt": "2026-08-27T12:00:00+09:00"
  }
}
```

`downloadUrl`, storage host/path/query와 PAT는 성공·실패 data에 포함하지 않는다. human output도 action,
remote/local path, size와 modified time만 출력한다.

## 로컬 파일 안전 정책

1. `lstat`으로 destination과 parent를 검사하고 symlink를 따라가지 않는다.
2. destination과 같은 directory에 충돌하지 않는 temporary regular file을 exclusive create한다.
3. signed response body를 일정 크기 chunk로 temp handle에 기록하며 전체 파일을 메모리에 만들지 않는다.
4. 수신 byte count가 최초 remote detail의 `size`와 같은지 검사한다.
5. 같은 resource ID를 다시 조회해 `size`와 `modifiedAt`이 전송 중 바뀌지 않았는지 검사한다.
6. temp file의 mtime을 remote `modifiedAt`으로 설정하고 handle을 sync/close한다.
7. 기본 모드는 no-clobber commit을 사용한다. 동일 directory hard link 등 Bun 1.4에서 검증된 원자적
   primitive만 채택하며 destination이 생겼으면 원본을 보존하고 `conflict`로 실패한다.
8. `--overwrite`는 검증된 atomic replace만 사용한다. 기존 destination을 먼저 unlink하는 fallback은
   금지한다.
9. 모든 실패와 SIGINT에서 response body를 취소하고 handle을 닫고 temp file만 정리한다.

no-clobber/replace primitive가 Ubuntu, macOS, Windows에서 같은 안전 계약을 충족하지 않으면 임시
우회 구현을 채택하지 않고 Phase 09를 `blocked`로 기록한다.

## retry와 호출 한도

- download URL 발급은 read-only지만 1회용 credential과 일일 호출 한도를 만든다. 기존 generic GET
  retry를 그대로 적용하지 않고 operation별 bounded policy를 정의한다.
- 응답을 받지 못한 URL 발급 요청은 성공 여부를 알 수 없으므로 자동 반복하지 않는다. retryable
  failure를 반환해 새 CLI 실행에서 다시 시도하게 한다.
- signed content transfer는 한 URL당 정확히 한 번 수행한다. 실패한 URL을 재사용하거나 같은 실행에서
  새 URL을 자동 발급하지 않는다.
- Phase 09에서는 Range/resume을 추측하지 않는다. partial temp file은 삭제한다.
- 공식 문서가 일일 한도의 reset boundary와 공유 기준을 충분히 정의하지 않으면 guessed local daily
  bucket을 만들지 않는다. 서버 429를 기존 `rate-limit`/exit 8 계약으로 노출하고 미확정 사항을
  `docs/reference/mybox-api.md`에 기록한다.
- 실제 한도를 소진해 429를 만들지 않는다.

## 구현 순서

### P09-A — targeted download probe

파일:

- `test/integration/download-contract.test.ts`
- 필요 시 작은 probe helper
- `package.json`
- `docs/reference/mybox-api.md`

검증 항목:

- unique prefix의 기존 upload 기능으로 0-byte와 Unicode 소형 파일 준비
- URL 발급 status/schema와 `expiresIn`
- signed content request의 method, 성공 status, redirect 여부와 body byte 일치
- signed request에 PAT/Authorization을 보내지 않아도 성공하는지
- response `Content-Length` 유무와 실제 byte count
- URL, token, Authorization이 test name/output/fixture에 없는지
- exact remote cleanup

probe는 `MYBOX_DOWNLOAD_PROBE=1 bun test test/integration/download-contract.test.ts`로 분리하고
`test:download-probe` script를 제공한다. broad `test:contract`는 공식 endpoint/schema가 기존 ledger와
모순될 때만 다시 실행한다. probe가 안전한 content request를 확정하지 못하면 Phase 09를 `blocked`로
두고 production fallback을 만들지 않는다.

### P09-B — schema와 transport

파일:

- `src/mybox/contract.ts`
- `src/mybox/contract.test.ts`
- `src/mybox/client.ts`
- `src/mybox/download.ts`
- `src/mybox/rate-limit.ts`와 관련 test — 공식 계약상 필요한 경우만
- `test/http/download.test.ts`

작업:

- Zod에서 `DownloadUrlResponse` type을 파생한다.
- `MyboxClient`에 URL 원문을 외부 output으로 전달하지 않는 발급 method를 추가한다.
- signed URL에는 PAT header를 보내지 않는 downloader substitution boundary를 둔다.
- response body를 chunk streaming하고 수신 byte 수를 반환한다.
- URL 발급과 content transfer의 timeout/error/redaction/cleanup을 집중 테스트한다.
- existing search/detail limiter를 재사용하고 확인되지 않은 download bucket은 추가하지 않는다.

### P09-C — command vertical slice

파일:

- `src/features/download.ts`
- `src/runtime.ts`
- `src/cli.ts`
- `src/output.ts`
- `test/cli/download.test.ts`
- 필요 시 local file commit 전용 unit test

작업:

- behavior test를 먼저 작성해 absent/folder/destination conflict에서 URL 발급이 0회인지 고정한다.
- remote detail snapshot, local preflight, URL 발급, streaming, postcondition, commit 순서로 orchestration한다.
- `downloaded` human/JSON output과 failure exit code를 추가한다.
- 빈 파일, Unicode, short/long body, local write failure, remote-changed, timeout, SIGINT와 secret redaction을
  검증한다.
- no-clobber와 `--overwrite`의 race test를 작성한다.

### P09-D — 문서와 cross-platform 검증

파일:

- `README.md`
- `docs/reference/cli-contract.md`
- `docs/reference/mybox-api.md`
- `docs/reference/official-api-audit.md`
- `docs/architecture/reliability.md`
- `.github/workflows/ci.yml`

작업:

- public command, JSON shape, local overwrite와 retry 정책을 문서화한다.
- official inventory의 download를 구현 상태로 변경한다.
- credential redaction/diff 검사를 유지한다.
- Ubuntu 24.04, macOS Latest, Windows 11에서 local no-clobber/atomic replace/SIGINT cleanup test를
  실행한다.

### P09-E — 실제 MYBOX acceptance

파일:

- `test/integration/download.test.ts`
- `docs/PROGRESS.md`
- `docs/HANDOFF.md`

흐름:

1. unique remote folder와 0-byte/Unicode content file을 기존 upload로 준비한다.
2. 첫 download → `downloaded`, byte와 mtime 확인
3. 같은 local destination 재실행 → `conflict`, URL 발급 0회
4. remote content 변경 후 `--overwrite` → `downloaded`, 새 byte 확인
5. folder download → type conflict, local file 없음
6. fake/integration fixture와 process output에 signed URL/PAT가 없는지 확인
7. remote unique resources와 local temp/destination을 exact cleanup

## 필수 검증

```bash
bun run check
bun run build
bun run test:download-probe
bun run test:integration
git diff --check
```

- `test:download-probe`와 `test:integration`은 PAT가 있는 opt-in 실행이다.
- 일반 CI는 credential 없이 fake HTTP, CLI, local filesystem contract를 검증한다.
- download에 무관한 broad Phase 00 probe와 기존 upload interruption probe는 반복하지 않는다.
- sandbox의 `EADDRINUSE`, rate-limit state `EPERM`, DNS 실패는 같은 검사를 허용된 환경에서 재실행한
  결과와 비교한 뒤 코드 결함 여부를 판단한다.

## 완료 조건

다음을 모두 만족해야 Phase 09를 `complete`로 변경한다.

1. signed content method/status/header와 PAT-free request가 targeted probe로 확인됐다.
2. `download <remote-file> <local-path> [--overwrite] [--json]` 계약이 구현됐다.
3. absent, folder, destination conflict는 URL을 발급하지 않는다.
4. 전체 body를 메모리에 만들지 않고 remote size와 같은 byte만 commit한다.
5. 기존 destination, symlink와 non-regular entry가 안전 정책대로 보존된다.
6. failure/SIGINT에서 partial destination과 temp file이 남지 않는다.
7. URL 발급·content transfer가 정의한 retry 상한을 넘지 않는다.
8. PAT, Authorization과 signed URL이 stdout/stderr/JSON/test fixture에 나타나지 않는다.
9. Ubuntu, macOS, Windows local commit test가 통과한다.
10. 실제 MYBOX acceptance와 exact cleanup이 통과한다.
11. `bun run check`, `bun run build`, `git diff --check`가 통과한다.
12. reference, progress와 handoff가 실제 결과로 갱신됐다.

## Handoff

다음 담당자는 Phase 09를 `in_progress`로 변경한 뒤 P09-A부터 시작한다. 공식 문서의 1회용 URL이라는
표현만으로 storage content request, retry 또는 resume 동작을 추측하지 않는다. production code보다
targeted probe가 먼저이며, local atomic commit이 세 운영체제에서 검증되지 않으면 완료 처리하지
않는다.
