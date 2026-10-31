export declare const enum ClipPathTypes {
    RECT = "rect",
    ELLIPSE = "ellipse",
    POLYGON = "polygon"
}
export interface ClipPathDef {
    name: string;
    type: ClipPathTypes;
    style: string;
    radius?: string;
    createPath?: (width: number, height: number) => string;
}
export declare const CLIPPATHS: Record<string, ClipPathDef>;
