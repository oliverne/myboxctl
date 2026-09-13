# Phase 16 — npm Trusted Publishing

상태는 `docs/PROGRESS.md`가 소유한다. 이 문서는 GitHub Actions의 npm 배포 인증을 장기 보관
`NPM_TOKEN`에서 npm Trusted Publishing(OIDC)으로 전환하는 실행 계획과 완료 기준을 기록한다.

## 상태와 진입 조건

- 상태: `complete`
- 활성 phase: 없음
- Phase 00~15와 npm `v0.3.1` 배포가 완료된 상태에서 시작했다.
- 저장소 workflow와 운영 문서의 전환은 이 phase에서 완료한다.
- npm 웹사이트의 Trusted Publisher 등록, 실제 OIDC publish, registry/provenance 및 설치 smoke와 기존
  token 폐기는 release 자격 증명과 별도 운영 승인이 필요한 후속 절차였으며, 2026-09-13 사용자 확인으로
  모두 완료했다.

## 변경 범위

- `.github/workflows/publish-npm.yml`에 `id-token: write`를 추가한다.
- GitHub-hosted runner에서 Node.js 24와 npm CLI를 사용하도록 `actions/setup-node@v7`을 추가한다.
- `NPM_TOKEN` secret, 임시 `.npmrc`, `NPM_CONFIG_USERCONFIG` 참조를 제거한다.
- 기존 `bun run publish:npm`과 `npm publish --access public`의 package 준비·검증·실행 순서는 유지한다.
- `package.json`, npm package 내용, CLI 동작과 MYBOX API 호출은 변경하지 않는다.
- 운영 문서는 Trusted Publisher의 정확한 owner/repository/workflow 설정, OIDC 오류 진단과 token 폐기
  시점을 설명한다.

## 외부 설정 계약

npm package 설정에서 다음 Trusted Publisher를 추가해야 한다.

| 항목                 | 값                |
| -------------------- | ----------------- |
| Provider             | GitHub Actions    |
| Organization or user | `oliverne`        |
| Repository           | `myboxctl`        |
| Workflow filename    | `publish-npm.yml` |
| Environment name     | 없음              |
| Allowed action       | `npm publish`     |

Trusted Publishing은 Node.js 22.14.0 이상과 npm CLI 11.5.1 이상, GitHub-hosted runner와
workflow의 `id-token: write`를 요구한다. GitHub Actions OIDC publish에서는 npm provenance가
자동 생성되므로 `--provenance` 플래그를 별도로 사용하지 않는다.

## 검증 경계

저장소 변경은 다음 로컬 검사를 통과해야 한다.

```bash
bun run check
bun run build
git diff --check
```

다음 외부 절차는 저장소 변경 이후 별도 release 승인으로 수행했으며, 2026-09-13 사용자 확인으로
모두 완료했다.

1. npm package에 Trusted Publisher를 등록한다.
2. 새 version tag로 `publish-npm.yml`을 실행한다.
3. workflow 성공, npm registry version/latest와 provenance를 확인한다.
4. `npx`/global install smoke를 수행한다.
5. 기존 npm publish token을 npm에서 revoke하고 GitHub의 `NPM_TOKEN` secret을 삭제한다.

외부 절차 완료 결과는 `v0.3.2` OIDC publish 성공, npm registry `latest`와 provenance 확인,
`npx`/global install smoke 성공, 기존 npm publish token과 GitHub `NPM_TOKEN` secret 폐기다. 실패한
OIDC publish를 동일 version으로 무조건 반복하지 않으며, `ENEEDAUTH`/`E404`는 Trusted Publisher
identity와 OIDC permission부터 재확인한다.
