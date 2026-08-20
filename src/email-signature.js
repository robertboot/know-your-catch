/* ReelIntel email signature — used by the admin tester-reply drafts.
 *
 * KEEP IN SYNC with docs/email-signature.html, which is the standalone
 * page Robert copies from once when setting up his mail client. Same
 * markup, two audiences; if you change one, change the other.
 *
 * Email-safe by construction: tables, inline styles, and a bgcolor
 * attribute on the CTA — mail clients strip <style> blocks and Outlook
 * ignores background-color on <a>. The logo keeps its navy ground baked
 * in so it survives a dark-mode client, where a transparent PNG
 * disappears.
 */

export const SIGNATURE_IMG = 'https://www.reelintel.ai/brand/email-signature.png';
export const SITE_URL      = 'https://www.reelintel.ai';

export const SIGNATURE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
  <tr>
    <td valign="top" style="padding:0 22px 0 0">
      <img src="${SIGNATURE_IMG}" alt="ReelIntel — fish smarter, catch more"
           width="196" style="display:block;width:196px;height:auto;border:0;border-radius:10px">
    </td>
    <td style="width:3px;background-color:#19D4F2;font-size:0;line-height:0">&nbsp;</td>
    <td valign="top" style="padding:2px 0 0 22px">
      <div style="font-size:23px;font-weight:800;color:#0B1F33;letter-spacing:-0.2px;line-height:1.2">Rob Boot</div>
      <div style="margin-top:5px;font-size:12px;font-weight:700;color:#19A8C4;letter-spacing:1.1px;text-transform:uppercase">Founder &nbsp;|&nbsp; ReelIntel</div>
      <div style="margin-top:14px;font-size:15px;color:#334155;line-height:1.5">Fishing intelligence built for anglers.</div>
      <div style="margin-top:4px;font-size:13px;color:#64748B;line-height:1.5">Fish ID &nbsp;•&nbsp; Regulations &nbsp;•&nbsp; Catch insights</div>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:16px">
        <tr>
          <td bgcolor="#19D4F2" style="background-color:#19D4F2;border-radius:8px">
            <a href="${SITE_URL}" style="display:inline-block;padding:11px 20px;font-size:13px;font-weight:800;letter-spacing:0.6px;color:#062033;text-decoration:none;text-transform:uppercase">Explore ReelIntel &nbsp;&rarr;</a>
          </td>
          <td style="padding-left:14px;font-size:13px;color:#64748B">
            <a href="${SITE_URL}" style="color:#64748B;text-decoration:none">www.reelintel.ai</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();

/* Plain-text fallback — mailto: bodies cannot carry HTML, and a
   recipient on a text-only client should still get the details. */
export const SIGNATURE_TEXT = [
  '--',
  'Rob Boot',
  'Founder | ReelIntel',
  'Fishing intelligence built for anglers.',
  'Fish ID • Regulations • Catch insights',
  'www.reelintel.ai',
].join('\n');

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Draft body + signature as HTML, ready to paste into a mail client. */
export function draftToHtml(draft) {
  const body = escapeHtml(draft || '')
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 14px;font:15px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div>${body}<div style="margin-top:26px">${SIGNATURE_HTML}</div></div>`;
}

/** Draft body + signature as plain text (mailto, or clipboard fallback). */
export function draftToText(draft) {
  return `${(draft || '').trimEnd()}\n\n${SIGNATURE_TEXT}\n`;
}
