/** A request field's request numbers, whole: "KSAML43-SA1157" -> KSAML43, SA1157. */
export function reqTokensOf(req: string): string[] {
  // Read out of the text rather than split on separators: "UAECO201UAECO250"
  // is two requests written with none between them.
  return [...(req || '').toUpperCase().matchAll(/[A-Z]{2,6}\d{2,6}(?!\d)/g)].map(m => m[0]);
}
