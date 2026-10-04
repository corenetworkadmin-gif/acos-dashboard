export interface Operation {
  id: string
  timestamp: number
  companionId: string
  capability: string
  action: string
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
    | 'RECOVERY_REQUIRED'
  authorizationResult: 'PENDING' | 'APPROVED' | 'DENIED'
  securityState: 'NORMAL' | 'RESTRICTED' | 'ISOLATED' | 'RECOVERY' | 'ADMINISTRATIVE_CONTROL' | 'EMERGENCY_ISOLATION'
  auditEvents: AuditEvent[]
}

export interface AuditEvent {
  timestamp: number
  type: 
    | 'AUTHORIZATION'
    | 'RESOURCE'
    | 'EXECUTION'
    | 'COMPLETION'
    | 'STATE_CHANGE'
    | 'NETWORK'
    | 'DEVICE'
    | 'CREDENTIAL'
  description: string
  data?: Record<string, any>
}

export interface Capability {
  id: string
  name: string
  description: string
  provider: string
  version: string
  supportedOperations: string[]
  resourceRequirements: {
    cpu: number
    memory: number
    gpu?: number
  }
  securityClassification: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED'
  availability: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE'
  administratorConfigured: boolean
  authorized: boolean
}

export interface Provider {
  id: string
  name: string
  type: 'BUILTIN' | 'EXTERNAL'
  implementations: {
    id: string
    name: string
    version: string
    supportedOperations: string[]
    resourceRequirements: {
      cpu: number
      memory: number
      gpu?: number
    }
    availability: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE'
  }[]
}

export interface Resource {
  id: string
  type: 'CPU' | 'MEMORY' | 'GPU' | 'NETWORK' | 'STORAGE'
  total: number
  allocated: number
  available: number
  ownerOperationId: string | null
}

export interface LocalAIEngine {
  status: 
    | 'DISCOVER'
    | 'VALIDATE'
    | 'REGISTER'
    | 'LOAD'
    | 'HEALTH_CHECK'
    | 'READY'
    | 'INFER'
    | 'QUIESCE'
    | 'STOP'
    | 'RECOVER'
    | 'UNLOAD'
  model: string
  tokenizerCompatible: boolean
  contextWindow: {
    used: number
    total: number
  }
  resourceUsage: {
    cpu: number
    memory: number
    gpu: number
  }
  acceleratorUtilization: {
    cpu: boolean
    gpu: boolean
    npu: boolean
  }
  health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN'
}

export interface CompanionState {
  id: string
  name: string
  persistentStateSize: number // bytes
  homePath: string
  activeCapabilities: string[]
  scheduledOperations: {
    id: string
    capability: string
    action: string
    trigger: 'TIME' | 'EVENT'
    schedule: string
    lastRun: number | null
    nextRun: number | null
  }[]
  extensionState: {
    id: string
    name: string
    version: string
    capabilities: string[]
    status: 'LOADED' | 'FAILED' | 'UNLOADED'
    resourceRequirements: {
      cpu: number
      memory: number
    }
  }[]
}

export interface AdminInterlockState {
  engaged: boolean
  companionPaused: boolean
  networkIsolated: boolean
  uiAccessible: boolean
  adminActivity: {
    timestamp: number
    action: string
    status: 'COMPLETED' | 'FAILED' | 'PENDING' | 'IN_PROGRESS'
    details: string
  }[]
}

export interface CompanionImportRequest {
  companionId: string
  relocationPackage: {
    companionInfo: {
      id: string
      name: string
      version: string
    }
    stateInfo: {
      size: number // bytes
      version: string
    }
    capabilities: {
      id: string
      name: string
      description: string
    }[]
    dependencies: string[]
    environmentRequirements: Record<string, any>
  }
}

export interface ImportResult {
  importId: string
  companionId: string
  timestamp: number
  status: 
    | 'FULLY_RECONSTRUCTED'
    | 'PARTIALLY_RECONSTRUCTED'
    | 'RECONSTRUCTED_WITH_SUBSTITUTIONS'
    | 'RECONSTRUCTED_WITH_UNRESOLVED_DEPENDENCIES'
    | 'IMPORT_FAILED'
  details: {
    identityVerified: boolean
    stateIntegrity: boolean
    dependenciesResolved: boolean
    capabilitiesReconciled: boolean
    unresolvedDependencies: string[]
    prohibitedAuthorityRequests: string[]
    warnings: string[]
  }
  continuousStatus: string
}