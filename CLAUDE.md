# AutoCalculator — Claude 작업 가이드

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

### 2. GitHub Release 생성
토큰 파일: `token.txt` (프로젝트 루트, 절대 커밋 금지)

```powershell
$token = [System.IO.File]::ReadAllText(".\token.txt").Trim()
$headers = @{ Authorization = "token $token"; "Content-Type" = "application/json" }
$body = @{ tag_name = "v1.0.X"; name = "v1.0.X"; body = "변경 내용"; draft = $false; prerelease = $false } | ConvertTo-Json
$r = Invoke-RestMethod "https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases" -Method Post -Headers $headers -Body $body
Write-Output "생성됨: $($r.tag_name)"
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

### 4. version.txt를 한 단계 낮춰서 테스트 (커밋 X)
```powershell
Set-Content ".\version.txt" "v1.0.W" -NoNewline
```

---

### 5. START_HERE.bat 실행 → 업데이트 감지 확인
아래 메시지가 뜨면 정상:
```
Current: v1.0.W
New version: v1.0.X
Update now? [Y/N]:
```
→ 안 뜨면 문제 있는 것 — 원인 파악 후 해결하고 다시 테스트.

---

### 6. 테스트 완료 후 version.txt 복원 (커밋 후 푸시)
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
