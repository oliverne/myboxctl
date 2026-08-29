# Phase 11 — Unicode path canonicalization

## 상태

- 상태: `pending`
- 선행 조건: Phase 00~10 `complete`
- 계획 브랜치: `phase-11-unicode-path-canonicalization`
- 구현 브랜치: 미생성

## 배경

Phase 10 live probe에서 MYBOX는 같은 사용자 표시 문자열의 NFC/NFD spelling을 서로 다른
resource ID로 저장했다. 반면 macOS, Windows, Linux의 파일명 normalization 동작은 동일하지
않으므로, 로컬 basename을 remote path로 사용하는 agent workflow에서는 같은 파일이 NFC/NFD
차이만으로 중복 업로드될 수 있다.

Phase 10의 “NFC/NFD distinct”는 서버 관찰 결과이지 myboxctl의 최종 namespace 정책이 아니다.
첫 stable release 전이므로 기존 exact-code-point 동작과의 호환성보다 교차 플랫폼에서 같은 논리적
경로를 결정적으로 식별하는 것을 우선한다.

## 목표

- 모든 remote path component에 NFC를 canonical form으로 적용한다.
- NFC/NFD처럼 canonically equivalent한 이름을 하나의 논리적 remote path로 취급한다.
- 기존 NFD spelling 하나만 존재하면 새 NFC resource를 만들지 않고 기존 resource를 resolve한다.
- canonically equivalent한 resource가 이미 둘 이상 존재하면 mutation하지 않고 `conflict`로
  fail-closed한다.
- ASCII 대소문자 정책과 Unicode normalization 정책을 분리한다.

## 비범위

- NFKC/NFKD compatibility normalization
- Unicode 또는 locale 기반 case folding
- 기존 remote resource의 자동 rename, delete, merge 또는 content 비교
- 사용자가 선택하는 duplicate-resolution command
- 로컬 디렉터리 sync, watch, bulk migration
- MYBOX Web/Finder/Explorer가 표시하는 이름의 강제 변경
- Phase 10 delete reconcile 및 C0/DEL 정책 변경

## 핵심 계약

### NFC canonical remote path

- `parseRemotePath()`는 separator와 C0/DEL, `.`/`..` 검증을 수행한 뒤 각 component를
  ECMAScript `String.prototype.normalize("NFC")`로 정규화한다.
- `RemotePath.normalized`, `components`, `parentPath`, `basename`은 모두 NFC 값을 가진다.
- 신규 folder/upload의 API request와 multipart `filename`에는 canonical NFC basename을 사용한다.
- CLI 성공 JSON과 오류의 path도 canonical NFC path를 사용한다.
- root `/`, ASCII, 일반 공백과 특수문자의 기존 동작은 유지한다.
- canonicalization 후에도 C0/DEL과 path component 검증을 다시 만족해야 한다.

### Canonical-equivalent lookup

각 parent의 direct-child 목록을 끝까지 pagination하고, candidate 이름을 NFC로 정규화한
canonical key로 비교한다. 검색 API의 query가 normalization-sensitive일 수 있으므로 exact search
한 건만으로 “없음”이나 “유일함”을 확정하지 않는다.

- canonical key가 일치하는 candidate가 0개면 `absent`
- 정확히 1개면 저장된 spelling이 NFC인지 NFD인지와 관계없이 해당 resource를 resolve
- 2개 이상이면 resource ID를 임의 선택하지 않고 `conflict`
- 중간 component가 file이면 기존과 같이 type conflict
- pagination 일부만 본 상태에서는 absent/unique를 확정하지 않음
- listing 응답의 원래 `name`은 진단을 위해 보존하지만 논리적 path 비교에는 canonical key를 사용

### 기존 resource와 mutation

- 기존 NFD-only resource를 NFC/NFD 어느 입력으로 요청해도 같은 resource ID를 사용한다.
- `upload`, `put`, `ensure-dir`는 canonical-equivalent 기존 resource를 발견하면 새 NFC
  duplicate를 생성하지 않는다.
- `download`, `stat`, `ls`, `delete`도 동일한 canonical lookup 계약을 사용한다.
- 이미 NFC/NFD duplicate가 공존하면 read와 mutation 모두 `conflict`로 중단한다.
- 이 phase는 duplicate를 자동 정리하지 않는다.
- delete는 resolve 시 확정한 기존 resource ID만 대상으로 하며 Phase 10의 “대체 ID를 절대 삭제하지
  않음” 계약을 유지한다.

### 대소문자

- `Report.txt`와 `report.txt`는 myboxctl canonical key에서는 서로 다르다.
- case folding이나 소문자 변환을 수행하지 않고 저장된 spelling을 보존한다.
- MYBOX가 case-only create를 거부하면 stable `conflict`로 반환한다.
- `--force`도 철자가 다른 기존 resource를 자동 overwrite하거나 rename하지 않는다.

## 구현 작업

### P11-A — Canonical path primitive

- remote path component별 NFC canonicalization을 추가한다.
- raw NFC/NFD 입력이 같은 `RemotePath.normalized`를 만드는 unit test를 작성한다.
- 조합형 라틴 문자와 한글 음절/자모의 canonical-equivalent fixture를 포함한다.
- NFKC에서만 같아지는 이름은 서로 다른 값으로 유지되는지 검증한다.
- C0/DEL, separator, root, `.`/`..` regression을 유지한다.

### P11-B — Parent-scoped canonical resolver

- root/folder direct-child listing을 재사용하는 parent-scoped resolver를 설계한다.
- 모든 page를 모은 뒤 file/folder candidate를 canonical key와 type으로 판정한다.
- NFC-only, NFD-only, absent, duplicate, type conflict, pagination 경계 fixture를 검증한다.
- search/list operation limiter와 기존 polling/reconcile 정책을 우회하지 않는다.
- 경로 component마다 불필요한 중복 listing이 생기지 않도록 한 resolve 안에서 parent snapshot을
  재사용할 수 있지만, mutation 전후 snapshot을 공유해 stale 판정을 만들지는 않는다.

### P11-C — Command integration

- `stat`, `ls`, `ensure-dir`, `upload`, `put`, `download`, `delete`가 동일한 canonical
  resolver를 사용하도록 정리한다.
- 신규 mutation request와 multipart filename이 NFC인지 fake HTTP test로 확인한다.
- NFD-only 기존 resource가 있을 때 upload/put/ensure-dir의 create request가 0회인지 확인한다.
- duplicate conflict와 case-only conflict에서 mutation이 0회인지 확인한다.
- human/JSON 출력, exit code, redaction 계약을 regression test로 고정한다.

### P11-D — Targeted live acceptance

`/myboxctl-integration-test/` 아래 실행별 unique parent에서 low-level test setup과 production CLI를
분리해 다음을 확인한다.

1. NFD-only resource를 직접 준비하고 NFC/NFD 입력 모두 같은 ID로 resolve
2. NFD-only file에 `put`을 실행해 새 NFC duplicate가 생기지 않음
3. NFD 입력으로 신규 upload/ensure-dir 시 서버 listing의 신규 spelling이 NFC
4. NFC/NFD duplicate를 직접 준비한 뒤 read와 mutation이 모두 `conflict`, mutation 0회
5. case-only create는 계속 `conflict`이고 최초 resource가 유지됨
6. ID 기반 exact cleanup과 unique parent cleanup 성공

이미 Phase 10에서 서버의 NFC/NFD distinct 저장과 case-only conflict를 확인했으므로 같은 사실을
다시 넓게 probe하지 않는다. Phase 11 live acceptance는 production canonicalization과 중복 방지
postcondition만 검증한다.

### P11-E — 문서와 handoff

- `docs/reference/cli-contract.md`의 “normalization 없음” 계약을 NFC canonicalization으로 교체한다.
- `docs/reference/mybox-api.md`에서 서버 관찰과 client 정책을 구분한다.
- architecture/reliability 문서에 canonical duplicate의 fail-closed 원칙을 반영한다.
- `PLAN.md`, `docs/PROGRESS.md`, `docs/HANDOFF.md`를 실제 검증 결과에 맞춰 갱신한다.

## 검증

일반 검증:

```bash
bun run check
bun run build
```

targeted live acceptance는 별도 opt-in 환경 변수와 GitHub Actions input을 사용한다. 정확한 script와
input 이름은 구현 시 기존 Phase 10 workflow naming과 충돌하지 않게 확정한다.

세 운영체제에서 최소한 remote path unit/CLI regression을 실행한다.

- Ubuntu 24.04
- macOS Latest
- Windows Latest

## 완료 조건

- [ ] NFC/NFD 입력이 같은 canonical remote path를 만든다.
- [ ] 신규 resource와 multipart filename은 NFC로 전송된다.
- [ ] 기존 NFD-only resource를 NFC/NFD 입력 모두 같은 ID로 resolve한다.
- [ ] 기존 NFD-only resource 때문에 NFC duplicate가 새로 생성되지 않는다.
- [ ] canonical-equivalent candidate가 둘 이상이면 read/mutation 모두 `conflict`로 중단한다.
- [ ] conflict에서 create/upload/delete 요청이 발생하지 않는다.
- [ ] case folding 없이 case-only create conflict와 original spelling 보존이 유지된다.
- [ ] Phase 10 delete ID safety와 C0/DEL 방어 regression이 통과한다.
- [ ] fake HTTP, CLI subprocess, 세 운영체제 일반 CI가 통과한다.
- [ ] 실제 MYBOX targeted acceptance와 cleanup이 성공한다.
- [ ] reference, progress, handoff 문서가 검증된 동작과 일치한다.

## 중단 조건

- parent listing이 resource의 정확한 이름/ID/type을 제공하지 않아 canonical candidate를 안전하게
  판정할 수 없는 경우
- pagination 또는 API visibility 때문에 duplicate 여부를 결정적으로 확정할 수 없는 경우
- normalization 후 candidate가 여러 개인데 안전한 fail-closed 경로를 보장할 수 없는 경우
- integration prefix 밖의 resource를 조회·변경 대상으로 선택할 가능성이 있는 경우
- rate limit, 권한 또는 cleanup 실패로 live acceptance 결과를 확정할 수 없는 경우

중단 시 exact-code-point fallback으로 mutation하지 않고 Phase 11을 `blocked`로 기록한다.
