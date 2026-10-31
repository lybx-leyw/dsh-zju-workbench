"use client";
import { jsx } from 'react/jsx-runtime';
import { createContext, useContext } from 'react';

const SlideContext = createContext(null);
function SlideRendererProvider({ children, className, style, ...value }) {
    return (jsx(SlideContext.Provider, { value: value, children: className || style ? (jsx("div", { className: className, style: style, children: children })) : (children) }));
}
/**
 * Read the closest SlideRendererProvider value.
 * Throws if used outside a provider — use `useOptionalSlideContext` for nullable access.
 */
function useSlideContext() {
    const value = useContext(SlideContext);
    if (!value) {
        throw new Error('useSlideContext must be used inside a <SlideRendererProvider>. ' +
            'Pass props directly to <SlideCanvas> if you do not need the provider.');
    }
    return value;
}
/** Nullable variant; returns null when outside a provider. */
function useOptionalSlideContext() {
    return useContext(SlideContext);
}

export { SlideRendererProvider, useOptionalSlideContext, useSlideContext };
//# sourceMappingURL=context.js.map
