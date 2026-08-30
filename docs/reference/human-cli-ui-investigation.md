# Human CLI UI 조사

> 상태: Phase 13 계획 근거
> 조사 대상: 2026-08-29의 로컬 `my-cli` CLI UI/TUI prototype
> 관련 phase: [`../phases/13-observability-and-test-latency.md`](../phases/13-observability-and-test-latency.md)

## 목적

사람이 `myboxctl`을 직접 실행할 때 긴 대기, retry와 upload 진행 상태를 쉽게 이해하도록 만들되,
기존 agent용 JSON 계약과 non-interactive log를 훼손하지 않는 최소 UI를 정한다.

`my-cli`는 설계 참고 자료일 뿐 runtime dependency나 source import 대상이 아니다. prototype의 여러 UI
library를 그대로 추가하지 않고, 실제 출력에서 유효했던 표현 원칙만 myboxctl의 typed event와 renderer에
적용한다.

## 확인한 prototype

| 파일/컴포넌트                         | 확인한 동작                               | Phase 13 판단                                    |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| `text.ts`                             | 상태별 색상과 `✔`, `✖`, `⚠`, `→` 표시     | semantic level과 compact prefix 개념 채택        |
| `progress.ts`                         | `\r` 기반 단일 progress bar               | TTY redraw 개념만 채택, stdout 직접 출력은 금지  |
| `progress-cli.ts`                     | percentage, speed, ETA와 multi-bar        | 초기 dependency와 multi-bar는 제외               |
| `spinner.ts`                          | start/succeed/fail과 stage text 변경      | 짧은 작업 spinner 대신 지연 후 stage 표시 사용   |
| `steps.ts`                            | pending/active/done/failed 단계 표현      | typed stage event와 compact status 개념 채택     |
| `steps-listr.ts`                      | nested task renderer와 error continuation | command orchestration dependency로는 과도해 제외 |
| `logger-consola.ts`                   | level/tag 기반 pretty logger              | 범용 logger를 추가하지 않고 typed allowlist 사용 |
| `box.ts`, `table.ts`, `markdown.ts`   | 강조 박스, 표, rich result rendering      | routine command progress/error에는 사용하지 않음 |
| `input-inquirer.ts`, `input-clack.ts` | interactive prompt와 cancel 처리          | deterministic agent CLI이므로 Phase 13 범위 밖   |

## 실제 출력 관찰

non-interactive pipe에서 prototype을 실행해 다음을 확인했다.

- `text`의 상태 prefix와 `steps`의 line-oriented 출력은 색상이 없어도 의미를 이해할 수 있었다.
- custom progress의 모든 `\r` frame은 캡처 결과에 연속해서 노출됐다. 실제 TTY에서는 한 줄로 보이지만
  CI, agent capture와 redirected stderr에서는 로그가 크게 늘어난다.
- `ora`는 non-TTY에서 line-oriented 상태로 degrade했지만, myboxctl에 spinner dependency를 추가할 만큼
  필요한 기능은 아니었다.
- box, table과 markdown은 showcase나 긴 결과 요약에는 유용하지만 단일 파일 operation의 중간 상태와
  오류에는 정보 밀도가 낮았다.

따라서 redraw 여부는 반드시 `stderr.isTTY`로 결정하고, non-TTY에는 carriage return과 cursor control을
출력하지 않는다.

## 채택할 Human UI

### 짧은 명령

`stat`, `ls`처럼 일반적으로 빠른 명령은 기본 spinner나 stage를 출력하지 않는다. 500ms 안에 끝나는
작업은 기존 최종 결과만 보여줘 flicker를 피한다.

### 긴 단계

작업이 500ms를 넘거나 `--verbose`인 경우 다음처럼 현재 단계를 stderr에 표시한다.

```text
→ Resolving remote path…
→ Reserving upload…
→ Verifying remote result…
```

기본 TTY에서는 현재 단계 한 줄만 갱신한다. `--verbose` 또는 non-TTY line log에서는 단계 전환을 각각
남긴다. 최종 성공은 기존 stdout 결과가 담당하므로 stderr에 같은 성공 결과를 중복하지 않는다.

### Upload/put progress

TTY의 compact 기본 표시:

```text
Uploading [████████░░░░] 68% · 68.0/100.0 MiB
```

`--verbose` 표시에는 충분한 표본이 쌓였을 때만 speed와 ETA를 renderer가 계산해 추가한다.

```text
Uploading [████████░░░░] 68% · 68.0/100.0 MiB · 8.1 MiB/s · ETA 4s
```

- event contract는 `transferredBytes`, `totalBytes`와 resume `offset`만 사실로 제공한다.
- percent, speed와 ETA는 renderer가 계산하며 JSON final contract에 추가하지 않는다.
- terminal width가 좁으면 bar와 ETA를 차례로 생략하고 byte/percent만 남긴다.
- 0-byte 파일은 progress bar 없이 단계와 최종 결과만 보여준다.
- 한 command가 동시에 여러 파일을 전송하지 않으므로 multi-bar는 추가하지 않는다.

### Rate-limit wait

TTY에서는 하나의 event로 받은 `waitMs`를 local countdown으로 표시한다.

```text
⚠ Rate limited · retrying in 42s
```

non-TTY human과 JSONL에는 매초 countdown을 쓰지 않는다. wait 시작과 실제 재개 event만 한 줄씩 남겨
로그 폭주와 agent event 중복을 피한다.

### Human final error

오류 box는 사용하지 않고 좁은 terminal과 copy/paste에 안전한 line-oriented 형식을 쓴다.

```text
Error: The request rate limit was exceeded.
Code: PLAT-429
Retry after: 60s
```

해결 방법이 command와 error code로 확정되는 경우에만 `Hint:`를 추가한다. 색상과 icon이 없어도 모든
정보가 보존되어야 한다.

## TTY와 접근성 정책

- terminal 제어와 color 판단은 stdout이 아니라 stderr 기준이다.
- `stderr.isTTY !== true`, `TERM=dumb` 또는 `NO_COLOR`에서는 color와 redraw를 사용하지 않는다.
- `--json`의 stderr JSON Lines에는 ANSI escape와 Unicode progress bar를 넣지 않는다.
- TTY에서는 `process.stderr.columns`와 `Bun.stringWidth()`를 사용해 현재 폭에 맞춘다.
- color는 의미를 보조할 뿐 level, text와 icon을 대체하지 않는다.
- Windows Terminal, macOS Terminal과 Ubuntu terminal에서 standalone executable의 줄 정리와 폭을
  검증한다.
- SIGINT, timeout과 terminal failure에서 active line을 지우고 newline을 보장한다. cursor를 숨기는
  구현을 선택한다면 모든 종료 경로에서 반드시 복원한다.

## Dependency 결정

Phase 13 첫 구현에는 `ora`, `cli-progress`, `listr2`, `consola`, `boxen`, `cli-table3`, prompt library를
추가하지 않는다. 현재 command는 단일 operation이고 event/output 계약이 작아 custom renderer가 더
직접적이며 테스트하기 쉽다.

색상도 우선 작은 내부 renderer와 Bun 1.4의 terminal utility로 구현한다. ANSI/color support 처리가
복잡해져 별도 dependency가 실제로 필요해질 때만 `picocolors` 같은 단일 목적 library를 다시 검토한다.

## 검증 항목

- TTY: 500ms 이후 stage 표시, 한 줄 upload progress, warning/error 전 active line 정리
- narrow TTY: bar 축소와 compact percent/byte fallback
- non-TTY: carriage return, cursor escape와 중간 frame 없음
- `NO_COLOR`/`TERM=dumb`: 정보 손실 없는 plain text
- `--json`: stdout final envelope 1개와 ANSI 없는 stderr JSON Lines
- `--quiet`: progress/warning 억제, human final error와 JSON final envelope 유지
- `--verbose`: stage history와 throttled progress 표시
- SIGINT/error: newline/cursor cleanup과 secret redaction
- Ubuntu, macOS, Windows standalone executable smoke
