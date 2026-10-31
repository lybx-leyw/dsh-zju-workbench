import type { PPTImageElement } from '@openmaic/dsl';
export declare function useClipImage(element: PPTImageElement): {
    clipShape: import("./clipPaths").ClipPathDef;
    imgPosition: {
        top: string;
        left: string;
        width: string;
        height: string;
    };
};
