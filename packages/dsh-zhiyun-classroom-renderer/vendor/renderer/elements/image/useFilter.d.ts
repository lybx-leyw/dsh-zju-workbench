import type { ImageElementFilters } from '@openmaic/dsl';
export declare function useFilter(filters?: ImageElementFilters): {
    filter: string;
};
export declare function imageFiltersToCss(filters?: ImageElementFilters): string;
