# ☕ 문동휘와 커피챗

9월 한 달간 커피챗 신청을 받는 정적 웹사이트입니다.
GitHub Pages(프론트) + Google Apps Script(백엔드) + Google Calendar 연동.

- 로그인 없이 **이름만** 남기고 신청
- 방법(식사/커피/운동/기타) → 장소/종목 → 날짜·시간대 → 정확한 시간 → 이름
- 맛집 488곳: 네이버 지도 저장 리스트에서 추출 (⭐찐맛집 / ✅검증된 맛집 / 맛집)
- 예약되거나 내 캘린더가 차 있는 시간대는 자동으로 선택 불가 (캘린더 **내용은 비공개**, 참/빔만 노출)
- 신청 완료 시 내 구글 캘린더에 `@@시 [이름] [위치] 커피챗` 이벤트 자동 생성

## 배포 후 해야 할 설정 (2가지)

### 1. Google Apps Script 백엔드 (5분)

1. [script.google.com](https://script.google.com) 접속 → **새 프로젝트**
2. 기본 `Code.gs` 내용을 지우고 이 저장소의 `apps-script/Code.gs` 내용을 전부 붙여넣기
3. 우측 상단 **배포 > 새 배포** 클릭
   - 유형 선택(⚙️): **웹 앱**
   - 실행 계정: **나(Me)**
   - 액세스 권한: **모든 사용자(Anyone)**
4. **배포** 클릭 → 구글 계정 권한 승인 (캘린더/시트 접근 허용)
5. 발급된 `https://script.google.com/macros/s/…/exec` URL 복사
6. `js/config.js`의 `API_URL`에 붙여넣고 commit & push

> 예약 내역은 내 구글 드라이브에 자동 생성되는 **"커피챗 예약"** 스프레드시트에 쌓입니다.

### 2. 네이버 지도 API (선택이지만 추천)

1. [네이버 클라우드 플랫폼 콘솔](https://console.ncloud.com) → **AI·NAVER API > Maps**
2. Application 등록 → **Web Dynamic Map** 선택
3. Web 서비스 URL에 GitHub Pages 주소 등록 (예: `https://doonghwi.github.io`)
4. 발급된 **Client ID(ncpKeyId)** 를 `js/config.js`의 `NAVER_CLIENT_ID`에 붙여넣고 push

지도 키가 없어도 리스트 모드로 정상 동작합니다.

## 예약 취소하기

**구글 캘린더에서 해당 이벤트를 삭제하면 끝!** 슬롯 참/빔은 캘린더만 보고 판단하므로,
이벤트를 지우면 그 시간이 사이트에서 다시 신청 가능해집니다.
스프레드시트("커피챗 예약")는 기록용 로그라서 지우지 않아도 됩니다.

## 안 되는 시간 수정하기

두 곳을 **똑같이** 고쳐야 합니다:

- `js/data.js`의 `BLOCKED` (화면 표시용)
- Apps Script의 `BLOCKED` (서버 검증용 — 수정 후 **배포 > 배포 관리 > 새 버전**으로 재배포)

## 로컬 미리보기

```bash
python -m http.server 8000
# http://localhost:8000
```

## 구조

```
index.html          # 소개 + 신청 위저드
css/style.css       # 따뜻한 커피톤 테마
js/config.js        # API_URL, NAVER_CLIENT_ID (배포 설정)
js/data.js          # 시간대/안 되는 시간/운동 종목
js/places.js        # 맛집 488곳 데이터 (자동 생성)
js/app.js           # 위저드 로직, 지도, 달력, 제출
apps-script/Code.gs # 백엔드 (예약 저장 + 캘린더 연동)
```
