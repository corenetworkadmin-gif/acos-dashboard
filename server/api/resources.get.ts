import { defineEventHandler } from 'h3'
import { Resource } from '~/types/acos'

// Mock resources data
let mockResources: Resource[] = [
  { id: 'res-1', type: 'CPU', total: 100, allocated: 25, available: 75 },
  { id: 'res-2', type: 'MEMORY', total: 8192, allocated: 2048, available: 6144 }, // MB
  { id: 'res-3', type: 'GPU', total: 100, allocated: 0, available: 100 },
  { id: 'res-4', type: 'NETWORK', total: 1000, allocated: 100, available: 900 }, // Mbps
  { id: 'res-5', type: 'STORAGE', total: 102400, allocated: 5120, available: 97280 } // MB
]

export default defineEventHandler(() => {
  return {
    success: true,
    data: mockResources
  }
})