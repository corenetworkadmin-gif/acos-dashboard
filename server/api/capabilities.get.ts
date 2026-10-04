import { defineEventHandler } from 'h3'
import { Capability } from '~/types/acos'

// Mock capabilities data
let mockCapabilities: Capability[] = [
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
    authorized: false
  }
]

export default defineEventHandler(() => {
  return {
    success: true,
    data: mockCapabilities
  }
})