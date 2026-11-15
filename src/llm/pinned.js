/**
 * transformers.js 4.3.2 fragt einzelne Dateien unter der Revision «main» statt der angegebenen ab
 * (get_file_metadata). Solche Adressen des geladenen Modells werden auf die festgelegte, geprüfte
 * Revision umgeschrieben; alle anderen bleiben unverändert.
 * @param {string} url
 * @param {{repo: string, revision: string}|null} pin
 */
export function resolvePinned(url, pin) {
    if (!pin) return url;
    const main = `/${pin.repo}/resolve/main/`;
    return url.includes(main) ? url.replace(main, `/${pin.repo}/resolve/${pin.revision}/`) : url;
}
