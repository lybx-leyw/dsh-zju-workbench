import type * as echartsCore from 'echarts/core';
type EChartsRuntime = typeof echartsCore;
/**
 * Load and register the small ECharts surface used by chart elements.
 *
 * Keeping this behind a shared promise is important for two reasons: charts
 * remain optional for consumers that only render text/images, and multiple
 * charts on one slide do not race to register the same ECharts extensions.
 */
export declare function loadChartRuntime(): Promise<EChartsRuntime>;
export {};
