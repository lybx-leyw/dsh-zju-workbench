import type { ComposeOption } from 'echarts/core';
import type { GridComponentOption } from 'echarts/components';
import type { BarSeriesOption, PictorialBarSeriesOption, LineSeriesOption, PieSeriesOption, ScatterSeriesOption, RadarSeriesOption } from 'echarts/charts';
import type { ChartData, ChartType, ImportedChartStyle } from '@openmaic/dsl';
type EChartOption = ComposeOption<PictorialBarSeriesOption | BarSeriesOption | LineSeriesOption | PieSeriesOption | ScatterSeriesOption | RadarSeriesOption | GridComponentOption>;
export interface ChartOptionPayload {
    type: ChartType;
    data: ChartData;
    themeColors: string[];
    textColor?: string;
    lineColor?: string;
    lineSmooth?: boolean;
    stack?: boolean;
    percentStack?: boolean;
    importedStyle?: ImportedChartStyle;
}
export declare const getChartOption: ({ type, data, themeColors, textColor, lineColor, lineSmooth, stack, percentStack, importedStyle, }: ChartOptionPayload) => EChartOption | null;
export {};
