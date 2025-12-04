# RAG Memory Configuration Guide

This guide explains how to configure RAG (Retrieval Augmented Generation) memory for AgentOS GMIs, Agents, and Agencies.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Persona-Level Configuration](#persona-level-configuration)
4. [Retrieval Configuration](#retrieval-configuration)
5. [Ingestion Configuration](#ingestion-configuration)
6. [Memory Lifecycle Management](#memory-lifecycle-management)
7. [Agency Shared Memory](#agency-shared-memory)
8. [Performance Tuning](#performance-tuning)
9. [Troubleshooting](#troubleshooting)

---

## Overview

AgentOS RAG memory allows GMIs to:
- **Remember** past conversations and retrieve relevant context
- **Learn** from interactions through automatic ingestion
- **Share** knowledge across GMIs in an Agency
- **Manage** memory lifecycle through configurable policies

### Key Components

| Component | Purpose |
|-----------|---------|
| `VectorStoreManager` | Manages vector database connections |
| `EmbeddingManager` | Generates embeddings for documents |
| `RetrievalAugmentor` | Orchestrates retrieval and ingestion |
| `MemoryLifecycleManager` | Enforces retention policies |

---

## Quick Start

### Minimal Configuration

Add this to your persona definition to enable basic RAG memory:

```json
{
  "id": "my-persona",
  "name": "My RAG-Enabled Persona",
  "memoryConfig": {
    "enabled": true,
    "ragConfig": {
      "enabled": true,
      "retrievalTriggers": {
        "onUserQuery": true
      },
      "dataSources": [{
        "id": "default-memory",
        "dataSourceNameOrId": "persona_memories",
        "isEnabled": true,
        "defaultTopK": 5
      }]
    }
  }
}
```

### Required System Configuration

Ensure your AgentOS instance has RAG components initialized:

```typescript
import { AgentOS } from '@framers/agentos';

const agentOS = new AgentOS({
  // ... other config
  ragConfig: {
    vectorStoreManager: {
      providers: [{
        id: 'sql-store',
        type: 'sql',
        storage: { filePath: './data/vectors.db' }
      }],
      defaultProviderId: 'sql-store'
    },
    embeddingManager: {
      defaultModelId: 'text-embedding-3-small',
      defaultProviderId: 'openai'
    },
    retrievalAugmentor: {
      categoryBehaviors: [
        {
          category: 'conversation_history',
          targetDataSourceIds: ['persona_memories'],
          defaultRetrievalOptions: { topK: 5, strategy: 'similarity' }
        }
      ]
    }
  }
});
```

---

## Persona-Level Configuration

### Complete PersonaMemoryConfig Reference

```typescript
interface PersonaMemoryConfig {
  // Master switch for memory features
  enabled: boolean;
  
  // Working memory / conversation context settings
  conversationContext?: {
    maxMessages?: number;              // Max messages in working memory
    maxTokens?: number;                // Max tokens for history
    overflowStrategy?: 'truncate' | 'summarize' | 'hybrid';
    summarizationTriggerTokens?: number;
    includeToolResults?: boolean;
    includeSystemMessages?: boolean;
  };
  
  // RAG configuration
  ragConfig?: {
    enabled: boolean;                  // ⚠️ NOT enabled by default
    
    // Retrieval settings
    defaultRetrievalStrategy?: 'similarity' | 'mmr' | 'hybrid_search';
    defaultRetrievalTopK?: number;
    dataSources?: PersonaRagDataSourceConfig[];
    retrievalTriggers?: PersonaRagConfigRetrievalTrigger;
    
    // Reranking (optional)
    rerankerConfig?: {
      enabled: boolean;
      provider: 'cohere' | 'jina' | 'custom_llm';
      modelName?: string;
      topN?: number;
    };
    
    // Ingestion settings
    ingestionTriggers?: PersonaRagConfigIngestionTrigger;
    ingestionProcessing?: PersonaRagIngestionProcessingConfig;
    defaultIngestionDataSourceId?: string;
    
    // Query/result processing
    queryAugmentationPromptName?: string;
    resultSynthesizerPromptName?: string;
    retrievedContextProcessing?: PersonaUtilityProcessingConfig;
  };
  
  // Memory lifecycle negotiation
  lifecycleConfig?: {
    negotiationEnabled?: boolean;      // GMI can prevent deletion
  };
}
```

### Data Source Configuration

Define which RAG data sources a persona can access:

```typescript
interface PersonaRagDataSourceConfig {
  id: string;                          // Unique ID for this config entry
  dataSourceNameOrId: string;          // Actual data source ID in RAG system
  isEnabled: boolean;                  // Can be disabled without removing
  displayName?: string;                // Human-readable name
  defaultTopK?: number;                // Results to fetch from this source
  defaultFilterMetadata?: Record<string, any>;  // Pre-filter results
  priority?: number;                   // Query priority (higher = first)
  relevanceThreshold?: number;         // Min score to include results
}
```

---

## Retrieval Configuration

### Retrieval Triggers

Control when RAG retrieval is triggered:

```typescript
interface PersonaRagConfigRetrievalTrigger {
  // Always retrieve on user query
  onUserQuery?: boolean;
  
  // Retrieve when specific intents detected
  onIntentDetected?: string[];  // e.g., ['question', 'recall', 'search']
  
  // Retrieve when tools fail (for fallback context)
  onToolFailure?: string[];     // e.g., ['web_search', 'database_query']
  
  // Retrieve when keywords present but context missing
  onMissingContextKeywords?: string[];
  
  // Custom logic function name
  customLogicFunctionName?: string;
}
```

### Example: Selective Retrieval

Only retrieve for certain types of queries:

```json
{
  "ragConfig": {
    "enabled": true,
    "retrievalTriggers": {
      "onUserQuery": false,
      "onIntentDetected": ["question", "recall", "remember"],
      "onMissingContextKeywords": ["last time", "previously", "before"]
    }
  }
}
```

### Retrieval Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `similarity` | Pure vector similarity | General queries |
| `mmr` | Maximal Marginal Relevance | Diverse results |
| `hybrid_search` | Vector + keyword | Technical queries |

---

## Ingestion Configuration

### Ingestion Triggers

Control when conversation data is stored in RAG:

```typescript
interface PersonaRagConfigIngestionTrigger {
  // Ingest summary after each turn
  onTurnSummary?: boolean;
  
  // Ingest on explicit user command
  onExplicitUserCommand?: string;  // e.g., "remember this"
  
  // Custom logic
  customLogicFunctionName?: string;
}
```

### Ingestion Processing

How to process content before ingestion:

```typescript
interface PersonaRagIngestionProcessingConfig {
  summarization?: {
    enabled: boolean;
    targetLength?: 'short' | 'medium' | 'long' | number;
    method?: 'extractive' | 'abstractive_llm';
    modelId?: string;      // Model for abstractive
    providerId?: string;
  };
  
  keywordExtraction?: {
    enabled: boolean;
    maxKeywords?: number;
  };
}
```

### Example: Full Ingestion Pipeline

```json
{
  "ragConfig": {
    "enabled": true,
    "ingestionTriggers": {
      "onTurnSummary": true,
      "onExplicitUserCommand": "remember this"
    },
    "ingestionProcessing": {
      "summarization": {
        "enabled": true,
        "targetLength": "short",
        "method": "abstractive_llm",
        "modelId": "gpt-4o-mini"
      },
      "keywordExtraction": {
        "enabled": true,
        "maxKeywords": 5
      }
    },
    "defaultIngestionDataSourceId": "conversation_summaries"
  }
}
```

---

## Memory Lifecycle Management

### GMI Negotiation

When enabled, GMIs can negotiate memory lifecycle events:

```json
{
  "memoryConfig": {
    "enabled": true,
    "lifecycleConfig": {
      "negotiationEnabled": true
    }
  }
}
```

### Lifecycle Actions

| Action | Description |
|--------|-------------|
| `ALLOW_ACTION` | Proceed with proposed action |
| `PREVENT_ACTION` | Block the action |
| `DELETE` | Delete the memory item |
| `ARCHIVE` | Move to archive storage |
| `SUMMARIZE_AND_DELETE` | Summarize then delete |
| `RETAIN_FOR_DURATION` | Keep for specified time |
| `MARK_AS_CRITICAL` | Flag as important |

### System-Level Policies

Configure retention policies in `MemoryLifecycleManagerConfig`:

```typescript
const lifecycleConfig = {
  policies: [
    {
      policyId: 'conversation-cleanup',
      description: 'Clean up old conversation summaries',
      retentionDays: 90,
      appliesTo: {
        categories: [RagMemoryCategory.CONVERSATION_HISTORY]
      },
      action: {
        type: 'summarize_and_delete',
        summaryDataSourceId: 'long_term_memories'
      },
      gmiNegotiation: {
        enabled: true,
        defaultActionOnTimeout: 'ALLOW_ACTION'
      },
      isEnabled: true,
      priority: 10
    }
  ],
  defaultCheckInterval: 'PT6H',  // Check every 6 hours
  dryRunMode: false
};
```

---

## Agency Shared Memory

> **Note:** Agency-level shared RAG memory is planned for future releases.

### Planned Configuration

```typescript
interface AgencyMemoryConfig {
  // Enable agency-level shared memory
  enabled: boolean;
  
  // Data sources accessible to all agency members
  sharedDataSourceIds: string[];
  
  // Allow GMIs to query each other's context
  crossGMIContextSharing: boolean;
  
  // Who can see what
  memoryVisibility: 'all_seats' | 'same_role' | 'explicit_grant';
  
  // Shared memory policies
  sharedMemoryPolicies?: {
    maxSharedItemsPerGMI?: number;
    requireApprovalForSharing?: boolean;
    autoShareCategories?: RagMemoryCategory[];
  };
}
```

### Planned Usage

```typescript
// Agency with shared memory (future API)
const agency = await agentOS.createAgency({
  workflowId: 'research-team',
  memoryConfig: {
    enabled: true,
    sharedDataSourceIds: ['team_knowledge', 'project_notes'],
    crossGMIContextSharing: true,
    memoryVisibility: 'all_seats'
  },
  seats: [
    { roleId: 'researcher', personaId: 'research-specialist' },
    { roleId: 'writer', personaId: 'content-creator' }
  ]
});
```

---

## Performance Tuning

### Caching Embeddings

Reduce embedding costs with caching:

```typescript
const embeddingConfig = {
  cacheSettings: {
    enabled: true,
    ttlSeconds: 3600,        // 1 hour
    maxCachedEmbeddings: 10000,
    evictionPolicy: 'lru'
  }
};
```

### Query Optimization

```typescript
const retrievalConfig = {
  performanceTuning: {
    maxConcurrentQueries: 3,
    queryTimeoutMs: 5000,
    earlyTerminationThreshold: 0.95  // Stop if confidence high
  }
};
```

### Batched Ingestion

```typescript
const ingestionConfig = {
  batching: {
    enabled: true,
    maxBatchSize: 100,
    flushIntervalMs: 5000
  }
};
```

---

## Troubleshooting

### RAG Not Retrieving

1. **Check `ragConfig.enabled`** - Must be `true`
2. **Check `retrievalTriggers`** - At least one trigger must be configured
3. **Verify data sources exist** - Data source IDs must match system config
4. **Check embeddings** - Ensure EmbeddingManager is initialized

### Ingestion Not Working

1. **Check `ingestionTriggers`** - Must have a trigger enabled
2. **Check `defaultIngestionDataSourceId`** - Must be configured
3. **Verify RetrievalAugmentor** - Must be passed to GMI config

### Memory Not Persisting

1. **Check storage adapter** - Verify database connectivity
2. **Check vector store** - Ensure SqlVectorStore/similar is initialized
3. **Review logs** - Look for ingestion errors in trace

### Debug Logging

Enable detailed RAG logging:

```typescript
const config = {
  logging: {
    level: 'debug',
    components: ['rag', 'embedding', 'vector-store']
  }
};
```

---

## API Reference

### GMI RAG Methods (Internal)

| Method | Description |
|--------|-------------|
| `shouldTriggerRAGRetrieval(query)` | Checks if retrieval should happen |
| `performPostTurnIngestion(input, response)` | Ingests conversation turn |
| `onMemoryLifecycleEvent(event)` | Handles lifecycle events |

### RetrievalAugmentor Methods

| Method | Description |
|--------|-------------|
| `retrieveContext(query, options)` | Retrieves relevant context |
| `ingestDocuments(docs, options)` | Ingests documents to RAG |
| `deleteDocuments(ids, options)` | Removes documents |
| `checkHealth()` | Health check |

---

*Last Updated: 2025-12-04*
*AgentOS Version: 0.x.x (pre-release)*


