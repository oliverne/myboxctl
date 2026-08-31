# CLI contract improvements archive

이 문서는 Phase 14에서 검토했던 개선 제안의 종료 기록이다. 적용된 내용은
[`cli-contract.md`](cli-contract.md)에 stable public contract로 승격되었다.

- machine envelope는 `schemaVersion: 1`과 explicit nullable field를 사용한다.
- resource size는 byte 단위가 드러나는 `sizeBytes`로 고정한다.
- resource type/time은 public output 경계에서 정규화한다.
- destination, not-found, human output, JSON stream과 global presentation option semantics를 명시한다.

추가 제안은 이 문서에 누적하지 않고 stable contract와 phase 문서를 갱신한다.
