---
name: myboxctl
description: Manage NAVER MYBOX files through a safe CLI workflow.
---

# myboxctl

`myboxctl`로 NAVER MYBOX의 파일과 폴더를 조회하고 전송하거나 휴지통으로 이동한다. Hermes에서는
`terminal`, 다른 호스트에서는 해당 셸 실행 도구를 사용한다.

## 설치

먼저 확인한다.

```bash
myboxctl --version
```

명령이 없으면 Node.js 20 이상이 설치되어 있는지 확인하고, 패키지 설치 권한을 받은 뒤 설치한다.

```bash
npm install -g @oliverne/myboxctl
myboxctl --version
```

PAT는 사용자가 `MYBOX_PAT` 또는 `~/.config/myboxctl/credentials`의 한 줄로 설정해야 한다. credentials
파일은 POSIX에서 mode `600`이어야 한다. PAT를 명령 인자나 출력에 넣지 않는다.

## 예제

```bash
# 루트 또는 폴더 내용 조회
myboxctl list / --json
myboxctl list '/Team Files' --json

# 파일 또는 폴더 정보 조회
myboxctl info '/agents/report.md' --json

# 폴더 생성
myboxctl mkdir --parents '/agents/output' --json

# 파일 업로드와 다운로드
myboxctl upload './report.md' '/agents/output/' --mkdir --json
myboxctl download '/agents/output/report.md' './report.md' --json

# 폴더 전체 전송: 기존 destination tree와 병합하지 않음
myboxctl upload './reports' '/agents/' --recursive --mkdir --json
myboxctl download '/agents/reports' './reports-copy' --recursive --json

# 명시적인 덮어쓰기
myboxctl upload './report.md' '/agents/report.md' --force --json
myboxctl download '/agents/report.md' './report.md' --overwrite --json

# 휴지통으로 이동
myboxctl delete '/agents/old-report.md' --json
```

## 꼭 지킬 규칙

- 자동화에서는 `--json`을 사용하고 exit code와 `ok`를 함께 확인한다.
- 원격 경로는 `/`로 시작해야 한다. 공백이 있는 경로는 한 인자로 전달한다.
- `--force`, `--overwrite`, `delete`는 사용자가 해당 변경을 명시한 경우에만 실행한다.
- 폴더 전송에는 `--recursive`가 필요하며 기존 destination tree와 병합하지 않는다.
- 실패한 mutation을 외부에서 자동 재실행하지 않는다. `error.partialTransfer`가 있으면 완료 수치와
  `mutationMayHaveOccurred`를 보고하고 중단한다.
- PAT, Authorization header, upload/download URL 또는 query token을 출력하지 않는다.

destination 의미, JSON shape와 exit code가 더 필요할 때만
[CLI contract](references/cli-contract.md)를 읽는다.
