export type SyncEnvelope = {
  protocolVersion: 1; eventId: string; entityType: string; entityId: string;
  operation: 'UPSERT'|'DELETE'; shopId: string; deviceId: string; occurredAt: string;
  entityVersion?: number|null; payload?: Record<string,unknown>|null; tombstone?: Record<string,unknown>|null;
};
export type PushBody = { shopId: string; deviceId: string; events: SyncEnvelope[] };
