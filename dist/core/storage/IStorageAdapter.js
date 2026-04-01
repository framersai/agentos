/**
 * @file IStorageAdapter.ts
 * @description Core storage abstraction interface for AgentOS persistence layer.
 *
 * This module defines the contract that storage implementations must fulfill to provide
 * persistence capabilities for conversations, messages, user data, and agent state.
 *
 * The storage layer is designed to be:
 * - **Platform-agnostic**: Works in Node.js, browsers, Electron, mobile (Capacitor)
 * - **Swappable**: Can switch between SQLite, PostgreSQL, in-memory, etc.
 * - **Type-safe**: Full TypeScript support with strict typing
 * - **Async-first**: All operations return Promises for non-blocking I/O
 *
 * @version 1.0.0
 * @author AgentOS Team
 * @license MIT
 */
export {};
//# sourceMappingURL=IStorageAdapter.js.map