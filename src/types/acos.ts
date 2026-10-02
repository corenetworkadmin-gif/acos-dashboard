export interface Operation {
  id: string;
  timestamp: number;
  companionId: string;
  capability: string;
  action: string;
  target?: string;
  resourceRequirements?: {
    cpu?: number;
    memory?: number;
    gpu?: number;
    network?: boolean;
  };
  credentialReferences?: string[];
  lifecycleState: 
    | 'REQUESTED'
    | 'VALIDATING'
    | 'AUTHORIZED'
    | 'ADMITTED'
    | 'RESERVING_RESOURCES'
    | 'RUNNING'
    | 'COMPLETING'
    | 'COMPLETED'
    | 'WAITING_FOR_AUTHORIZATION'
    | 'DENIED'
    | 'CANCELLED'
    | 'TIMEOUT'
    | 'FAILED'
    | 'ABORTED'
    | 'RECOVERY_REQUIRED';
  authorizationResult: 'PENDING' | 'APPROVED' | 'DENIED';
  securityState: 'NORMAL' | 'RESTRICTED' | 'ISOLATED' | 'RECOVERY' | 'ADMINISTRATIVE_CONTROL' | 'EMERGENCY_ISOLATION';
  auditEvents: AuditEvent[];
}

export interface AuditEvent {
  timestamp: number;
  type: 'AUTHORIZATION' | 'RESOURCE' | 'EXECUTION' | 'NETWORK' | 'COMPLETION' | 'STATE_CHANGE';
  description: string;
  data?: Record<string, any>;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  provider: string;
  version: string;
  supportedOperations: string[];
  resourceRequirements: {
    cpu?: number;
    memory?: number;
    gpu?: number;
  };
  securityClassification: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
  availability: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
  administratorConfigured: boolean;
  authorized: boolean;
}

export interface Provider {
  id: string;
  name: string;
  type: 'BUILTIN' | 'EXTENSION' | 'REMOTE';
  implementations: Implementation[];
}

export interface Implementation {
  id: string;
  name: string;
  version: string;
  supportedOperations: string[];
  resourceRequirements: {
    cpu?: number;
    memory?: number;
    gpu?: number;
  };
  availability: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
}

export interface Resource {
  id: string;
  type: 'CPU' | 'MEMORY' | 'GPU' | 'NETWORK' | 'STORAGE' | 'DEVICE';
  total: number;
  allocated: number;
  available: number;
  ownerOperationId?: string;
}

export interface LocalAIEngine {
  status: 'DISCOVER' | 'VALIDATE' | 'REGISTER' | 'LOAD' | 'HEALTH_CHECK' | 'READY' | 'INFER' | 'QUIESCE' | 'STOP' | 'RECOVER' | 'UNLOAD';
  model: string | null;
  tokenizerCompatible: boolean;
  contextWindow: {
    used: number;
    total: number;
  };
  resourceUsage: {
    cpu: number;
    memory: number;
    gpu: number;
  };
  acceleratorUtilization: {
    cpu: boolean;
    gpu: boolean;
    npu: boolean;
  };
  health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
}

export interface CompanionState {
  id: string;
  name: string;
  persistentStateSize: number; // in bytes
  homePath: string;
  activeCapabilities: string[];
  scheduledOperations: ScheduledOperation[];
  extensionState: ExtensionState[];
}

export interface ScheduledOperation {
  id: string;
  capability: string;
  action: string;
  trigger: 'TIME' | 'EVENT' | 'MANUAL';
  schedule: string; // cron or event description
  lastRun: number | null;
  nextRun: number | null;
}

export interface ExtensionState {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  status: 'LOADED' | 'ACTIVE' | 'INACTIVE' | 'ERROR';
  resourceRequirements: {
    cpu: number;
    memory: number;
  };
}

export interface AdminInterlockState {
  engaged: boolean;
  companionPaused: boolean;
  networkIsolated: boolean;
  uiAccessible: boolean;
  adminActivity: AdminActivity[];
}

export interface AdminActivity {
  timestamp: number;
  action: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  details?: string;
}