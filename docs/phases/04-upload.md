# Phase 04 — `upload`

## 목표

로컬 파일을 전체 메모리 적재 없이 신규 업로드하고, 명시된 경우에만 기존 파일을 덮어쓴다.
중단과 응답 유실을 일반 POST retry가 아닌 검증된 resume/reconcile로 처리한다.

## 진입 조건

- Phase 03이 `complete`다.
- Phase 00에서 upload method/header/status와 resume 계약이 confirmed 상태다.
- `docs/PROGRESS.md`의 Phase 04가 `in_progress`다.

## 구현 파일

```text
src/mybox/upload.ts
src/features/upload.ts
src/mybox/client.ts
src/cli.ts
test/http/upload.test.ts
test/cli/upload.test.ts
test/integration/upload.test.ts
```

## 1. 로컬 파일 source

test부터 다음 case를 정의한다.

- regular file open/stat/stream/close
- 없는 파일, directory, 읽기 권한 없음
- 0-byte file
- offset 0과 non-zero stream
- upload 도중 size/mtime 변경
- success/error/SIGINT에서 handle close

업로드 시작 전에 path를 `realpath`로 강제 변경하지 않는다. symlink 허용 여부는 명시적으로
결정하여 test로 고정한다. 기본 권장은 최종 대상이 regular file이면 허용하는 것이다.

file handle의 첫 `fstat` 결과로 `fileSize`와 `modifiedTime`을 만들고 같은 handle에서 body를
stream한다. 완료 후 `fstat`이 다르면 성공 응답 대신 `local-file-changed`를 반환한다.

## 2. 업로드 protocol

Phase 00 fixture를 기반으로 다음 함수를 구현한다.

```ts
createUpload(request): Promise<{ uploadUrl: string; offset: number }>
uploadContent({ uploadUrl, fileHandle, offset, signal }): Promise<UploadResult>
```

- upload URL은 credential로 취급하고 오류 context/log에 저장하지 않는다.
- content length/range/header는 Phase 00 confirmed 값만 사용한다.
- offset은 `0 <= offset <= fileSize`를 검증한다.
- offset이 fileSize와 같을 때 서버가 완료 상태로 취급하는지 확인된 계약을 따른다.
- response body가 비어 있을 수 있으므로 무조건 JSON parse하지 않는다.

## 3. resume와 실패 처리

fake server test sequence:

1. 정상 단일 전송
2. content network failure 후 resume URL 재발급
3. non-zero offset부터 남은 byte 전송
4. invalid offset 거부
5. resume URL 재발급 실패
6. AbortSignal/SIGINT
7. response lost 후 remote reconcile

resume attempt 수를 bounded하게 유지한다. Phase 00에서 resume가 신뢰할 수 없다고 확인되면
MVP는 자동 resume를 비활성화하고 retryable failure로 반환한다. 처음부터 재업로드하는 fallback을
추측으로 추가하지 않는다.

## 4. `upload` command

```bash
myboxctl upload <local-path> <remote-path> [--overwrite] [--mkdir] [--json]
```

절차:

1. local file handle open/stat
2. remote parent resolve 또는 `--mkdir` ensure
3. target exact resolve
4. 존재하지 않으면 신규 upload
5. folder면 conflict
6. file이며 `--overwrite`가 없으면 conflict
7. upload URL 생성과 content 전송
8. postcondition 확인
9. local file stable 확인
10. JSON 결과 출력

postcondition은 upload 응답의 resource 정보가 충분하면 ID 기반 조회를 사용하고, 아니면 bounded
exact resolve를 사용한다. 적어도 type=file과 size 일치를 확인한 후 성공을 반환한다.

## 5. bounded memory test

100MB 이상의 sparse 또는 generated stream fixture를 사용한다. test가 100MB buffer를 한 번에
생성하지 않도록 한다. 시작/peak RSS를 기록하고 허용 상한을 파일 크기보다 충분히 낮게 둔다.
CI 편차가 큰 경우 엄격한 byte snapshot 대신 10MB와 100MB 업로드의 peak 증가가 선형으로
커지지 않는지를 확인한다.

## 검증

```bash
bun run check
bun run build
MYBOX_PAT=... bun run test:integration
```

실제 test는 0B, Unicode 소형 파일, 100MB 이상 파일, overwrite, interrupted resume를 포함한다.
resume을 안전하게 재현할 수 없다면 그 항목은 미검증으로 handoff하고 phase 완료 조건을 충족하지
못한 것으로 기록한다.

## 완료 조건

- 파일 전체를 `Bun.file(...).arrayBuffer()` 또는 동등한 방식으로 읽지 않는다.
- 신규/overwrite/conflict/local-change case가 test로 고정되어 있다.
- content failure가 일반 create/upload 재실행으로 이어지지 않는다.
- postcondition 확인 후에만 성공을 반환한다.
- 100MB 이상 파일에서 bounded memory 증거가 있다.
- signed upload URL이 test output과 fixture에 없다.

## Handoff

- 확정한 content request와 resume state machine
- postcondition 확인 방식
- file stability와 SIGINT cleanup 방식
- large-file RSS 측정 결과
- 실제 upload test resource cleanup 상태
- check/build/integration 결과
