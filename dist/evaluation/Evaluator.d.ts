/**
 * @file Evaluator.ts
 * @description Implementation of the agent evaluation framework.
 * @module AgentOS/Evaluation
 * @version 1.0.0
 */
import { IEvaluator, EvalTestCase, EvalTestResult, EvalRun, EvalConfig, EvalComparison, ScorerFunction, BuiltInScorer } from './IEvaluator';
/**
 * Agent evaluation framework implementation.
 */
export declare class Evaluator implements IEvaluator {
    private readonly runs;
    private readonly scorers;
    constructor();
    runEvaluation(name: string, testCases: EvalTestCase[], agentFn: (input: string, context?: string) => Promise<string>, config?: EvalConfig): Promise<EvalRun>;
    evaluateTestCase(testCase: EvalTestCase, actualOutput: string, config?: EvalConfig): Promise<EvalTestResult>;
    score(scorer: BuiltInScorer | string, actual: string, expected?: string, references?: string[]): Promise<number>;
    registerScorer(name: string, fn: ScorerFunction): void;
    getRun(runId: string): Promise<EvalRun | undefined>;
    listRuns(limit?: number): Promise<EvalRun[]>;
    compareRuns(runId1: string, runId2: string): Promise<EvalComparison>;
    generateReport(runId: string, format: 'json' | 'markdown' | 'html'): Promise<string>;
    private createEmptyAggregateMetrics;
    private calculateAggregateMetrics;
    private generateMarkdownReport;
    private generateHtmlReport;
}
//# sourceMappingURL=Evaluator.d.ts.map