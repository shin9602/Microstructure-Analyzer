# AutoCalculator — Claude 작업 가이드

## 릴리즈 업로드 및 자동 업데이트 테스트 절차

코드 변경 후 자동 업데이트가 정상 작동하는지 확인하는 순서:

### 1. 코드 푸시
```
git add <변경파일>
git commit -m "..."
git push origin main
```

### 2. GitHub Release 생성 (API 사용)
토큰 파일: `token.txt` (프로젝트 루트, git에 커밋하지 말 것)

```powershell
$token = [System.IO.File]::ReadAllText("token.txt").Trim()
$headers = @{ Authorization = "token $token"; "Content-Type" = "application/json" }
$body = @{ tag_name = "v1.0.X"; name = "v1.0.X"; body = "변경 내용"; draft = $false; prerelease = $false } | ConvertTo-Json
Invoke-RestMethod "https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases" -Method Post -Headers $headers -Body $body
```

> 주의: 릴리즈는 **생성 날짜 기준**으로 latest가 결정됨.
> 이전 버전이 더 나중에 만들어져 있으면 latest가 잘못 잡힘 — 그 릴리즈를 삭제해야 함.

### 3. version.txt를 한 단계 낮춤 (테스트용, 커밋 X)
```
echo v1.0.W > version.txt
```

### 4. START_HERE.bat 실행 → 업데이트 메시지 확인
```
New version: v1.0.X
Update now? [Y/N]:
```
→ Y 입력 후 자동 다운로드·적용·재시작 확인

### 5. 테스트 완료 후 version.txt 복원
```
echo v1.0.X > version.txt
```

---

## 릴리즈 latest 오류 수정법

`/releases/latest` API가 구버전을 반환할 때:

```powershell
$token = [System.IO.File]::ReadAllText("token.txt").Trim()
$headers = @{ Authorization = "token $token" }
$releases = Invoke-RestMethod "https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases" -Headers $headers
$releases | ForEach-Object { "$($_.tag_name) - created:$($_.created_at)" }
# 날짜가 가장 늦은데 구버전인 릴리즈 ID를 찾아 삭제
Invoke-RestMethod "https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases/<ID>" -Method Delete -Headers $headers
```

---

## GitHub 토큰 관련

- 토큰은 `token.txt`에 저장, `.gitignore`에 추가 필요
- 필요 권한: `repo`
- 발급: https://github.com/settings/tokens → Generate new token (classic)
- gh CLI 대신 PowerShell `Invoke-RestMethod`로 직접 API 호출하는 방식 사용 (gh CLI는 인증 불안정)
