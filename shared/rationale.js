/* Plain-text cleanup for the model's `rationale`.
 *
 * With web_search on, the model cites inline as markdown links, e.g.
 * "… at NZD 1,050 per week ([trademe.co.nz](https://…?utm_source=openai))".
 * The calculator shows the source hostnames as chips already, so citations are
 * dropped rather than rendered. Used when an estimate is produced (api/) and
 * again at display time, because older cached estimates still hold raw text.
 */

export function cleanRationale(text) {
  return String(text ?? "")
    .replace(/\s*\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "") // " ([host](url))" citations
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") //          [label](url) -> label
    .replace(/\s*\(?\bhttps?:\/\/\S+/g, "") //            bare URLs
    .replace(/[*_`]+/g, "") //                            stray emphasis markers
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
