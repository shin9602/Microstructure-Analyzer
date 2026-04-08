## Phase 2: 사용자 피드백 반영 및 기능 고도화

### 1. 이미지 및 레이아웃 조정
- [MODIFY] `CanvasArea.tsx`: 배경색을 흰색 계통(`bg-slate-50`)으로 복구.
- [MODIFY] `CanvasArea.tsx`: 스페이스바 키 다운/업 감지로 사진 이동(Panning) 기능 추가.
- [MODIFY] `CanvasArea.tsx`: `Shift` 키 감지 및 선 그리기 시 수평/수직 스냅(Snap) 기능 구현.

### [Batch Analysis]
- Implement full batch analysis logic in `App.tsx`:
    - Iterate through `imageList`.
    - For each item, load its image data.
    - Run `AutoAnalyzer.analyzeCvdCoating` with current settings.
    - Store the resulting `Measurement` back into the entry's `measurements` array.
- Add "Batch Auto Analysis" (일괄 자동분석) button to `Sidebar.tsx`.
- Connect the button to the new logic in `App.tsx`.

### [UI Style Polish]
- Sidebar buttons: Light gray background (`#f8fafc`), Slate-600 text.
- Apply/Delete buttons: White background with colored borders.
- Improve button hover/active states for better feedback.

### 2. 측정도구 로직 및 스타일 변경
- [MODIFY] `CanvasArea.tsx`: 사각형 및 자동분석 도구를 드래그 방식에서 **클릭-투-클릭** 방식으로 변경.
- [MODIFY] `CanvasArea.tsx`: 사각형 측정 시에도 해당 영역의 조도 프로파일을 계산하여 차트에 표시.
- [MODIFY] `Measurement.ts`: 모든 측정도구의 색상을 요청받은 파란색 계열로 변경.
- [MODIFY] `Measurement.ts`: `draw` 메서드에서 `Shift` 스냅 상태 반영 표시 개선.

### 3. 데이터 연동 및 단축키 정리
- [MODIFY] `App.tsx`: 줌 컨트롤 버튼(+/-, 초기화, 100%) 기능 연동 및 오류 수정.
- [MODIFY] `App.tsx`: 단축키 메뉴 업데이트 (지원하지 않는 도구 단축키 삭제, Space/Shift 추가).

## 검증 계획
### 통합 테스트
- 스페이스바를 누른 채 마우스 이동 시 Panning 동작 확인.
- `Shift` 키를 누르면 선이 수평/수직으로 고정되는지 확인.
- 사각형 도구가 첫 클릭 후 마우스를 떼도 가이드가 남고 두 번째 클릭 시 완성되는지 확인.
- 캘리브레이션 변경 후 테이블의 모든 숫자가 비례하여 변하는지 확인.
