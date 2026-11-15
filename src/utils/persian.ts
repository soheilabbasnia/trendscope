export function toPersianDigits(input: number | string | null | undefined): string {
  if (input === null || input === undefined) return '';
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(input).replace(/[0-9]/g, (w) => persianDigits[+w]);
}
