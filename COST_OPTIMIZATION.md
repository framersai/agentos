# AgentOS Cost Optimization Guide

> Comprehensive guide for optimizing LLM costs, configuring performance tiers, and implementing sensible defaults across the AgentOS framework.

---

## Table of Contents

1. [Overview](#overview)
2. [Cost Factors](#cost-factors)
3. [Optimization Strategies](#optimization-strategies)
4. [Performance Tiers](#performance-tiers)
5. [Model Selection](#model-selection)
6. [RAG Cost Optimization](#rag-cost-optimization)
7. [Storage Cost Optimization](#storage-cost-optimization)
8. [Configuration Reference](#configuration-reference)
9. [Monitoring & Budgets](#monitoring--budgets)

---

## Overview

AgentOS is designed to be **cost-conscious by default** while allowing fine-grained control for users who need it. This guide covers:

- **LLM Costs**: Token usage, model selection, caching
- **RAG Costs**: Embedding generation, vector storage, retrieval
- **Storage Costs**: Database operations, sync bandwidth
- **Compute Costs**: Tool execution, streaming overhead

### Key Principles

1. **Sensible Defaults**: Out-of-box configuration minimizes cost while maintaining quality
2. **Configurable Tradeoffs**: Choose between speed, cost, and accuracy
3. **Transparency**: Built-in metrics for cost tracking
4. **Graceful Degradation**: Falls back to cheaper options when possible

---

## Cost Factors

### LLM Token Costs (Approximate)

| Model | Input (per 1K) | Output (per 1K) | Context Window |
|-------|---------------|-----------------|----------------|
| GPT-4o | $0.005 | $0.015 | 128K |
| GPT-4o-mini | $0.00015 | $0.0006 | 128K |
| Claude 3.5 Sonnet | $0.003 | $0.015 | 200K |
| Claude 3 Haiku | $0.00025 | $0.00125 | 200K |
| Gemini 1.5 Pro | $0.00125 | $0.005 | 1M |
| Gemini 1.5 Flash | $0.000075 | $0.0003 | 1M |

### Embedding Costs

| Model | Cost (per 1K tokens) | Dimensions |
|-------|---------------------|------------|
| text-embedding-3-small | $0.00002 | 1536 |
| text-embedding-3-large | $0.00013 | 3072 |
| text-embedding-ada-002 | $0.0001 | 1536 |

### Storage Costs

| Service | Cost | Notes |
|---------|------|-------|
| Local SQLite | Free | Included in app |
| Supabase (Free) | Free | 500MB, 2 projects |
| Supabase (Pro) | $25/mo | 8GB included |
| Pinecone (Starter) | Free | 100K vectors |
| Pinecone (Standard) | $70/mo | 1M vectors |

---

## Optimization Strategies

### 1. Model Tiering

Route different tasks to appropriate models:

```typescript
import { AgentOS, AgentOSConfig } from '@framers/agentos';

const config: AgentOSConfig = {
  modelRouting: {
    // Use cheap models for simple tasks
    simple: {
      model: 'gpt-4o-mini',
      maxTokens: 500,
    },
    // Use powerful models for complex reasoning
    complex: {
      model: 'gpt-4o',
      maxTokens: 2000,
    },
    // Use very cheap for classification/routing
    routing: {
      model: 'gpt-4o-mini',
      maxTokens: 100,
    },
  },
  
  // Auto-route based on task complexity
  autoRouting: {
    enabled: true,
    complexityThreshold: 0.7, // 0-1 scale
    fallbackModel: 'gpt-4o-mini',
  },
};

const agentos = new AgentOS();
await agentos.initialize(config);
```

### 2. Context Window Management

Minimize tokens by smart context management:

```typescript
const config: AgentOSConfig = {
  contextManagement: {
    // Max tokens for conversation history
    maxHistoryTokens: 4000,
    
    // Max tokens for RAG context
    maxRAGContextTokens: 2000,
    
    // Summarization strategy for long conversations
    summarizationStrategy: 'progressive', // 'none' | 'progressive' | 'aggressive'
    
    // When to summarize (percentage of max tokens)
    summarizeThreshold: 0.8,
    
    // Use cheaper model for summarization
    summarizationModel: 'gpt-4o-mini',
  },
};
```

### 3. Response Caching

Cache common responses to avoid repeated LLM calls:

```typescript
const config: AgentOSConfig = {
  caching: {
    enabled: true,
    
    // Cache identical prompts
    promptCache: {
      enabled: true,
      ttlSeconds: 3600, // 1 hour
      maxEntries: 1000,
    },
    
    // Cache semantic similarity (fuzzy matching)
    semanticCache: {
      enabled: true,
      similarityThreshold: 0.95, // Very high similarity required
      ttlSeconds: 7200, // 2 hours
    },
    
    // Cache tool results
    toolResultCache: {
      enabled: true,
      ttlSeconds: 300, // 5 minutes
    },
  },
};
```

### 4. Streaming Optimization

Optimize streaming for cost and latency:

```typescript
const config: AgentOSConfig = {
  streaming: {
    // Enable streaming (better UX, same cost)
    enabled: true,
    
    // Batch small chunks (reduce overhead)
    batchingEnabled: true,
    batchIntervalMs: 50,
    
    // Auto-stop on user interruption (save tokens)
    interruptionHandling: 'stop', // 'stop' | 'complete' | 'summarize'
  },
};
```

### 5. Tool Execution Optimization

Minimize tool call overhead:

```typescript
const config: AgentOSConfig = {
  toolExecution: {
    // Parallel tool execution (faster, same cost)
    parallelExecution: true,
    maxConcurrent: 5,
    
    // Cache tool results
    cacheResults: true,
    cacheTtlSeconds: 300,
    
    // Limit tool iterations (prevent runaway costs)
    maxIterations: 10,
    
    // Timeout for individual tools
    timeoutMs: 30000,
  },
};
```

---

## Performance Tiers

### Tier Configuration

```typescript
type PerformanceTier = 'economy' | 'balanced' | 'performance' | 'custom';

const TIER_DEFAULTS = {
  economy: {
    defaultModel: 'gpt-4o-mini',
    maxTokensPerTurn: 500,
    cachingEnabled: true,
    summarizationEnabled: true,
    toolParallelization: false,
    ragEnabled: false,
  },
  balanced: {
    defaultModel: 'gpt-4o-mini',
    maxTokensPerTurn: 1000,
    cachingEnabled: true,
    summarizationEnabled: true,
    toolParallelization: true,
    ragEnabled: true,
  },
  performance: {
    defaultModel: 'gpt-4o',
    maxTokensPerTurn: 4000,
    cachingEnabled: false,
    summarizationEnabled: false,
    toolParallelization: true,
    ragEnabled: true,
  },
};
```

### Usage

```typescript
import { AgentOS } from '@framers/agentos';

// Economy tier: Minimize costs
const economyAgent = new AgentOS();
await economyAgent.initialize({
  performanceTier: 'economy',
});

// Balanced tier: Default, good for most use cases
const balancedAgent = new AgentOS();
await balancedAgent.initialize({
  performanceTier: 'balanced',
});

// Performance tier: Maximum capability
const performanceAgent = new AgentOS();
await performanceAgent.initialize({
  performanceTier: 'performance',
});

// Custom tier: Full control
const customAgent = new AgentOS();
await customAgent.initialize({
  performanceTier: 'custom',
  defaultModel: 'claude-3-haiku',
  maxTokensPerTurn: 2000,
  cachingEnabled: true,
  // ... other options
});
```

### Tier Comparison

| Feature | Economy | Balanced | Performance |
|---------|---------|----------|-------------|
| Default Model | gpt-4o-mini | gpt-4o-mini | gpt-4o |
| Max Tokens | 500 | 1000 | 4000 |
| Caching | ✅ | ✅ | ❌ |
| RAG | ❌ | ✅ | ✅ |
| Tool Parallel | ❌ | ✅ | ✅ |
| Est. Cost/1K turns | ~$0.10 | ~$0.50 | ~$5.00 |

---

## Model Selection

### Automatic Model Selection

AgentOS can automatically select models based on task complexity:

```typescript
const config: AgentOSConfig = {
  modelSelection: {
    strategy: 'auto', // 'fixed' | 'auto' | 'user-preference'
    
    // Complexity detection
    complexityDetection: {
      // Use fast classifier to estimate complexity
      classifier: 'rule-based', // 'rule-based' | 'ml' | 'llm'
      
      // Factors considered
      factors: [
        'messageLength',      // Longer = more complex
        'technicalTerms',     // Technical vocabulary
        'questionType',       // 'factual' vs 'analytical'
        'toolRequirements',   // Tools needed
        'contextDependency',  // Needs history?
      ],
    },
    
    // Model mapping by complexity
    complexityMapping: {
      low: 'gpt-4o-mini',      // 0.0 - 0.3
      medium: 'gpt-4o-mini',   // 0.3 - 0.7
      high: 'gpt-4o',          // 0.7 - 1.0
    },
  },
};
```

### Provider Fallback

Configure fallback providers for reliability and cost:

```typescript
const config: AgentOSConfig = {
  providers: {
    primary: {
      name: 'openai',
      models: ['gpt-4o', 'gpt-4o-mini'],
      apiKey: process.env.OPENAI_API_KEY,
    },
    fallback: [
      {
        name: 'anthropic',
        models: ['claude-3-haiku'],
        apiKey: process.env.ANTHROPIC_API_KEY,
        // Use when primary fails or is expensive
        conditions: {
          onPrimaryFailure: true,
          onPrimaryOverBudget: true,
        },
      },
    ],
  },
};
```

---

## RAG Cost Optimization

### Embedding Strategy

```typescript
const config: AgentOSConfig = {
  rag: {
    embedding: {
      // Use smaller, cheaper embeddings
      model: 'text-embedding-3-small', // vs 'large'
      dimensions: 1536,
      
      // Batch embeddings (reduce API calls)
      batchSize: 100,
      
      // Cache embeddings (don't re-embed same content)
      cacheEnabled: true,
      cacheTtlDays: 30,
      
      // Content deduplication (skip identical content)
      deduplication: true,
    },
  },
};
```

### Retrieval Optimization

```typescript
const config: AgentOSConfig = {
  rag: {
    retrieval: {
      // Limit retrieved documents
      topK: 5, // Don't retrieve more than needed
      
      // Minimum relevance threshold
      minScore: 0.7, // Skip low-relevance results
      
      // Hybrid search (lexical + semantic)
      hybridSearch: {
        enabled: true,
        // Lexical is free, semantic costs embeddings
        lexicalWeight: 0.3,
        semanticWeight: 0.7,
      },
      
      // Progressive retrieval (start small, expand if needed)
      progressive: {
        enabled: true,
        initialK: 3,
        maxK: 10,
        expansionThreshold: 0.5, // Expand if avg score < threshold
      },
    },
  },
};
```

### Vector Store Selection

```typescript
const config: AgentOSConfig = {
  rag: {
    vectorStore: {
      // Use local store for development (free)
      development: {
        type: 'in-memory',
      },
      
      // Use efficient hosted store for production
      production: {
        type: 'pinecone',
        index: 'production',
        // Serverless = cheaper for low traffic
        serverless: true,
      },
    },
  },
};
```

---

## Storage Cost Optimization

AgentOS integrates with `@framers/sql-storage-adapter` for local-first storage:

```typescript
import { AgentOS } from '@framers/agentos';
import { createDatabase } from '@framers/sql-storage-adapter';

// Use efficient storage tier
const db = await createDatabase({
  priority: ['indexeddb', 'sqljs'], // Free local storage
  performance: {
    tier: 'efficient',
    batchWrites: true,
    cacheEnabled: true,
  },
});

const config: AgentOSConfig = {
  storage: {
    // Use local storage (free) for:
    conversations: db,
    personas: db,
    preferences: db,
    
    // Only use cloud for synced data
    sync: {
      enabled: true,
      strategy: 'incremental', // Only sync changes
      interval: 60000, // 1 minute
    },
  },
};
```

---

## Configuration Reference

### Full Configuration Schema

```typescript
interface AgentOSCostConfig {
  // Performance tier preset
  performanceTier?: 'economy' | 'balanced' | 'performance' | 'custom';
  
  // Model configuration
  models?: {
    default?: string;
    routing?: string;
    summarization?: string;
    embedding?: string;
  };
  
  // Token limits
  limits?: {
    maxTokensPerTurn?: number;
    maxTokensPerDay?: number;
    maxCostPerDay?: number; // USD
    maxToolIterations?: number;
  };
  
  // Caching
  caching?: {
    promptCache?: boolean;
    semanticCache?: boolean;
    toolCache?: boolean;
    embeddingCache?: boolean;
  };
  
  // Context management
  context?: {
    maxHistoryTokens?: number;
    maxRAGTokens?: number;
    summarizationEnabled?: boolean;
  };
  
  // RAG settings
  rag?: {
    enabled?: boolean;
    topK?: number;
    minScore?: number;
    hybridSearch?: boolean;
  };
  
  // Tool execution
  tools?: {
    parallelExecution?: boolean;
    maxConcurrent?: number;
    cacheResults?: boolean;
    timeoutMs?: number;
  };
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTOS_PERFORMANCE_TIER` | Preset tier | `balanced` |
| `AGENTOS_DEFAULT_MODEL` | Default LLM model | `gpt-4o-mini` |
| `AGENTOS_MAX_TOKENS_PER_TURN` | Token limit per turn | `1000` |
| `AGENTOS_MAX_COST_PER_DAY` | Daily cost limit (USD) | `10.00` |
| `AGENTOS_CACHING_ENABLED` | Enable all caching | `true` |
| `AGENTOS_RAG_ENABLED` | Enable RAG | `true` |
| `AGENTOS_RAG_TOP_K` | RAG retrieval count | `5` |

---

## Monitoring & Budgets

### Cost Tracking

```typescript
const agentos = new AgentOS();

// Subscribe to cost events
agentos.on('cost:turn', (event) => {
  console.log(`Turn cost: $${event.cost.toFixed(4)}`);
  console.log(`  - Input tokens: ${event.inputTokens}`);
  console.log(`  - Output tokens: ${event.outputTokens}`);
  console.log(`  - Model: ${event.model}`);
});

agentos.on('cost:daily', (event) => {
  console.log(`Daily total: $${event.total.toFixed(2)}`);
  if (event.total > event.budget * 0.8) {
    console.warn('Approaching daily budget limit!');
  }
});

// Get usage summary
const usage = await agentos.getUsageSummary({
  period: 'day', // 'hour' | 'day' | 'week' | 'month'
});

console.log(`
Usage Summary:
  Total cost: $${usage.cost.toFixed(2)}
  Total turns: ${usage.turns}
  Total tokens: ${usage.tokens}
  Avg cost/turn: $${(usage.cost / usage.turns).toFixed(4)}
`);
```

### Budget Enforcement

```typescript
const config: AgentOSConfig = {
  budgets: {
    // Hard limits (will reject requests)
    hardLimits: {
      perTurn: 0.10,      // Max $0.10 per turn
      perHour: 5.00,      // Max $5 per hour
      perDay: 20.00,      // Max $20 per day
    },
    
    // Soft limits (will warn and downgrade)
    softLimits: {
      perHour: 3.00,      // Warn at $3/hour
      perDay: 15.00,      // Warn at $15/day
    },
    
    // Actions when limits reached
    limitActions: {
      softLimit: 'downgrade-model', // Switch to cheaper model
      hardLimit: 'reject',           // Reject request
    },
  },
};
```

---

## Best Practices

### 1. Start with Economy Tier

```typescript
// Development and testing
const dev = new AgentOS();
await dev.initialize({ performanceTier: 'economy' });
```

### 2. Use Model Tiering in Production

```typescript
// Route simple queries to cheap models
const prod = new AgentOS();
await prod.initialize({
  modelRouting: {
    simple: { model: 'gpt-4o-mini' },
    complex: { model: 'gpt-4o' },
  },
  autoRouting: { enabled: true },
});
```

### 3. Enable Caching

```typescript
// Cache everything possible
const cached = new AgentOS();
await cached.initialize({
  caching: {
    promptCache: true,
    semanticCache: true,
    toolCache: true,
    embeddingCache: true,
  },
});
```

### 4. Set Budget Limits

```typescript
// Always set limits in production
const safe = new AgentOS();
await safe.initialize({
  budgets: {
    hardLimits: { perDay: 50.00 },
    limitActions: { hardLimit: 'reject' },
  },
});
```

### 5. Monitor Usage

```typescript
// Track costs in real-time
agentos.on('cost:turn', (e) => metrics.record('agentos.cost', e.cost));
```

---

## Summary

| Strategy | Savings | Implementation |
|----------|---------|----------------|
| Use economy tier | 80-90% | `performanceTier: 'economy'` |
| Model tiering | 50-70% | Route by complexity |
| Caching | 20-40% | Enable all caches |
| Context limits | 20-30% | Set max tokens |
| RAG optimization | 30-50% | Hybrid search, low topK |
| Budget enforcement | Unlimited | Hard limits |

---

<p align="center">
  Built and maintained by <a href="https://frame.dev" target="_blank" rel="noopener"><strong>Frame.dev</strong></a>
</p>



