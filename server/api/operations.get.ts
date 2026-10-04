import { defineEventHandler } from 'h3'
import { Operation } from '~/types/acos'

// Mock operations data - in real implementation, this would come from database
let mockOperations: Operation[] = [
  {
    id: 'op-001',
    timestamp: Date.now() - 5 * 60 * 1000,
    companionId: 'comp-001',
    capability: 'chat.send',
    action: 'Send message: "Hello, how can I help you?"',
    lifecycleState: 'COMPLETED',
    authorizationResult: 'APPROVED',
    securityState: 'NORMAL',
    auditEvents: []
  }
]

export default defineEventHandler(() => {
  return {
    success: true,
    data: mockOperations
  }
})