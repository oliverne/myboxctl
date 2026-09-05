# Progress

이 문서는 프로젝트 상태의 단일 기준이다. 추측이나 예정된 결과가 아니라 현재 checkout에서
확인된 사실만 기록한다.

## 현재 상태

- 현재 phase: `Phase 15 Recursive Folder Transfer`
- 상태: `complete`
- 릴리스 상태: npm `latest`는 `v0.3.0`이다. standalone 실행파일 배포는 폐기했고 npm(Node 기반) 단독
  배포를 사용한다. `v0.1.0` draft Release/tag는 삭제했다.
- 2026-09-06 `v0.3.0` Node npm launcher에서 ReadableStream upload 요청이 `duplex` 옵션 누락으로
  실패하는 오류를 재현하고 `duplex: "half"`를 추가했다. 실제 Node launcher upload 회귀와 전체
  `bun run check`(262 pass, 37 opt-in skip, 0 fail), 별도 `bun run build`가 통과했으며, 패치의
  commit/push/npm 재배포는 아직 실행하지 않았다.
- 활성 구현 phase: 없음
- 다음 담당자: 다음 phase 또는 다음 릴리스 범위를 결정한다.
- CLI 문서의 소비자는 특정 제품이 아닌 다양한 로컬 AI 에이전트로 정의한다.
- Phase 14 command surface, destination semantics, human renderer와 versioned machine envelope 구현을
  완료했다. `list`, `info`, `mkdir`, `upload`, `download`, `delete`와 `ls` alias를 제공하며, 기존
  legacy command와 제거된 option은 public CLI에서 노출하지 않는다.
- `docs/reference/cli-contract-improvements.md`의 CLI `--help`와 `--json` 개선 제안은 Phase 14 계획의
  입력으로 반영했다.
- README와 stable CLI contract를 현재 command surface와 JSON/output semantics에 맞춰 갱신했다.
- 2026-09-04 공개 기본 `README.md`를 영문으로 전환하고 `README.ko.md`를 추가했다. 두 문서는 서로
  링크하며 설치, 명령, 핵심 안전 규칙과 자동화 계약만 간결하게 담는다. 상세 계약은
  `docs/reference/cli-contract.md`를 기준으로 한다.
- Phase 14 review 후 기본 `mkdir`도 retryable/409/invalid-response 생성 실패를 exact path polling으로
  reconcile하며 POST를 반복하지 않도록 기존 ensure-dir 정책을 공유했다. `download` command는 최초
  canonical resolution을 destination 계산과 전송 실행에 재사용해 원격 검색을 1회만 수행한다.
- Phase 13은 지연 원인 계측, 429 처리 판정과 기본 human/`--json` agent 출력 모드를 다루는 실행
  계획으로 구체화한 뒤 P13-A~D 일반 구현을 완료했다. typed event sink, human/JSONL renderer,
  `--verbose`/`--quiet`, local limiter와 GET retry 계측, upload/put 진행률을 추가했다. 일반 검증은
  212 pass, 35 opt-in skip, 0 fail이다. targeted live probe는 1 pass, full live acceptance는 8 pass,
  17 opt-in skip, 0 fail로 통과했다. 장시간 지연 원인은 local search quota 대기로 확인했다.
- Phase 11 후속 dependency maintenance로 Release workflow의 artifact action을 Node 24 기반
  `upload-artifact@v7`과 `download-artifact@v8`로 갱신했다. PR Release workflow의 5개 native
  smoke는 통과했으며 새 tag 기반 artifact transfer는 아직 실행하지 않았다.
- 로컬 검증: Phase 15 구현 기준 `bun run check` 248 pass, 37 opt-in skip, 0 fail. 별도
  `bun run build` 결과는 아래 Phase 15 구현 기록에 남긴다.
- 실제 MYBOX live acceptance(`MYBOX_INTEGRATION=1 bun test test/integration`)를 2026-09-03에 로컬에서 실행해 8 pass, 17 opt-in skip, 0 fail, 2,284.88초(약 38분)로 통과했다. unique prefix cleanup도 검증하는 suite다. upload 통합 timeout 900s 상향과 upload 중복 resolution 제거 리팩터의 라이브 동작을 이번 실행으로 확인했다.
- `test/integration/upload.test.ts`를 정정했다. Phase 14에서 `put`이 `upload`로 통합된 뒤
  적용된 메타데이터 정책(size-different → 자동 `overwritten`, conflict는 remote-newer만)을
  반영하지 않은 stale 단언(기존 파일이 크기만 다를 때 `--force` 없이도 충돌이 아닌 덮어쓰기)을
  병합된 의미에 맞췄다. 권위 있는 acceptance는 `test/integration/put.test.ts`다. 특수문자 파일명
  검색 동작은 `docs/reference/mybox-api.md`의 API-12로 미확정 이슈로 기록했다.
- 마지막 갱신: 2026-09-06

## Phase 상태

| Phase                             | 상태     | 상태 근거                                                                                    | 문서                                                                                             |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 00 API contract                   | complete | contract test 4회 성공, resolver/upload 결과 및 미확정 항목을 API ledger에 기록              | [`phases/00-api-contract.md`](phases/00-api-contract.md)                                         |
| 01 Foundation                     | complete | config/error/output/client 및 fake HTTP test 통과, typecheck/lint/build 통과                 | [`phases/01-foundation.md`](phases/01-foundation.md)                                             |
| 02 Read commands                  | complete | path/resolver/stat/ls 구현, fake HTTP/subprocess 및 실제 MYBOX smoke 통과                    | [`phases/02-read-commands.md`](phases/02-read-commands.md)                                       |
| 03 Ensure directory               | complete | ensure-dir, 공유 검색 limiter, fake/subprocess/실제 MYBOX acceptance 통과                    | [`phases/03-ensure-dir.md`](phases/03-ensure-dir.md)                                             |
| 04 Upload                         | complete | 실제 소형 acceptance와 100MiB bounded-memory resume 완료 전송 통과                           | [`phases/04-upload.md`](phases/04-upload.md)                                                     |
| 05 Put                            | complete | 순수 decision, CLI/fake HTTP, 실제 metadata policy flow 및 cleanup 통과                      | [`phases/05-put.md`](phases/05-put.md)                                                           |
| 06 Delete                         | complete | file/non-empty-folder 실제 삭제, ID reconcile, limiter 및 cleanup 통과                       | [`phases/06-delete.md`](phases/06-delete.md)                                                     |
| 07 Hardening                      | complete | P07-A~D CI 및 통합 P07-E live acceptance 1회와 cleanup 확인                                  | [`phases/07-hardening.md`](phases/07-hardening.md)                                               |
| 08 Official API alignment         | complete | 공식 API correction, 일반 CI와 실제 MYBOX acceptance 통과                                    | [`phases/08-official-api-alignment.md`](phases/08-official-api-alignment.md)                     |
| 09 Download                       | complete | targeted probe, 3개 OS CI, 실제 MYBOX download acceptance와 cleanup 통과                     | [`phases/09-download.md`](phases/09-download.md)                                                 |
| 10 Cross-implementation hardening | complete | C0/DEL 방어, live delete/name probe, active-membership reconcile 및 CI 통과                  | [`phases/10-cross-implementation-hardening.md`](phases/10-cross-implementation-hardening.md)     |
| 11 Distribution & Release         | complete | v0.1.0 draft Release 최초 실행·재실행과 5개 native smoke 성공                                | [`phases/11-distribution-release.md`](phases/11-distribution-release.md)                         |
| 12 Cross-platform Unicode names   | complete | CI 90·Release 21, Phase 12 live probe run 33244082095 성공                                   | [`phases/12-cross-platform-unicode-filenames.md`](phases/12-cross-platform-unicode-filenames.md) |
| 13 Observability & test latency   | complete | 212 pass, targeted probe 1 pass, live acceptance 8 pass                                      | [`phases/13-observability-and-test-latency.md`](phases/13-observability-and-test-latency.md)     |
| 14 CLI UX & Agent Contract        | complete | canonical surface, destination/output contract, docs와 release smoke 검증 완료               | [`phases/14-cli-ux-and-agent-contract.md`](phases/14-cli-ux-and-agent-contract.md)               |
| 15 Recursive folder transfer      | complete | P15-A~D 로컬 구현·일반 검사, 3-OS matrix, recursive live acceptance와 failure-path 회귀 통과 | [`phases/15-recursive-folder-transfer.md`](phases/15-recursive-folder-transfer.md)               |

## 초기화 상태

- [x] Git 저장소 초기화
- [x] Bun 1.4 package/tooling 정의
- [x] TypeScript CLI smoke scaffold
- [x] 프로젝트용 `AGENTS.md`
- [x] phase/reference/architecture 문서 구조
- [x] `bun install` 및 `bun.lock` 생성
- [x] `bun run check` — typecheck, Biome, Bun test 통과
- [x] `bun run build` — `dist/cli.js` 생성 및 help 실행 확인

Phase 00 integration test를 구현하고 4회 성공시켰다. PAT 인증과 전용 `/myboxctl-integration-test/`
prefix 존재를 확인했으며, resolver/upload 계약 및 미확정 항목을
`docs/reference/mybox-api.md`에 기록했다.

Phase 01 Foundation을 완료했다. config/PAT 보호, domain error와 exit code, JSON envelope/redaction,
Zod 기반 API contract, GET 전용 retry/pagination transport, ephemeral fake HTTP server와 관련
테스트를 추가했다.

Phase 02 Read commands를 완료했다. POSIX remote path parser, exact search resolver, 공식 direct-child
listing client, `stat`/`ls`와 JSON/human output을 추가했다. fake HTTP 및 subprocess test에서
pagination, exact filtering, type conflict, absent 결과, deterministic ordering을 검증했고, 실제
MYBOX의 root/nested/Unicode smoke와 opt-in integration contract test를 통과시켰다.

Phase 03 Ensure directory를 완료했다. 누락된 remote folder component를 root부터 순차적으로
생성하고, 409/응답 유실 가능 오류 뒤에는 exact resolve로 reconcile하며 mutation POST를 반복하지
않는다. 최종 folder가 이미 존재하면 검색 1회로 반환하고, folder가 없을 때만 file conflict를
검색한다.

검색 GET은 local state의 10회/분 sliding window를 atomic lock으로 공유한다. 429는
`Retry-After`를 우선하고 header가 없으면 60초 + jitter를 사용하며 GET을 한 번만 재시도한다.
Phase 00 contract probe는 `test:contract`, command acceptance는 `test:integration`으로 분리했다.
`bun run check`는 76 pass, 6 integration skip, 0 fail이었고 build와 실제 MYBOX ensure-dir
acceptance도 통과했다. 실제 integration은 contract 3 skip, acceptance 1 pass였으며 unique test
resource cleanup까지 완료됐다.

후속 리뷰에서 Commander argument 오류도 JSON failure envelope와 exit 2를 사용하도록 보강했고,
공식 검색 계약의 optional `resources`/`responseMetaData` 누락을 빈 검색 결과로 정규화했다.

후속 phase 계획도 현재 rate-limit 및 probe 정책에 맞춰 갱신했다. 당시 Phase 04는 API-05 100MB
streaming, API-06 실제 interruption/non-zero resume와 resume 관련 API-08 `modifiedTime` 규칙을
targeted upload probe로 먼저 확정하고, 미확정이면 `blocked`로 두도록 계획했다. 이후 실제 probe와
사용자 정책 결정에 따라 server offset 0도 유효한 복구 지점으로 변경했다. Phase 05는 기존 search
limiter와 upload mutation 정책을 재사용하고, Phase 06은 같은 공유 state에 delete 60회/분 bucket과
동일 resource ID 기반 429 reconcile을 추가한다. Phase 07은 교차 프로세스 state/lock/cooldown과
최종 429 `retryAfterMs`/exit 8 계약을 검증한다. broad `test:contract`는 계약 변경이나 ledger
모순이 있을 때만 다시 실행한다.

최초 Phase 04 targeted probe는 unique integration folder에서 100MiB streaming multipart를
중단한 뒤 재예약했지만 `offset: 0`을 반환했다. 후속 리뷰에서 이 실행은 임의의 fetch 오류도 중단
성공으로 취급하고, 최초 reservation에 resume identity를 넣지 않았으며, 8MiB body read 직후
settle delay 없이 재예약한 것으로 확인됐다. 따라서 이 결과는 non-zero resume 미확정 증거일 뿐,
MYBOX resume 불가의 증거로 사용하지 않는다.

probe를 수정하고 실제 MYBOX에서 세 조건을 실행했다. 최초/재예약 모두 같은 `resume: true`,
`modifiedTime`, `isOverwrite`를 사용하고 64MiB read 뒤 2초 settle delay를 적용했다. in-process
stream error, read 직후 worker `SIGKILL`, 2초간 client buffer drain 뒤 worker `SIGKILL` 모두 resume
reservation이 `201 / offset: 0`을 반환했다. 각 실행 후 `/myboxctl-integration-test/` 목록이 빈 것도
확인했다.

따라서 현재 확인된 계약은 중단 후 resume reservation은 성공하지만 서버가 non-zero checkpoint를
제공하지 않는다는 것이다. 사용자가 server-returned `offset: 0`부터 전체 파일을 다시 보내는
recovery를 승인해 Phase 04를 `in_progress`로 재개했다.

production `upload` command와 file-handle 기반 multipart streaming을 추가했다. 최초 예약부터
`resume: true`와 같은 `modifiedTime`을 사용하며, retryable content failure 뒤 동일 identity로
예약을 정확히 한 번 재발급한다. 서버 offset 0은 전체 파일, non-zero는 남은 byte만 전송하고 두
번째 실패 뒤에는 세 번째 시도를 하지 않는다. 0-byte, non-zero range, restart-from-zero,
overwrite opt-in, `--mkdir`, local-file-changed, JSON subprocess 계약을 fake HTTP test로 고정했다.
실제 MYBOX용 0-byte Unicode 신규 upload, conflict, overwrite acceptance도 격리 prefix cleanup과 함께
추가했다. `MYBOX_INTEGRATION=1 bun test test/integration/upload.test.ts`를 실행해 1 pass, 0 fail을
확인했고 exact file/folder cleanup도 오류 없이 완료됐다.

승인된 offset 0 복구 정책을 반영한 뒤 `bun run test:upload-probe`를 다시 실행했다. 64MiB read 후
hard-kill한 최초 전송의 재예약은 `offset: 0`을 반환했고, production `MyboxUploader`가 100MiB 전체를
재전송해 postcondition을 만족했다. peak RSS 증가는 23,609,344 bytes로 파일 크기 104,857,600
bytes의 절반 미만이었으며 unique file/folder cleanup도 통과했다. Phase 04 완료 조건을 모두 충족해
상태를 `complete`로 변경했다.

Phase 05 Put을 완료했다. I/O 없는 decision 함수에 2초 mtime tolerance와 force/type/absent/file
우선순위를 고정했고 table-driven unit test 12개가 통과했다. command는 exact remote detail을 읽어
`uploaded`, `overwritten`, `skipped`를 반환하며 remote-newer와 folder conflict에서는 mutation을
수행하지 않는다. upload/overwrite는 Phase 04 `runUpload`를 재사용해 resume, postcondition,
`--mkdir`, 공유 search limiter 정책을 그대로 유지한다.

fake HTTP와 subprocess에서 skip/conflict POST 0회, absent upload, force overwrite, stable JSON reason과
conflict code를 확인했다. 실제 MYBOX 단독 put acceptance는 1 pass, 0 fail이었고, 전체
`bun run test:integration`은 5 pass, 6 opt-in skip, 0 fail로 완료됐다. unique 경로에서
uploaded → skipped → size-different overwrite → remote-newer conflict → force overwrite와 missing
parent → `--mkdir`를 검증하고 file/folder cleanup을 완료했다. `bun run check`는 107 pass, 15 skip,
0 fail이었고 build와 diff check도 통과했다.

Phase 06 Delete를 완료했다. 기본 absent는 `already-absent`, `--strict`는 not-found/exit 4이며 root는
API 호출 전에 거부한다. DELETE timeout/5xx/429 뒤에는 resolve 당시 resource ID만 조회한다. ID가
사라졌으면 삭제 성공으로 reconcile하고, 남아 있으면 429에만 같은 ID로 한 번 재시도한다. timeout/5xx는
DELETE를 반복하지 않으며 path에 새 ID가 나타나도 삭제 대상으로 바꾸지 않는다.

origin별 delete bucket을 기존 shared state/lock에 60회/분으로 추가했다. 두 limiter instance의 slot과
429 cooldown 공유, search bucket 분리를 fake clock으로 검증했다. 실제 MYBOX에서 file과 non-empty
folder DELETE가 204, 같은 ID 재삭제가 404임을 확인했다. 단독 acceptance는 1 pass, 전체
`bun run test:integration`은 6 pass, 6 opt-in skip, 0 fail이었다. active integration prefix cleanup은
완료됐고 unique test resources는 MYBOX 삭제 의미에 따라 휴지통에 남는다. `bun run check`는 121
pass, 18 skip, 0 fail이었고 build와 diff check도 통과했다.

Phase 07 Hardening을 시작했다. `SharedRateLimiter`에 production 기본값을 바꾸지 않는 test-only policy
주입을 추가하고, 두 Bun child process의 search slot 및 429 cooldown 공유, stale lock 복구, active
lock timeout fail-closed, malformed state fail-closed, state 비밀정보 비저장 테스트를 작성했다. 모든
command의 최종 429 JSON 한 줄/exit 8/`retryAfterMs`/redaction 계약과 build artifact의
shebang/help/version/argument 오류 계약도 subprocess test로 추가했다. symbolic link는 명령 시작 시
연 regular-file handle을 사용하며 경로를 다시 resolve하지 않는 정책을 test/reference에 고정했다.

Ubuntu Server 24.04의 frozen install, 0600 credentials, AI agent subprocess, retry/exit code,
upgrade/rollback 문서를 추가했다. 최초 작성 환경에는 Bun, Biome, TypeScript compiler와 MYBOX PAT가
없어 새 테스트, `bun run check`, `bun run build`, integration과 Ubuntu 실환경 절차를 실행하지
못했으며, 당시에는 Phase 07을 `in_progress`로 유지했다. 이후 Ubuntu 24.04/Bun 1.4 GitHub Actions
CI와 opt-in live acceptance로 필요한 증거를 보완했다.

GitHub Actions CI를 추가해 `ubuntu-24.04`와 Bun 1.4.0에서 frozen install, check, build를 실행한다.
CI에는 secret을 전달하지 않으며 MYBOX integration은 opt-in 상태로 유지한다. workflow run 결과는
원격 반영 후 확인해 Phase 07 검증 증거에 추가한다.

PR #1의 GitHub Actions CI run 3에서 Ubuntu 24.04/Bun 1.4.0 검증이 통과했다. frozen install,
typecheck, Biome, build artifact와 전체 test가 성공했으며 결과는 131 pass, 18 opt-in skip, 0 fail이다.
별도 build step도 104 modules bundle에 성공했다. 당시 Phase 07의 남은 필수 검증은 실제 MYBOX
acceptance와 credential leak/diff 최종 검사였다.

2026-08-24 공식 MYBOX Open API 문서를 전수 조사하고 현재 `MyboxClient`와 대조했다. 조사
시점에는 공식 20개 operation 중 8개를 사용했고 12개는 비범위 후보였다. 이후 Phase 08에서
`GET /v1/drive/storage`를 추가해 현재 coverage는 9/20이며, 나머지 11개는 사용 사례가 생길 때만
검토한다. 조사 결과와 분류는 `docs/reference/official-api-audit.md`에 기록했다.

사용자는 P07-E live acceptance를 Phase 08 breaking correction 이후로 이관하도록 승인했다. 이
전환에 한해 Phase 07과 Phase 08을 함께 `in_progress`로 두었고, Phase 08에서는 storage preflight,
현재 사용 operation별 limiter와 file/folder search type 분리를 production code와 테스트에 반영했다.
구현과 일반 CI 통과 후 사용자는 `live_acceptance=true` 실행 1회 성공을 충분한 최종 증거로 승인했다.

## Phase 08 구현 및 일반 CI 검증

Phase 08의 contract correction을 구현했다.

- `SearchOptions`를 `FileSearchOptions`와 `FolderSearchOptions`로 교체하고 file search의
  undocumented `path` 직렬화를 제거했다.
- storage/root list/folder list/resource detail/folder create/upload reservation에 operation별 독립
  60회/분 shared bucket을 추가했다.
- 공식 storage response schema와 process-local 5분 cache를 추가했다.
- upload와 mutation이 필요한 put은 `maxFileBytes` 초과를 reservation 전에 `FILE_TOO_LARGE`로
  거부한다. quota 부족은 서버 507을 따른다.
- PR #4 CI에서 Ubuntu 24.04/Bun 1.4.0 frozen install, typecheck, Biome, build,
  138 pass/21 opt-in skip/0 fail, diff check가 통과했다.

2026-08-24 GitHub Actions의 `live_acceptance=true` 실행 1회가 성공했다고 사용자가 확인했다. 해당
integration suite의 unique prefix cleanup과 일반 CI의 credential redaction/diff 검사를 최종 증거로
채택해 Phase 07과 Phase 08을 모두 `complete`로 변경했다.

## Phase 07/08 검증 순서 결정

2026-08-24 사용자는 Phase 08의 breaking refactor 전에 Phase 07 live acceptance를 실행하지 않고 최종
검증으로 통합하도록 승인했다. 이후 일반 CI와 통합 live acceptance 1회가 성공했고, 사용자는 1회를
충분한 최종 기준으로 승인했다. unique prefix cleanup, credential redaction과 diff 검증을 포함한
증거를 근거로 두 phase를 완료 처리했다.

## 릴리스 결정

2026-08-24 사용자는 현재 MVP의 공개 릴리스를 보류했다. Phase 00~08의 완료 상태와 기존 검증 증거는
유지하며, 릴리스 작업이나 새 구현을 자동으로 시작하지 않는다. 다음 작업은 실제 요구사항이 확정된 뒤
별도 phase로 정의한다.

## Phase 09 계획

2026-08-27 사용자는 미구현 공식 API 중 download를 다음 phase로 선택하고 계획 문서 저장을 요청했다.
[`phases/09-download.md`](phases/09-download.md)에 contract-first probe, local no-clobber/atomic commit,
bounded-memory streaming, secret redaction, fake/CLI/실제 MYBOX 및 세 운영체제 검증 조건을 기록했다.

Phase 09 P09-A targeted probe가 실제 MYBOX에서 통과했다. PAT 없는 signed GET 1회, 최종 200,
0-byte/Unicode byte 일치와 600초 이하 expiry를 확인했다. 이 계약에 맞춰 Zod schema, 단일 URL 발급,
bounded streaming downloader, exact remote pre/postcondition과 `download` command를 구현했다.

로컬 destination은 sibling exclusive temp, no-clobber hard link, regular-file overwrite의 identity 재검증과
atomic rename을 사용한다. destination 생성/변경 race, symbolic link/non-regular entry, byte mismatch와
SIGINT cleanup을 fake HTTP/CLI/local filesystem test로 검증했다. 일반 `bun run check`는 152 pass,
27 opt-in skip, 0 fail이다.

2026-08-28 최신 HEAD `f97daaacea49774e5a3f303dbefede1908c9d05f`에서 GitHub Actions CI #50을
수동 실행했다. Ubuntu 24.04, macOS Latest, Windows Latest의 local commit/download transport와
일반 check/build/diff가 모두 통과했다. 실제 MYBOX suite는 8 pass, targeted download probe는 1 pass로
완료됐으며 production download의 conflict 보존, atomic overwrite, folder 거부와 unique resource
cleanup을 확인했다. Phase 09 완료 조건을 모두 충족해 `complete`로 변경했다. 기존 공개 릴리스 보류
결정은 유지한다.

## 2026-08-29 PHP 구현체 교차 감사

`overworks/php-mybox@3050c92`와 `overworks/flysystem-mybox@42e3234`의 실제 소스를
`myboxctl@1ab0918`과 비교했다. 결과는
[`reference/php-implementation-audit.md`](reference/php-implementation-audit.md)에 기록했다.

- P0 후보는 remote path component의 C0/DEL 거부와 delete reconcile의 targeted 재검증이다.
- NFC/NFD·대소문자, Asia/Seoul resume literal, overwrite offset, 423은 외부 관찰이므로 우리
  integration probe 전에는 API 사실로 취급하지 않는다.
- generic mutation retry, direct `wb` download, destination 선삭제 move, purge/root clear,
  불완전 directory snapshot은 도입하지 않는다.
- production code와 API ledger는 변경하지 않았고 live MYBOX 호출도 실행하지 않았다.
- 새 phase를 시작하지 않았으며 Phase 09 complete와 릴리스 보류 상태를 유지한다.

## Phase 10 시작

2026-08-29 사용자는 PHP 구현체 교차 감사의 후속 hardening 진행을 승인했다. Phase 10은 remote
path component의 C0 control/DEL 거부, delete 이후 ID detail·active path·parent listing targeted
probe, NFC/NFD·대소문자 semantics targeted probe만 필수 범위로 둔다. resumable upload의 KST
literal/overwrite offset/423과 directory snapshot 최적화는 실제 우선순위가 확인될 때 별도 phase로
남긴다. generic mutation retry, quota exhaustion, purge/root clear, move/copy, full API wrapper는
비범위다.

P10-A를 구현했다. remote path component에서 C0 control과 DEL을 모두 거부하며 multipart filename
boundary에서도 같은 문자를 방어적으로 거부한다. production resolver는 NFC/NFD normalization이나
case folding을 수행하지 않는다.

PR #6의 GitHub Actions CI run 33229198802에서 Ubuntu 24.04/Bun 1.4 frozen install, typecheck,
Biome, build, 188 pass/31 opt-in skip/0 fail과 Git diff check가 통과했다. macOS/Ubuntu/Windows의
download local commit regression도 모두 통과했다.

Phase 10 targeted live probe code와 현재 `server_semantics_probe` workflow input을 추가했다. GitHub Actions
run 33230351165에서 전체 integration 8 pass, download probe 1 pass와 Phase 10 probe 2 pass가
성공했다. unique integration child와 local temporary file cleanup도 성공했다.

probe에서 삭제된 ID detail은 200을 유지했지만 active exact path와 parent listing에서는 사라졌고,
같은 ID의 두 번째 DELETE는 404였다. retryable DELETE reconcile을 두 active membership 신호로
교체했다. 양쪽에서 기존 ID가 사라진 경우만 성공으로 판정하며, 같은 path의 대체 ID는 삭제하지
않는다. parent listing에 기존 ID가 남아 있으면 fail-closed한다.

NFC/NFD spelling은 서로 다른 파일과 ID로 보존됐다. ASCII case만 다른 두 번째 파일 생성은
conflict였으며 최초 spelling만 남았다. production은 NFC normalization이나 case folding을 추가하지
않고 exact spelling 정책을 유지한다.

최종 PR CI run 33231710723은 Ubuntu 24.04/Bun 1.4 check/build/diff와 191 pass/31 opt-in skip/0
fail을 통과했고 Ubuntu/macOS/Windows download regression도 성공했다. Phase 10 완료 조건을 모두
충족해 `complete`로 변경했다.

## Phase 11 구현 및 로컬 검증

2026-08-29 Phase 11 Distribution & Release를 시작했다. build-time SemVer 주입, Bun 1.4 standalone
cross-compile 5개 target, versioned tar.gz/zip과 `SHA256SUMS` 생성을 구현했다. 같은 checksum에서
Linux installer, Homebrew formula와 Scoop manifest를 생성하며 npm은 `@oliverne/myboxctl` launcher와
5개 optional platform package로 분리한다.

`v*` tag workflow는 일반 check 후 5개 native runner에서 archive의 checksum, `--version`과 `--help`를
검증하고 모두 성공한 경우에만 draft Release를 만든다. 공개 Release의 npm/Homebrew 반영은 별도
수동 workflow로 분리했으며 public Release, registry/tap 권한과 전용 token이 없으면 실행하지 않는다.

로컬 Bun 1.4.0에서 `bun run check` 194 pass, 31 opt-in skip, 0 fail과 `bun run test:release` 3
pass를 확인했다. `0.1.0-test`로 5개 archive와 checksum/installer/formula/manifest를 생성했고 Linux
x64 archive checksum·압축·`--version`·`--help`, npm launcher `--version`, Windows zip integrity와
installer shell syntax가 통과했다. macOS arm64/x64, Linux arm64, Windows x64 native 실행과 실제
draft Release workflow는 원격 CI에서 확인해야 하므로 Phase 11은 `in_progress`다.

PR #8 Release workflow run 33235460712에서 5개 archive build와 macOS arm64/x64, Linux arm64/x64,
Windows x64 native checksum·`--version`·`--help` smoke가 모두 통과했다. macOS arm64 runner의
Homebrew formula Ruby syntax도 통과했고 일반 CI run 33235460718도 성공했다. 실제 tag 기반 draft
Release 생성은 아직 실행하지 않았으므로 Phase 11은 `in_progress`를 유지한다.

## Phase 12 계획

2026-08-29 사용자는 macOS, Windows와 WSL2를 함께 사용할 때 파일시스템의 NFC/NFD 차이가 원격
중복, 조회 실패 또는 Windows 애플리케이션의 한글 자소 분리 표시로 이어질 수 있음을 실제 사용
요구로 확정했다. [`phases/12-cross-platform-unicode-filenames.md`](phases/12-cross-platform-unicode-filenames.md)에
새 원격 이름의 NFC 생성, 기존 NFD resource의 단일 canonical fallback, 다중 후보 fail-closed,
로컬 경로 비정규화와 세 운영체제/실제 MYBOX 검증 계획을 기록했다.

Phase 12 구현을 시작했다. NFC helper와 canonical-aware resolver를 추가하고 `ensure-dir`, `upload`,
`put`, `stat`, `ls`, `download`, `delete`에 연결했다. 새 원격 이름은 NFC로 생성하며, mutation에서
canonical-equivalent sibling이 여러 개면 `UNICODE_NAME_COLLISION` conflict로 중단한다. CI 85의 Bun
check/build/full tests와 Ubuntu/macOS/Windows local download regression, Release 17의 5개 native
smoke가 성공했다. 실제 MYBOX targeted probe만 workflow dispatch 후 확인한다.

Phase 12가 완료되어 Phase 11의 tag 기반 draft Release 검증을 재개할 수 있다. 실제 public publish는
기존 권한과 승인 조건을 확인하기 전까지 보류한다.

## Phase 11 원격 Release 검증 완료

2026-08-30 `main` commit `4e895b745d7822b6b2e74fc80939642d27c542e5`에 annotated tag
`v0.1.0`을 생성했다. Release workflow run 33309779551의 최초 실행과 attempt 2 재실행이 모두
성공했다. 두 실행에서 macOS arm64/x64, Linux arm64/x64, Windows x64 checksum·`--version`·`--help`
native smoke가 통과했다.

draft Release ID 379266317 하나를 유지하면서 9개 asset을 `--clobber`로 교체했고, 재다운로드한 5개
archive는 `SHA256SUMS` 검증을 통과했다. run log와 asset에서 PAT, Authorization 값 또는 signed
upload/download URL 노출을 찾지 못했다. draft는 공개하지 않았고 npm/Homebrew/Scoop publish도
실행하지 않았다. Phase 11 완료 조건을 충족해 `complete`로 변경했다.

## Phase 12 구현 진행

로컬 TypeScript typecheck와 Biome 검사를 통과했다. CI 85에서 Bun check/build/full tests와
Ubuntu/macOS/Windows local download regression이 성공했고, Release 17에서 5개 native smoke가
성공했다. Phase 12는 실제 MYBOX targeted probe가 남아 있어 완료 처리하지 않는다. 프로브는 NFC
입력으로 기존 NFD resource를 찾는 단일 fallback, canonical-equivalent 중복 mutation 차단, 신규
원격 이름의 NFC 전송, 그리고 local path 비정규화를 확인하며 `workflow_dispatch`의
`unicode_probe=true`로 실행한다.

## Phase 13 완료

typed event sink, human/JSONL renderer, `--verbose`/`--quiet`, local limiter와 GET retry 계측,
upload/put byte progress를 구현했다. 로컬 `bun run check`는 212 pass, 35 opt-in skip, 0 fail이며 별도
build와 release contract 3 pass도 통과했다.

기존 live integration test 5개가 `--json` stderr를 항상 빈 문자열로 가정하던 문제를 수정했다. 모든
CLI subprocess는 stderr가 비어 있거나 각 줄이 command와 event/data allowlist 및 credential
redaction을 통과하는 JSON object인지 검증한다. 수정 commit `710cde2`를 PR #11에 push했고 일반 CI
run 33388258127과 Release run 33388258207의 5개 native smoke가 성공했다.

분리 dispatch로 Phase 13 targeted probe run 33388395781이 1 pass, 0 fail, 1,095.83ms에 event 없이
통과했다. full live acceptance run 33388494698은 8 pass, 17 opt-in skip, 0 fail이며 1,875.35초가
걸렸다. 직전 진단 run의 실제 event 16쌍은 모두 local search `quota`였고 시작 event의 `waitMs`
합계는 271,777ms였다. 서버 429, `server-cooldown`과 `http.retry-scheduled`는 관찰되지 않았다.

공식 검색 한도와 일치하는 local bucket을 완화하지 않고, GET 429 한 번 retry, `Retry-After` 우선,
header가 없을 때 60~61초 fallback 정책을 유지한다. Phase 13 완료 조건을 충족해 `complete`로
변경했다. PR #11은 2026-08-31에 `main`으로 merge되었으며, public Release/publish는 별도 결정으로 남긴다.

## Phase 14 완료

2026-09-01 첫 공개 Release 전에 command surface, destination semantics, human output과 versioned JSON
contract를 정리하는 Phase 14 구현을 완료했다. canonical command 여섯 개와 `ls` alias, destination
intent, `mkdir -p`, delete missing policy, human renderer, `schemaVersion: 1`, explicit nullable
fields, normalized type/time, JSON stream와 global presentation options를 구현하고 subprocess/unit
regression으로 고정했다. README, architecture overview와 stable CLI contract도 갱신했다.

검증은 `bun run check`에서 225 pass, 35 opt-in integration skip, 0 fail이며 `bun run test:release`의
artifact/help/invalid-argument/list smoke 4건도 통과했다. live MYBOX acceptance는 새 API를 추가하지 않는
CLI contract 변경이라 opt-in 정책에 따라 실행하지 않았고, 공개 Release는 별도 승인 전까지 보류한다.

## Phase 14 P2 hardening (공개 Release 전)

2026-09-01 소스 리뷰의 P2 권고 3건을 Phase 14 contract를 유지하며 처리했다.

- `upload` local basename은 `node:path`의 host-native `basename(localPath)`을 그대로 사용한다. local
  path의 `\`→`/` 치환·임의 정규화를 제거했다. POSIX에서 `report\2026.txt`처럼 실제 backslash가 포함된
  파일명은 basename 전체가 remote filename이 된다.
- human `list` table 열 순서를 `TYPE NAME SIZE MODIFIED`에서 `TYPE SIZE MODIFIED NAME`으로 바꿨다.
  NAME을 마지막 열로 두어 긴 ASCII·한글·혼합 이름이 앞 열 정렬을 깨지 않도록 했다. 새 display-width
  의존성은 추가하지 않았다. JSON envelope, resource shape, 정렬 순서는 변경하지 않았다.
- public resource 정규화는 fail-closed로 바뀌었다. `type`이 `file`/`folder`가 아니거나 public 변환에
  도달한 누락 값, `modifiedAt` 값이 존재하지만 RFC 3339 형식이 아니면 `apiResponseError`(code
  `API_RESPONSE_INVALID`, kind `api-unavailable`)로 실패한다. 부재 `modifiedAt`은 `null`이다. 이전의
  추정 기본값(unknown→folder, invalid date→null)을 제거했다. 검증은 public 변환 경계
  (`public-resource.ts`)에서 수행하며, MYBOX Zod schema는 다른 consumer를 깨지 않도록 완화된 채로 두었다.
- `docs/reference/cli-contract.md` Human output 설명을 실제 출력(`TYPE SIZE MODIFIED NAME`)과 맞췄다.
- canonical command, `schemaVersion: 1`, destination semantics, overwrite 정책은 변경하지 않았다.
- 실제 MYBOX integration test는 실행하지 않았다(별도 승인 필요, 인수인계 범위 외).

초기 검증: `bun run check` 234 pass, 35 opt-in skip, 0 fail; `bun run build` 통과;
`bun run test:release` 4 pass. 후속 리뷰에서 `Date.parse()`의 느슨한 입력 허용을 발견해
`z.iso.datetime({ offset: true })` 기반 RFC 3339 검증을 추가했다. 모호한 날짜, date-only와 timezone-less
값은 거부하고 UTC/명시적 offset은 허용한다. 최종 commit `7e474bd`의 CI run `33576388192`는
236 pass, 35 opt-in skip, 0 fail로 성공했다.

## 2026-09-03 문서 정리

사람용 README를 제품 소개, 지원 명령, 설치 상태, 주의사항과 개발 명령만 남기는 짧은 문서로
재작성했다. 당시 명령별 사용법과 AI subprocess 계약은 별도 AI 문서로 분리했다. 2026-09-04에는
별도 AI 문서를 삭제하고 필수 계약만 영문·국문 README에 다시 통합했다.

## 2026-09-03 v0.2.0 live acceptance

사용자가 로컬에서 `MYBOX_INTEGRATION=1 bun test test/integration`을 실행했다. 결과는 8 pass,
17 opt-in skip, 0 fail이며 wall time은 2,284.88초(약 38분)였다. 12개 파일, 112 expect() 호출.

- 통과 8건: download/upload/put/ensure-dir/delete acceptance, final MVP flow(격리 자원 2회),
  upload probe interruption 분류 2건.
- skip 17건은 `live_acceptance=true`나 `phase*` 플래그 기반 opt-in probe(api-contract,
  cross-platform Unicode, observability, upload/download contract, cross-implementation hardening)로
  plain 실행에서는 의도적으로 건너뛴다.
- unique integration child는 suite가 cleanup까지 검증한다. 원격 잔여를 직접 확인하는 별도 API 호출은
  하지 않았다.
- 이전에 미검증으로 두었던 두 항목을 이번 실행으로 검증했다. (1) upload 통합 timeout 900_000 상향 뒤
  `--force` 업로드가 SIGTERM(143) 없이 완료된다. (2) `runPut`→`runUpload` resolution 전달 리팩터가
  라이브 upload/put acceptance를 그대로 통과한다.

## 2026-09-03 배포 전략 변경 (standalone 폐기 → npm-only)

macOS Gatekeeper가 미서명 standalone 실행파일(.tar.gz/.zip) 다운로드를 차단하는 문제와
"아무도 사용하지 않음" 판단에 따라 배포 전략을 바꿨다.

- GitHub Release 기반 standalone 실행파일 배포 폐기: `scripts/build-release.ts`, `render-packaging.ts`,
  `verify-release.ts`, `release-config.ts`(+test), `test/cli/release-contract.test.ts`,
  `.github/workflows/release.yml`, `.github/workflows/publish-homebrew.yml`, `docs/operations/release.md`,
  `docs/operations/release-v0.2.0-checklist.md` 삭제. `package.json`에서 `build:release`, `verify:release`,
  `test:release` 스크립트 제거.
- npm 배포를 Node.js 기반으로 재작성: `src`의 Bun 전용 런타임 API 4곳(`Bun.sleep` 3곳, `Bun.argv` 1곳)을
  Node 동등 코드로 교체(`process.argv`, `setTimeout` 기반 sleep). `scripts/build.ts`는 `Bun.build` target을
  `bun`→`node`(format `esm`)로 바꾸고, CJS 의존(commander)을 위해 `createRequire` 기반 `__require`를
  banner로 주입. `import.meta.main` 자기실행은 `typeof Bun !== "undefined" && Bun.main`으로 바꿔 Node에서
  이중 실행을 막았다.
- 새 npm 패키지(`@oliverne/myboxctl`): Node 번들(`dist/cli.js`) + `bin/myboxctl.js` 런처(`node` 실행).
  `engines.node >= 20`. 사용자 환경에 Bun 불필요. Homebrew/Scoop/install.sh 경로는 폐기.
- `scripts/prepare-npm.ts`·`publish-npm.ts`·`.github/workflows/publish-npm.yml` 재작성: 소스를 받아
  `bun run build` 후 npm 패키지 준비·`npm publish`(기존 "Require a published release"·"Release에서
  바이너리 다운로드" 단계 제거).
- 검증: `bun run check` 통과(229 pass / 35 skip / 0 fail). 로컬에서 `bun run build -- --version 0.2.0` →
  `bun run prepare:npm -- --version 0.2.0` → `node release/npm/bin/myboxctl.js --version`가 `0.2.0`을
  stdout 한 줄로 출력하고 exit 0. `npm pack --dry-run`으로 4개 파일 패키징 확인.
- `v0.2.0` GitHub Release(드래프트)는 삭제 완료. 게시 버전은 `v0.2.1`로 지정: `v0.2.1` tag를 리팩터 commit에
  생성하고 push. 기존 `v0.2.0` tag는 리팩터 이전 commit(`ffb5bd1`)을 가리키는 이력 마커로 잔류.

## 2026-09-04 npm package 리뷰 수정

- 생성 launcher의 `process.exit(code)`를 `process.exitCode = code`로 바꿔 Node가 pipe의 pending
  stdout/stderr write를 flush한 뒤 종료하게 했다.
- 가짜 Node bundle이 stdout/stderr에 각각 2 MiB를 쓰고 exit 7을 반환하는 child-process 회귀 테스트를
  추가했다. 수정 전에는 stdout이 잘려 실패했고 수정 후 전체 byte와 exit code를 보존한다.
- 생성 package manifest의 `files`에 `README.md`를 추가하고 루트 README를 package로 복사한다.
- 검증: 대상 test 2 pass, `bun run check` 231 pass / 35 opt-in skip / 0 fail, 별도 `bun run build`
  통과. v0.2.1 package launcher의 `--version`은 `0.2.1`/exit 0이며 `npm pack --dry-run`은 README를
  포함한 5개 파일을 확인했다. MYBOX live test와 npm publish는 실행하지 않았다.

## 2026-09-04 npm publish 차단점 수정

- `typeof Bun !== "undefined" && Bun.main`이 `bun test`에서 `src/cli.ts`를 import할 때도 참이 되어
  테스트 자체는 모두 통과한 뒤 host process의 exit code가 2가 되는 문제를 재현했다.
- source entry와 현재 process entry의 file URL을 비교해 직접 실행일 때만 `runCli()`를 호출하도록
  고쳤다. import는 host exit code를 바꾸지 않고, 직접 source 실행은 유지하며, Node launcher가 bundle을
  import해도 CLI를 정확히 한 번만 실행한다.
- `src/cli.test.ts`와 실제 Node bundle/package를 생성하는 `test/cli/npm-package.test.ts`에 회귀 검증을
  추가했다.
- `publish-npm.yml`은 동일 tag 중복 실행을 막고, publish 전에 `bun run check`, package `--version`,
  `--help`, `npm pack --dry-run`을 실행한다.
- 삭제된 release 문서 링크를 `docs/operations/npm-release.md`로 교체하고 npm token 생성, tag, workflow,
  registry smoke와 최초 publish 후 OIDC 전환 절차를 기록했다.
- 검증: `bun run check` 233 pass / 35 opt-in skip / 0 fail. 별도 `bun run build -- --version 0.2.2`,
  `bun run prepare:npm -- --version 0.2.2`, Node launcher `--version`/`--help`,
  `npm pack --dry-run ./release/npm`이 통과했고 package 6개 파일을 확인했다. 실제 publish, tag 생성,
  credential 변경, MYBOX live test는 실행하지 않았다.

## 2026-09-04 영문·국문 README 통합

- 공개 GitHub/npm 기본 문서를 영문 `README.md`로 전환하고 한국어 `README.ko.md`를 추가해 상호
  링크했다.
- 별도 AI 요약 문서는 삭제했다. 공개 command, 인증, upload/download/delete 안전 규칙, JSON stream과
  exit code 요약만 두 README에 통합하고 정확한 세부 계약은 `docs/reference/cli-contract.md`로 연결했다.
- npm package가 두 README를 모두 포함하도록 `scripts/prepare-npm.ts`와 회귀 test를 갱신했다.
- 두 README는 각각 98줄, 97줄이다. `bun run check` 233 pass / 35 opt-in skip / 0 fail, Prettier,
  local link 검사와 v0.2.2 npm package dry-run(두 README를 포함한 6개 파일)이 통과했다.

## 2026-09-04 root no-args help 수정

- `myboxctl`을 인자 없이 실행하면 Commander의 `commander.help`가 일반 argument 오류로 변환되어
  stderr에 `Error: (outputHelp)`를 출력하고 exit 2로 종료되던 문제를 재현했다.
- 인자가 없으면 runtime/config/PAT를 만들지 않고 root help를 stdout에 출력한 뒤 exit 0으로
  종료하도록 수정하고, subprocess 회귀 테스트로 API 미호출까지 고정했다.
- `bun run check`는 234 pass, 35 opt-in skip, 0 fail이고 별도 `bun run build`도 통과했다. v0.2.3 npm
  package의 no-args 실행은 stdout help/빈 stderr/exit 0이며 `--version`과 6개 파일 package dry-run도
  통과했다. 네트워크를 사용하지 않는 경로이므로 MYBOX live test는 실행하지 않았다.
- `v0.2.2`는 이미 npm에 게시되어 변경할 수 없으므로 이 수정은 commit `fd36b3d`와 `v0.2.3` tag로
  push했다. main CI run `33885020537`도 성공했고 `v0.2.3`은 npm `latest`로 게시됐다.

## 2026-09-04 live probe entrypoint 정리

- Phase 번호 기반 script와 CI input을 동작 기반 `server-semantics`와 `unicode` 이름으로 바꿨다.
  package script가 opt-in 환경변수를 설정하므로 CI step의 중복 환경변수 지정은 제거했다.
- event가 발생하지 않아도 통과하고 전체 integration·unit regression과 중복되던 Phase 13 observability
  live probe 파일, package script와 CI input/step을 제거했다. 기존 완료 증거는 phase와 handoff 문서에
  유지했다.
- `bun run check`는 234 pass, 34 opt-in skip, 0 fail이고 별도 `bun run build`도 통과했다. CI YAML은
  Ruby YAML parser로 검증했다. 실제 MYBOX probe는 실행하지 않았다.
- 변경은 아직 commit/push하지 않았고 다음 npm 배포 version도 정하지 않았다.

## 2026-09-05 Phase 15 계획

- local/remote folder tree의 one-shot recursive upload/download를 다음 기능 phase로 선택했다.
- `--recursive` 필수, root download 거부, 기존 destination merge/recursive overwrite 제외, 양방향
  manifest, empty folder, name collision, symlink와 부분 tree 실패 정책을
  [`phases/15-recursive-folder-transfer.md`](phases/15-recursive-folder-transfer.md)에 정의했다.
- 계획 리뷰를 반영해 missing parent/`--mkdir` matrix, transfer tree exclusive create, response-loss
  uncertain 중단, manifest 이후 file/directory identity 재검증, portable filename 규칙, remote file
  metadata 재검증과 structured partial failure 계약을 추가했다.
- 계획 문서 수정 후 Prettier와 `git diff --check`, `bun run check` 234 pass/34 opt-in skip/0 fail 및 별도
  `bun run build`가 통과했다.
- 상태는 `pending`이며 구현, 실제 MYBOX mutation, commit/push는 실행하지 않았다.
- 사용자 확인으로 Windows 대용량 download에서 byte progress가 없는 현재 동작을 개선 대상으로
  확정했다. Phase 15 범위에 단일 파일 및 recursive download의 실제 기록 byte 기반
  `download.transfer-*` event, TTY/non-TTY/JSONL renderer와 교차 운영체제 검증을 추가했다.
- 영문·국문 README에 공백이 포함된 local/remote 경로는 경로별로 quote해야 한다는 셸 규칙과
  PowerShell/`cmd.exe` 예시를 추가했다. quote 문자는 파일명의 일부가 아니다.
- 문서 변경 후 `bun run check`는 233 pass/35 opt-in skip/0 fail, 별도 `bun run build`와
  `git diff --check`가 통과했다. MYBOX live test는 실행하지 않았다.

## 2026-09-05 PowerShell API 토큰 관리 가이드

- `docs/operations/powershell-api-secrets.md`에 PowerShell SecretManagement/SecretStore 설치,
  secure prompt 저장, 세션 unlock, AI agent용 무프롬프트 자동 로드와 보안 트레이드오프를 정리했다.
- 실제 토큰 값은 문서에 기록하지 않았으며, 코드와 MYBOX live test는 변경하거나 실행하지 않았다.

### API 사용 한도 검토 반영

- Phase 15 계획에 `config.json`의 `plan`, `MYBOX_PLAN` 우선순위와 공식 요금제별 preset을 추가했다.
  미설정 시 기존 보수적 한도를 사용하며 자동 요금제 감지와 임의 rate override는 제외한다.
- 기존 upload의 부모 재검색을 제거하도록 `parentId` 전달을 명시했다. download는 기존 전송 직전
  detail을 재사용하고 파일당 전후 detail 2회와 최종 tree 재순회를 유지한다.
- 정상 API 호출량, 설정별 limiter와 호출 이력·cooldown 보존을 구현 작업 및 완료 조건에 추가했다.
- 다운로드 일 한도는 실제 잔여 quota와 구분해 안내하고, 부분 실패 후 수동 처리 절차를 정의했다.
  `429`만으로 일 한도 소진을 단정하거나 다음 날까지 자동 대기하지 않는다.
- 이번 변경은 계획 문서에만 반영했으며 상태는 `pending`이다. 설정과 recursive transfer 구현, 실제
  MYBOX 호출, commit/push는 실행하지 않았다.
- 이번 문서 변경의 Prettier 검사와 `git diff --check`가 통과했다. 코드 변경이 없어 전체 check/build는
  재실행하지 않았다. 위의 234 pass 기록은 앞선 계획 변경 시점의 결과다.

### Phase 15 Windows 진단 로그 계획

- Windows 테스트에서 error code만 확보되어 원인을 재현하기 어려웠던 사례를 Phase 15 입력으로
  반영했다. 모든 canonical command에 opt-in `--diagnostic-log <file>`을 추가하는 계획이며 아직
  구현된 option이 아니다.
- 진단 파일은 기존 경로를 덮어쓰지 않는 독립 JSONL이다. 실행 환경, typed event, 최종 envelope/exit
  code와 allowlist된 OS 오류 정보를 기록하고, raw argv와 HTTP payload는 기록하지 않는다.
- PAT, Authorization, credentials와 signed URL redaction, local path/stack의 공유 전 검토, open/write
  failure와 SIGINT 정책 및 Windows npm launcher 회귀 조건을 Phase 15 계획과 완료 조건에 명시했다.
- 이번 변경은 계획 문서에만 반영했으며 Phase 15 상태는 `pending`이다. 구현, 실제 MYBOX 호출,
  commit/push는 실행하지 않았다.
- 대상 문서 Prettier 검사와 `git diff --check`가 통과했다. 코드 변경이 없어 전체 check/build는
  재실행하지 않았다.

## 2026-09-05 Phase 15 로컬 구현

- `upload`와 `download`에 명시적 `--recursive` folder 전송을 추가했다. 양방향 manifest를 먼저 만들고
  nested file과 empty folder를 순차 전송하며, 기존 destination에는 merge하거나 recursive overwrite하지
  않는다.
- portable filename과 sibling collision, local symlink/non-regular entry, manifest 이후 file/directory 및
  destination ancestor 교체를 fail-closed로 처리한다. remote folder create는 direct response로만 소유권을
  확정하며 409나 response-loss에서는 mutation POST를 반복하지 않고 structured `partialTransfer`를 남긴다.
- recursive upload는 생성된 parent ID를 전달해 파일별 path search를 제거했다. recursive download는
  direct-child manifest를 전후 비교하고 파일별 metadata 검증, bounded-memory stream과 atomic commit을
  재사용한다. 실제 기록 byte 기반 `download.transfer-*` event와 요금제별 일 한도 참고 안내를 추가했다.
- `MYBOX_PLAN` → XDG/default `config.json`의 `plan` → 보수적 기본값 순서로 공식 요금제 preset을 적용한다.
  limiter instance 교체 없이 기존 공유 history와 cooldown을 보존하며 자동 요금제 감지는 하지 않는다.
- 모든 canonical command에 opt-in `--diagnostic-log` JSONL을 추가했다. 기존 file/symlink를 덮어쓰지 않고
  command 시작, typed event, 최종 envelope/exit code를 기록하며 raw argv, PAT, Authorization, signed URL과
  raw HTTP payload는 기록하지 않는다.
- unit/subprocess/fake dependency test와 opt-in 실제 MYBOX recursive round-trip test를 추가했다. live test는
  nested/empty/Unicode/0-byte tree를 전용 prefix의 unique child에 올리고 내려받아 byte와 구조를 확인한 뒤
  root resource ID로 cleanup하도록 작성했다.
- `bun run check`는 248 pass, 37 opt-in skip, 0 fail이고 별도 `bun run build`도 통과했다. recursive
  acceptance는 1 pass, 0 fail, 126.58초로 완료됐으며 unique child cleanup도 통과했다. 구현 commit과
  push를 완료했다.

## 2026-09-05 Phase 15 3-OS local 검증 연결

- `.github/workflows/ci.yml`의 Ubuntu/macOS/Windows matrix job 이름을 `Phase 15 local transfer contracts`로
  정리하고, tree manifest, recursive transfer, diagnostic log, upload/download local·HTTP·CLI와 npm
  launcher 회귀 테스트를 세 운영체제에서 실행하도록 확장했다. MYBOX credential과 live mutation은 이 job에
  전달하지 않는다.
- workflow YAML은 Ruby YAML parser로 유효성을 확인했다. 현재 checkout에서 같은 테스트 묶음은 ephemeral
  fake HTTP port를 허용한 실행으로 48 pass, 0 fail을 기록했다. GitHub Actions run
  [`33970836545`](https://github.com/oliverne/myboxctl/actions/runs/33970836545)은 Ubuntu/macOS/Windows
  matrix와 Ubuntu 일반 check를 모두 성공시켰다.

## 2026-09-05 Phase 15 recursive live acceptance

- 승인 후 `MYBOX_INTEGRATION=1 bun test test/integration/recursive-transfer.test.ts`를 실행했다.
- 전용 `/myboxctl-integration-test/` 하위 unique child에 nested/empty/Unicode/0-byte tree를 upload하고
  download한 뒤 구조와 byte를 확인했다. 결과는 1 pass, 0 fail, 126.58초이며 root resource ID cleanup도
  통과했다.
- 전체 `test/integration` suite 재실행은 하지 않았고, Phase 15 상태는 세부 완료 조건 검증 전까지
  `in_progress`로 유지한다.

## 2026-09-05 Phase 15 세부 failure-path 회귀

- recursive upload SIGINT가 retryable 오류로 재시도되지 않고, 이미 완료된 파일과 폴더를 보존한 채
  `error.partialTransfer`에 확인된 count와 `mutationMayHaveOccurred`를 남기는 회귀 테스트를 추가했다.
- recursive download SIGINT에서 완료된 파일은 보존하고 현재 전송의 temporary file만 제거하는 회귀 테스트를
  추가했다. upload source file과 directory가 manifest 이후 교체되거나 symlink가 되면 upload mutation 전에
  fail-closed하고, download destination ancestor가 symlink로 교체되면 commit 전에 identity를 재검증해
  외부 경로에 쓰지 않도록 수정했다.
- destination tree 내부 directory 검증은 정상적인 temporary file 생성으로 바뀌는 mtime을 교체로 오인하지
  않도록 `(dev, ino)`를 사용하고, destination parent anchor의 realpath/identity 검증은 유지한다.
- diagnostic file I/O를 injectable boundary로 분리하고 first-write, mid-write와 close failure를 검증했다.
  mid-write 이후 diagnostic sink만 비활성화하고 warning을 한 번 출력하며, command result/exit code와
  mutation retry 정책은 바꾸지 않는다. JSON warning과 secret redaction도 함께 확인했다.
- partial transfer human/JSON envelope 회귀를 추가했다. 대상 회귀 묶음은 32 pass, 0 fail이고 import 정렬
  수정 후 전체 `bun run check`는 258 pass, 37 opt-in skip, 0 fail, 별도 `bun run build`와
  `git diff --check`도 통과했다.
- follow-up commit `d81e189`의 GitHub Actions run
  [`33972625509`](https://github.com/oliverne/myboxctl/actions/runs/33972625509)에서 Ubuntu 일반 check와
  Ubuntu/macOS/Windows Phase 15 matrix가 모두 성공했다. push 실행에서는 live MYBOX acceptance가 skip됐다.
- 첫 run `33972523212`에서 발견된 import 정렬과 Windows npm launcher 일시 timeout은 follow-up 후 재실행에서
  통과했다. 전체 `test/integration` suite 재실행은 하지 않았다. Phase 15는 원격 중간 mutation failure,
  Windows npm launcher diagnostic failure와 나머지 완료 조건 확인 전까지 `in_progress`로 유지한다.

## 2026-09-05 남은 failure-path 검증 추가

- recursive upload의 중간 하위 폴더 mutation failure와 recursive download의 두 번째 원격 파일 전송
  failure를 fake dependency로 재현했다. 완료된 결과와 `error.partialTransfer`를 보존하고, 이후 파일
  mutation·재시도 없이 중단하며 download temporary file을 정리하는지 확인한다.
- 실제 Node npm launcher subprocess에서 공백·한글 diagnostic 경로의 command failure JSONL 기록과 기존
  directory를 diagnostic target으로 지정한 생성 실패의 terminal error/exit code를 확인한다. 이 테스트는
  Windows CI에서도 같은 경로로 실행된다.
- 대상 회귀는 22 pass, 0 fail이다. 현재 checkout의 `bun run check`는 261 pass, 37 opt-in skip, 0 fail이며
  별도 `bun run build`와 `git diff --check`도 통과했다.
- 커밋 `4163669`를 `origin/main`에 푸시했고, GitHub Actions run
  [`33973516016`](https://github.com/oliverne/myboxctl/actions/runs/33973516016)에서 Ubuntu 일반 check와
  Ubuntu/macOS/Windows Phase 15 matrix가 모두 성공했다. Phase 15 완료 조건을 충족해 상태를 `complete`로
  갱신한다. npm `v0.3.0` tag/publish와 registry smoke는 완료됐다.

## 상태 변경 규칙

- phase를 시작할 때만 `pending → in_progress`로 변경한다.
- 외부 권한이나 API 제약으로 진행할 수 없을 때 `blocked`와 구체적인 해제 조건을 기록한다.
- phase 문서의 모든 완료 조건과 검증이 충족된 경우에만 `complete`로 변경한다.
- 다음 phase를 시작하기 전 이전 phase의 handoff 결과가 `HANDOFF.md`에 있어야 한다.
