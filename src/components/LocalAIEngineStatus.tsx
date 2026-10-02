import { useState, useEffect } from 'react';
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LucideIcon, Zap, Monitor, Settings, CheckCircle, XCircle } from 'lucide-react';

const LocalAIEngineStatus = () => {
  const [status, setStatus] = useState({
    engine: "Local AI Engine v1.0",
    model: "llama-3.2-3b-instruct",
    status: "ready",
    usage: {
      cpu: 25,
      memory: 40,
      gpu: 0,
    },
    context: {
      used: 1024,
      total: 4096,
    },
  });

  useEffect(() => {
    // Simulate status updates
    const interval = setInterval(() => {
      setStatus(prev => ({
        ...prev,
        usage: {
          cpu: Math.min(100, Math.max(0, prev.usage.cpu + (Math.random() - 0.5) * 10)),
          memory: Math.min(100, Math.max(0, prev.usage.memory + (Math.random() - 0.5) * 5)),
          gpu: Math.random() > 0.9 ? Math.floor(Math.random() * 100) : 0, // GPU usage sporadic
        },
        context: {
          used: Math.min(4096, Math.max(0, prev.context.used + (Math.random() - 0.5) * 100)),
          total: 4096,
        },
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const statusBadge = () => {
    switch (status.status) {
      case "ready":
        return <Badge variant="secondary" className="bg-green-500/20 text-green-400">Ready</Badge>;
      case "loading":
        return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400">Loading</Badge>;
      case "error":
        return <Badge variant="secondary" className="bg-red-500/20 text-red-400">Error</Badge>;
      default:
        return <Badge variant="secondary" className="bg-blue-500/20 text-blue-400">Unknown</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-3">
        <Monitor className="w-5 h-5 text-cyan-400" />
        <h3 className="font-semibold text-cyan-300">Local AI Engine Status</h3>
      </div>
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-cyan-300">
          <Zap className="w-4 h-4" />
          <span>Engine:</span> <span className="ml-2">{status.engine}</span>
        </div>
        <div className="flex items-center space-x-2 text-cyan-300">
          <Settings className="w-4 h-4" />
          <span>Model:</span> <span className="ml-2">{status.model}</span>
        </div>
        <div className="flex items-center space-x-2 text-cyan-300">
          <span>Status:</span> <span className="ml-2">{statusBadge()}</span>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-cyan-300">
            <span>CPU Usage</span>
            <span>{status.usage.cpu}%</span>
          </div>
          <Progress value={status.usage.cpu} className="h-2.5" />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-cyan-300">
            <span>Memory Usage</span>
            <span>{status.usage.memory}%</span>
          </div>
          <Progress value={status.usage.memory} className="h-2.5" />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-cyan-300">
            <span>GPU Usage</span>
            <span>{status.usage.gpu}%</span>
          </div>
          <Progress value={status.usage.gpu} className="h-2.5" />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-cyan-300">
            <span>Context Window</span>
            <span>{Math.round((status.context.used / status.context.total) * 100)}%</span>
          </div>
          <Progress value={(status.context.used / status.context.total) * 100} className="h-2.5" />
          <div className="flex justify-between text-xs text-cyan-400">
            <span>{status.context.used} / {status.context.total} tokens</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocalAIEngineStatus;