export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    // Пытаемся парсить как YYYY-MM-DD вручную
    const m = /^\d{4}-\d{2}-\d{2}$/.exec(iso);
    if (m) {
      const [y, mo, da] = iso.split('-');
      return `${da}.${mo}.${y}`;
    }
    return String(iso);
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}
