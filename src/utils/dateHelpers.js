/**
 * Checks if a given date (defaults to today) is the 2nd or 4th Sunday of the month.
 * @param {Date} [date=new Date()]
 * @returns {boolean}
 */
export function isVerificationDay(date = new Date()) {
  if (date.getDay() !== 0) return false; // Must be Sunday

  const dayOfMonth = date.getDate();
  // 1st Sunday: 1-7
  // 2nd Sunday: 8-14
  // 3rd Sunday: 15-21
  // 4th Sunday: 22-28
  
  const isSecondSunday = dayOfMonth >= 8 && dayOfMonth <= 14;
  const isFourthSunday = dayOfMonth >= 22 && dayOfMonth <= 28;

  return isSecondSunday || isFourthSunday;
}
