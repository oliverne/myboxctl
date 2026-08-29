# Current handoff

## 현재 상태

- Phase 00~09: `complete`
- 활성 구현 phase: 없음
- 공개 릴리스: 보류
- 기준선: `1ab09182de11518e671eafb9550be7076320f849`
- 2026-08-29 PHP 구현체 교차 감사:
  [`reference/php-implementation-audit.md`](reference/php-implementation-audit.md)

이번 작업은 문서 전용이다. production code, API ledger, phase 상태는 바꾸지 않았고 live MYBOX
호출과 Bun test/build도 실행하지 않았다.

## 감사에서 확인한 결정

- 현재의 GET-only generic retry와 operation-specific mutation reconcile을 유지한다.
- upload의 file-handle 안정성 검사와 download의 atomic local commit을 유지한다.
- PHP/Flysystem의 live note와 소스 주석은 targeted probe 전까지 가설이다.
- Flysystem의 same-name file/folder 허용 가정은 우리 API-09 관찰과 모순되므로 채택하지 않는다.
- 앞선 탐색에서 잘못 표기한 저장소 이름은 `overworks/mybox`가 아니라
  `overworks/php-mybox`다.

## 다음 bounded 결정

사용자가 후속 구현을 선택하면 먼저 별도 Phase 10
`cross-implementation-hardening` 문서를 만들고 다음 순서로 진행한다.

1. remote path component의 C0 control/DEL 거부와 unit/CLI test
2. trash 이후 ID detail, active path, parent listing을 비교하는 delete targeted probe
3. NFC/NFD와 대소문자 semantics targeted probe
4. resumable upload가 실제 우선순위일 때만 KST literal/overwrite/423 probe
5. 검색 비용이 확인될 때만 command-scoped directory snapshot benchmark

각 live probe는 `/myboxctl-integration-test/` 아래 unique child와 exact cleanup을 사용한다.
generic mutation retry, quota exhaustion, purge, root clear, move/copy, full API wrapper는 범위에 넣지
않는다.

## 검증 상태

- 두 PHP 저장소의 source와 protocol/adapter note를 고정 commit에서 검토했다.
- 우리 구현의 path/resolver/upload/download/delete/reliability 계약과 대조했다.
- 문서 링크와 상태 기록만 변경했다.
- 코드가 바뀌지 않아 `bun run check`와 `bun run build`는 실행하지 않았다.
