# AutoCalculator — Claude 작업 가이드

## 코드 변경 후 필수 릴리즈 프로토콜

> **모든 코드 변경 시 반드시 이 순서 전체를 완료해야 함.**
> 단순 수정이라도 건너뛰지 말 것 — 다운로드 테스트까지 통과해야 배포 완료.

## 릴리즈 배포 및 자동 업데이트 테스트 절차

코드 변경 후 자동 업데이트가 정상 작동하는지 **반드시 아래 순서대로** 확인할 것.

---

### 1. 코드 푸시
```powershell
git add <변경파일>
git commit -m "..."
git push origin main
```

---

### 2. GitHub Release 생성 + ZIP 업로드
토큰 파일: `token.txt` (프로젝트 루트, 절대 커밋 금지)

> **주의: 이 프로젝트는 OneDrive 폴더에 있어서 파일들이 심볼릭 링크로 저장됨.**
> ZIP 생성 시 반드시 **robocopy로 임시 폴더에 실제 파일을 복사한 뒤** ZIP을 만들어야 함.
> `CreateEntryFromFile()`을 OneDrive 원본 경로에 직접 사용하면 파일이 0바이트로 들어감.
> 또한 `Where-Object` 파이프라인 대신 **`foreach` 루프**를 사용해야 필터가 정상 동작함.

```powershell
$root = "c:\Users\korloy\OneDrive - 다인그룹\바탕 화면\자동화 프로그램\AutoCalulator v1.0.0"
$ver = "v1.0.X"
$tmpDir = "c:\Users\korloy\AppData\Local\Temp\ac_build_tmp"
$zipPath = "c:\Users\korloy\AppData\Local\Temp\AutoCalculator-$ver.zip"
$token = [System.IO.File]::ReadAllText("$root\token.txt").Trim()

# 1) 릴리즈 생성
$headers = @{ Authorization = "token $token"; "Content-Type" = "application/json" }
$body = @{ tag_name = $ver; name = $ver; body = "변경 내용"; draft = $false; prerelease = $false } | ConvertTo-Json
$r = Invoke-RestMethod "https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases" -Method Post -Headers $headers -Body $body
$releaseId = $r.id
Write-Output "릴리즈 생성: $($r.tag_name) (id: $releaseId)"

# 2) robocopy로 실제 파일 복사 (OneDrive 링크 우회)
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $tmpDir | Out-Null
robocopy $root $tmpDir /E /XD node_modules _tools _update_temp .git .claude dist dist-ssr __pycache__ .venv venv env .temp_ebsd /XF "*.log" "token.txt" "*.zip" "*.7z" "*.rar" "pdf_text.md" "ang_header.txt" "temp_header.txt" /NFL /NDL /NJH /NJS

# 3) ZIP 생성 (foreach 루프 필수 — Where-Object 파이프라인 사용 금지)
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
$files = Get-ChildItem -Path $tmpDir -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($tmpDir.Length + 1)
    if ($rel -like "python\*.png") { return $false }
    if ($rel -like "python\*.txt") { return $false }
    return $true
}
foreach ($file in $files) {
    $rel = $file.FullName.Substring($tmpDir.Length + 1)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $rel) | Out-Null
}
$zip.Dispose()

# 4) ZIP 업로드
$headers2 = @{ Authorization = "token $token"; "Content-Type" = "application/zip" }
$uploadUrl = "https://uploads.github.com/repos/shin9602/Microstructure-Analyzer/releases/$releaseId/assets?name=AutoCalculator-$ver.zip"
$bytes = [System.IO.File]::ReadAllBytes($zipPath)
$r2 = Invoke-RestMethod $uploadUrl -Method Post -Headers $headers2 -Body $bytes
Write-Output "업로드 완료: $($r2.name) ($($r2.size) bytes)"

# 5) ZIP 검증 — 실제 파일과 ZIP 내용 비교 (누락 있으면 업로드 중단)
$excludeDirs2 = @("node_modules","_tools","_update_temp",".git",".claude","dist","dist-ssr","__pycache__",".venv","venv","env",".temp_ebsd")
$excludeFiles2 = @("*.log","token.txt","*.zip","*.7z","*.rar","pdf_text.md","ang_header.txt","temp_header.txt")
$actualFiles = Get-ChildItem -Path $root -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    $parts = $rel -split '\\'
    foreach ($d in $excludeDirs2) { if ($parts -contains $d) { return $false } }
    foreach ($p in $excludeFiles2) { if ($_.Name -like $p) { return $false } }
    if ($rel -like "python\*.png") { return $false }
    if ($rel -like "python\*.txt") { return $false }
    return $true
} | ForEach-Object { $_.FullName.Substring($root.Length + 1) -replace '\\','/' } | Sort-Object

$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$zipFiles = $zipCheck.Entries | ForEach-Object { $_.FullName -replace '\\','/' } | Sort-Object
$zipCheck.Dispose()

$missing = $actualFiles | Where-Object { $zipFiles -notcontains $_ }
if ($missing) {
    Write-Output "[ERROR] ZIP에 누락된 파일 있음 — 업로드 중단:"
    $missing | ForEach-Object { Write-Output "  MISSING: $_" }
    Remove-Item $zipPath -Force
    Remove-Item $tmpDir -Recurse -Force
    exit 1
}
Write-Output "[OK] ZIP 검증 완료 — 실제 $($actualFiles.Count)개 / ZIP $($zipFiles.Count)개 일치"

# 6) 임시 파일 정리
Remove-Item $zipPath -Force
Remove-Item $tmpDir -Recurse -Force
Write-Output "완료"
```

> 주의: GitHub는 **생성 날짜 기준**으로 latest를 결정함.
> 구버전 릴리즈가 더 최근에 만들어져 있으면 latest가 잘못 잡힘 → 아래 오류 수정법 참고.

---

### 3. latest 확인
```powershell
$r = Invoke-RestMethod "https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases/latest"
Write-Output "Latest: $($r.tag_name)"
```
→ 새 버전이 맞는지 확인. 틀리면 아래 오류 수정법 실행.

---

### 4. version.txt를 한 단계 낮춰서 다운로드 테스트 (커밋 X)
```powershell
# v1.0.X 배포 후 → v1.0.W로 낮춰서 테스트
Set-Content ".\version.txt" "v1.0.W" -NoNewline
```

---

### 5. PowerShell로 다운로드 직접 검증 (START_HERE.bat 없이도 가능)
```powershell
$ver = "v1.0.X"
$zipUrl = "https://github.com/shin9602/Microstructure-Analyzer/releases/download/$ver/AutoCalculator-$ver.zip"
$outFile = "$env:TEMP\test_download_$ver.zip"
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
Invoke-WebRequest $zipUrl -OutFile $outFile -UseBasicParsing
$size = (Get-Item $outFile).Length
Write-Output "다운로드 완료: $size bytes"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead($outFile)
Write-Output "ZIP 내 파일 수: $($z.Entries.Count)"
$vf = $z.Entries | Where-Object { $_.FullName -eq "version.txt" }
Write-Output "version.txt: $([System.IO.StreamReader]::new($vf.Open()).ReadToEnd())"
$z.Dispose()
Remove-Item $outFile -Force
```
→ `version.txt: v1.0.X` 출력되면 정상.

---

### 6. START_HERE.bat 실행 → 업데이트 감지 확인 (선택)
아래 메시지가 뜨면 정상:
```
Current: v1.0.W
New version: v1.0.X
Update now? [Y/N]:
```
→ 안 뜨면 문제 있는 것 — 원인 파악 후 해결하고 다시 테스트.

---

### 7. 테스트 완료 후 version.txt 복원 (커밋 후 푸시)
```powershell
Set-Content ".\version.txt" "v1.0.X" -NoNewline
git add version.txt
git commit -m "Restore version.txt to v1.0.X"
git push origin main
```

---

## 릴리즈 latest 오류 수정법

`/releases/latest`가 구버전을 반환할 때:

```powershell
$token = [System.IO.File]::ReadAllText(".\token.txt").Trim()
$headers = @{ Authorization = "token $token" }

# 전체 릴리즈 목록 + 생성 날짜 확인
$releases = Invoke-RestMethod "https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases" -Headers $headers
$releases | ForEach-Object { "$($_.tag_name) - id:$($_.id) - created:$($_.created_at)" }

# 날짜가 가장 늦은데 구버전인 릴리즈 삭제
Invoke-RestMethod "https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases/<ID>" -Method Delete -Headers $headers
```

---

## GitHub 토큰 관련

- 토큰 위치: `token.txt` (`.gitignore`에 등록됨)
- 필요 권한: `repo`
- 발급: https://github.com/settings/tokens → Generate new token (classic) → `repo` 체크
- gh CLI는 인증 불안정 → PowerShell `Invoke-RestMethod`로 직접 API 호출할 것
