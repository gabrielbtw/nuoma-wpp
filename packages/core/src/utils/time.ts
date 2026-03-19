function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseWindowPart(input: string) {
  const [hoursRaw, minutesRaw] = input.split(":");
  const hours = Number(hoursRaw ?? 0);
  const minutes = Number(minutesRaw ?? 0);
  return hours * 60 + minutes;
}

function getLocalParts(timeZone: string, reference = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const entries = formatter.formatToParts(reference);
  const map = Object.fromEntries(entries.map((entry) => [entry.type, entry.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

export function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function randomBetween(min: number, max: number) {
  if (max <= min) {
    return min;
  }

  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function isWithinTimeWindow(start: string, end: string, timeZone: string) {
  const local = getLocalParts(timeZone);
  const currentMinutes = local.hour * 60 + local.minute;
  const startMinutes = parseWindowPart(start);
  const endMinutes = parseWindowPart(end);

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

export function nextWindowStartIso(start: string, end: string, timeZone: string) {
  const local = getLocalParts(timeZone);
  const currentMinutes = local.hour * 60 + local.minute;
  const startMinutes = parseWindowPart(start);
  const endMinutes = parseWindowPart(end);
  const overnight = startMinutes > endMinutes;

  let deltaMinutes = 0;
  if (!overnight) {
    deltaMinutes = currentMinutes < startMinutes ? startMinutes - currentMinutes : 24 * 60 - currentMinutes + startMinutes;
  } else {
    deltaMinutes = currentMinutes < startMinutes && currentMinutes > endMinutes ? startMinutes - currentMinutes : 24 * 60 - currentMinutes + startMinutes;
  }

  const next = new Date(Date.now() + deltaMinutes * 60 * 1000);
  next.setSeconds(0, 0);
  return next.toISOString();
}

export function formatMinutesAsTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

export function hoursAgoIso(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
