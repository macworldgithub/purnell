export function parseDailyCapacity(snapshot, observedAt) {
  if (snapshot.department !== 'S' || snapshot.advisor_scope !== 'all' || snapshot.messages?.some(Boolean)) throw Error('Capacity filters or source message not verified');
  if (!Number.isFinite(Date.parse(observedAt))) throw Error('Invalid capacity observation time');
  const matches = [...snapshot.text.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)];
  const rows = matches.map((match, index) => {
    const date = `${match[3]}-${match[2]}-${match[1]}`;
    if (new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw Error('Invalid diary date');
    const block = snapshot.text.slice(match.index + match[0].length, matches[index + 1]?.index).replaceAll('\u00a0', ' ');
    const pair = label => {
      const found = block.match(new RegExp(label + '\\s+(-?\\d+(?:\\.\\d+)?)\\s*\\/\\s*(-?\\d+(?:\\.\\d+)?)'));
      if (!found) throw Error('Incomplete capacity field: ' + label);
      return [found[1], found[2]];
    };
    const [appointments, limit] = pair('Appointments');
    const [sold, unsold] = pair('Sold / Unsold');
    const [loanCars, loanLimit] = pair('Loan Cars');
    const [waitJobs, waitLimit] = pair('Wait Jobs');
    const [carryOver, carryLimit] = pair('Carry Over Hours');
    return { dealership_id: '01', department_id: 'S', department_name: 'Service', advisor_scope: 'all', date, timezone: 'Australia/Sydney', appointments_recorded: appointments, appointment_limit: limit, sold_hours: sold, unsold_hours: unsold, loan_cars_recorded: loanCars, loan_car_limit: loanLimit, wait_jobs_recorded: waitJobs, wait_job_limit: waitLimit, carry_over_hours: carryOver, carry_over_limit: carryLimit, exact_time_slots_verified: 'false', job_specific_availability_verified: 'false', source: 'eraPower Service appointment booking summary', source_captured_at: observedAt };
  });
  if (rows.length !== 21 || new Set(rows.map(row => row.date)).size !== 21) throw Error('Expected 21 distinct diary dates');
  for (let i = 1; i < rows.length; i++) if (Date.parse(rows[i].date) - Date.parse(rows[i - 1].date) !== 86400000) throw Error('Diary date gap');
  if (!rows.some(row => Number(row.appointment_limit) > 0)) throw Error('Diary capacity is unconfigured or has not loaded');
  return rows;
}
