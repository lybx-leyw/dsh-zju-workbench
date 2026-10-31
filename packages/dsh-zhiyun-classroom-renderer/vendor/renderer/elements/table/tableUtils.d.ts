import type { CSSProperties } from 'react';
import type { TableCell, TableCellStyle } from '@openmaic/dsl';
export declare function getTextStyle(style?: TableCellStyle): CSSProperties;
export declare function formatText(text: string): string;
export declare function getHiddenCells(data: TableCell[][]): Set<string>;
