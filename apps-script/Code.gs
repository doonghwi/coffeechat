/**
 * ☕ 커피챗 예약 백엔드 (Google Apps Script)
 *
 * 하는 일
 *  - GET  ?action=busy : 날짜별로 이미 찬 시간대 반환 (예약 + 내 구글 캘린더 참/빔)
 *                        → 캘린더 "내용"은 절대 내보내지 않고 참/빔 여부만 계산합니다.
 *  - POST {name, method, location, date, slot, time, endTime, message}
 *         : 슬롯 검증 → 스프레드시트에 기록 → 내 캘린더에
 *           "오전 n시~m시 [이름] [위치] 커피챗" 이벤트 생성 (시작~종료 시각 그대로)
 *           → ntfy.sh/coffeechat-doonghwi 로 푸시 알림 (신청 메시지 포함)
 *
 * 배포: 우측 상단 [배포] > 새 배포 > 유형: 웹 앱
 *   - 실행 계정: 나(Me)
 *   - 액세스 권한: 모든 사용자(Anyone)
 *   → 발급된 /exec URL을 js/config.js의 API_URL에 붙여넣기
 *
 * ★ 취소 방법: 구글 캘린더에서 해당 이벤트를 삭제하면 끝!
 *   슬롯 참/빔은 오직 "캘린더"만 보고 판단하므로, 이벤트를 지우면
 *   그 시간이 사이트에서 다시 신청 가능으로 바뀝니다.
 *   (스프레드시트는 기록용 로그일 뿐 — 지우지 않아도 됩니다)
 */

var YEAR = 2026;
var MONTH = 9; // 9월

// ntfy 액세스 토큰 (필수!)
// Apps Script는 구글 공유 IP를 쓰기 때문에 익명 발송은 429(할당량 초과)가 자주 뜹니다.
// ntfy.sh에서 무료 계정 생성 → 우측 상단 계정 → Access tokens → CREATE ACCESS TOKEN
// → "tk_..." 로 시작하는 토큰을 아래에 붙여넣으세요.
var NTFY_TOKEN = "";

// 프론트엔드 js/data.js와 반드시 동일하게 유지!
var SLOTS = {
  "아침":   [7, 10],
  "브런치": [10, 12],
  "점심":   [12, 14],
  "점저":   [15, 17],
  "저녁":   [18, 20],
  "밤":     [20, 24],
  "새벽":   [0, 7]
};

var BLOCKED = {
  3:  "all",
  4:  ["점심"],
  5:  ["브런치", "점심", "점저", "밤", "새벽"],
  6:  ["저녁", "밤", "새벽"],
  8:  ["점저", "저녁"],
  11: ["저녁", "밤", "새벽"],
  13: "all",
  15: ["저녁"],
  16: ["저녁", "밤", "새벽"],
  18: "all",
  19: "all",
  20: "all",
  21: "all",
  22: "all",
  29: ["저녁"]
};

// 시간대보다 잘게 막는 부분 차단 (js/data.js와 동일하게 유지!)
// 월·목은 19~22시만 차단 → 18시대와 22·23시대는 신청 가능
var BLOCKED_RANGES = {
  7:  [["19:00", "22:00"]],
  10: [["19:00", "22:00"]],
  14: [["19:00", "22:00"]],
  17: [["19:00", "22:00"]],
  28: [["19:00", "22:00"]]
};

// ---------- 시트 ----------
function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID");
  var ss;
  if (!id) {
    ss = SpreadsheetApp.create("커피챗 예약");
    props.setProperty("SHEET_ID", ss.getId());
    ss.getSheets()[0].appendRow(["신청시각", "이름", "날짜(일)", "시간대", "시간", "방법", "장소", "직접추천여부", "메시지"]);
  } else {
    ss = SpreadsheetApp.openById(id);
  }
  return ss.getSheets()[0];
}

// 내 구글 캘린더에서 참/빔만 계산 (제목·내용은 절대 반환하지 않음)
// 예약 이벤트도 캘린더에 생성되므로, 캘린더가 유일한 기준(single source of truth)!
function calendarBusy_() {
  var cal = CalendarApp.getDefaultCalendar();
  var start = new Date(YEAR, MONTH - 1, 1);
  var end = new Date(YEAR, MONTH, 1);
  var events = cal.getEvents(start, end);
  var busy = {};
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.isAllDayEvent()) continue; // 종일 이벤트는 막지 않음
    var s = ev.getStartTime();
    var e = ev.getEndTime();
    // 이벤트가 걸치는 날짜들을 순회
    var d = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    while (d < e) {
      if (d.getFullYear() === YEAR && d.getMonth() === MONTH - 1) {
        var day = d.getDate();
        for (var key in SLOTS) {
          var slotStart = new Date(YEAR, MONTH - 1, day, SLOTS[key][0], 0);
          var slotEnd = new Date(YEAR, MONTH - 1, day, 0, 0);
          slotEnd.setHours(SLOTS[key][1]); // to=24도 안전
          if (s < slotEnd && e > slotStart) {
            var dk = String(day);
            if (!busy[dk]) busy[dk] = [];
            if (busy[dk].indexOf(key) < 0) busy[dk].push(key);
          }
        }
      }
      d.setDate(d.getDate() + 1);
    }
  }
  return busy;
}

function mergedBusy_() {
  return calendarBusy_(); // 캘린더에서 이벤트를 지우면 슬롯이 다시 열립니다
}

function isBlocked_(day, slot) {
  var bl = BLOCKED[day];
  if (bl === "all") return true;
  if (bl && bl.indexOf(slot) >= 0) return true;
  return false;
}

// ---------- 엔드포인트 ----------
function doGet(e) {
  return json_({ ok: true, busy: mergedBusy_() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var b = JSON.parse(e.postData.contents);
    var name = String(b.name || "").trim().substring(0, 30);
    var location = String(b.location || "").trim().substring(0, 60);
    var method = String(b.method || "").trim();
    var day = parseInt(b.date, 10);
    var slot = String(b.slot || "");
    var time = String(b.time || "");
    var endTime = String(b.endTime || "");
    var message = String(b.message || "").trim().substring(0, 500);

    if (!name || !location || !day || !SLOTS[slot] || !/^\d{2}:\d{2}$/.test(time) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return json_({ ok: false, error: "invalid_input" });
    }
    if (day < 1 || day > 30) return json_({ ok: false, error: "invalid_date" });

    var hh = parseInt(time.split(":")[0], 10);
    var mm = parseInt(time.split(":")[1], 10);
    var eh = parseInt(endTime.split(":")[0], 10);
    var em = parseInt(endTime.split(":")[1], 10);
    var range = SLOTS[slot];
    if (hh < range[0] || hh >= range[1]) return json_({ ok: false, error: "time_out_of_slot" });
    if (mm % 10 !== 0 || em % 10 !== 0) return json_({ ok: false, error: "time_out_of_slot" }); // 10분 단위만 허용

    // 종료 시각: 시작보다 뒤, 자정(24:00) 이하, 시간대 끝 또는 시작+2시간 중 늦은 쪽까지 (프론트와 동일 규칙)
    var tMin = hh * 60 + mm;
    var eMin = eh * 60 + em;
    var cap = Math.min(1440, Math.max(range[1] * 60, tMin + 120));
    if (eMin <= tMin || eMin > cap) return json_({ ok: false, error: "time_out_of_slot" });

    if (isBlocked_(day, slot)) return json_({ ok: false, error: "slot_taken" });
    // 부분 차단 시간 검증 (예: 월·목 19~22시) — 신청 구간 [시작, 종료)와 겹치면 거절
    var ranges = BLOCKED_RANGES[day] || [];
    for (var ri = 0; ri < ranges.length; ri++) {
      var rs = ranges[ri][0].split(":"), re = ranges[ri][1].split(":");
      var bs = (+rs[0]) * 60 + (+rs[1]), be = (+re[0]) * 60 + (+re[1]);
      if (tMin < be && eMin > bs) return json_({ ok: false, error: "slot_taken" });
    }
    var busy = mergedBusy_();
    if (busy[String(day)] && busy[String(day)].indexOf(slot) >= 0) {
      return json_({ ok: false, error: "slot_taken" });
    }
    // 신청 구간이 다른 시간대의 차단 구간이나 캘린더 이벤트와 겹치는지 확인
    var startAt = new Date(YEAR, MONTH - 1, day, hh, mm);
    var endAt = new Date(YEAR, MONTH - 1, day, 0, 0);
    endAt.setMinutes(eMin); // 24:00도 안전 (다음날 0시)
    for (var sk in SLOTS) {
      if (sk === slot) continue;
      var ss = SLOTS[sk][0] * 60, se = SLOTS[sk][1] * 60;
      if (tMin < se && eMin > ss && (isBlocked_(day, sk) || (busy[String(day)] && busy[String(day)].indexOf(sk) >= 0))) {
        return json_({ ok: false, error: "slot_taken" });
      }
    }
    var overlapping = CalendarApp.getDefaultCalendar().getEvents(startAt, endAt);
    for (var oi = 0; oi < overlapping.length; oi++) {
      if (!overlapping[oi].isAllDayEvent()) return json_({ ok: false, error: "slot_taken" });
    }

    // 시트 기록 (시간 열: "시작~종료")
    getSheet_().appendRow([new Date(), name, day, slot, time + "~" + endTime, method, location, b.isCustom ? "O" : "", message]);

    // 캘린더 이벤트: "오전 n시~m시 [이름] [위치] 커피챗"
    //   같은 오전/오후면 "오후 1시~3시", 다르면 "오전 11시~오후 1시", 분이 있으면 "오후 1시 30분~3시"
    var title = timeRangeLabel_(tMin, eMin) + " " + name + " [" + location + "] 커피챗";
    CalendarApp.getDefaultCalendar().createEvent(title, startAt, endAt, {
      description: "커피챗 신청 (" + method + " / " + location + (b.isCustom ? " - 신청자 추천" : "") + ")"
    });

    // ntfy 알림은 서버에서 보내지 않습니다!
    // (구글 공유 IP 할당량 때문에 429가 나고 응답만 느려짐 →
    //  신청 완료 화면에서 신청자의 브라우저가 직접 발송)
    return json_({ ok: true, ntfy: false });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

// 분(0~1440) → { ampm: "오전"|"오후", text: "1시 30분" }
function koTime_(min) {
  var h = Math.floor(min / 60) % 24, m = min % 60;
  var h12 = h % 12; if (h12 === 0) h12 = 12;
  return { ampm: h < 12 ? "오전" : "오후", text: h12 + "시" + (m > 0 ? " " + m + "분" : "") };
}

// "오전 n시~m시" 양식. 오전/오후가 바뀌면 뒤에도 표기 ("오전 11시~오후 1시")
function timeRangeLabel_(startMin, endMin) {
  var s = koTime_(startMin), e = koTime_(endMin);
  var tail = s.ampm === e.ampm ? e.text : e.ampm + " " + e.text;
  return s.ampm + " " + s.text + "~" + tail;
}

// ntfy 발송 공통 함수: 토픽 주소로 직접 POST (제목 등 한글은 URL 인코딩)
function sendNtfy_(title, message) {
  var url = "https://ntfy.sh/coffeechat-doonghwi"
    + "?title=" + encodeURIComponent(title)
    + "&priority=4&tags=coffee";
  var options = {
    method: "post",
    contentType: "text/plain; charset=utf-8",
    payload: message,
    muteHttpExceptions: true
  };
  if (NTFY_TOKEN) options.headers = { "Authorization": "Bearer " + NTFY_TOKEN };
  return UrlFetchApp.fetch(url, options);
}

/**
 * ★ ntfy 연결 테스트 (에디터에서 직접 실행용)
 * 1. 상단 함수 선택에서 testNtfy 선택 → [실행] 클릭
 * 2. "외부 서비스 연결" 권한 승인 창이 뜨면 승인
 * 3. 휴대폰에 알림이 오면 성공! (실행 로그에 응답 코드 200 표시)
 */
function testNtfy() {
  var res = sendNtfy_(
    "✅ Apps Script → ntfy 연결 성공!",
    "이제 커피챗 신청이 들어오면 이 채널로 알림이 옵니다."
  );
  Logger.log(res.getResponseCode() + " " + res.getContentText());
}
