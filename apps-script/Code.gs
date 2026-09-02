/**
 * ☕ 커피챗 예약 백엔드 (Google Apps Script)
 *
 * 하는 일
 *  - GET  ?action=busy : 날짜별로 이미 찬 시간대 반환 (예약 + 내 구글 캘린더 참/빔)
 *                        → 캘린더 "내용"은 절대 내보내지 않고 참/빔 여부만 계산합니다.
 *  - POST {name, method, location, date, slot, time}
 *         : 슬롯 검증 → 스프레드시트에 기록 → 내 캘린더에
 *           "@@시 [이름] [위치] 커피챗" 이벤트 생성
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
  7:  ["저녁", "밤"],
  8:  ["점저", "저녁"],
  10: ["저녁", "밤"],
  13: "all",
  14: ["저녁", "밤"],
  15: ["저녁", "밤", "새벽"],
  16: ["저녁", "밤", "새벽"],
  17: ["저녁", "밤"],
  18: "all",
  19: "all",
  20: "all",
  21: "all",
  28: ["저녁", "밤"]
};

// ---------- 시트 ----------
function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID");
  var ss;
  if (!id) {
    ss = SpreadsheetApp.create("커피챗 예약");
    props.setProperty("SHEET_ID", ss.getId());
    ss.getSheets()[0].appendRow(["신청시각", "이름", "날짜(일)", "시간대", "시간", "방법", "장소", "직접추천여부"]);
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

    if (!name || !location || !day || !SLOTS[slot] || !/^\d{2}:\d{2}$/.test(time)) {
      return json_({ ok: false, error: "invalid_input" });
    }
    if (day < 1 || day > 30) return json_({ ok: false, error: "invalid_date" });

    var hh = parseInt(time.split(":")[0], 10);
    var mm = parseInt(time.split(":")[1], 10);
    var range = SLOTS[slot];
    if (hh < range[0] || hh >= range[1]) return json_({ ok: false, error: "time_out_of_slot" });
    if (mm % 10 !== 0) return json_({ ok: false, error: "time_out_of_slot" }); // 10분 단위만 허용

    if (isBlocked_(day, slot)) return json_({ ok: false, error: "slot_taken" });
    var busy = mergedBusy_();
    if (busy[String(day)] && busy[String(day)].indexOf(slot) >= 0) {
      return json_({ ok: false, error: "slot_taken" });
    }

    // 시트 기록
    getSheet_().appendRow([new Date(), name, day, slot, time, method, location, b.isCustom ? "O" : ""]);

    // 캘린더 이벤트: "@@시 [이름] [위치] 커피챗" (2시간)
    var timeLabel = hh + "시" + (mm > 0 ? mm + "분" : "");
    var title = timeLabel + " " + name + " [" + location + "] 커피챗";
    var startAt = new Date(YEAR, MONTH - 1, day, hh, mm);
    var endAt = new Date(startAt.getTime() + 2 * 60 * 60 * 1000);
    CalendarApp.getDefaultCalendar().createEvent(title, startAt, endAt, {
      description: "커피챗 신청 (" + method + " / " + location + (b.isCustom ? " - 신청자 추천" : "") + ")"
    });

    return json_({ ok: true });
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
