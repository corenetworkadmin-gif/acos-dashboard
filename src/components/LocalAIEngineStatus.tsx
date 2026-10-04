import { useState, useEffect } from 'react';
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw } from 'lucide-react';
import { acosSimulationService } from '../services/acosSimulation';
import { LocalAIEngine } from '../types/acos';

const LocalAIEngineStatus = () => {
  const [engine, setEngine] = useState<LocalAIEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadEngineStatus();
    
    // Set up periodic refresh to simulate real-time updates
    const interval = setInterval(() => {
      if (!refreshing) {
        loadEngineStatus();
      }
    }, 2000); // Refresh every 2 seconds
    
    return () => clearInterval(interval);
  }, [refreshing]);

  const loadEngineStatus = async () => {
    setLoading(true);
    try {
      const eng = await acosSimulationService.getLocalAIEngine();
      setEngine(eng);
    } catch (error) {
      console.error('Failed to load engine status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadEngineStatus();
    } finally {
      setRefreshing(false);
    }
  };

  // Simulate engine state changes for demonstration
  useEffect(() => {
    if (!engine) return;
    
    // Simulate occasional state changes
    const simulateChanges = () => {
      // Randomly change engine status occasionally
      if (Math.random() < 0.05) { // 5% chance
        const statuses: Array<LocalAIEngine['status']> = ['READY', 'INFER', 'QUIESCE', 'HEALTH_CHECK'];
        const newStatus = statuses[Math.floor(Math.random() * statuses.length)];
        acosSimulationService.updateLocalAIEngineStatus(newStatus);
      }
      
      // Randomly change context usage
      if (Math.random() < 0.3) { // 30% chance
        const currentUsed = engine.contextWindow.used;
        const change = (Math.random() - 0.5) * 200; // -100 to +100
        const newUsed = Math.max(0, Math.min(engine.contextWindow.total, currentUsed + change));
        acosSimulationService.updateLocalAIEngineContext(newUsed);
      }
      
      // Randomly change resource usage
      if (Math.random() < 0.4) { // 40% chance
        const cpuChange = (Math.random() - 0.5) * 10; // -5 to +5
        const memChange = (Math.random() - 0.5) * 5;  // -2.5 to +2.5
        const gpuChange = Math.random() < 0.2 ? (Math.random() * 30) : 0; // 20% chance of GPU usage
        
        acosSimulationService.updateLocalAIEngineUsage({
          cpu: Math.max(0, Math.min(100, engine.resourceUsage.cpu + cpuChange)),
          memory: Math.max(0, Math.min(100, engine.resourceUsage.memory + memChange)),
          gpu: Math.max(0, Math.min(100, engine.resourceUsage.gpu + gpuChange))
        });
      }
    };
    
    const interval = setInterval(simulateChanges, 3000);
    return () => clearInterval(interval);
  }, [engine]);

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 mx-auto mb-4 text-cyan-400 animate-spin" />
        <p className="text-cyan-400">Loading engine status...</p>
      </div>
    );
  }

  if (!engine) {
    return (
      <div className="text-center py-8">
        <p className="text-cyan-400">Engine data not available</p>
      </div>
    );
  }

  const statusBadge = () => {
    const variants: Record<string, string> = {
      READY: "bg-green-500/20 text-green-400",
      INFER: "bg-blue-500/20 text-blue-400",
      QUIESCE: "bg-yellow-500/20 text-yellow-400",
      HEALTH_CHECK: "bg-orange-500/20 text-orange-400",
      LOAD: "bg-purple-500/20 text-purple-400",
      VALIDATE: "bg-purple-500/20 text-purple-400",
      REGISTER: "bg-purple-500/20 text-purple-400",
      DISCOVER: "bg-purple-500/20 text-purple-400",
      STOP: "bg-red-500/20 text-red-400",
      RECOVER: "bg-red-500/20 text-red-400",
      UNLOAD: "bg-red-500/20 text-red-400",
    };
    return <Badge variant="secondary" className={variants[engine.status] || variants.READY}>
      {engine.status}
    </Badge>;
  };

  const healthBadge = () => {
    const variants: Record<string, string> = {
      HEALTHY: "bg-green-500/20 text-green-400",
      DEGRADED: "bg-yellow-500/20 text-yellow-400",
      UNHEALTHY: "bg-red-500/20 text-red-400",
      UNKNOWN: "bg-gray-500/20 text-gray-400",
    };
    return <Badge variant="secondary" className={variants[engine.health] || variants.UNKNOWN}>
      {engine.health}
    </Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="text-cyan-400">Local AI Engine Status</span>
        </div>
        <button 
          onClick={handleRefresh}
          disabled={refreshing}
          className={`px-3 py-1 text-sm rounded hover:bg-white/10 transition-colors ${refreshing ? 'bg-cyan-500/20 text-cyan-400 animate-spin' : 'hover:bg-white/10'}`}
        >
          {refreshing ? (
            <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 text-cyan-400" />
          )}
        </button>
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-cyan-300">
          <span>Engine:</span> <span className="ml-2 font-mono">{engine.model || 'None'}</span>
        </div>
        <div className="flex items-center space-x-2 text-cyan-300">
          <span>Tokenizer:</span> <span className="ml-2">{engine.tokenizerCompatible ? 'Compatible' : 'Incompatible'}</span>
        </div>
        <div className="flex items-center space-x-2 text-cyan-300">
          <span>Status:</span> <span className="ml-2">{statusBadge()}</span>
        </div>
        <div className="flex items-center space-x-2 text-cyan-300">
          <span>Health:</span> <span className="ml-2">{healthBadge()}</span>
        </div>
      </div>
      
      <div className="space-y-4">
        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center space-x-3 mb-3">
            <span className="text-cyan-400">Resource Utilization</span>
          </div>
          
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-cyan-300">
                <span>CPU Usage</span>
                <span className="font-mono">{engine.resourceUsage.cpu}%</span>
              </div>
              <Progress value={engine.resourceUsage.cpu} className="h-2.5" />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-cyan-300">
                <span>Memory Usage</span>
                <span className="font-mono">{engine.resourceUsage.memory}%</span>
              </div>
              <Progress value={engine.resourceUsage.memory} className="h-2.5" />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-cyan-300">
                <span>GPU Usage</span>
                <span className="font-mono">{engine.resourceUsage.gpu}%</span>
              </div>
              <Progress value={engine.resourceUsage.gpu} className="h-2.5" />
            </div>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center space-x-3 mb-3">
            <span className="text-cyan-400">Context Window</span>
          </div>
          
          <div className="space-y-3">
            <div className="flex justify-between text-sm text-cyan-300">
              <span>Context Usage</span>
              <span className="font-mono">
                {Math.round((engine.contextWindow.used / engine.contextWindow.total) * 100)}%
              </span>
            </div>
            <Progress 
              value={(engine.contextWindow.used / engine.contextWindow.total) * 100} 
              className="h-2.5" 
            />
            <div className="flex justify-between text-xs text-cyan-400 mt-1">
              <span>{engine.contextWindow.used} / {engine.contextWindow.total} tokens</span>
            </div>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center space-x-3 mb-3">
            <span className="text-cyan-400">Accelerator Utilization</span>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center space-x-3 text-sm text-cyan-300">
              <span>CPU:</span> 
              <span className="ml-2">
                {engine.acceleratorUtilization.cpu ? 
                  <span className="w-3 h-3 rounded bg-green-500/20 text-green-400"></span> 
                  : <span className="w-3 h-3 rounded bg-red-500/20 text-red-400"></span>
                }
              </span>
            </div>
            <div className="flex items-center space-x-3 text-sm text-cyan-300">
              <span>GPU:</span> 
              <span className="ml-2">
                {engine.acceleratorUtilization.gpu ? 
                  <span className="w-3 h-3 rounded bg-green-500/20 text-green-400"></span> 
                  : <span className="w-3 h-3 rounded bg-red-500/20 text-red-400"></span>
                }
              </span>
            </div>
            <div className="flex items-center space-x-3 text-sm text-cyan-300">
              <span>NPU:</span> 
              <span className="ml-2">
                {engine.acceleratorUtilization.npu ? 
                  <span className="w-3 h-3 rounded bg-green-500/20 text-green-400"></span> 
                  : <span className="w-3 h-3 rounded bg-red-500/20 text-red-400"></span>
                }
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocalAIEngineStatus;