# AgentOS RAG Memory Investigation Report

## Executive Summary

This document provides a comprehensive investigation of the current state of RAG (Retrieval Augmented Generation) memory integration within AgentOS, including conversation memory for agents, GMIs, and agencies.

---

## 1. Current Architecture State

### 1.1 RAG Memory Components (✅ Implemented)

| Component | Status | Location |
|-----------|--------|----------|
| `IVectorStore` | ✅ Complete | `src/rag/IVectorStore.ts` |
| `VectorStoreManager` | ✅ Complete | `src/rag/VectorStoreManager.ts` |
| `IEmbeddingManager` | ✅ Complete | `src/rag/IEmbeddingManager.ts` |
| `EmbeddingManager` | ✅ Complete | `src/rag/EmbeddingManager.ts` |
| `IRetrievalAugmentor` | ✅ Complete | `src/rag/IRetrievalAugmentor.ts` |
| `RetrievalAugmentor` | ✅ Complete | `src/rag/RetrievalAugmentor.ts` |
| `SqlVectorStore` | ✅ Complete | `src/rag/implementations/vector_stores/SqlVectorStore.ts` |
| `InMemoryVectorStore` | ✅ Complete | `src/rag/implementations/vector_stores/InMemoryVectorStore.ts` |

### 1.2 GMI RAG Integration (✅ Partially Implemented)

The GMI class integrates with RAG through:

```
GMI.ts → IRetrievalAugmentor (optional dependency)
        ↓
  - shouldTriggerRAGRetrieval() - checks persona ragConfig
  - retrievalAugmentor.retrieveContext() - fetches relevant context
  - performPostTurnIngestion() - stores conversation summaries
```

**Current Configuration Path:**
- `IPersonaDefinition.memoryConfig.ragConfig.enabled` - enables/disables RAG
- `IPersonaDefinition.memoryConfig.ragConfig.retrievalTriggers` - controls when retrieval happens
- `IPersonaDefinition.memoryConfig.ragConfig.ingestionTriggers` - controls when ingestion happens

### 1.3 Agency Integration (⚠️ Limited)

Agencies are tracked via `AgencyRegistry` but **lack direct RAG memory integration**:

```typescript
// Current AgencySession structure
interface AgencySession {
  agencyId: string;
  workflowId: string;
  conversationId: string;
  seats: Record<string, AgencySeatState>;  // GMIs assigned to roles
  metadata?: Record<string, unknown>;
  // ❌ No shared memory configuration
  // ❌ No RAG data source scoping
}
```

---

## 2. Configuration Analysis

### 2.1 Persona-Level RAG Configuration

```typescript
// From IPersonaDefinition.ts
interface PersonaMemoryConfig {
  enabled: boolean;
  conversationContext?: PersonaConversationContextConfig;
  ragConfig?: {
    enabled: boolean;  // ← NOT DEFAULT, must be explicitly enabled
    defaultRetrievalStrategy?: 'similarity' | 'mmr' | 'hybrid_search';
    defaultRetrievalTopK?: number;
    dataSources?: PersonaRagDataSourceConfig[];
    rerankerConfig?: { ... };
    retrievalTriggers?: PersonaRagConfigRetrievalTrigger;
    ingestionTriggers?: PersonaRagConfigIngestionTrigger;
    ingestionProcessing?: PersonaRagIngestionProcessingConfig;
    defaultIngestionDataSourceId?: string;
  };
  lifecycleConfig?: {
    negotiationEnabled?: boolean;  // GMI can negotiate memory lifecycle
  };
}
```

### 2.2 What's Configurable Today

| Feature | Configurable | Default | Notes |
|---------|-------------|---------|-------|
| RAG enabled | ✅ Yes | `false` | Must be explicitly enabled per persona |
| Retrieval on user query | ✅ Yes | `false` | Via `retrievalTriggers.onUserQuery` |
| Ingestion on turn summary | ✅ Yes | `false` | Via `ingestionTriggers.onTurnSummary` |
| Summarization before ingestion | ✅ Yes | `false` | Via `ingestionProcessing.summarization` |
| Data sources | ✅ Yes | `[]` | Can configure multiple per persona |
| Reranking | ✅ Yes | disabled | Supports Cohere, Jina, custom |
| Memory lifecycle negotiation | ✅ Yes | `false` | GMI can prevent deletion |

### 2.3 Configuration Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| No Agency-level RAG config | Agencies can't share memory | HIGH |
| No default RAG data source auto-creation | Requires manual setup | MEDIUM |
| No conversation-to-RAG persistence trigger | Manual only | HIGH |
| No cross-GMI memory sharing in Agency | Limited collaboration | HIGH |

---

## 3. GMI Memory Integration Deep Dive

### 3.1 Current Flow (When RAG Enabled)

```
User Query
    ↓
GMI.processTurnStream()
    ↓
1. Check shouldTriggerRAGRetrieval()
    ↓ (if true)
2. retrievalAugmentor.retrieveContext(query, options)
    ↓
3. Context injected into PromptComponents.retrievedContext
    ↓
4. LLM generates response
    ↓
5. performPostTurnIngestion() called
    ↓ (if ingestionTriggers.onTurnSummary = true)
6. Conversation turn summarized + ingested to RAG
```

### 3.2 Code References

**Retrieval Trigger Check:**
```typescript
// GMI.ts:479-491
private shouldTriggerRAGRetrieval(query: string): boolean {
  if (!query || query.trim() === '') return false;
  const ragConfig = this.activePersona.memoryConfig?.ragConfig;
  const retrievalTriggers = ragConfig?.retrievalTriggers;
  if (retrievalTriggers?.onUserQuery) {
    return true;
  }
  // TODO: Implement more sophisticated logic based on other retrievalTriggers
  return false; // Default
}
```

**Post-Turn Ingestion:**
```typescript
// GMI.ts:850-905
private async performPostTurnIngestion(userInput: string, gmiResponse: string): Promise<void> {
  const ragConfig = this.activePersona.memoryConfig?.ragConfig;
  const ingestionTriggers = ragConfig?.ingestionTriggers;
  
  if (!this.retrievalAugmentor || !ragConfig?.enabled || !ingestionTriggers?.onTurnSummary) {
    return;  // ← Must be explicitly enabled
  }
  // ... summarization and ingestion logic
}
```

---

## 4. Missing Implementations

### 4.1 Critical Missing Features

| Feature | Description | Files to Modify |
|---------|-------------|-----------------|
| Agency Shared Memory | Agencies should have dedicated data sources that all member GMIs can access | `AgencyRegistry.ts`, `AgencyTypes.ts`, new `AgencyMemoryManager.ts` |
| Auto RAG Data Source Creation | When persona enables RAG, auto-create appropriate data sources | `GMIManager.ts`, `VectorStoreManager.ts` |
| Conversation History → RAG Pipeline | Automatic pipeline to move old conversation turns into RAG | New `ConversationRAGBridge.ts` |
| Cross-GMI Context Sharing | In an Agency, GMIs should be able to query each other's context | `RetrievalAugmentor.ts`, new filters |
| Memory Importance Scoring | Automatic scoring of memory importance for retention | `MemoryLifecycleManager.ts` enhancement |

### 4.2 Configuration Missing Features

| Feature | Description |
|---------|-------------|
| `AgencyMemoryConfig` | Configuration for agency-level shared RAG |
| `conversationMemoryConfig.autoIngestAfterTurns` | Auto-ingest conversation after N turns |
| `conversationMemoryConfig.retentionPolicy` | How long to keep in working memory vs RAG |
| `ragConfig.agencyScope` | Scope RAG queries to agency context |

---

## 5. Test Coverage Analysis

### 5.1 Current Test Coverage

| Area | Tests Exist | Location |
|------|-------------|----------|
| AgencyRegistry | ✅ | `tests/core/AgencyRegistry.spec.ts` |
| PersonaValidation | ✅ | `tests/cognitive_substrate/PersonaValidation*.spec.ts` |
| PersonaOverlayManager | ✅ | `tests/cognitive_substrate/PersonaOverlayManager.spec.ts` |
| PromptEngine | ✅ | `tests/core/prompt/*.spec.ts` |
| WorkflowRuntime | ✅ | `tests/core/workflows/*.spec.ts` |
| StreamingManager | ✅ | `tests/core/streamingManager.spec.ts` |
| Guardrails | ✅ | `tests/core/guardrails.integration.spec.ts` |
| **RAG Components** | ❌ | **MISSING** |
| **GMI RAG Integration** | ❌ | **MISSING** |
| **Memory Lifecycle** | ❌ | **MISSING** |
| **SqlVectorStore** | ❌ | **MISSING** |

### 5.2 Required Tests

#### Unit Tests (to create)

```
packages/agentos/tests/
├── rag/
│   ├── VectorStoreManager.spec.ts        # Vector store manager lifecycle
│   ├── EmbeddingManager.spec.ts          # Embedding generation
│   ├── RetrievalAugmentor.spec.ts        # Core RAG orchestration
│   ├── SqlVectorStore.spec.ts            # SQL vector store operations
│   ├── InMemoryVectorStore.spec.ts       # In-memory vector store
│   └── DocumentChunking.spec.ts          # Chunking utilities
├── memory_lifecycle/
│   ├── MemoryLifecycleManager.spec.ts    # Policy enforcement
│   └── GMINegotiation.spec.ts            # GMI negotiation flows
└── cognitive_substrate/
    └── GMI.rag.spec.ts                   # GMI RAG integration
```

#### Integration Tests (to create)

```
packages/agentos/tests/integration/
├── rag.gmi.integration.spec.ts           # GMI + RAG end-to-end
├── rag.agency.integration.spec.ts        # Agency + shared RAG memory
├── memory.lifecycle.integration.spec.ts  # Memory lifecycle with GMI negotiation
└── conversation.rag.bridge.spec.ts       # Conversation → RAG pipeline
```

#### E2E Tests (to create)

```
packages/agentos/tests/e2e/
├── rag.conversation.e2e.spec.ts          # Full conversation with RAG
├── agency.collaboration.e2e.spec.ts      # Multi-GMI collaboration with shared memory
└── memory.retention.e2e.spec.ts          # Long-term memory retention flows
```

---

## 6. Documentation Updates Required

### 6.1 Architecture Documentation

| Document | Updates Needed |
|----------|---------------|
| `docs/ARCHITECTURE.md` | Add RAG memory section, update data flow diagrams |
| `docs/COST_OPTIMIZATION.md` | ✅ Already includes RAG optimization |
| `README.md` | Add RAG configuration quick start |

### 6.2 New Documentation to Create

| Document | Purpose |
|----------|---------|
| `docs/RAG_MEMORY_CONFIGURATION.md` | Complete guide to configuring RAG memory |
| `docs/AGENCY_COLLABORATION.md` | How agencies share memory and collaborate |
| `docs/MEMORY_LIFECYCLE.md` | Memory retention, eviction, and GMI negotiation |
| `docs/CONVERSATION_TO_RAG.md` | Pipeline for converting conversations to RAG |

---

## 7. Implementation Plan

### Phase 1: Core RAG Tests (Week 1)
1. Create unit tests for VectorStoreManager
2. Create unit tests for EmbeddingManager
3. Create unit tests for RetrievalAugmentor
4. Create unit tests for SqlVectorStore
5. Create GMI RAG integration tests

### Phase 2: Agency Memory (Week 2)
1. Design `AgencyMemoryConfig` interface
2. Extend `AgencySession` with memory configuration
3. Implement `AgencyMemoryManager`
4. Create agency memory integration tests
5. Update documentation

### Phase 3: Conversation → RAG Bridge (Week 3)
1. Design conversation persistence triggers
2. Implement `ConversationRAGBridge`
3. Add automatic ingestion configuration
4. Create E2E tests
5. Update ARCHITECTURE.md

### Phase 4: Memory Lifecycle Enhancement (Week 4)
1. Add importance scoring to MemoryLifecycleManager
2. Implement cross-GMI memory sharing
3. Add agency-level memory policies
4. Create E2E memory lifecycle tests
5. Create MEMORY_LIFECYCLE.md documentation

---

## 8. API Hooks Summary

### 8.1 Current Hooks (in GMI)

| Hook | Location | Trigger |
|------|----------|---------|
| `shouldTriggerRAGRetrieval()` | GMI.ts:479 | Before each LLM call |
| `performPostTurnIngestion()` | GMI.ts:850 | After LLM response |
| `onMemoryLifecycleEvent()` | GMI.ts:1090 | Memory eviction/archival |

### 8.2 Proposed Additional Hooks

| Hook | Purpose | Location |
|------|---------|----------|
| `onAgencyMemoryUpdate()` | Notify GMIs of shared memory changes | `GMI.ts` |
| `onConversationArchive()` | When conversation moves to RAG | `GMI.ts` |
| `getMemoryImportanceScore()` | GMI rates memory importance | `GMI.ts` |
| `onCrossGMIContextRequest()` | Another GMI requests context | `GMI.ts` |

---

## 9. Conclusion

The AgentOS RAG memory system has **solid foundations** with complete implementations of vector stores, embedding management, and retrieval augmentation. However, several gaps exist:

1. **Configuration is not default** - RAG must be explicitly enabled per persona
2. **No agency-level memory** - Agencies can't share RAG memory
3. **Limited test coverage** - RAG components lack unit and integration tests
4. **Documentation gaps** - No dedicated RAG configuration guide

The recommended priority is:
1. **Create comprehensive tests** (ensures stability)
2. **Add agency shared memory** (enables collaboration)
3. **Implement conversation → RAG bridge** (enables long-term memory)
4. **Complete documentation** (enables adoption)

---

*Document created: 2025-12-04*
*AgentOS Version: 0.x.x (pre-release)*

