import { 
  Operation, 
  Capability, 
  Provider, 
  Resource, 
  LocalAIEngine, 
  CompanionState,
  AdminInterlockState,
  AuditEvent
} from '../types/acos';

// Mock data for simulation
const mockCapabilities: Capability[] = [
  {
    id: 'cap-1',
    name: 'chat.send',
    description: 'Send messages to users',
    provider: 'builtin',
    version: '1.0.0',
    supportedOperations: ['sendMessage', 'receiveMessage'],
    resourceRequirements: { cpu: 5, memory: 10 },
    securityClassification: 'PUBLIC',
    availability: 'AVAILABLE',
    administratorConfigured: true,
    authorized: true
  },
  {
    id: 'cap-2',
    name: 'file.read',
    description: 'Read files from companion home',
    provider: 'builtin',
    version: '1.0.0',
    supportedOperations: ['readFile', 'listDirectory'],
    resourceRequirements: { cpu: 2, memory: 5 },
    securityClassification: 'INTERNAL',
    availability: 'AVAILABLE',
    administratorConfigured: true,
    authorized: true
  },
  {
    id: 'cap-3',
    name: 'file.write',
    description: 'Write files to companion home',
    provider: 'builtin',
    version: '1.0.0',
    supportedOperations: ['writeFile', 'deleteFile'],
    resourceRequirements: { cpu: 3, memory: 8 },
    securityClassification: 'INTERNAL',
    availability: 'AVAILABLE',
    administratorConfigured: true,
    authorized: false // Disabled by default
  },
  {
    id: 'cap-4',
    name: 'network.request',
    description: 'Make HTTP requests',
    provider: 'builtin',
    version: '1.0.0',
    supportedOperations: ['httpGet', 'httpPost'],
    resourceRequirements: { cpu: 10, memory: 20, gpu: 0 }, // Changed network to gpu for type compatibility
    securityClassification: 'CONFIDENTIAL',
    availability: 'AVAILABLE',
    administratorConfigured: true,
    authorized: true
  },
  {
    id: 'cap-5',
    name: 'system.update',
    description: 'Check and apply system updates',
    provider: 'builtin',
    version: '1.0.0',
    supportedOperations: ['checkForUpdates', 'applyUpdate'],
    resourceRequirements: { cpu: 15, memory: 50 },
    securityClassification: 'RESTRICTED',
    availability: 'AVAILABLE',
    administratorConfigured: true,
    authorized: true
  },
  {
    id: 'cap-6',
    name: 'memory.allocate',
    description: 'Allocate companion memory',
    provider: 'builtin',
    version: '1.0.0',
    supportedOperations: ['allocateMemory', 'freeMemory'],
    resourceRequirements: { cpu: 1, memory: 2 },
    securityClassification: 'INTERNAL',
    availability: 'AVAILABLE',
    administratorConfigured: true,
    authorized: true
  },
  {
    id: 'cap-7',
    name: 'device.camera',
    description: 'Access camera hardware',
    provider: 'builtin',
    version: '1.0.0',
    supportedOperations: ['captureImage', 'startVideo'],
    resourceRequirements: { cpu: 50, memory: 100 },
    securityClassification: 'RESTRICTED',
    availability: 'AVAILABLE',
    administratorConfigured: true,
    authorized: false // Disabled by default
  },
  {
    id: 'cap-8',
    name: 'device.microphone',
    description: 'Access microphone hardware',
    provider: 'builtin',
    version: '1.0.0',
    supportedOperations: ['captureAudio', 'startStream'],
    resourceRequirements: { cpu: 30, memory: 50 },
    securityClassification: 'RESTRICTED',
    availability: 'AVAILABLE',
    administratorConfigured: true,
    authorized: false // Disabled by default
  }
];

const mockProviders: Provider[] = [
  {
    id: 'prov-1',
    name: 'Built-in ACOS Services',
    type: 'BUILTIN',
    implementations: [
      {
        id: 'impl-1',
        name: 'Basic Communication',
        version: '1.0.0',
        supportedOperations: ['sendMessage', 'receiveMessage'],
        resourceRequirements: { cpu: 5, memory: 10 },
        availability: 'AVAILABLE'
      },
      {
        id: 'impl-2',
        name: 'File System Access',
        version: '1.0.0',
        supportedOperations: ['readFile', 'writeFile', 'listDirectory', 'deleteFile'],
        resourceRequirements: { cpu: 3, memory: 8 },
        availability: 'AVAILABLE'
      }
    ]
  }
];

const mockResources: Resource[] = [
  { id: 'res-1', type: 'CPU', total: 100, allocated: 25, available: 75 },
  { id: 'res-2', type: 'MEMORY', total: 8192, allocated: 2048, available: 6144 }, // MB
  { id: 'res-3', type: 'GPU', total: 100, allocated: 0, available: 100 },
  { id: 'res-4', type: 'NETWORK', total: 1000, allocated: 100, available: 900 }, // Mbps
  { id: 'res-5', type: 'STORAGE', total: 102400, allocated: 5120, available: 97280 } // MB
];

let mockOperations: Operation[] = [];
let mockLocalAIEngine: LocalAIEngine = {
  status: 'READY',
  model: 'llama-3.2-3b-instruct',
  tokenizerCompatible: true,
  contextWindow: { used: 1024, total: 4096 },
  resourceUsage: { cpu: 25, memory: 40, gpu: 0 },
  acceleratorUtilization: { cpu: true, gpu: false, npu: false },
  health: 'HEALTHY'
};

let mockCompanionState: CompanionState = {
  id: 'comp-001',
  name: 'ACOS Companion Alpha',
  persistentStateSize: 1024 * 1024 * 50, // 50 MB
  homePath: '/acos/companion/home',
  activeCapabilities: ['chat.send', 'file.read', 'network.request', 'system.update', 'memory.allocate'],
  scheduledOperations: [
    {
      id: 'sched-001',
      capability: 'system.update',
      action: 'checkForUpdates',
      trigger: 'TIME',
      schedule: '0 */6 * * *', // Every 6 hours
      lastRun: Date.now() - 6 * 60 * 60 * 1000,
      nextRun: Date.now() + 6 * 60 * 60 * 1000
    },
    {
      id: 'sched-002',
      capability: 'memory.allocate',
      action: 'allocateMemory',
      trigger: 'EVENT',
      schedule: 'low_memory',
      lastRun: null,
      nextRun: null
    }
  ],
  extensionState: [
    {
      id: 'ext-001',
      name: 'Skill: Conversation Enhancer',
      version: '1.2.0',
      capabilities: ['chat.send', 'chat.receive'],
      status: 'LOADED',
      resourceRequirements: { cpu: 5, memory: 20 }
    }
  ]
};

let mockAdminInterlock: AdminInterlockState = {
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
};

// Operation lifecycle states in order
const lifecycleStates = [
  'REQUESTED',
  'VALIDATING',
  'AUTHORIZED',
  'ADMITTED',
  'RESERVING_RESOURCES',
  'RUNNING',
  'COMPLETING',
  'COMPLETED'
] as const;

// Generate a mock operation ID
function generateOperationId(): string {
  return `op-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;
}

// Get current timestamp
function getTimestamp(): number {
  return Date.now();
}

// Add an audit event to an operation
function addAuditEvent(operation: Operation, type: AuditEvent['type'], description: string, data?: Record<string, any>): Operation {
  const event: AuditEvent = {
    timestamp: getTimestamp(),
    type,
    description,
    data
  };
  
  return {
    ...operation,
    auditEvents: [...operation.auditEvents, event]
  };
}

// Transition operation to next lifecycle state
function transitionOperationState(operation: Operation): Operation {
  const currentIndex = lifecycleStates.indexOf(operation.lifecycleState);
  if (currentIndex >= 0 && currentIndex < lifecycleStates.length - 1) {
    const nextState = lifecycleStates[currentIndex + 1];
    const updatedOp = {
      ...operation,
      lifecycleState: nextState,
      auditEvents: [...operation.auditEvents, {
        timestamp: getTimestamp(),
        type: 'STATE_CHANGE',
        description: `Transitioned to ${nextState} state`,
        data: { previousState: operation.lifecycleState, newState: nextState }
      }]
    };
    
    // If we just entered RUNNING state, simulate resource allocation
    if (nextState === 'RUNNING') {
      return allocateResourcesForOperation(updatedOp);
    }
    
    // If we just entered COMPLETED state, simulate resource release
    if (nextState === 'COMPLETED') {
      return releaseResourcesFromOperation(updatedOp);
    }
    
    return updatedOp;
  }
  
  return operation; // Already at final state or invalid state
}

// Allocate resources for an operation
function allocateResourcesForOperation(operation: Operation): Operation {
  // Find the capability to get resource requirements
  const capability = mockCapabilities.find(c => c.name === operation.capability);
  if (!capability) return operation;
  
  // Simplified resource allocation - in reality this would be more complex
  const updatedResources = mockResources.map(resource => {
    let allocated = resource.allocated;
    
    if (resource.type === 'CPU' && capability.resourceRequirements?.cpu) {
      allocated += capability.resourceRequirements.cpu;
    } else if (resource.type === 'MEMORY' && capability.resourceRequirements?.memory) {
      allocated += capability.resourceRequirements.memory;
    } else if (resource.type === 'GPU' && capability.resourceRequirements?.gpu) {
      allocated += capability.resourceRequirements.gpu;
    }
    
    // Ensure we don't exceed total
    allocated = Math.min(allocated, resource.total);
    
    return {
      ...resource,
      allocated,
      available: resource.total - allocated,
      ownerOperationId: allocated > resource.allocated ? operation.id : resource.ownerOperationId
    };
  });
  
  // Update global resources (in a real app, this would be state management)
  // For simulation, we'll just return the operation with updated audit
  const updatedOp = addAuditEvent(operation, 'RESOURCE', 'Resources allocated for operation', {
    cpu: capability.resourceRequirements?.cpu || 0,
    memory: capability.resourceRequirements?.memory || 0,
    gpu: capability.resourceRequirements?.gpu || 0
  });
  
  return updatedOp;
}

// Release resources from an operation
function releaseResourcesFromOperation(operation: Operation): Operation {
  // Find the capability to get resource requirements
  const capability = mockCapabilities.find(c => c.name === operation.capability);
  if (!capability) return operation;
  
  // Simplified resource release
  const updatedResources = mockResources.map(resource => {
    let allocated = resource.allocated;
    
    if (resource.type === 'CPU' && capability.resourceRequirements?.cpu) {
      allocated -= capability.resourceRequirements.cpu;
    } else if (resource.type === 'MEMORY' && capability.resourceRequirements?.memory) {
      allocated -= capability.resourceRequirements.memory;
    } else if (resource.type === 'GPU' && capability.resourceRequirements?.gpu) {
      allocated -= capability.resourceRequirements.gpu;
    }
    
    // Ensure we don't go below 0
    allocated = Math.max(0, allocated);
    
    return {
      ...resource,
      allocated,
      available: resource.total - allocated,
      ownerOperationId: allocated < resource.allocated ? null : resource.ownerOperationId
    };
  });
  
  // Update global resources
  // For simulation, we'll just return the operation with updated audit
  const updatedOp = addAuditEvent(operation, 'RESOURCE', 'Resources released from operation', {
    cpu: -(capability.resourceRequirements?.cpu || 0),
    memory: -(capability.resourceRequirements?.memory || 0),
    gpu: -(capability.resourceRequirements?.gpu || 0)
  });
  
  return updatedOp;
}

// Initialize with some mock operations
function initializeMockOperations() {
  const now = Date.now();
  
  mockOperations = [
    {
      id: generateOperationId(),
      timestamp: now - 5 * 60 * 1000,
      companionId: mockCompanionState.id,
      capability: 'chat.send',
      action: 'Send message: "Hello, how can I help you?"',
      lifecycleState: 'COMPLETED',
      authorizationResult: 'APPROVED',
      securityState: 'NORMAL',
      auditEvents: [
        {
          timestamp: now - 5 * 60 * 1000 - 1000,
          type: 'AUTHORIZATION',
          description: 'Operation authorized by administrator policy',
          data: { capability: 'chat.send', action: 'sendMessage' }
        },
        {
          timestamp: now - 5 * 60 * 1000 - 500,
          type: 'RESOURCE',
          description: 'Resources reserved: CPU 5%, Memory 10MB',
          data: { cpu: 5, memory: 10 }
        },
        {
          timestamp: now - 5 * 60 * 1000,
          type: 'EXECUTION',
          description: 'Message sent to user interface',
          data: { messageLength: 28 }
        },
        {
          timestamp: now - 5 * 60 * 1000 + 500,
          type: 'COMPLETION',
          description: 'Operation completed successfully',
          data: { result: 'Message delivered' }
        }
      ]
    },
    {
      id: generateOperationId(),
      timestamp: now - 12 * 60 * 1000,
      companionId: mockCompanionState.id,
      capability: 'file.read',
      action: 'Read configuration file: /acos/config/system.json',
      lifecycleState: 'COMPLETED',
      authorizationResult: 'APPROVED',
      securityState: 'NORMAL',
      auditEvents: [
        {
          timestamp: now - 12 * 60 * 1000 - 1000,
          type: 'AUTHORIZATION',
          description: 'Operation authorized by administrator policy',
          data: { capability: 'file.read', action: 'readFile' }
        },
        {
          timestamp: now - 12 * 60 * 1000 - 500,
          type: 'RESOURCE',
          description: 'Resources reserved: CPU 2%, Memory 5MB',
          data: { cpu: 2, memory: 5 }
        },
        {
          timestamp: now - 12 * 60 * 1000,
          type: 'EXECUTION',
          description: 'File read successfully',
          data: { fileSize: 2048, path: '/acos/config/system.json' }
        },
        {
          timestamp: now - 12 * 60 * 1000 + 500,
          type: 'COMPLETION',
          description: 'Operation completed successfully',
          data: { result: 'Configuration loaded' }
        }
      ]
    }
  ];
}

// Initialize on load
initializeMockOperations();

// Service functions
export const acosSimulationService = {
  // Capabilities
  getCapabilities: () => [...mockCapabilities],
  getCapabilityById: (id: string) => mockCapabilities.find(c => c.id === id),
  updateCapabilityAuthorization: (id: string, authorized: boolean) => {
    const capabilityIndex = mockCapabilities.findIndex(c => c.id === id);
    if (capabilityIndex !== -1) {
      mockCapabilities[capabilityIndex] = {
        ...mockCapabilities[capabilityIndex],
        authorized
      };
      
      // Add audit event for admin activity
      mockAdminInterlock.adminActivity = [
        ...mockAdminInterlock.adminActivity,
        {
          timestamp: Date.now(),
          action: `Capability ${authorized ? 'enabled' : 'disabled'}: ${mockCapabilities[capabilityIndex].name}`,
          status: 'COMPLETED',
          details: `Administrator changed authorization status`
        }
      ].slice(-10); // Keep last 10 activities
    }
    
    return mockCapabilities.find(c => c.id === id);
  },
  
  // Providers
  getProviders: () => [...mockProviders],
  
  // Resources
  getResources: () => [...mockResources],
  
  // Operations
  getOperations: () => [...mockOperations].sort((a, b) => b.timestamp - a.timestamp),
  getOperationById: (id: string) => mockOperations.find(o => o.id === id),
  
  // Create a new operation
  createOperation: (capabilityName: string, action: string): Operation => {
    const capability = mockCapabilities.find(c => c.name === capabilityName);
    if (!capability) {
      throw new Error(`Capability not found: ${capabilityName}`);
    }
    
    // Check if capability is authorized
    if (!capability.authorized) {
      throw new Error(`Capability not authorized: ${capabilityName}`);
    }
    
    const newOperation: Operation = {
      id: generateOperationId(),
      timestamp: getTimestamp(),
      companionId: mockCompanionState.id,
      capability: capabilityName,
      action,
      lifecycleState: 'REQUESTED',
      authorizationResult: 'PENDING',
      securityState: 'NORMAL',
      auditEvents: []
    };
    
    // Simulate the operation lifecycle
    let processedOperation = addAuditEvent(newOperation, 'AUTHORIZATION', 'Operation submitted for authorization', {
      capability: capabilityName,
      action
    });
    
    // Auto-authorize for built-in capabilities (in real system, this would go through policy engine)
    processedOperation = {
      ...processedOperation,
      authorizationResult: 'APPROVED',
      auditEvents: [...processedOperation.auditEvents, {
        timestamp: getTimestamp(),
        type: 'AUTHORIZATION',
        description: 'Operation authorized by built-in policy',
        data: { capability: capabilityName, action }
      }]
    };
    
    // Transition through lifecycle states
    let currentOp = processedOperation;
    while (currentOp.lifecycleState !== 'COMPLETED') {
      currentOp = transitionOperationState(currentOp);
      
      // Add execution event when we reach RUNNING state
      if (currentOp.lifecycleState === 'RUNNING') {
        currentOp = addAuditEvent(currentOp, 'EXECUTION', `Executing action: ${action}`, {
          capability: capabilityName,
          action
        });
      }
    }
    
    // Add completion event
    const completedOp = addAuditEvent(currentOp, 'COMPLETION', 'Operation completed successfully', {
      capability: capabilityName,
      action,
      result: `Successfully executed ${action}`
    });
    
    // Add to operations list
    mockOperations = [completedOp, ...mockOperations];
    
    return completedOp;
  },
  
  // Local AI Engine
  getLocalAIEngine: () => ({ ...mockLocalAIEngine }),
  updateLocalAIEngineStatus: (status: LocalAIEngine['status']) => {
    mockLocalAIEngine = {
      ...mockLocalAIEngine,
      status
    };
    return mockLocalAIEngine;
  },
  updateLocalAIEngineModel: (model: string) => {
    mockLocalAIEngine = {
      ...mockLocalAIEngine,
      model
    };
    return mockLocalAIEngine;
  },
  updateLocalAIEngineUsage: (usage: Partial<LocalAIEngine['resourceUsage']>) => {
    mockLocalAIEngine = {
      ...mockLocalAIEngine,
      resourceUsage: {
        ...mockLocalAIEngine.resourceUsage,
        ...usage
      }
    };
    return mockLocalAIEngine;
  },
  updateLocalAIEngineContext: (used: number) => {
    mockLocalAIEngine = {
      ...mockLocalAIEngine,
      contextWindow: {
        ...mockLocalAIEngine.contextWindow,
        used: Math.min(used, mockLocalAIEngine.contextWindow.total)
      }
    };
    return mockLocalAIEngine;
  },
  
  // Companion State
  getCompanionState: () => ({ ...mockCompanionState }),
  
  // Admin Interlock
  getAdminInterlock: () => ({ ...mockAdminInterlock }),
  setAdminInterlockEngaged: (engaged: boolean) => {
    mockAdminInterlock = {
      ...mockAdminInterlock,
      engaged,
      companionPaused: engaged, // When engaged, companion is paused
      networkIsolated: engaged, // When engaged, network is isolated
      uiAccessible: !engaged // When engaged, admin UI is accessible but companion UI is not
    };
    
    // Add admin activity
    mockAdminInterlock.adminActivity = [
      ...mockAdminInterlock.adminActivity,
      {
        timestamp: Date.now(),
        action: engaged ? 'Admin control interlock engaged' : 'Admin control interlock disengaged',
        status: 'COMPLETED',
        details: engaged ? 
          'Administrator took control - companion paused and network isolated' :
          'Administrator released control - companion resumed normal operation'
      }
    ].slice(-10); // Keep last 10 activities
    
    return mockAdminInterlock;
  },
  
  // Get recent admin activity
  getAdminActivity: () => [...mockAdminInterlock.adminActivity],
  
  // Simulate background operations (for demonstration)
  startBackgroundSimulation: () => {
    // In a real implementation, this would set up intervals to simulate
    // background operations, scheduled tasks, etc.
    // For now, we'll just return a cleanup function
    return () => {
      // Cleanup would go here
    };
  }
};