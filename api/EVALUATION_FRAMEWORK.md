# AgentOS Evaluation Framework

## Overview

The Evaluation Framework provides systematic tools for measuring, benchmarking, and improving agent performance. It enables developers to:

- **Define test cases** with expected outputs and grading criteria
- **Run evaluations** against agent functions with configurable concurrency
- **Score outputs** using built-in or custom scorers
- **Compare runs** to track improvements or regressions
- **Generate reports** in JSON, Markdown, or HTML formats

## Quick Start

```typescript
import { Evaluator } from '@framers/agentos';
import type { EvalTestCase } from '@framers/agentos';

const evaluator = new Evaluator();

// Define test cases
const testCases: EvalTestCase[] = [
  {
    id: 'math-1',
    name: 'Basic Addition',
    input: 'What is 2 + 2?',
    expectedOutput: '4',
    criteria: [
      { name: 'correctness', description: 'Contains correct answer', weight: 1, scorer: 'contains' }
    ]
  },
  {
    id: 'greeting-1',
    name: 'Greeting Response',
    input: 'Hello!',
    expectedOutput: 'Hello! How can I help you today?',
    criteria: [
      { name: 'politeness', description: 'Polite response', weight: 1, scorer: 'contains' },
      { name: 'similarity', description: 'Similar to expected', weight: 2, scorer: 'levenshtein' }
    ]
  }
];

// Define your agent function
async function myAgent(input: string): Promise<string> {
  // Your GMI or agent logic here
  return `Response to: ${input}`;
}

// Run evaluation
const run = await evaluator.runEvaluation(
  'My Agent Evaluation v1.0',
  testCases,
  myAgent,
  { concurrency: 5, timeoutMs: 30000 }
);

// Generate report
const report = await evaluator.generateReport(run.runId, 'markdown');
console.log(report);
```

## Built-in Scorers

The framework includes several built-in scorers:

| Scorer | Description | Best For |
|--------|-------------|----------|
| `exact_match` | Returns 1 if strings are identical (case-insensitive) | Precise answers |
| `contains` | Returns 1 if actual contains expected | Checking for key terms |
| `levenshtein` | Normalized edit distance (0-1) | Typo tolerance |
| `semantic_similarity` | Word overlap score (0-1) | General similarity |
| `bleu` | BLEU score approximation | Translation quality |
| `rouge` | ROUGE-L F1 score | Summarization quality |

### Using Scorers Directly

```typescript
// Score individual outputs
const score = await evaluator.score('levenshtein', 'actual output', 'expected output');
console.log(`Similarity: ${(score * 100).toFixed(1)}%`);
```

## Custom Scorers

Register custom scorers for domain-specific evaluation:

```typescript
// Register a custom scorer
evaluator.registerScorer('json_valid', (actual, expected) => {
  try {
    JSON.parse(actual);
    return 1;
  } catch {
    return 0;
  }
});

// Use in test cases
const testCase: EvalTestCase = {
  id: 'json-1',
  name: 'JSON Output',
  input: 'Generate JSON for user profile',
  expectedOutput: '{"name": "John", "age": 30}',
  criteria: [
    { name: 'valid_json', description: 'Output is valid JSON', weight: 1, scorer: 'json_valid' },
    { name: 'similar', description: 'Similar structure', weight: 2, scorer: 'levenshtein' }
  ]
};
```

## Configuration Options

```typescript
interface EvalConfig {
  concurrency?: number;      // Parallel test execution (default: 3)
  timeoutMs?: number;        // Timeout per test (default: 60000)
  retries?: number;          // Retry count on failure (default: 1)
  continueOnError?: boolean; // Continue if a test fails (default: true)
  thresholds?: {
    pass?: number;           // Minimum score to pass (default: 0.7)
    warn?: number;           // Warning threshold (default: 0.5)
  };
}
```

## Test Case Structure

```typescript
interface EvalTestCase {
  id: string;                    // Unique identifier
  name: string;                  // Human-readable name
  input: string;                 // Input to the agent
  expectedOutput?: string;       // Expected output
  referenceOutputs?: string[];   // Alternative acceptable outputs
  context?: string;              // Additional context for the agent
  criteria?: EvalCriterion[];    // Grading criteria
  tags?: string[];               // Categorization tags
  metadata?: Record<string, unknown>;
}
```

## Comparing Runs

Track improvements across versions:

```typescript
const runV1 = await evaluator.runEvaluation('v1.0', testCases, agentV1);
const runV2 = await evaluator.runEvaluation('v2.0', testCases, agentV2);

const comparison = await evaluator.compareRuns(runV1.runId, runV2.runId);

console.log('Improvements:', comparison.summary.improved);
console.log('Regressions:', comparison.summary.regressed);

for (const metric of comparison.metrics) {
  const trend = metric.improved ? '📈' : '📉';
  console.log(`${trend} ${metric.name}: ${metric.delta.toFixed(2)} (${metric.percentChange.toFixed(1)}%)`);
}
```

## Aggregate Metrics

Each evaluation run includes aggregate metrics:

```typescript
interface AggregateMetrics {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  passRate: number;        // 0-1
  avgScore: number;        // 0-1
  scoreStdDev: number;     // Standard deviation
  avgLatencyMs: number;
  p50LatencyMs: number;    // Median
  p95LatencyMs: number;    // 95th percentile
  p99LatencyMs: number;    // 99th percentile
  totalTokens: number;     // If provided
  totalCostUsd: number;    // If provided
}
```

## Integration with GMI

Evaluate GMI responses:

```typescript
import { GMIManager } from '@framers/agentos';

const gmiManager = new GMIManager();
const gmi = await gmiManager.createGMI(myPersona);

// Create wrapper function for evaluation
async function gmiAgent(input: string): Promise<string> {
  let response = '';
  for await (const chunk of gmi.processTurnStream({ message: input })) {
    if (chunk.content) {
      response += chunk.content;
    }
  }
  return response;
}

const run = await evaluator.runEvaluation('GMI Evaluation', testCases, gmiAgent);
```

## Best Practices

1. **Start with representative test cases** - Cover common user queries and edge cases
2. **Use multiple criteria** - Combine exactness and semantic measures
3. **Weight criteria appropriately** - Prioritize what matters most
4. **Track baselines** - Store run IDs to compare against
5. **Automate in CI/CD** - Run evaluations on each deployment
6. **Review failures** - Manually inspect failing cases for insights

## Report Formats

### JSON
```bash
# Programmatic analysis
const report = await evaluator.generateReport(run.runId, 'json');
const data = JSON.parse(report);
```

### Markdown
```bash
# Documentation and GitHub
const report = await evaluator.generateReport(run.runId, 'markdown');
```

### HTML
```bash
# Visual reports
const report = await evaluator.generateReport(run.runId, 'html');
fs.writeFileSync('report.html', report);
```

## LLM-as-Judge

For semantic evaluation using GPT-4 or other models:

```typescript
import { LLMJudge, CRITERIA_PRESETS } from '@framers/agentos';

const judge = new LLMJudge({
  llmProvider: aiModelProviderManager,
  modelId: 'gpt-4-turbo',
  temperature: 0.1,
});

// Single judgment
const result = await judge.judge(
  'What is photosynthesis?',
  'Photosynthesis is how plants make food from sunlight.',
  'Photosynthesis is the process by which plants convert light energy into chemical energy.'
);

console.log(`Score: ${result.score}`);
console.log(`Reasoning: ${result.reasoning}`);
console.log(`Feedback: ${result.feedback.join(', ')}`);

// Use preset criteria
const codeResult = await judge.judge(
  'Write a function to reverse a string',
  actualCode,
  expectedCode,
  CRITERIA_PRESETS.codeGeneration
);

// Compare two outputs
const comparison = await judge.compare(
  'Summarize this article',
  summaryA,
  summaryB,
  CRITERIA_PRESETS.summarization
);
console.log(`Winner: ${comparison.winner}`);

// Register as custom scorer
evaluator.registerScorer('llm_judge', judge.createScorer());
```

### Available Criteria Presets

| Preset | Use Case |
|--------|----------|
| `codeGeneration` | Evaluate generated code |
| `summarization` | Evaluate summaries |
| `questionAnswering` | Evaluate Q&A responses |
| `creativeWriting` | Evaluate creative content |
| `safety` | Evaluate for harmlessness |

## Future Enhancements
- **Human Evaluation UI**: Collect human judgments in agentos-workbench
- **Persistent Storage**: Store runs in SQL database
- **Regression Detection**: Automatic alerting on performance drops
- **A/B Testing**: Compare agent variants statistically

