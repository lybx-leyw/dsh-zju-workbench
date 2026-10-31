"use client";
import { jsx, jsxs } from 'react/jsx-runtime';
import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';

// ==================== Shiki Singleton ====================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highlighterPromise = null;
function getHighlighter() {
    if (!highlighterPromise) {
        highlighterPromise = import('shiki').then(({ createHighlighter }) => createHighlighter({
            themes: ['github-light'],
            langs: [
                'python',
                'javascript',
                'typescript',
                'json',
                'go',
                'rust',
                'java',
                'c',
                'cpp',
                'html',
                'css',
                'bash',
                'sql',
                'yaml',
                'markdown',
                'jsx',
                'tsx',
            ],
        }));
    }
    return highlighterPromise;
}
// ==================== Helpers ====================
function parseShikiLines(html) {
    const codeMatch = html.match(/<code>([\s\S]*?)<\/code>/);
    if (!codeMatch)
        return [];
    const parts = codeMatch[1].split('<span class="line">');
    const lines = [];
    for (const part of parts) {
        if (!part)
            continue;
        const endIdx = part.lastIndexOf('</span>');
        if (endIdx !== -1) {
            lines.push(part.substring(0, endIdx));
        }
    }
    return lines;
}
// ==================== Typing Easing ====================
const STUTTER_COUNT = 5;
const STUTTER_AMOUNT = 0.04;
const LINE_GAP_MS = 120;
const TAB_SIZE = 4;
function visualLength(s) {
    let len = 0;
    for (const ch of s) {
        len += ch === '\t' ? TAB_SIZE : 1;
    }
    return len;
}
function getTypingCharCount(content) {
    const trimmed = content.replace(/^[\t ]+/, '');
    return trimmed.length;
}
function computeRevealSteps(content) {
    const total = visualLength(content);
    if (total === 0)
        return [1];
    const trimmed = content.replace(/^[\t ]+/, '');
    const indentPart = content.slice(0, content.length - trimmed.length);
    let cumVisual = 0;
    for (const ch of indentPart) {
        cumVisual += ch === '\t' ? TAB_SIZE : 1;
    }
    const steps = [cumVisual / total];
    for (const ch of trimmed) {
        cumVisual += ch === '\t' ? TAB_SIZE : 1;
        steps.push(cumVisual / total);
    }
    return steps;
}
function humanTypingEase(t) {
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
    const stutter = Math.sin(t * Math.PI * STUTTER_COUNT) * STUTTER_AMOUNT * 4 * t * (1 - t);
    return Math.min(Math.max(eased + stutter, 0), 1);
}
// ==================== TypingReveal ====================
function TypingReveal({ html, durationMs, revealSteps, onComplete, }) {
    const typingUnitCount = revealSteps.length - 1;
    const [revealPct, setRevealPct] = useState(revealSteps[0]);
    const rafRef = useRef(0);
    const startRef = useRef(0);
    useEffect(() => {
        if (typingUnitCount <= 0) {
            const t = setTimeout(() => {
                setRevealPct(1);
                onComplete();
            }, 0);
            return () => clearTimeout(t);
        }
        startRef.current = performance.now();
        const tick = (now) => {
            const elapsed = now - startRef.current;
            const linearT = Math.min(elapsed / durationMs, 1);
            const easedProgress = humanTypingEase(linearT);
            const stepIdx = Math.min(Math.floor(easedProgress * (typingUnitCount + 1)), typingUnitCount);
            setRevealPct(revealSteps[stepIdx]);
            if (linearT < 1) {
                rafRef.current = requestAnimationFrame(tick);
            }
            else {
                setRevealPct(1);
                onComplete();
            }
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [durationMs, typingUnitCount, revealSteps, onComplete]);
    return (jsxs("span", { style: { position: 'relative', display: 'inline-block' }, children: [jsx("span", { style: {
                    clipPath: `inset(0 ${(1 - revealPct) * 100}% 0 0)`,
                }, dangerouslySetInnerHTML: { __html: html } }), revealPct < 1 && (jsx("span", { style: {
                    position: 'absolute',
                    top: 0,
                    width: '2px',
                    backgroundColor: '#1f2937',
                    left: `${revealPct * 100}%`,
                    height: '1.1em',
                    animation: 'slide-renderer-code-cursor-blink 0.6s step-end infinite',
                } }))] }));
}
// ==================== CodeLineRow ====================
function getTypingDuration(content) {
    return Math.max(getTypingCharCount(content) * 40, 250);
}
const REPLACE_SELECT_MS = 350;
function CodeLineRow({ line, lineNumber, highlightedHtml, showLineNumbers, animState, animate, typingDelay, }) {
    const isNewLine = animate && !!animState && animState.type !== 'replaced';
    const isReplace = animate && animState?.type === 'replaced';
    const [mounted, setMounted] = useState(!isNewLine || typingDelay === 0);
    useEffect(() => {
        if (isNewLine && typingDelay > 0) {
            const timer = setTimeout(() => setMounted(true), typingDelay);
            return () => clearTimeout(timer);
        }
    }, [isNewLine, typingDelay]);
    const [typing, setTyping] = useState(isNewLine && typingDelay === 0);
    useEffect(() => {
        if (mounted && isNewLine) {
            const t = setTimeout(() => setTyping(true), 0);
            return () => clearTimeout(t);
        }
    }, [mounted, isNewLine]);
    const handleTypingComplete = useCallback(() => {
        setTyping(false);
    }, []);
    const prevHtmlRef = useRef(highlightedHtml);
    const [replacePhase, setReplacePhase] = useState('idle');
    const [oldHtml, setOldHtml] = useState(null);
    useEffect(() => {
        if (isReplace && prevHtmlRef.current !== highlightedHtml) {
            setOldHtml(prevHtmlRef.current);
            setReplacePhase('select');
            const timer = setTimeout(() => {
                setReplacePhase('type');
                setTyping(true);
                setOldHtml(null);
                prevHtmlRef.current = highlightedHtml;
            }, REPLACE_SELECT_MS);
            return () => clearTimeout(timer);
        }
        prevHtmlRef.current = highlightedHtml;
    }, [isReplace, highlightedHtml]);
    const [highlight, setHighlight] = useState(() => {
        if (!animState)
            return null;
        if (animState.type === 'inserted')
            return 'rgba(34, 197, 94, 0.12)';
        return null;
    });
    useEffect(() => {
        if (animState?.type === 'inserted') {
            const t = setTimeout(() => setHighlight('rgba(34, 197, 94, 0.12)'), 0);
            return () => clearTimeout(t);
        }
    }, [animState]);
    const [highlightFading, setHighlightFading] = useState(false);
    useEffect(() => {
        if (!highlight || highlightFading || typing)
            return;
        const fadeTimer = setTimeout(() => setHighlightFading(true), 0);
        const clearTimer = setTimeout(() => {
            setHighlight(null);
            setHighlightFading(false);
        }, 2000);
        return () => {
            clearTimeout(fadeTimer);
            clearTimeout(clearTimer);
        };
    }, [highlight, typing, highlightFading]);
    const typingDuration = getTypingDuration(line.content);
    const revealSteps = useMemo(() => computeRevealSteps(line.content), [line.content]);
    if (!mounted)
        return null;
    let bgColor = highlight || 'transparent';
    if (replacePhase === 'select')
        bgColor = 'rgba(59, 130, 246, 0.18)';
    let contentNode;
    if (replacePhase === 'select' && oldHtml) {
        contentNode = jsx("span", { dangerouslySetInnerHTML: { __html: oldHtml } });
    }
    else if (typing) {
        contentNode = (jsx(TypingReveal, { html: highlightedHtml, durationMs: typingDuration, revealSteps: revealSteps, onComplete: handleTypingComplete }));
    }
    else {
        contentNode = jsx("span", { dangerouslySetInnerHTML: { __html: highlightedHtml } });
    }
    return (jsxs(motion.div, { initial: isNewLine ? { opacity: 0, height: 0 } : false, animate: {
            opacity: 1,
            height: 'auto',
            backgroundColor: bgColor,
            transition: {
                duration: 0.3,
                ease: [0.16, 1, 0.3, 1],
                backgroundColor: { duration: 0.4 },
            },
        }, exit: {
            backgroundColor: 'rgba(59, 130, 246, 0.18)',
            height: 0,
            opacity: 0,
            transition: {
                backgroundColor: { duration: 0 },
                height: { duration: 0, delay: 0.3 },
                opacity: { duration: 0, delay: 0.3 },
            },
        }, style: {
            display: 'flex',
            lineHeight: 1.6,
            fontSize: 'inherit',
            overflow: 'hidden',
        }, children: [showLineNumbers && (jsx("span", { style: {
                    flexShrink: 0,
                    textAlign: 'right',
                    paddingRight: '16px',
                    paddingLeft: '8px',
                    width: '3.5em',
                    color: '#9ca3af',
                    userSelect: 'none',
                }, children: lineNumber })), jsx("span", { style: { flex: 1, paddingRight: '16px', whiteSpace: 'pre', tabSize: 4 }, children: contentNode })] }));
}
// ==================== BaseCodeElement ====================
function BaseCodeElement({ elementInfo, animate }) {
    const { language, lines, fileName, showLineNumbers = true, fontSize = 14 } = elementInfo;
    const wrapperRef = useRef(null);
    const codeBodyRef = useRef(null);
    useEffect(() => {
        const el = codeBodyRef.current;
        if (!el)
            return;
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let startScrollLeft = 0;
        let startScrollTop = 0;
        let activePointer = null;
        const endDrag = () => {
            if (activePointer !== null && el.hasPointerCapture(activePointer)) {
                el.releasePointerCapture(activePointer);
            }
            dragging = false;
            activePointer = null;
            el.style.cursor = 'grab';
        };
        const onPointerDown = (e) => {
            if (e.button !== 0)
                return;
            dragging = true;
            activePointer = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            startScrollLeft = el.scrollLeft;
            startScrollTop = el.scrollTop;
            el.setPointerCapture(e.pointerId);
            el.style.cursor = 'grabbing';
        };
        const onPointerMove = (e) => {
            if (!dragging || e.pointerId !== activePointer)
                return;
            el.scrollLeft = startScrollLeft - (e.clientX - startX);
            el.scrollTop = startScrollTop - (e.clientY - startY);
        };
        const onPointerEnd = (e) => {
            if (e.pointerId !== activePointer)
                return;
            endDrag();
        };
        const onLostCapture = () => {
            endDrag();
        };
        const onWheel = (e) => {
            e.stopPropagation();
        };
        el.style.cursor = 'grab';
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', onPointerEnd);
        el.addEventListener('pointercancel', onPointerEnd);
        el.addEventListener('lostpointercapture', onLostCapture);
        el.addEventListener('wheel', onWheel, { passive: true });
        return () => {
            endDrag();
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerup', onPointerEnd);
            el.removeEventListener('pointercancel', onPointerEnd);
            el.removeEventListener('lostpointercapture', onLostCapture);
            el.removeEventListener('wheel', onWheel);
        };
    }, []);
    useEffect(() => {
        const el = wrapperRef.current;
        if (!el)
            return;
        const stopWheelOutsideBody = (e) => {
            const body = codeBodyRef.current;
            if (body && body.contains(e.target))
                return;
            e.stopPropagation();
        };
        el.addEventListener('wheel', stopWheelOutsideBody);
        return () => el.removeEventListener('wheel', stopWheelOutsideBody);
    }, []);
    const stopPointer = useCallback((e) => {
        e.stopPropagation();
    }, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [highlighter, setHighlighter] = useState(null);
    const prevLinesRef = useRef([]);
    const isFirstRenderRef = useRef(true);
    const [animStates, setAnimStates] = useState(() => new Map());
    useEffect(() => {
        const states = new Map();
        if (animate) {
            if (isFirstRenderRef.current) {
                isFirstRenderRef.current = false;
                lines.forEach((line, i) => {
                    states.set(line.id, { type: 'typing', timestamp: i * 80 });
                });
            }
            else {
                const prevById = new Map(prevLinesRef.current.map((l) => [l.id, l]));
                for (const line of lines) {
                    const prev = prevById.get(line.id);
                    if (!prev) {
                        states.set(line.id, { type: 'inserted', timestamp: 0 });
                    }
                    else if (prev.content !== line.content) {
                        states.set(line.id, { type: 'replaced', timestamp: 0 });
                    }
                }
            }
            prevLinesRef.current = lines;
        }
        const t = setTimeout(() => setAnimStates(states), 0);
        return () => clearTimeout(t);
    }, [lines, animate]);
    useEffect(() => {
        getHighlighter().then(setHighlighter);
    }, []);
    const highlightedLines = useMemo(() => {
        if (!highlighter)
            return null;
        const code = lines.map((l) => l.content).join('\n');
        let lang = language;
        try {
            highlighter.getLoadedLanguages();
        }
        catch {
            lang = 'text';
        }
        try {
            const html = highlighter.codeToHtml(code, { lang, theme: 'github-light' });
            const parsed = parseShikiLines(html);
            return lines.map((line, i) => ({
                id: line.id,
                html: parsed[i] || escapeHtml(line.content),
            }));
        }
        catch {
            return lines.map((line) => ({
                id: line.id,
                html: escapeHtml(line.content),
            }));
        }
    }, [highlighter, lines, language]);
    const fallbackLines = useMemo(() => {
        return lines.map((line) => ({
            id: line.id,
            html: escapeHtml(line.content),
        }));
    }, [lines]);
    const lineHtmlMap = highlightedLines || fallbackLines;
    const typingDelays = useMemo(() => {
        const delays = new Map();
        let cumulative = 0;
        for (const line of lines) {
            if (animStates.has(line.id)) {
                delays.set(line.id, cumulative);
                cumulative += getTypingDuration(line.content) + LINE_GAP_MS;
            }
        }
        return delays;
    }, [lines, animStates]);
    const langDisplay = LANG_DISPLAY_NAMES[language] || language;
    return (jsx("div", { ref: wrapperRef, className: "base-element-code", style: {
            position: 'absolute',
            top: `${elementInfo.top}px`,
            left: `${elementInfo.left}px`,
            width: `${elementInfo.width}px`,
            height: `${elementInfo.height}px`,
        }, onPointerDown: stopPointer, onClick: stopPointer, children: jsx("div", { className: "rotate-wrapper", style: {
                width: '100%',
                height: '100%',
                transform: `rotate(${elementInfo.rotate}deg)`,
            }, children: jsxs("div", { className: "element-content", style: {
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    background: '#fafbfc',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)',
                    fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", ui-monospace, SFMono-Regular, "Liberation Mono", Menlo, Monaco, Consolas, monospace',
                    fontSize: `${fontSize}px`,
                }, children: [jsxs("div", { style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexShrink: 0,
                            paddingLeft: '12px',
                            paddingRight: '12px',
                            height: '32px',
                            background: '#f8f9fa',
                            borderBottom: '1px solid #e5e7eb',
                        }, children: [jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [jsxs("div", { style: { display: 'flex', gap: '6px' }, children: [jsx("div", { style: {
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '9999px',
                                                    background: '#ff5f57',
                                                } }), jsx("div", { style: {
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '9999px',
                                                    background: '#febc2e',
                                                } }), jsx("div", { style: {
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '9999px',
                                                    background: '#28c840',
                                                } })] }), fileName && (jsx("span", { style: {
                                            marginLeft: '8px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            color: '#6b7280',
                                            fontSize: '11px',
                                            letterSpacing: '0.01em',
                                        }, children: fileName }))] }), jsx("span", { style: {
                                    color: '#9ca3af',
                                    fontSize: '10px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    fontWeight: 500,
                                }, children: langDisplay })] }), jsx("div", { ref: codeBodyRef, style: {
                            flex: 1,
                            overflow: 'auto',
                            paddingTop: '8px',
                            paddingBottom: '8px',
                            background: '#fafbfc',
                            color: '#24292e',
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            touchAction: 'none',
                        }, children: jsx("div", { style: { minWidth: 'max-content' }, children: jsx(AnimatePresence, { initial: false, mode: "popLayout", children: lineHtmlMap.map((lineData, index) => {
                                    const line = lines[index];
                                    if (!line)
                                        return null;
                                    return (jsx(CodeLineRow, { line: line, lineNumber: index + 1, highlightedHtml: lineData.html, showLineNumbers: showLineNumbers, animState: animStates.get(line.id), animate: !!animate, typingDelay: typingDelays.get(line.id) ?? 0 }, line.id));
                                }) }) }) })] }) }) }));
}
// ==================== Utilities ====================
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
const LANG_DISPLAY_NAMES = {
    python: 'Python',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    json: 'JSON',
    go: 'Go',
    rust: 'Rust',
    java: 'Java',
    c: 'C',
    cpp: 'C++',
    html: 'HTML',
    css: 'CSS',
    bash: 'Bash',
    sql: 'SQL',
    yaml: 'YAML',
    markdown: 'Markdown',
    jsx: 'JSX',
    tsx: 'TSX',
};

export { BaseCodeElement };
//# sourceMappingURL=BaseCodeElement.js.map
