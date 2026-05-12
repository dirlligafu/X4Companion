export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const fmtNumber = (n: number) => n.toLocaleString("en-US");

export const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleString("en-US");
