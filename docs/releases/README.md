# 릴리스 노트

이 디렉터리는 npm/GitHub Release의 본문으로 쓰는 version별 release note를 보관한다. 본문은
`.github/workflows/publish-npm.yml`의 `release` job이 같은 tag commit에서 읽어 GitHub Release로
게시한다.

## 파일 규칙

- 파일명은 `vX.Y.Z.md`다. publish 대상 tag와 정확히 같아야 하며, prerelease/build metadata는
  아직 지원하지 않는다.
- npm version, Git tag와 파일명 version이 모두 같아야 한다. 다르면 publish 전에 workflow가 실패한다.
- 예: tag `v0.4.0` → `docs/releases/v0.4.0.md`

## 본문 규칙

- 사용자에게 영향을 주는 기능, 수정과 호환성 변경만 **3~6개 bullet**로 적는다.
- 내부 refactor, 문서 정리, dependency 갱신은 사용자 영향이 있을 때만 포함한다.
- heading은 없어도 되고 있어도 된다. GitHub Release 제목은 tag로 설정된다.
- PAT, workflow credential, request ID, upload/download URL과 로컬 절대 경로를 넣지 않는다.
- 이미 배포된 version의 note는 수정하지 않는다. Release 본문과 달라지면 `release` job의 idempotent
  비교가 실패해 재실행이 막힌다. 오타는 다음 version에서 고친다.

### 문체

독자는 내부 구현을 모르는 CLI 사용자다. 한 bullet에 한 주제만 두고, 무엇이 가능해졌는지 먼저 말한다.
문체는 기존 version의 note보다 이 규칙을 우선한다.

- 사용자가 알아챌 결과를 쓴다. 명령 이름과 경로 placeholder로 어떤 작업이 가능해졌는지 바로 알 수 있게
  한다.
- 내부 식별자(`resourceId`), 구현 메커니즘(canonical spelling, reconcile 방식), exit code 표는 넣지
  않는다. 사용자가 실제로 조치해야 하는 제약은 평범한 문장으로 남긴다.

```text
복잡함:      새 rename <remote-path> <new-name> command로 같은 folder 안에서 file 또는 folder의 이름을 바꿀 수 있다.
사용자 관점: 이제 myboxctl rename <remote-path> <new-name>으로 원격 파일과 폴더의 이름을 바꿀 수 있습니다.
```

문체는 자동 검증 대상이 아니다. `verify:release-notes`는 파일 존재, version 일치와 bullet 개수만
검사하므로, 작성자가 위 규칙을 직접 확인한다.

예:

```markdown
- 이제 `myboxctl foo <path>`로 ... 할 수 있습니다.
- 오류 JSON envelope에 ... 필드를 추가했습니다.
- ... 동작을 ... 하도록 수정했습니다.
```

## 검증

- 로컬: `bun run verify:release-notes -- --tag vX.Y.Z`가 파일 존재, version 일치와 bullet 개수를
  검사한다. `bun run check`는 `docs/releases/*.md` 전체 규칙을 함께 회귀 검증한다.
- publish: workflow의 `publish` job이 build 이전에 note를 검증하고, `release` job이 npm publish 성공
  뒤 같은 note로 GitHub Release를 생성한다.
