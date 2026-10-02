import { useState, useEffect } from 'react';
import { Progress } from "@/components/ui/progress";
import { LucideIcon, Activity, Server, Zap, Monitor } from 'lucide-react';

const ResourceMonitor = () => {
  const [resources, setResources] = useState({
    cpu: Math.floor(Math.random() * 100),
    memory: Math.floor(Math.random() * 100),
    gpu: Math.floor(Math.random() * 100),
    network: Math.floor(Math.random() * 100),
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setResources(prev => ({
        cpu: Math.min(100, Math.max(0, prev.cpu + (Math.random() - 0.5) * 10)),
        memory: Math.min(100, Math.max(0, prev.memory + (Math.random() - 0.5) * 5)),
        gpu: Math.min(100, Math.max(0, prev.gpu + (Math.random() - 0.5) * 15)),
        network: Math.min(100, Math.max(0, prev.network + (Math.random() - 0.5) * 20)),
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Activity className="w-5 h-5 text-cyan-400" />
        <h3 className="font-semibold text-cyan-300">System Resources</h3>
      </div>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm text-cyan-300">
            <span>CPU Usage</span>
            <span>{resources.cpu}%</span>
          </div>
          <Progress value={resources.cpu} className="h-2.5" />
        </div>
        <div>
          <div className="flex justify-between text-sm text-cyan-300">
            <span>Memory Usage</span>
            <span>{resources.memory}%</span>
          </div>
          <Progress value={resources.memory} className="h-2.5" />
        </div>
        <div>
          <div className="flex justify-between text-sm text-cyan-300">
            <span>GPU Usage</span>
            <span>{resources.gpu}%</span>
          </div>
          <Progress value={resources.gpu} className="h-2.5" />
        </div>
        <div>
          <div className="flex justify-between text-sm text-cyan-300">
            <span>Network I/O</span>
            <span>{resources.network}%</span>
          </div>
          <Progress value={resources.network} className="h-2.5" />
        </div>
      </div>
    </div>
  );
};

export default ResourceMonitor;