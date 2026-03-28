/**
 * Minimal UI component spec placeholder. Concrete UI frameworks can extend this
 * interface to render tool/agent output in custom shells.
 */
export interface UIComponentSpecification {
  id: string;
  type: string;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
