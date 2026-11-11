/**
 * Copies text. The Clipboard API exists only in secure contexts, and a phone
 * on http://192.168.x.y isn't one, so this falls back to selecting text and
 * `execCommand('copy')`. The fallback field goes inside the open dialog: a
 * modal dialog makes the rest of the page inert, where nothing can be selected.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the selection fallback
  }
  const host = document.querySelector('dialog[open]') ?? document.body;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  host.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** The share sheet exists only in secure contexts (not on a phone over plain http). */
export function canShareSheet(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && window.isSecureContext;
}
