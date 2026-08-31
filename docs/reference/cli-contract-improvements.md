# CLI contract 개선 제안 (미적용)

이 문서는 [`cli-contract.md`](cli-contract.md)의 안정 계약에 대한 개선 제안을 모아둔다. 제안이
수용되어 구현·검증되면 해당 내용을 `cli-contract.md`로 승격하고 이 문서에서 제거한다. 이 문서는
코드 변경을 수반하지 않으며, 현재 checkout에서 관찰된 사실과 한계만 기록한다.

## 배경

`myboxctl`은 "Agent-friendly CLI"를 표방한다(`src/cli.ts`). `--help`와 `--json` envelope를 실제
출력·소스 기반으로 리뷰한 결과, 엔벨로프 설계·에러 구조·stdout/stderr 분리는 우수하나 에이전트
파싱 안정성을 갉아먹는 허점이 확인됐다.

## 우선순위 요약

| #   | 항목                                          | 우선순위 | 영향 범위                                                       | 상태   |
| --- | --------------------------------------------- | -------- | -------------------------------------------------------------- | ------ |
| 1   | `size` → `sizeBytes` (또는 단위 명시)         | 높음     | contract, ls/stat/upload/put/download 출력, `PublicResource`    | 제안   |
| 2   | 옵셔널 필드 `null` 일관화 + `schemaVersion`   | 높음     | 모든 `data` 스키마, envelope                                   | 제안   |
| 3   | `--help` 예시·exit code·기본 동작 보강        | 중간     | `cli.ts` help 텍스트                                           | 제안   |
| 4   | `type`/`modifiedAt` 정규화 선언               | 낮음     | contract 문서, stat/ls 출력                                    | 제안   |

## 1. size 단위 명확화

### 현상
- `ls`/`stat`/`upload`/`put`/`download`의 `data`에 `size: number`가 단위 표기 없이 노출된다.
- 필드명이 `size`라 출력만 보면 byte인지 다른 단위인지 불확정. 에이전트는 관례 기반 추론만 가능.
- 계약(`src/mybox/contract.ts`)도 `size: nonNegativeNumber`일 뿐 단위 메타데이터가 없다.
- 업로드 계약 문서(`docs/reference/mybox-api.md`)는 `fileSize`가 "정확한 byte size"임을 명시하나,
  `ls`/`stat`의 `size`는 명시하지 않는다.

### 제안
- `size` 필드명을 `sizeBytes`로 변경하거나, `cli-contract.md`에 "모든 `size`는 byte 단위 정수"를
  명시적 규칙으로 추가한다.
- 에이전트가 단위를 100% 확정할 수 있어야 한다.

### 영향
- `src/features/ls.ts` `toPublicResource`
- `src/features/stat.ts` `publicResource`, `PublicResource`
- `src/features/upload.ts` `UploadData`
- `src/features/put/command.ts` `PutData`
- `src/features/download.ts` `DownloadResult`
- `src/mybox/contract.ts` `resourceItemSchema`/`searchResourceItemSchema`의 `size`
- 관련 test(`test/cli/*.test.ts`, `test/integration/*`)의 스키마 단언

## 2. 옵셔널 필드 null 일관화 + schemaVersion

### 현상
- `PublicResource`에서 `resourceId?`/`size?`/`modifiedAt?`가 자유롭게 생략된다
  (`stat` 루트, `ls` 검색 결과 등). 에이전트는 매번 null-guard가 필수다.
- `ensure-dir`은 `resourceId: string | null`인데 다른 곳은 옵셔널(`resourceId?`)로 혼용된다.
- envelope에 스키마 버전 필드가 없어 포맷 변경을 에이전트가 감지할 수 없다.

### 제안
- 생략 대신 `null`로 통일한다(필드 항상 존재, 부재는 `null`).
- `ensure-dir`의 `resourceId: string | null` 규칙을 전체 `data`로 확장한다.
- 성공/실패 envelope 최상단에 `schemaVersion: 1`을 추가하고, 변경 시 increment한다.

### 영향
- `src/features/stat.ts` `PublicResource`
- `src/output.ts` `SuccessEnvelope`/`FailureEnvelope`
- 모든 `data` 타입과 출력 단언

## 3. --help 보강

### 현상
- 인자 설명이 없다(`<remote-directory>`가 절대경로인지, 선행 `/`가 필수인지 등).
- `Examples:` 섹션이 없다.
- 종료 코드 매핑(예: 429→8)이 미문서화되어 있다.
- `--json`이 기계파싱용임을 명시하지 않는다(비JSON은 헤더 없는 TSV).
- `put` 기본 동작(skip/conflict)이 도움말에 없다.

### 제안
- 각 명령에 `--help` 예시 1~2개를 추가한다.
- 공통 규칙에 exit code 표(성공 0, 인자오류 2, 인증/권한, not-found, conflict, rate-limit 8 등)를
  추가한다.
- `--json` 설명에 "기계 파싱용, stdout은 단일 JSON"을 명시한다.

### 영향
- `src/cli.ts` 명령 정의의 `.description` / `.argument` 설명 / `.addHelpText`

## 4. type/modifiedAt 정규화 선언

### 현상
- 코드(`isFolder` 등)는 소문자로 비교하지만 출력값은 원시값 그대로라 "File"/"file"이 혼재할 수 있다.
- `modifiedAt`이 ISO 8601이라는 선언이 contract에 없다.

### 제안
- contract에 "`type`은 소문자 `file`/`folder`로 정규화", "`modifiedAt`은 ISO 8601 UTC"를 명시한다.
- 필요 시 출력 단계에서 정규화한다.

### 영향
- `src/features/stat.ts`, `src/features/ls.ts`, `src/mybox/contract.ts`

## 수용 기준 (공통)
- 에이전트가 단위·필드 부재·스키마 버전을 명시적 정보로 판별 가능하다.
- `--json` stdout가 단일 JSON document 계약을 유지한다.
- 기존 test가 깨지지 않고 새 단언이 추가된다.

## 관련 문서
- [`reference/cli-contract.md`](cli-contract.md) — 적용된 안정 계약
- [`reference/mybox-api.md`](mybox-api.md) — API 응답 단위 근거
