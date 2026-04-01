/**
 * High-level lifecycle states for a workflow instance.
 */
export var WorkflowStatus;
(function (WorkflowStatus) {
    WorkflowStatus["PENDING"] = "pending";
    WorkflowStatus["RUNNING"] = "running";
    WorkflowStatus["AWAITING_INPUT"] = "awaiting_input";
    WorkflowStatus["ERRORED"] = "errored";
    WorkflowStatus["COMPLETED"] = "completed";
    WorkflowStatus["CANCELLED"] = "cancelled";
})(WorkflowStatus || (WorkflowStatus = {}));
/**
 * Lifecycle states for a task within a workflow.
 */
export var WorkflowTaskStatus;
(function (WorkflowTaskStatus) {
    WorkflowTaskStatus["PENDING"] = "pending";
    WorkflowTaskStatus["READY"] = "ready";
    WorkflowTaskStatus["IN_PROGRESS"] = "in_progress";
    WorkflowTaskStatus["BLOCKED"] = "blocked";
    WorkflowTaskStatus["COMPLETED"] = "completed";
    WorkflowTaskStatus["SKIPPED"] = "skipped";
    WorkflowTaskStatus["FAILED"] = "failed";
})(WorkflowTaskStatus || (WorkflowTaskStatus = {}));
//# sourceMappingURL=WorkflowTypes.js.map