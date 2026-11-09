// Display helpers for values the engine sends in its own encoding.

/** Map a slog.Level integer to its canonical label. */
export function levelName(level: number): string {
	if (level <= -4) return 'DEBUG';
	if (level < 4) return 'INFO';
	if (level < 8) return 'WARN';
	return 'ERROR';
}
