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

예:

```markdown
- 새 `foo` command로 ... (사용자에게 보이는 변경을 한 줄로 적는다)
- 오류 JSON envelope에 ... 필드를 추가했다.
- ... 동작을 ... 하도록 수정했다.
```

## 검증

- 로컬: `bun run verify:release-notes -- --tag vX.Y.Z`가 파일 존재, version 일치와 bullet 개수를
  검사한다. `bun run check`는 `docs/releases/*.md` 전체 규칙을 함께 회귀 검증한다.
- publish: workflow의 `publish` job이 build 이전에 note를 검증하고, `release` job이 npm publish 성공
  뒤 같은 note로 GitHub Release를 생성한다.
