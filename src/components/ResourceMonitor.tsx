import { useState, useEffect } from 'react';
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw } from 'lucide-react';
import { acosSimulationService } from '../services/acosSimulation';

const ResourceMonitor = () => {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadResources();
    
    // Set up periodic refresh to simulate real-time updates
    const interval = setInterval(() => {
      if (!refreshing) {
        loadResources();
      }
    }, 3000); // Refresh every 3 seconds
    
    return () => clearInterval(interval);
  }, [refreshing]);

  const loadResources = async () => {
    setLoading(true);
    try {
      const res = await acosSimulationService.getResources();
      setResources(res);
    } catch (error) {
      console.error('Failed to load resources:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadResources();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 mx-auto mb-4 text-cyan-400 animate-spin" />
        <p className="text-cyan-400">Loading resource data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="text-cyan-400">System Resources</span>
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
      
      <div className="space-y-4">
        {resources.map((resource) => {
          const usagePercentage = resource.total > 0 
            ? (resource.allocated / resource.total) * 100 
            : 0;
          
          // Determine color based on usage
          const getUsageColor = (percentage: number) => {
            if (percentage < 50) return 'bg-green-500/20 text-green-400';
            if (percentage < 80) return 'bg-yellow-500/20 text-yellow-400';
            return 'bg-red-500/20 text-red-400';
          };
          
          return (
            <div key={resource.id}>
              <div className="flex justify-between text-sm text-cyan-300 mb-1">
                <span>{resource.type}</span>
                <span className="font-mono">
                  {resource.allocated.toLocaleString()}/{resource.total.toLocaleString()}
                  {resource.type === 'MEMORY' ? ' MB' : 
                   resource.type === 'NETWORK' ? ' Mbps' : 
                   resource.type === 'STORAGE' ? ' MB' : ''}
                </span>
              </div>
              <div className="w-full bg-white/5 rounded h-2.5 overflow-hidden">
                <div 
                  className={`${getUsageColor(usagePercentage)} h-2.5 transition-all duration-500`}
                  style={{ width: `${usagePercentage}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-xs text-cyan-400 mt-1">
                <span>Usage: {usagePercentage.toFixed(1)}%</span>
                <span>Available: {((resource.total - resource.allocated) / resource.total * 100).toFixed(1)}%</span>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Resource Details */}
      <div className="border-t border-white/10 pt-4">
        <div className="flex items-center space-x-3 mb-3">
          <span className="text-cyan-400">Resource Allocation Details</span>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Total CPU Cores:</span>
            <span className="text-cyan-300 font-mono">4 cores</span>
          </div>
          <div className="flex justify-between">
            <span>Total Memory:</span>
            <span className="text-cyan-300 font-mono">8 GB</span>
          </div>
          <div className="flex justify-between">
            <span>Total GPU Memory:</span>
            <span className="text-cyan-300 font-mono">6 GB</span>
          </div>
          <div className="flex justify-between">
            <span>Network Bandwidth:</span>
            <span className="text-cyan-300 font-mono">1 Gbps</span>
          </div>
          <div className="flex justify-between">
            <span>Storage Capacity:</span>
            <span className="text-cyan-300 font-mono">100 GB</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResourceMonitor;