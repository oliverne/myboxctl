# PowerShell API 토큰 관리

이 문서는 Windows PowerShell에서 API 토큰을 프로필이나 Git 저장소에 평문으로 두지 않으면서,
CLI와 AI agent가 필요한 토큰을 자동으로 사용할 수 있게 하는 방법을 설명한다.

예시는 `MYBOX_PAT`를 사용한다. 다른 API 키도 같은 방법으로 별도 secret 이름을 사용한다.

## 권장 방식 선택

- 중요한 토큰: SecretStore를 비밀번호로 보호하고 PowerShell 세션마다 한 번 unlock한다.
- 개인 개발 PC에서 무프롬프트 사용이 우선: SecretStore의 passwordless 모드와 프로필 자동 로드를 사용한다.
- CI나 배포: GitHub Actions secret, 클라우드 secret manager 또는 짧은 수명의 workload credential을 사용한다.

AI agent가 같은 Windows 사용자 계정으로 실행된다면, agent가 읽을 수 있는 토큰은 해당 사용자로 실행되는
다른 프로세스도 읽을 수 있다고 가정해야 한다. 보안 경계는 agent와 PowerShell 사이가 아니라 Windows
사용자 계정과 프로세스 권한이다.

## 1. SecretStore 설치 및 등록

PowerShell 7에서 현재 사용자 범위로 모듈을 설치한다. 관리자 권한은 필요하지 않다.

```powershell
Install-PSResource Microsoft.PowerShell.SecretManagement -Scope CurrentUser
Install-PSResource Microsoft.PowerShell.SecretStore -Scope CurrentUser

Import-Module Microsoft.PowerShell.SecretManagement
Import-Module Microsoft.PowerShell.SecretStore

Register-SecretVault `
    -Name LocalSecretStore `
    -ModuleName Microsoft.PowerShell.SecretStore `
    -DefaultVault
```

이미 등록했는지 먼저 확인하려면 다음을 사용한다.

```powershell
Get-SecretVault
```

`LocalSecretStore`가 이미 있으면 `Register-SecretVault`는 다시 실행하지 않는다.

SecretStore는 현재 사용자 범위의 로컬 파일에 secret을 저장하고 .NET 암호화 API로 내용을 보호한다.
기본 설정은 vault 비밀번호를 요구하며, 이 방식이 저장된 secret에 대한 보호 수준이 가장 높다.

## 2. 토큰 저장

토큰을 명령 인자나 명령 기록에 넣지 말고, secure prompt로 입력한다.

```powershell
Set-Secret `
    -Name MYBOX_PAT `
    -Vault LocalSecretStore `
    -Secret (Read-Host -Prompt 'MYBOX_PAT' -AsSecureString)
```

다른 토큰도 값마다 별도의 이름으로 저장한다.

```powershell
Set-Secret -Name OPENROUTER_API_KEY -Vault LocalSecretStore `
    -Secret (Read-Host -Prompt 'OPENROUTER_API_KEY' -AsSecureString)
```

저장된 이름만 확인하고 secret 값은 출력하지 않는다.

```powershell
Get-SecretInfo -Vault LocalSecretStore
```

## 3. 기본 보안 방식: 세션당 한 번 unlock

기본 설정에서는 처음 접근할 때 vault 비밀번호를 묻는다. 세션을 시작할 때 한 번만 unlock할 수 있다.

```powershell
Unlock-SecretStore
```

그 다음 필요한 secret을 현재 PowerShell 프로세스의 환경 변수로 올린다.

```powershell
$env:MYBOX_PAT = Get-Secret `
    -Name MYBOX_PAT `
    -Vault LocalSecretStore `
    -AsPlainText

myboxctl info /
```

사용을 마친 뒤에는 현재 세션의 환경 변수에서 제거한다.

```powershell
Remove-Item Env:MYBOX_PAT -ErrorAction SilentlyContinue
```

환경 변수는 CLI 같은 자식 프로세스에 상속되므로, `myboxctl` 실행 중에는 토큰이 프로세스 환경에
존재한다. 다만 토큰을 PowerShell 프로필에 영구적으로 넣거나 User 환경 변수로 저장하는 것과는 다르다.

## 4. AI agent용 무프롬프트 자동 로드

매번 수동으로 환경 변수를 설정하기 싫은 개인 개발 PC에서는 passwordless 모드를 사용할 수 있다.

```powershell
Set-SecretStoreConfiguration `
    -Authentication None `
    -Interaction None `
    -Confirm:$false
```

기존 vault가 비밀번호 모드라면 현재 vault 비밀번호를 입력해야 passwordless 모드로 전환할 수 있다.
비밀번호를 명령 인자에 직접 쓰지 않는다.

```powershell
$currentVaultPassword = Read-Host -Prompt '현재 SecretStore 비밀번호' -AsSecureString
Set-SecretStoreConfiguration `
    -Authentication None `
    -Interaction None `
    -Password $currentVaultPassword `
    -Confirm:$false
Remove-Variable currentVaultPassword -ErrorAction SilentlyContinue
```

그 다음 PowerShell 프로필에 필요한 secret만 자동 로드하는 코드를 추가한다.

```powershell
Import-Module Microsoft.PowerShell.SecretManagement
Import-Module Microsoft.PowerShell.SecretStore

foreach ($secretName in @('MYBOX_PAT')) {
    try {
        $secretValue = Get-Secret `
            -Name $secretName `
            -Vault LocalSecretStore `
            -AsPlainText `
            -ErrorAction Stop

        Set-Item -Path "Env:$secretName" -Value $secretValue
        Remove-Variable secretValue -ErrorAction SilentlyContinue
    }
    catch {
        # SecretStore가 아직 설정되지 않았거나 secret이 없으면 셸 시작을 방해하지 않는다.
    }
}
```

PowerShell 프로필 경로는 `$PROFILE`로 확인할 수 있다.

```powershell
$PROFILE
```

AI agent를 그 PowerShell 세션에서 실행하거나, 프로필을 로드하는 새 PowerShell 세션으로 agent를
시작하면 `MYBOX_PAT`를 별도 준비 없이 사용할 수 있다. `pwsh -NoProfile`로 실행되는 프로세스에는
프로필 자동 로드가 적용되지 않는다.

### passwordless 모드의 주의점

SecretStore의 `Authentication None`도 secret 파일 자체는 암호화하지만, 복호화 키가 현재 사용자
파일 시스템에 저장된다. 따라서 같은 사용자 권한을 가진 프로세스가 접근할 수 있으며, Microsoft는
중요한 secret에는 이 모드를 권장하지 않는다.

무프롬프트 자동 로드는 개인 개발용·범위가 제한된 토큰에만 사용하고, 배포 권한이나 결제 권한이 있는
토큰에는 세션 unlock 또는 외부 secret manager를 사용한다.

## 5. 토큰 교체와 삭제

토큰을 교체할 때도 secure prompt를 사용한다.

```powershell
Set-Secret `
    -Name MYBOX_PAT `
    -Vault LocalSecretStore `
    -Secret (Read-Host -Prompt '새 MYBOX_PAT' -AsSecureString)
```

더 이상 사용하지 않는 secret은 삭제한다.

```powershell
Remove-Secret -Name MYBOX_PAT -Vault LocalSecretStore
Remove-Item Env:MYBOX_PAT -ErrorAction SilentlyContinue
```

프로필, `.env`, 명령 인자, Git history, 로그에는 토큰을 기록하지 않는다. 이미 평문으로 저장했거나
출력한 토큰은 SecretStore로 옮기는 것만으로 충분하지 않으므로, 공급자 콘솔에서 폐기하고 새 토큰을
발급한다.

## 6. 피해야 할 방식

다음 방식은 편하지만 저장된 secret을 보호하지 않는다.

```powershell
# 피해야 함: 프로필에 평문 저장
$env:MYBOX_PAT = 'token-value'

# 피해야 함: 사용자 환경 변수에 평문 저장
[Environment]::SetEnvironmentVariable('MYBOX_PAT', 'token-value', 'User')
```

User 범위 환경 변수는 세션을 넘어 유지되고 Windows 사용자 환경 설정에 저장된다. 환경 변수는 자식
프로세스에도 상속되므로, 이 방법은 편의성은 높지만 노출 범위가 넓다.

## 참고 자료

- [SecretStore 시작하기](https://learn.microsoft.com/en-us/powershell/utility-modules/secretmanagement/get-started/using-secretstore?view=ps-modules)
- [SecretStore 관리](https://learn.microsoft.com/en-us/powershell/utility-modules/secretmanagement/how-to/manage-secretstore?view=ps-modules)
- [SecretManagement와 SecretStore의 보안 기능](https://learn.microsoft.com/en-us/powershell/utility-modules/secretmanagement/security-concepts?view=ps-modules)
- [PowerShell 환경 변수](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables?view=powershell-7.5)
- [PowerShell 프로필](https://learn.microsoft.com/en-us/powershell/scripting/learn/shell/creating-profiles?view=powershell-7.6)
