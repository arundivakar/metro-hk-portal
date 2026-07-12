/**
 * Checks if a given date (defaults to today) is the 2nd or 4th Sunday of the month.
 * @param {Date} [date=new Date()]
 * @returns {boolean}
 */
function getNthSunday(year, month, n) {
  const firstDay = new Date(year, month, 1);
  const firstSundayDate = 1 + ((7 - firstDay.getDay()) % 7);
  return new Date(year, month, firstSundayDate + (n - 1) * 7);
}

export function getVerificationPeriodInfo(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed

  // Strip time for accurate date comparison
  const d = new Date(year, month, date.getDate());
  
  const secondSunday = getNthSunday(year, month, 2);
  const fourthSunday = getNthSunday(year, month, 4);

  let periodMonth = month;
  let periodYear = year;
  let periodId = '';

  if (d < secondSunday) {
    // Before 2nd Sunday -> belongs to Previous Month's P2
    periodMonth = month - 1;
    if (periodMonth < 0) {
      periodMonth = 11;
      periodYear -= 1;
    }
    periodId = 'P2';
  } else if (d >= secondSunday && d < fourthSunday) {
    // Between 2nd and 4th Sunday -> Current Month's P1
    periodId = 'P1';
  } else {
    // On or after 4th Sunday -> Current Month's P2
    periodId = 'P2';
  }

  const mm = String(periodMonth + 1).padStart(2, '0');
  const monthStr = `${periodYear}-${mm}`;
  
  const isSecond = d.getTime() === secondSunday.getTime();
  const isFourth = d.getTime() === fourthSunday.getTime();

  return {
    month: monthStr,
    period: `${monthStr}-${periodId}`,
    isVerificationDay: isSecond || isFourth
  };
}

export function isVerificationDay(date = new Date()) {
  return getVerificationPeriodInfo(date).isVerificationDay;
}

/**
 * Formats a date string or Date object to DD-MM-YYYY
 * @param {string|Date} dateInput
 * @returns {string}
 */
export function formatDate(dateInput) {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}
