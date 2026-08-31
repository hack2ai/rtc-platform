'use client';

// Keep one canonical RTC meeting implementation. The legacy /meeting2 route
// intentionally re-exports /meeting so fixes cannot diverge between copies.
export { default } from '../../meeting/[code]/page';
