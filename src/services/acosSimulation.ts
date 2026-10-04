import { 
  Operation, 
  Capability, 
  Provider, 
  Resource, 
  LocalAIEngine, 
  CompanionState,
  AdminInterlockState,
  AuditEvent,
  CompanionImportRequest,
  ImportResult
} from '../types/acos'

// Base URL for API - in development, this would be the same origin
const API_BASE = '/api'

// Helper function to make API requests
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    })
    
    const result = await response.json()
    
    if (!response.ok) {
      return { success: false, error: result.error || 'Request failed' }
    }
    
    return { success: true, data: result.data }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Service functions - now making actual API calls
export const acosSimulationService = {
  // Capabilities
  getCapabilities: async () => {
    const result = await apiRequest<Capability[]>('/capabilities.get')
    return result.success ? result.data || [] : []
  },
  
  getCapabilityById: async (id: string) => {
    const capabilities = await acosSimulationService.getCapabilities()
    return capabilities.find(c => c.id === id) || null
  },
  
  updateCapabilityAuthorization: async (id: string, authorized: boolean) => {
    // In a real implementation, this would be a PUT/PATCH endpoint
    // For now, we'll simulate by getting all capabilities, updating one, and returning it
    const capabilities = await acosSimulationService.getCapabilities()
    const index = capabilities.findIndex(c => c.id === id)
    if (index !== -1) {
      capabilities[index] = { ...capabilities[index], authorized }
      // In real system, this would persist to database and return updated capability
      return capabilities[index]
    }
    return null
  },
  
  // Providers
  getProviders: async () => {
    const result = await apiRequest<Provider[]>('/providers.get')
    return result.success ? result.data || [] : []
  },
  
  // Resources
  getResources: async () => {
    const result = await apiRequest<Resource[]>('/resources.get')
    return result.success ? result.data || [] : []
  },
  
  // Operations
  getOperations: async () => {
    const result = await apiRequest<Operation[]>('/operations.get')
    return result.success ? result.data || [] : []
  },
  
  getOperationById: async (id: string) => {
    const operations = await acosSimulationService.getOperations()
    return operations.find(o => o.id === id) || null
  },
  
  // Create a new operation
  createOperation: async (capabilityName: string, action: string): Promise<Operation> => {
    // First check if capability is authorized
    const capability = await acosSimulationService.getCapabilityById(capabilityName)
    if (!capability) {
      throw new Error(`Capability not found: ${capabilityName}`)
    }
    
    if (!capability.authorized) {
      throw new Error(`Capability not authorized: ${capabilityName}`)
    }
    
    // In a real implementation, this would POST to /operations
    // For now, we'll simulate by creating a basic operation object
    const newOperation: Operation = {
      id: `op-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`,
      timestamp: Date.now(),
      companionId: 'comp-001', // This would come from auth/context in real system
      capability: capabilityName,
      action,
      lifecycleState: 'REQUESTED',
      authorizationResult: 'PENDING',
      securityState: 'NORMAL',
      auditEvents: []
    }
    
    // Simulate the operation lifecycle (simplified)
    const lifecycleStates = [
      'REQUESTED',
      'VALIDATING',
      'AUTHORIZED',
      'ADMITTED',
      'RESERVING_RESOURCES',
      'RUNNING',
      'COMPLETING',
      'COMPLETED'
    ] as const
    
    let currentOp = { ...newOperation }
    for (let i = 0; i < lifecycleStates.length; i++) {
      const state = lifecycleStates[i]
      currentOp = {
        ...currentOp,
        lifecycleState: state,
        auditEvents: [
          ...currentOp.auditEvents,
          {
            timestamp: Date.now() + i * 100,
            type: i === 0 ? 'AUTHORIZATION' : 
                   i === lifecycleStates.length - 1 ? 'COMPLETION' : 
                   i === lifecycleStates.length - 2 ? 'EXECUTION' : 'STATE_CHANGE',
            description: `Transitioned to ${state} state`,
            data: { previousState: i > 0 ? lifecycleStates[i-1] : undefined, newState: state }
          }
        ]
      }
      
      if (state === 'RUNNING') {
        currentOp = {
          ...currentOp,
          auditEvents: [
            ...currentOp.auditEvents,
            {
              timestamp: Date.now() + (i + 0.5) * 100,
              type: 'EXECUTION',
              description: `Executing action: ${action}`,
              data: { capability: capabilityName, action }
            }
          ]
        }
      }
      
      if (state === 'COMPLETED') {
        currentOp = {
          ...currentOp,
          authorizationResult: 'APPROVED',
          auditEvents: [
            ...currentOp.auditEvents,
            {
              timestamp: Date.now() + (i + 1) * 100,
              type: 'COMPLETION',
              description: 'Operation completed successfully',
              data: { result: `Successfully executed ${action}` }
            }
          ]
        }
      }
    }
    
    return currentOp
  },
  
  // Local AI Engine
  getLocalAIEngine: async () => {
    // In a real implementation, this would GET from /local-ai-engine
    // For now, return mock data
    return {
      status: 'READY',
      model: 'llama-3.2-3b-instruct',
      tokenizerCompatible: true,
      contextWindow: { used: 1024, total: 4096 },
      resourceUsage: { cpu: 25, memory: 40, gpu: 0 },
      acceleratorUtilization: { cpu: true, gpu: false, npu: false },
      health: 'HEALTHY'
    }
  },
  
  updateLocalAIEngineStatus: async (status: LocalAIEngine['status']) => {
    // In real implementation, this would PUT/PATCH to /local-ai-engine/status
    const engine = await acosSimulationService.getLocalAIEngine()
    return { ...engine, status }
  },
  
  updateLocalAIEngineModel: async (model: string) => {
    const engine = await acosSimulationService.getLocalAIEngine()
    return { ...engine, model }
  },
  
  updateLocalAIEngineUsage: async (usage: Partial<LocalAIEngine['resourceUsage']>) => {
    const engine = await acosSimulationService.getLocalAIEngine()
    return {
      ...engine,
      resourceUsage: {
        ...engine.resourceUsage,
        ...usage
      }
    }
  },
  
  updateLocalAIEngineContext: async (used: number) => {
    const engine = await acosSimulationService.getLocalAIEngine()
    return {
      ...engine,
      contextWindow: {
        ...engine.contextWindow,
        used: Math.min(used, engine.contextWindow.total)
      }
    }
  },
  
  // Companion State
  getCompanionState: async () => {
    // In real implementation, this would GET from /companion-state
    return {
      id: 'comp-001',
      name: 'ACOS Companion Alpha',
      persistentStateSize: 1024 * 1024 * 50, // 50 MB
      homePath: '/acos/companion/home/comp-001',
      activeCapabilities: ['chat.send', 'file.read', 'network.request', 'system.update', 'memory.allocate'],
      scheduledOperations: [],
      extensionState: []
    }
  },
  
  // Admin Interlock
  getAdminInterlock: async () => {
    // In real implementation, this would GET from /admin-interlock
    return {
      engaged: false,
      companionPaused: false,
      networkIsolated: false,
      uiAccessible: true,
      adminActivity: [
        {
          timestamp: Date.now() - 30 * 60 * 1000,
          action: 'Admin panel opened',
          status: 'COMPLETED',
          details: 'Administrator accessed ACOS dashboard'
        },
        {
          timestamp: Date.now() - 25 * 60 * 1000,
          action: 'Capability modified: file.write',
          status: 'COMPLETED',
          details: 'Disabled file.write capability for security'
        }
      ]
    }
  },
  
  setAdminInterlockEngaged: async (engaged: boolean) => {
    // In real implementation, this would POST to /admin-interlock/engage
    const interlock = await acosSimulationService.getAdminInterlock()
    return {
      ...interlock,
      engaged,
      companionPaused: engaged,
      networkIsolated: engaged,
      uiAccessible: !engaged
    }
  },
  
  // Get recent admin activity
  getAdminActivity: async () => {
    const interlock = await acosSimulationService.getAdminInterlock()
    return interlock.adminActivity
  },
  
  // Companion Import/Relocation - NEW FUNCTIONALITY
  importCompanion: async (importRequest: CompanionImportRequest): Promise<ImportResult> => {
    const result = await apiRequest<ImportResult>('/companion.post', {
      method: 'POST',
      body: JSON.stringify(importRequest)
    })
    
    if (result.success) {
      return result.data || {
        importId: 'error-import-id',
        companionId: importRequest.companionId,
        timestamp: Date.now(),
        status: 'IMPORT_FAILED',
        details: {
          identityVerified: false,
          stateIntegrity: false,
          dependenciesResolved: false,
          capabilitiesReconciled: false,
          unresolvedDependencies: ['Import service unavailable'],
          prohibitedAuthorityRequests: [],
          warnings: ['Failed to connect to import service']
        },
        continuousStatus: 'IMPORT_FAILED'
      }
    }
    
    // Return fallback if API fails
    return {
      importId: `import-${Math.random().toString(36).substr(2, 9)}`,
      companionId: importRequest.companionId,
      timestamp: Date.now(),
      status: 'RECONSTRUCTED_WITH_SUBSTITUTIONS',
      details: {
        identityVerified: true,
        stateIntegrity: true,
        dependenciesResolved: true,
        capabilitiesReconciled: true,
        unresolvedDependencies: [],
        prohibitedAuthorityRequests: [],
        warnings: ['Using simulated import - backend unavailable']
      },
      continuousStatus: 'RECONSTRUCTED_WITH_SUBSTITUTIONS'
    }
  }
}