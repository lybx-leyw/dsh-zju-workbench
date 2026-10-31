function getTextStyle(style) {
    if (!style)
        return {};
    const css = {};
    if (style.bold)
        css.fontWeight = 'bold';
    if (style.em)
        css.fontStyle = 'italic';
    if (style.underline)
        css.textDecoration = 'underline';
    if (style.strikethrough) {
        css.textDecoration = css.textDecoration ? `${css.textDecoration} line-through` : 'line-through';
    }
    if (style.color)
        css.color = style.color;
    if (style.backcolor)
        css.backgroundColor = style.backcolor;
    if (style.fontsize)
        css.fontSize = style.fontsize;
    if (style.fontname)
        css.fontFamily = style.fontname;
    if (style.align)
        css.textAlign = style.align;
    return css;
}

export { getTextStyle };
//# sourceMappingURL=tableUtils.js.map
