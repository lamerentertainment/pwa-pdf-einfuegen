// Wo steht eine Textstelle sichtbar in einem Textfeld oder einem scrollbaren Bereich – und wie
// scrollt man, damit sie auf einer bestimmten Höhe erscheint? Höhen sind relativ zur Oberkante
// des Elements (Rahmen eingeschlossen), so wie der Nutzer sie sieht.

const MIRRORED = [
    'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
    'textTransform', 'wordSpacing', 'tabSize', 'textIndent', 'wordBreak', 'overflowWrap',
];

/**
 * Höhe einer Zeichenposition im Inhalt eines Textfelds (ab Oberkante des Inhalts, ohne Scrollen),
 * über ein unsichtbares Spiegel-Element mit derselben Schrift und Breite.
 */
function textareaContentTop(textarea, offset) {
    const style = getComputedStyle(textarea);
    const mirror = document.createElement('div');
    for (const prop of MIRRORED) mirror.style[prop] = style[prop];
    const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    Object.assign(mirror.style, {
        position: 'absolute',
        visibility: 'hidden',
        top: '0',
        left: '-10000px',
        boxSizing: 'border-box',
        // clientWidth ohne Bildlaufleiste, dafür mit Innenabstand
        width: `${textarea.clientWidth + borderX}px`,
        whiteSpace: textarea.getAttribute('wrap') === 'off' ? 'pre' : 'pre-wrap',
        overflowWrap: 'break-word',
    });
    mirror.textContent = textarea.value.slice(0, offset);
    const marker = document.createElement('span');
    marker.textContent = textarea.value.slice(offset, offset + 1) || '.';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const top = marker.offsetTop;
    mirror.remove();
    return top;
}

function lineHeightOf(el) {
    const style = getComputedStyle(el);
    return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 20;
}

/** Sichtbare Höhe einer Zeichenposition in einem Textfeld. */
export function textareaVisibleTop(textarea, offset) {
    const border = parseFloat(getComputedStyle(textarea).borderTopWidth) || 0;
    return border + textareaContentTop(textarea, offset) - textarea.scrollTop;
}

/** Textfeld so scrollen, dass die Zeichenposition auf Höhe `visibleTop` steht. */
export function scrollTextareaTo(textarea, offset, visibleTop) {
    const border = parseFloat(getComputedStyle(textarea).borderTopWidth) || 0;
    textarea.scrollTop = Math.max(0, border + textareaContentTop(textarea, offset) - visibleTop);
    return { top: textareaVisibleTop(textarea, offset), height: lineHeightOf(textarea) };
}

/** Sichtbare Höhe eines Elements innerhalb eines scrollbaren Bereichs. */
export function elementVisibleTop(container, element) {
    return element.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

/** Bereich so scrollen, dass das Element auf Höhe `visibleTop` steht. */
export function scrollElementTo(container, element, visibleTop) {
    container.scrollTop += elementVisibleTop(container, element) - visibleTop;
    return { top: elementVisibleTop(container, element), height: element.getBoundingClientRect().height || lineHeightOf(container) };
}
