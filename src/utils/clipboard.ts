/**
 * Put text on the clipboard, and say whether it landed.
 *
 * navigator.clipboard only exists in a secure context. Production has one;
 * a plain http origin - a preview on the LAN, a machine opened by IP - does
 * not, and there the modern call is not merely refused, it is undefined. The
 * old textarea trick still works in both, so it stands behind the new one.
 *
 * Returns false rather than throwing. A copy that failed should tell the
 * person to press Ctrl+C, not put an error in front of them: nothing was
 * lost and nothing was changed.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      // Off-screen but focusable: display:none or visibility:hidden cannot be
      // selected, and a visible one scrolls the page to itself.
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
