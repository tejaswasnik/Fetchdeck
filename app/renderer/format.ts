const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export const formatBytes = (bytes: number): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
};

const unitIndexFor = (bytes: number): number => {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit;
};

/** `4.06 / 5.78 GB`: both numbers in the unit of the total, like the design's progress column. */
export const formatProgress = (done: number, total: number): string => {
  const unit = unitIndexFor(total);
  const divisor = 1024 ** unit;
  const digits = unit >= 3 ? 2 : 1;
  return `${(done / divisor).toFixed(unit === 0 ? 0 : digits)} / ${(total / divisor).toFixed(unit === 0 ? 0 : digits)} ${UNITS[unit]}`;
};

/** An offset in a file as a number in the unit of the file size (`0.72`). */
export const formatOffset = (offset: number, fileSize: number): string => {
  const unit = unitIndexFor(fileSize);
  return (offset / 1024 ** unit).toFixed(unit >= 3 ? 2 : 1);
};

export const sizeUnit = (fileSize: number): string => UNITS[unitIndexFor(fileSize)] as string;

export const splitSpeed = (bytesPerSecond: number): { value: string; unit: string } => {
  const text = formatBytes(bytesPerSecond);
  const [value = '0', unit = 'B'] = text.split(' ');
  return { value, unit: `${unit}/s` };
};

export const formatEta = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return '--';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} m ${total % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
};

export const formatClock = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

export const ordinal = (n: number): string => {
  if (n === 1) return 'Next';
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};
