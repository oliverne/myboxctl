# Ubuntu Server 24.04 운영

이 문서는 Ubuntu Server 24.04에서 `myboxctl`을 단발성 CLI subprocess로 운영하는 절차다. MVP의
범위에는 daemon, watch mode, systemd service가 포함되지 않는다.

## standalone 설치

공개 Release 이후에는 Bun과 source checkout 없이 설치할 수 있다.

```bash
curl -fsSL https://github.com/oliverne/myboxctl/releases/latest/download/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
myboxctl --version
```

installer는 Release archive와 `SHA256SUMS`를 모두 내려받고 SHA-256이 일치할 때만 설치한다. 특정
버전으로 고정하거나 사용자 설치 경로를 지정할 수 있다.

```bash
curl -fsSL https://github.com/oliverne/myboxctl/releases/download/v0.1.0/install.sh |
  MYBOXCTL_VERSION=0.1.0 MYBOXCTL_INSTALL_DIR="$HOME/.local/bin" sh
```

## 소스 빌드 전제

- Ubuntu Server 24.04와 `bash` 또는 호환 셸
- Bun 1.4 이상 (`package.json`의 `packageManager`는 `bun@1.4.0`)
- `git`과 빌드에 필요한 일반적인 컴파일 도구
- MYBOX PAT. PAT는 명령 인자, 소스, 로그, systemd unit에 넣지 않는다.

Bun 설치 방법은 배포 환경의 표준 패키지 관리 정책을 따른다. 공식 설치 스크립트를 사용하는 경우
설치 후 반드시 버전을 확인한다.

```bash
curl -fsSL https://bun.com/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

`bun --version`이 `1.4.0` 이상이 아니면 배포를 중단하고 Bun 1.4 계열을 설치한다. 프로젝트의
lockfile을 변경하지 않고 재현 가능한 의존성을 사용하려면 반드시 frozen install을 실행한다.

## 소스 설치와 빌드

버전별 디렉터리를 유지하면 이전 릴리스로 쉽게 되돌릴 수 있다. 아래 예시는 사용자 소유 경로를
사용하므로 root 권한이 필요하지 않다.

```bash
export MYBOXCTL_ROOT="$HOME/.local/lib/myboxctl"
export MYBOXCTL_RELEASE="0.0.0"
mkdir -p "$MYBOXCTL_ROOT/releases/$MYBOXCTL_RELEASE"
git clone <repository-url> "$MYBOXCTL_ROOT/worktree"
cd "$MYBOXCTL_ROOT/worktree"
bun install --frozen-lockfile
bun run build
bun run test:release

install -m 755 dist/cli.js "$MYBOXCTL_ROOT/releases/$MYBOXCTL_RELEASE/cli.js"
mkdir -p "$HOME/.local/bin"
ln -sfn "$MYBOXCTL_ROOT/releases/$MYBOXCTL_RELEASE/cli.js" "$HOME/.local/bin/myboxctl"
export PATH="$HOME/.local/bin:$PATH"
myboxctl --version
```

`dist/cli.js`는 shebang을 보존한 실행 가능한 Bun artifact를 기본 경로로 사용한다. 실행 권한이
없는 환경에서는 다음처럼 Bun을 명시해도 된다.

```bash
bun "$MYBOXCTL_ROOT/releases/$MYBOXCTL_RELEASE/cli.js" --version
```

빌드 검증은 다음과 같다.

```bash
bun run check
bun run build
```

실제 계정을 사용하는 acceptance는 의도적으로 별도 opt-in한다.

```bash
MYBOX_PAT=... bun run test:integration
```

## PAT 전달

### 일시적인 환경변수

환경변수는 해당 CLI와 자식 프로세스에만 전달한다. 셸 history에 PAT가 남지 않도록 명령 인자에
직접 쓰지 않는다.

```bash
read -r -s -p 'MYBOX PAT: ' MYBOX_PAT
printf '\n'
export MYBOX_PAT
myboxctl stat /agents/output/report.md --json
unset MYBOX_PAT
```

### 영속 credentials file

장시간 실행되는 AI 에이전트 계정에서는 credentials file을 권장한다. 파일은 공백을 제거한 한 줄의
PAT만 포함해야 하며 Linux에서는 반드시 owner만 읽을 수 있어야 한다.

```bash
umask 077
install -d -m 700 "$HOME/.config/myboxctl"
read -r -s -p 'MYBOX PAT: ' MYBOX_PAT
printf '\n'
printf '%s\n' "$MYBOX_PAT" > "$HOME/.config/myboxctl/credentials"
unset MYBOX_PAT
chmod 600 "$HOME/.config/myboxctl/credentials"
```

기본 경로는 `$HOME/.config/myboxctl/credentials`이며 `XDG_CONFIG_HOME`을 설정하면
`$XDG_CONFIG_HOME/myboxctl/credentials`를 사용한다. `MYBOX_PAT`가 설정되어 있으면 file보다
환경변수가 우선한다. 토큰을 명령 인자로 전달하거나 `set -x` 상태에서 입력하지 않는다.

## AI 에이전트 subprocess 계약

자동화 호출은 항상 `--json`을 사용한다. 성공과 예상 가능한 실패 모두 stdout에 JSON envelope 하나와
마지막 newline만 출력하며, stderr는 별도 diagnostics stream이다. exit code를 먼저 확인한 뒤 JSON의
`ok`, `action`, `error.kind`, 선택적 `error.retryAfterMs`를 해석한다.

```bash
myboxctl put ./report.md /agents/output/report.md --mkdir --json \
  >result.json 2>diagnostics.log
status=$?
```

Bun 기반 에이전트의 최소 호출 예시는 다음과 같다.

```ts
const child = Bun.spawn(["myboxctl", "stat", "/agents/output/report.md", "--json"], {
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
const result = JSON.parse(stdout);
```

에이전트는 `stderr`를 결과 JSON으로 합치지 않는다. PAT, Authorization header, upload/download URL이
출력되면 안 되므로 diagnostics도 저장 시 접근 권한을 제한한다.

## timeout, retry, exit code

`MYBOX_TIMEOUT_MS`로 요청 timeout을 조정할 수 있으며 기본값은 30초다.

```bash
MYBOX_TIMEOUT_MS=60000 myboxctl stat /agents/output/report.md --json
```

GET/search는 timeout·network 오류·일부 5xx·429에 대해 operation 정책에 따라 제한적으로 재시도한다.
mutation을 generic retry wrapper로 반복하지 않는다. upload content failure는 동일한 reservation
identity로 한 번만 recovery하며, `put`과 `delete`도 문서화된 reconcile 정책만 따른다.

주요 exit code는 다음과 같다.

| code | 의미                                             | 에이전트 동작                                          |
| ---: | ------------------------------------------------ | ------------------------------------------------------ |
|    0 | 성공, `skipped`·`existing`·`already-absent` 포함 | 결과 JSON 처리                                         |
|    2 | argument/config/path 오류                        | 요청 수정                                              |
|    3 | 인증·권한 오류                                   | PAT와 권한 확인                                        |
|    4 | strict not-found                                 | 원격 경로 확인                                         |
|    5 | conflict                                         | overwrite/force 정책을 명시할지 결정                   |
|    6 | API/network 오류                                 | operation 특성 확인 후 재실행                          |
|    7 | 로컬 파일 오류 또는 업로드 중 변경               | 로컬 파일 상태 확인                                    |
|    8 | rate limit/retry exhausted                       | JSON의 `retryAfterMs`만큼 기다린 뒤 정책에 따라 재시도 |
|   70 | 분류하지 못한 내부 오류                          | 로그와 버전을 보존하고 수동 조사                       |

`retryAfterMs`가 없는 경우에도 호출자가 임의의 빠른 mutation retry를 하지 않는다. 상세 JSON shape와
명령별 정책은 [`docs/reference/cli-contract.md`](../reference/cli-contract.md)를 기준으로 한다.

검색 10회/분과 delete 60회/분 조정 상태는 프로세스 간 공유된다. 기본 파일은
`$XDG_STATE_HOME/myboxctl/rate-limit.json`이며 `XDG_STATE_HOME`이 없으면
`$HOME/.local/state/myboxctl/rate-limit.json`이다. 같은 계정으로 실행하는 AI 에이전트 subprocess가
서로 다른 rate-limit 파일을 사용하지 않도록 한다. 격리된 실행이 꼭 필요할 때만
`MYBOX_RATE_LIMIT_STATE_PATH`를 별도로 지정하고, 해당 state 디렉터리도 사용자만 읽을 수 있게
보호한다. 이 파일에는 PAT나 요청 body를 저장하지 않는다.

## 업그레이드와 rollback

1. 새 버전을 기존 release 디렉터리와 다른 경로에 checkout한다.
2. `bun install --frozen-lockfile`, `bun run build`, `bun run test:release`를 실행한다.
3. 새 artifact를 새 release 디렉터리에 복사하고 `--version`을 확인한다.
4. `~/.local/bin/myboxctl` symlink를 새 release로 교체한다.
5. 기존 release 디렉터리는 검증이 끝날 때까지 보존한다.

예시는 다음과 같다.

```bash
export NEW_RELEASE="0.0.1"
cd "$MYBOXCTL_ROOT/worktree"
git fetch --tags
git checkout "$NEW_RELEASE"
bun install --frozen-lockfile
bun run build
bun run test:release
install -m 755 dist/cli.js "$MYBOXCTL_ROOT/releases/$NEW_RELEASE/cli.js"
ln -sfn "$MYBOXCTL_ROOT/releases/$NEW_RELEASE/cli.js" "$HOME/.local/bin/myboxctl"
myboxctl --version
```

새 release에서 문제가 발견되면 이전 버전의 경로로 symlink를 되돌린다. 실행 중인 daemon을
재시작하는 절차는 없으며, 다음 subprocess 호출부터 새 symlink 대상이 사용된다.

```bash
ln -sfn "$MYBOXCTL_ROOT/releases/$PREVIOUS_RELEASE/cli.js" "$HOME/.local/bin/myboxctl"
myboxctl --version
```
