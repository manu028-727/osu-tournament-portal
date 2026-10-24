// Version 1 identity slots also occur in opaque historical JSON. Keep this wire
// convention stable; domain witnesses verify competitive values after remapping.
export function remapArchiveValue(
  value: unknown,
  ids: ReadonlyMap<string, string>,
  rewriteText: (text: string) => string,
  field = '',
  path: string[] = [],
): unknown {
  if (typeof value === 'string') {
    const identity =
      /^(?:id|.*Id|.*Ids|createdBy|calculatedBy|seedOrder|groupTieOrder)$/.test(field) ||
      path.at(-2) === 'roundStages' ||
      (field === 'order' && path.at(-2) === 'tieResolution');
    return identity && ids.has(value) ? ids.get(value)! : rewriteText(value);
  }
  if (Array.isArray(value))
    return value.map((child) => remapArchiveValue(child, ids, rewriteText, field, path));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        remapArchiveValue(child, ids, rewriteText, key, [...path, key]),
      ]),
    );
  return value;
}
