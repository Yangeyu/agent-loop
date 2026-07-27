// Formatting of quantities a tool reports about its own work. Lives in the
// substrate because several tools describe the same quantity, and a transcript
// where one says "31842 B" and another says "31.1 KB" reads as two systems.
//
// Only quantities belong here. Fitting text to a viewport is the surface's job:
// a tool has no idea how wide the terminal is.

const UNITS = ["B", "KB", "MB", "GB"] as const

/**
 * Formats a byte count for a one-line summary: `842 B`, `31.1 KB`, `2.4 MB`.
 *
 * @param bytes - the byte count
 * @returns the formatted size
 */
export function formatBytes(bytes: number) {
  let value = Math.max(0, bytes)
  let unit = 0

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }

  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${UNITS[unit]}`
}
