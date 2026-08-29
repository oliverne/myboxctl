# PHP 구현체 교차 감사

- 감사일: 2026-08-29
- 우리 기준선: [`oliverne/myboxctl@1ab0918`](https://github.com/oliverne/myboxctl/tree/1ab09182de11518e671eafb9550be7076320f849)
- 비교 대상: [`overworks/php-mybox@3050c92`](https://github.com/overworks/php-mybox/tree/3050c92bd60b52ddd148a8a7c9b2c66edca9aa21)
- 비교 대상: [`overworks/flysystem-mybox@42e3234`](https://github.com/overworks/flysystem-mybox/tree/42e3234adcc0278d5f5a99e5170f98472e53f382)

앞선 탐색에서 PHP SDK 저장소를 `overworks/mybox`로 표기한 것은 잘못이다. 실제 저장소 이름은
`overworks/php-mybox`다.

## 결론

PHP 코드를 그대로 이식할 필요는 없다. 현재 `myboxctl`은 mutation 재시도 경계, 로컬 파일 안정성,
원자적 download commit, schema 검증과 비밀정보 보호에서 더 안전하다. 반면 아래 세 영역은 PHP
구현이 유용한 검증 가설을 제공한다.

1. remote path component의 제어문자 거부
2. 휴지통 이동 뒤 resource ID의 조회 의미와 delete reconcile 재검증
3. 이름 비교의 Unicode 정규화/대소문자 의미 및 resume identity의 시간 literal 검증

외부 저장소의 live note나 주석은 우리 API 사실로 승격하지 않는다. 전용
`/myboxctl-integration-test/` 아래에서 재현된 결과만 `mybox-api.md`에 기록한다.

## 근거 등급

| 등급 | 근거 | 사용 방법 |
| --- | --- | --- |
| A | 공식 문서 또는 `myboxctl`의 재현 가능한 integration 관찰 | 현재 계약으로 사용 |
| B | 비교 저장소의 코드와 날짜가 있는 live note | targeted probe 후보로만 사용 |
| C | 소스 주석 또는 테스트 double의 가정 | 설계 아이디어로만 사용 |

특히 Flysystem 구현의 “같은 이름의 file과 folder가 함께 존재할 수 있다”는 주석은 우리 API-09
관찰과 모순된다. 이 가정은 도입하지 않는다.

## 도입 후보

| 우선순위 | 후보 | 근거와 권장 조치 |
| --- | --- | --- |
| P0 | path component의 C0/DEL 거부 | 현재 parser는 NUL만 거부하고 multipart filename은 CR/LF를 제거하지 않는다. `U+0000–U+001F`, `U+007F`를 입력 단계에서 거부하고 parser/upload/CLI 테스트를 추가한다. |
| P0 | delete reconcile 검증 | 외부 note는 trash된 resource가 ID detail로 계속 조회된다고 한다. 사실이면 현재 `getResource(id)` 기반 성공 판정이 응답 유실 뒤 오판할 수 있다. 원래 active path/parent listing과 동일 ID를 기준으로 확인하는 targeted probe를 먼저 수행한다. |
| P1 | 이름 비교 규칙 검증 | NFC/NFD와 대소문자 변형을 unique prefix에서 측정한다. 확인될 때만 비교 전용 canonical key를 도입하고 서버에 보내는 원래 spelling은 보존한다. canonical collision은 conflict로 처리한다. |
| P1 | resume identity 검증 | 외부 note의 Asia/Seoul literal, overwrite 시 offset 0, 중단 직후 423을 작은 bounded probe로 확인한다. 확인된 동작만 reservation identity와 operation-specific retry에 반영한다. |
| P2 | command-scoped directory snapshot | search 호출과 read-after-write 비용을 줄이는지 benchmark한 뒤 도입한다. full pagination을 지키고 임의 5,000개 cap이나 장기 process cache는 두지 않는다. |
| P2 | 허용 remote prefix | 여러 agent가 한 계정을 사용할 때 optional prefix confinement을 제공할 수 있다. 절대 경로와 JSON 계약은 유지하고 virtual root는 자동 도입하지 않는다. |

### P0-1. 제어문자

`src/remote/path.ts`는 backslash, NUL, `.`과 `..`을 거부하지만 CR/LF를 포함한 다른 제어문자는
통과시킨다. `src/mybox/upload.ts`는 multipart `filename`의 backslash와 quote만 escape한다. 따라서
remote filename이 multipart header 경계를 교란할 수 있다. 서버 수용 여부와 무관하게 CLI/agent
입력 계약에서 모든 C0 control과 DEL을 거부하는 것이 맞다.

### P0-2. delete 확인

현재 delete는 retryable 오류 뒤 동일 ID가 404인지 확인한다. PHP adapter note는 trash 이동 후에도
ID detail 조회가 성공한다고 기록한다. 이 주장은 아직 B급 근거다. 아래를 한 번의 isolated probe로
확인한다.

1. unique file을 생성하고 ID와 parent를 기록한다.
2. DELETE 뒤 active path resolve, parent listing, ID detail을 각각 확인한다.
3. 같은 ID의 두 번째 DELETE 결과를 확인한다.
4. 결과가 일치할 때만 reconcile 기준을 수정한다.

### P1-1. Unicode와 대소문자

Flysystem adapter는 NFC와 lowercase로 comparison key를 만든다. 이는 원래 이름을 변경하지 않고
lookup만 안정화한다는 점에서 좋은 패턴이다. 다만 JavaScript lowercase와 PHP `mb_strtolower`의
Unicode edge case가 다르고 서버 규칙도 아직 우리 쪽에서 확인하지 않았다. 검증 전 전역 normalize를
추가하면 서로 다른 이름을 같은 resource로 오인할 수 있으므로 먼저 probe한다.

### P1-2. resume/423

PHP SDK는 resume `modifiedTime`을 Asia/Seoul literal로 만들고, adapter는 423을 bounded retry한다.
우리 live probe에서는 같은 UTC ISO identity로 재예약했지만 non-zero offset을 관찰하지 못했다.
의도적으로 호출 한도를 소진하지 않고, 작은 파일/짧은 중단으로 literal과 overwrite flag를 분리해
측정한다. 423 retry는 upload reservation 같은 확인된 operation에만 한정한다.

### P2. listing snapshot과 prefix

Flysystem의 directory snapshot은 nested path 탐색에 필요한 API 호출을 줄일 수 있지만, 10초
process cache는 짧게 실행되는 CLI에서 효용이 작다. 더구나 5,000개에서 잘린 snapshot을 완전한
부재로 취급하면 correctness 문제가 생긴다. 도입한다면 한 command 안에서만 쓰고, pagination이
끝나지 않은 miss는 `unknown`으로 처리해야 한다.

Flysystem의 `rootDirectory`는 adapter 소비자에게 유용하지만 CLI의 절대 경로/JSON 계약을 바꾼다.
우리 쪽에서는 설정 가능한 “허용 prefix 밖 mutation 거부”가 더 작은 안전 기능이다.

## 도입하지 않을 항목

- transport 수준의 mutation/network/5xx 일괄 retry
- signed one-use download URL 재시도와 destination을 바로 `wb`로 여는 방식
- destination을 먼저 삭제하는 비원자적 move/rename
- root directory 전체 삭제, trash purge, signed temporary URL 노출
- size를 모르는 임의 stream의 자동 임시파일 buffering
- 측정 없는 process-persistent directory cache와 불완전 snapshot의 `not found` 판정
- exact folder search miss에서 첫 번째 검색 결과를 선택하는 fallback
- 사용 사례가 정해지지 않은 full API wrapper 또는 Flysystem 호환 계층

이 항목들은 현재의 “GET만 generic retry, mutation은 operation별 reconcile”, atomic download,
local regular-file handle, 비밀정보 redaction 원칙보다 안전하지 않거나 프로젝트 범위를 넓힌다.

## 현재 설계가 더 강한 부분

| 영역 | `myboxctl`의 유지할 설계 |
| --- | --- |
| retry | GET만 공통 retry하고 mutation은 operation-specific reconcile |
| upload | 먼저 파일을 열고 같은 handle을 `fstat`, 전송 후 안정성을 재검사 |
| download | sibling temp와 no-clobber/identity check 뒤 atomic commit |
| 계약 | Zod runtime schema와 stable JSON error envelope |
| 보안 | PAT, Authorization, signed upload/download URL redaction |
| 삭제 | root 사전 거부와 resolve 당시 ID 고정 |

## 권장 후속 phase

새 phase를 자동 시작하지 않는다. 필요하면 Phase 10 `cross-implementation-hardening`을 별도로 승인해
다음 순서로 수행한다.

1. 제어문자 거부와 unit/CLI 테스트
2. trash 이후 detail/path/listing targeted probe와 delete reconcile 결정
3. NFC/NFD 및 case semantics targeted probe
4. resumable upload가 우선 요구일 때만 KST literal/overwrite/423 probe
5. 검색 비용이 실제 문제일 때만 command-scoped snapshot benchmark

각 probe는 unique prefix와 exact cleanup을 사용한다. broad contract suite, quota exhaustion, generic
mutation retry, purge는 이 phase의 범위가 아니다.

## 확인한 주요 소스

- PHP SDK: [`Transport.php`](https://github.com/overworks/php-mybox/blob/3050c92bd60b52ddd148a8a7c9b2c66edca9aa21/src/Http/Transport.php), [`PathResolver.php`](https://github.com/overworks/php-mybox/blob/3050c92bd60b52ddd148a8a7c9b2c66edca9aa21/src/Path/PathResolver.php), [`Uploader.php`](https://github.com/overworks/php-mybox/blob/3050c92bd60b52ddd148a8a7c9b2c66edca9aa21/src/Transfer/Uploader.php), [`Downloader.php`](https://github.com/overworks/php-mybox/blob/3050c92bd60b52ddd148a8a7c9b2c66edca9aa21/src/Transfer/Downloader.php), [`transfer-protocol.md`](https://github.com/overworks/php-mybox/blob/3050c92bd60b52ddd148a8a7c9b2c66edca9aa21/docs/transfer-protocol.md)
- Flysystem: [`MyboxAdapter.php`](https://github.com/overworks/flysystem-mybox/blob/42e3234adcc0278d5f5a99e5170f98472e53f382/src/MyboxAdapter.php), [`ResourceLocator.php`](https://github.com/overworks/flysystem-mybox/blob/42e3234adcc0278d5f5a99e5170f98472e53f382/src/ResourceLocator.php), [`NameKey.php`](https://github.com/overworks/flysystem-mybox/blob/42e3234adcc0278d5f5a99e5170f98472e53f382/src/NameKey.php), [`adapter-notes.md`](https://github.com/overworks/flysystem-mybox/blob/42e3234adcc0278d5f5a99e5170f98472e53f382/docs/adapter-notes.md)
- 우리 구현: [`path.ts`](https://github.com/oliverne/myboxctl/blob/1ab09182de11518e671eafb9550be7076320f849/src/remote/path.ts), [`resolver.ts`](https://github.com/oliverne/myboxctl/blob/1ab09182de11518e671eafb9550be7076320f849/src/remote/resolver.ts), [`upload.ts`](https://github.com/oliverne/myboxctl/blob/1ab09182de11518e671eafb9550be7076320f849/src/mybox/upload.ts), [`delete.ts`](https://github.com/oliverne/myboxctl/blob/1ab09182de11518e671eafb9550be7076320f849/src/features/delete.ts), [`reliability.md`](https://github.com/oliverne/myboxctl/blob/1ab09182de11518e671eafb9550be7076320f849/docs/architecture/reliability.md)
