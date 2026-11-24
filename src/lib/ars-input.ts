/** Argentine amounts: dots group thousands, commas separate cents. */
export function parseArsInput(value: string): string | null {
  const clean = value.replace(/^\s*\$\s*/, '').replace(/\s/g, '');
  if (clean === '') return '';
  if (!/^[\d.,]+$/.test(clean)) return null;
  const parts = clean.split(',');
  if (parts.length > 2 || (parts[1] !== undefined && !/^\d{0,2}$/.test(parts[1]))) return null;
  let integer = parts[0];
  if (/^\d{1,3}(?:\.\d{3})+$/.test(integer)) integer = integer.replace(/\./g, '');
  else if (!/^\d+$/.test(integer)) return null;
  integer = integer.replace(/^0+(?=\d)/, '');
  return integer + (parts[1] !== undefined ? '.' + parts[1] : '');
}

export function formatArsInput(value: string): string {
  if (!value) return '';
  const [integer, fraction] = value.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction !== undefined ? ',' + fraction : '');
}
