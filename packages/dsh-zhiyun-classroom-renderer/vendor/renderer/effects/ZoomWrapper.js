"use client";
import { jsx, Fragment } from 'react/jsx-runtime';
import { motion } from 'motion/react';

function ZoomWrapper({ children, zoom, geometry }) {
    if (!zoom || !geometry) {
        return jsx(Fragment, { children: children });
    }
    const { scale } = zoom;
    const { centerX, centerY } = geometry;
    return (jsx(motion.div, { initial: { scale: 1 }, animate: { scale }, exit: { scale: 1 }, transition: { type: 'spring', stiffness: 200, damping: 25 }, style: {
            width: '100%',
            height: '100%',
            transformOrigin: `${centerX}% ${centerY}%`,
        }, children: children }));
}

export { ZoomWrapper };
//# sourceMappingURL=ZoomWrapper.js.map
