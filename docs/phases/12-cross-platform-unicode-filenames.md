# Phase 12 — Cross-platform Unicode Filename Compatibility

## 상태

- 상태: `in_progress`
- 계획일: 2026-08-29
- 선행 조건: Phase 10 `complete`, Phase 11 distribution 구현이 `main`에 반영됨
- 구현 브랜치: `phase-12-unicode-filename-plan`
- 공개 릴리스 조건: 첫 public Release 전에 완료

## 구현 진행 상태

- P12-A Unicode NFC helper와 remote path canonical key를 구현했다.
- P12-B read용 exact-first canonical fallback과 mutation용 canonical sibling 유일성 검사를 구현했다.
- P12-C `ensure-dir`, `upload`, `put`, `stat`, `ls`, `download`, `delete`를 새 resolver 정책에 연결했다.
- P12-D 새 원격 이름은 NFC로 전송하고 기존 resource overwrite에서는 기존 spelling을 보존한다.
- P12-E resolver/path 테스트를 추가했으며 전체 Bun test와 실제 MYBOX probe는 CI에서 확인한다.

## 배경

Phase 10의 실제 MYBOX probe에서 NFC와 NFD로 표현한 같은 사용자 표시 문자열이 같은 parent 아래
서로 다른 resource와 ID로 저장될 수 있음을 확인했다. 현재 CLI는 입력 spelling을 그대로 보존하고
code point가 정확히 일치하는 이름만 찾는다.

이 정책은 원문을 손상시키지 않지만 macOS, Windows, WSL2를 함께 사용하는 흐름에서는 다음 문제가
남는다.

- macOS 파일시스템에서 읽은 NFD 계열 basename을 원격 경로로 재사용하면 MYBOX에 NFD 이름이 생성될
  수 있다.
- Windows나 WSL2에서 같은 이름을 NFC로 입력하면 기존 NFD resource를 찾지 못할 수 있다.
- NFC와 NFD resource가 함께 존재하면 화면상 같은 파일이 중복된 것처럼 보일 수 있다.
- NFD 이름을 Windows에 그대로 내려받으면 일부 프로그램에서 한글 자소가 분리되어 표시되거나 NFC
  이름과 다른 파일로 비교될 수 있다.

`upload`, `put`, `download`은 로컬 경로와 원격 경로를 명시적으로 분리하므로 모든 사용에서
문제가 발생하는 것은 아니다. 하지만 로컬 `basename`으로 원격 경로를 만드는 agent/script가 실제
사용 사례이므로 첫 공개 릴리스 전에 일관된 원격 이름 정책을 제공한다.

## 목표

- 새 원격 파일과 폴더 이름을 NFC로 통일한다.
- 기존 NFD resource를 NFC 입력으로도 안전하게 찾을 수 있게 한다.
- 기존 resource의 ID와 실제 spelling을 보존하며 암묵적으로 rename하거나 복제하지 않는다.
- canonical-equivalent 후보가 여러 개이면 임의로 선택하거나 덮어쓰지 않는다.
- macOS, Windows, Linux/WSL2에서 동일한 사용자 표시 이름이 같은 원격 resource를 가리키게 한다.

## 핵심 정책

### 로컬 경로

로컬 파일시스템에 전달하는 `localPath`는 정규화하지 않는다. 사용자가 전달한 경로 그대로
`open`, `stat`, 임시 파일 생성과 commit에 사용한다. macOS 파일시스템이 반환한 spelling을
바꾸면 실제 로컬 파일을 열지 못하거나 다른 entry를 가리킬 수 있기 때문이다.

`download <remote-file> <local-path>`의 목적지도 사용자가 명시한 로컬 경로를 그대로 사용한다.
CLI가 로컬 파일명을 자동으로 선택하거나 기존 파일을 rename하지 않는다.

### 원격 경로

- path separator 정리와 Unicode canonicalization을 서로 다른 개념으로 모델링한다.
- 입력 원격 path와 component spelling은 진단 및 exact lookup을 위해 보존한다.
- 비교용 canonical key는 각 component의 `normalize("NFC")` 결과로 만든다.
- 새 resource의 서버 전송 이름은 NFC를 사용한다.
- case folding은 적용하지 않는다. Phase 10에서 대소문자만 다른 create가 서버 conflict임을
  확인했으며 이번 phase는 Unicode canonical equivalence만 다룬다.

### 기존 resource 조회

읽기 명령은 각 parent에서 다음 순서를 사용한다.

1. code point가 정확히 일치하는 기존 resource가 있으면 이를 선택한다.
2. exact match가 없으면 fully paginated direct-child 목록에서 NFC canonical key가 같은 후보를 찾는다.
3. 후보가 하나면 그 resource의 기존 ID와 실제 spelling을 사용한다.
4. fallback 후보가 여러 개면 `UNICODE_NAME_COLLISION` conflict로 중단한다.

생성 또는 mutation 명령은 exact match 여부와 관계없이 대상 parent의 canonical-equivalent 후보를
확인한다. 후보가 없으면 NFC 이름으로 생성하고, 하나면 해당 기존 resource의 ID와 spelling을
사용하며, 여러 개면 mutation 없이 conflict로 중단한다. 따라서 화면상 같은 기존 resource가 여러
개인 상황에서 `--force`나 `--overwrite`도 임의 대상을 변경하지 않는다.

listing/search API의 기존 shared rate limiter와 pagination 계약을 재사용하며, canonical lookup을
위해 undocumented query를 추가하지 않는다.

## 작업 범위

### P12-A — Unicode name model

- remote path component의 원본 spelling과 NFC canonical key를 명시적으로 구분한다.
- `normalized`라는 기존 이름이 slash/path 정리와 Unicode NFC를 혼동시키지 않도록 type과 helper
  이름을 정리한다.
- canonicalization은 remote component 경계에서만 수행하고 local path에는 적용하지 않는다.
- NFC/NFD가 아닌 일반 한글, 공백, 특수문자와 C0/DEL 거부 계약을 유지한다.

### P12-B — Canonical-aware resolver

- file/folder read resolver에 exact-first 단일 canonical fallback을 추가한다.
- 생성/mutation resolver는 exact match가 있어도 canonical-equivalent sibling의 유일성을 확인한다.
- root부터 nested component까지 parent 단위로 동일한 규칙을 적용한다.
- file/folder type이 다르거나 mutation 대상의 canonical-equivalent 후보가 여러 개면 fail-closed한다.
- fallback으로 선택한 resource의 실제 `resourceId`, `name`, `path`를 이후 postcondition과
  mutation에 전달한다.
- canonical fallback으로 추가되는 listing 호출이 기존 API rate limit을 우회하지 않도록 검증한다.

### P12-C — Creation and mutation safety

- `ensure-dir`, `upload`, `put`의 신규 생성 이름을 NFC로 서버에 전송한다.
- 기존 NFD resource를 canonical fallback으로 찾은 경우 overwrite/create로 NFC 복제본을 만들지
  않고 기존 ID와 spelling을 사용한다.
- `stat`, `ls`, `download`, `delete`는 resolver가 확정한 기존 resource ID를 사용한다.
- exact lookup과 mutation 사이 race가 발생하면 기존 operation-specific reconcile 정책을 유지한다.
- canonical collision에서는 exact spelling이 일치하더라도 `--force`나 `--overwrite`가 임의
  대상을 선택하지 못하게 한다.

### P12-D — CLI contract and diagnostics

- canonical fallback 사용 여부와 실제 원격 spelling을 JSON 결과에서 판단할 필요가 있는지 테스트를
  통해 결정한다. 추가한다면 기존 envelope를 깨지 않는 optional 진단 필드로 제한한다.
- collision 오류는 AI agent가 분기할 수 있는 안정적인 code와 안전한 후보 정보를 제공한다.
- README와 CLI reference에 macOS/Windows/WSL2의 원격 이름 정책과 로컬 경로 비정규화 원칙을
  설명한다.
- 기존 NFD resource의 자동 rename/migration 명령은 추가하지 않는다. 충돌이 발견되면 먼저
  read-only 진단과 수동 정리 절차를 제공한다.

### P12-E — Verification

단위 및 fake HTTP 테스트:

- NFC/NFD Latin 조합문자와 한글 완성형/조합형 pair
- 읽기의 exact match 우선과 단일 canonical fallback
- mutation의 canonical sibling 유일성 확인과 다중 후보 collision
- nested folder의 component별 fallback
- NFD 입력으로 신규 upload/ensure-dir 시 NFC 이름 전송
- 기존 NFD resource overwrite 시 기존 ID/spelling 보존
- canonical collision에서 upload/put/delete가 mutation을 호출하지 않음
- case-sensitive comparison과 C0/DEL 방어 regression
- local upload/download path가 정규화되지 않음

실제 MYBOX targeted probe:

1. unique parent 아래 NFD resource를 만들고 NFC 경로로 `stat`과 `download`한다.
2. NFD 원격 입력으로 새 resource를 요청하고 서버에 NFC spelling이 남는지 확인한다.
3. NFC/NFD resource를 함께 준비한 뒤 exact read 결과를 확인하고 mutation은 conflict로 종료되는지
   확인한다.
4. cleanup은 화면상 이름이 아니라 probe가 기록한 exact resource ID만 사용한다.

운영체제 검증:

- macOS runner에서 decomposed local filename을 준비해 basename 기반 upload 시나리오를 실행한다.
- Windows runner에서 NFC 경로로 같은 remote fixture를 조회·다운로드하는 CLI contract를 검증한다.
- Ubuntu runner에서 NFC/NFD code point 보존과 canonical fallback을 검증한다.
- WSL2는 hosted CI 필수 조건으로 두지 않고 Windows/Ubuntu 결과와 실제 WSL2 수동 smoke 절차를
  운영 문서에 기록한다.

## 비범위

- 대소문자 case folding 또는 case-insensitive client lookup
- 로컬 파일시스템 entry의 자동 rename
- 기존 MYBOX resource의 일괄 rename/migration
- 양방향 sync, 디렉터리 mirror 또는 conflict resolution engine
- Unicode compatibility normalization인 NFKC/NFKD
- MYBOX API에 없는 rename 동작을 download/upload/delete 조합으로 모사

## 검증 명령

구현 시 저장소의 실제 script 이름에 맞춰 세부 명령을 확정한다.

```bash
bun run check
bun run build
bun run test:integration
```

완료 조건:

- [ ] 새 원격 file/folder 이름이 NFC로 생성된다.
- [ ] 기존 NFD resource를 NFC 입력으로 조회·다운로드할 수 있다.
- [ ] 기존 NFD resource를 overwrite해도 NFC duplicate를 만들지 않는다.
- [ ] canonical-equivalent 후보가 여러 개면 exact match가 있어도 mutation 없이 안정적인 conflict를
  반환한다.
- [ ] local path는 upload/download 모두 입력 spelling 그대로 사용한다.
- [ ] macOS, Windows, Ubuntu CI에서 Unicode CLI regression이 통과한다.
- [ ] 실제 MYBOX targeted probe와 resource-ID 기반 cleanup이 통과한다.
- [ ] README, CLI contract, API ledger, PROGRESS와 HANDOFF가 실제 동작과 일치한다.
- [ ] Phase 12 완료 전 public Release를 게시하지 않는다.

## 중단 조건

- direct-child listing만으로 canonical 후보 전체를 확정할 수 없는 경우
- API 응답에서 name/path spelling이 일관되게 보존되지 않는 경우
- canonical fallback이 같은 parent의 file/folder를 안전하게 구분할 수 없는 경우
- 테스트 fixture 밖의 기존 사용자 resource를 자동으로 변경해야만 검증 가능한 경우

중단 조건이 발생하면 normalization을 강행하지 않고 probe 결과와 미확정 계약을 문서화한다.
