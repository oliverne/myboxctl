# Current handoff

## 현재 상태

- Phase 00~10: `complete`
- Phase 11: `pending` — 계획 작성 완료, 구현·검증 미시작
- 활성 구현 phase: 없음
- 공개 릴리스: 보류
- Phase 10 PR: #6 merged
- Phase 11 계획 브랜치: `phase-11-unicode-path-canonicalization`
- Phase 10 기준 CI: run 33231710723
- Phase 10 live evidence: run 33230351165

## Phase 10 완료 결과

- remote path component의 C0 control과 DEL을 mutation 전에 거부한다.
- multipart filename boundary도 같은 문자를 방어적으로 거부한다.
- 삭제된 ID의 detail은 휴지통에서 200을 유지할 수 있으므로 active membership 증거로 사용하지 않는다.
- retryable DELETE 뒤 active exact path와 fully paginated parent listing 양쪽에서 기존 ID가
  사라진 경우만 삭제 성공으로 reconcile한다.
- 같은 path의 다른 ID는 절대 삭제하지 않으며 membership 증거가 불일치하면 fail-closed한다.
- MYBOX 서버는 NFC/NFD spelling을 별도 resource로 저장할 수 있다.
- ASCII case만 다른 create는 conflict였으며 최초 spelling만 남았다.
- production resolver는 현재 exact-code-point spelling을 사용하며 NFC normalization이나 case
  folding을 수행하지 않는다.

## Phase 11 계획 결정

Phase 10의 NFC/NFD 결과는 보존할 client 정책이 아니라 교차 플랫폼 duplicate 위험을 보여주는
서버 관찰로 해석한다.

- remote path component와 신규 resource 이름은 NFC로 canonicalize한다.
- 기존 NFD-only resource는 NFC/NFD 어느 입력에서도 같은 ID로 resolve한다.
- canonical-equivalent candidate가 둘 이상이면 임의 선택하지 않고 read/mutation 모두
  `conflict`로 중단한다.
- existing duplicate를 자동 rename, delete, merge하지 않는다.
- NFKC/NFKD와 case folding은 도입하지 않는다.
- case-only create conflict와 original spelling 보존을 유지한다.
- Phase 10의 delete resource-ID safety와 C0/DEL 방어를 regression 조건으로 둔다.

상세 실행 계획과 완료 조건은
[`phases/11-unicode-path-canonicalization.md`](phases/11-unicode-path-canonicalization.md)를 따른다.

## 검증 기준

Phase 11 구현 시 다음 증거가 필요하다.

- fake HTTP와 CLI subprocess에서 canonical lookup, duplicate conflict, mutation 0회
- Ubuntu 24.04, macOS Latest, Windows Latest 일반 CI
- 실제 MYBOX에서 NFD-only resolve와 duplicate-create 방지
- 기존 NFC/NFD duplicate의 fail-closed conflict
- case-only conflict와 original resource 보존
- unique integration resource cleanup

## 다음 작업

사용자 승인 후에만 Phase 11을 `in_progress`로 변경하고 구현 브랜치를 시작한다. 계획 승인 전에는
production code, workflow와 reference contract를 변경하지 않는다.
