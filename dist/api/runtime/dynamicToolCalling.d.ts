export interface SyntheticToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
export type DynamicToolCallLike = {
    id?: string;
    type?: 'function';
    function?: {
        name?: string;
        arguments?: string;
    };
};
export declare function buildSyntheticToolCallsFromText(text: string, step: number): SyntheticToolCall[];
export declare function resolveDynamicToolCalls<T extends DynamicToolCallLike>(toolCalls: ReadonlyArray<T> | undefined, options: {
    text: string | undefined;
    step: number;
    toolsAvailable: boolean;
}): Array<T | SyntheticToolCall>;
//# sourceMappingURL=dynamicToolCalling.d.ts.map