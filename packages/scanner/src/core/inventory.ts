/**
 * Common component model. Both adapters (repo, org) normalize to
 * this shape; everything downstream (tiering, score, reporters) consumes it.
 */

export type ComponentType =
  | 'ApexClass'
  | 'ApexTrigger'
  | 'Flow'
  | 'LWC'
  | 'Aura'
  | 'VisualforcePage'
  | 'VisualforceComponent'
  | 'ProjectDefault'
  | 'Manifest';

export type VersionSource = 'explicit' | 'inherited';

export interface InventoryItem {
  id: string;
  type: ComponentType;
  /** Metadata API/developer name, e.g. "AccountTrigger" or "Order_Fulfillment". */
  name?: string;
  /** "55.0" — null only when undeterminable; a warning explains why. */
  apiVersion: string | null;
  versionSource: VersionSource;
  /** Repo mode: path relative to scan root. Org mode: record id. */
  location: string;
  raw?: unknown;
}

export interface ScanWarning {
  code: string;
  message: string;
  location?: string;
}

export interface IntegrationFinding {
  type: 'api-usage' | 'soap-login';
  clientName: string;
  apiFamily: string;
  apiVersion: string;
  requestCount?: number;
}

export interface Inventory {
  items: InventoryItem[];
  integrations: IntegrationFinding[];
  warnings: ScanWarning[];
  /**
   * Org scans only: the API version reported by the org's sf session.
   * Tiering uses this as `currentApiVersion` instead of the schedule constant,
   * so a sandbox on a preview release tiers against the preview, not the GA constant.
   */
  resolvedApiVersion?: string;
  /**
   * Org scans only: `Organization.IsSandbox` queried during the scan.
   * `false` means the connected org is production — persisting deploys are blocked.
   * Absent when the org did not return this field or the query was denied.
   */
  isSandbox?: boolean;
}
