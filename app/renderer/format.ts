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

export const formatEta = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return '--';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
