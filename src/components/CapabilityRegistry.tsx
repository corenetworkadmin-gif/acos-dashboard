import { useState, useEffect } from 'react';
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Settings, Loader2, RefreshCw } from 'lucide-react';
import { acosSimulationService } from '../services/acosSimulation';

const CapabilityRegistry = () => {
  const [capabilities, setCapabilities] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
    
    // Set up periodic refresh
    const interval = setInterval(() => {
      if (!refreshing) {
        loadData();
      }
    }, 10000); // Refresh every 10 seconds
    
    return () => clearInterval(interval);
  }, [refreshing]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [caps, provs] = await Promise.all([
        acosSimulationService.getCapabilities(),
        acosSimulationService.getProviders()
      ]);
      setCapabilities(caps);
      setProviders(provs);
    } catch (error) {
      console.error('Failed to load capabilities/providers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleCapability = async (id: string) => {
    try {
      const updatedCap = await acosSimulationService.updateCapabilityAuthorization(
        id, 
        false // We'll toggle based on current state in the component
      );
      
      if (updatedCap) {
        // Update local state
        setCapabilities(prev => 
          prev.map(c => c.id === id ? updatedCap : c)
        );
      }
    } catch (error) {
      console.error('Failed to toggle capability:', error);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 mx-auto mb-4 text-cyan-400 animate-spin" />
        <p className="text-cyan-400">Loading capabilities...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Settings className="w-5 h-5" />
          <h3 className="font-semibold text-cyan-300">Capability Registry</h3>
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
      
      {/* Description */}
      <div className="space-y-3">
        <p className="text-cyan-300 text-sm">
          Configure which capabilities are available to the AI companion. 
          Changes require administrator authorization.
        </p>
        
        {/* Capabilities Table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Capability</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-16">Provider</TableHead>
                <TableHead className="w-14">Status</TableHead>
                <TableHead className="w-16">Control</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {capabilities.map((cap) => {
                // Find provider for this capability
                const provider = providers.find(p => 
                  p.implementations.some(impl => 
                    impl.supportedOperations.some(op => 
                      cap.supportedOperations.includes(op)
                    )
                  )
                ) || { name: 'Unknown', type: 'UNKNOWN' };
                
                return (
                  <TableRow key={cap.id} className="hover:bg-white/5">
                    {/* Capability Name and Version */}
                    <TableCell className="flex items-center space-x-2 text-cyan-300">
                      <Settings className="w-4 h-4" />
                      <div className="flex flex-col">
                        <span className="font-medium">{cap.name}</span>
                        <span className="text-xs text-cyan-400">v{cap.version}</span>
                      </div>
                    </TableCell>
                    
                    {/* Description */}
                    <TableCell className="text-cyan-300 text-sm">{cap.description}</TableCell>
                    
                    {/* Provider Info */}
                    <TableCell className="text-cyan-300 text-sm">
                      <div className="flex flex-col">
                        <span>{provider.name}</span>
                        <span className="text-xs">{provider.type}</span>
                      </div>
                    </TableCell>
                    
                    {/* Availability Status */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <div 
                          className="w-3 h-3 rounded" 
                          style={{ 
                            backgroundColor: cap.availability === 'AVAILABLE' 
                              ? '#10b981' 
                              : cap.availability === 'DEGRADED' 
                                ? '#f59e0b' 
                                : '#ef4444' 
                          }}
                        ></div>
                        <span className="text-xs text-cyan-400">{cap.availability}</span>
                      </div>
                    </TableCell>
                    
                    {/* Control Switch */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center">
                        <Switch
                          checked={cap.authorized}
                          onCheckedChange={(checked) => handleToggleCapability(cap.id)}
                          className="w-10"
                        />
                        <span className="text-xs text-cyan-400 ml-2">
                          {cap.authorized ? 'Auth' : 'Not Auth'}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
      
      {/* Providers Section */}
      <div className="border-t border-white/10 pt-4">
        <div className="flex items-center space-x-3 mb-3">
          <h4 className="font-semibold text-cyan-300">Provider Registry</h4>
        </div>
        
        <div className="space-y-2">
          {providers.map((provider) => (
            <div key={provider.id} className="bg-black/30 rounded p-3">
              {/* Provider Header */}
              <div className="flex items-center space-x-3 mb-2">
                {provider.type === 'BUILTIN' ? (
                  <span className="w-4 h-4 rounded bg-cyan-500/20 text-cyan-400">BUILTIN</span>
                ) : (
                  <span className="w-4 h-4 rounded bg-blue-500/20 text-blue-400">EXTERNAL</span>
                )}
                <span className="font-medium text-cyan-300">{provider.name}</span>
                <span className="px-2 py-0.5 text-xs rounded bg-cyan-500/20 text-cyan-400">
                  {provider.type}
                </span>
              </div>
              
              {/* Implementations */}
              <div className="space-y-1">
                {provider.implementations.map((impl) => (
                  <div key={impl.id} className="flex items-center space-x-3 text-sm text-cyan-300">
                    <span>{impl.name}</span>
                    <span className="flex-1"></span>
                    <span className="text-xs">
                      {impl.supportedOperations.length} operations
                    </span>
                    <span 
                      className={`ml-2 px-2 py-0.5 rounded 
                        ${impl.availability === 'AVAILABLE' 
                          ? 'text-green-400 bg-green-500/20' 
                          : impl.availability === 'DEGRADED' 
                            ? 'text-yellow-400 bg-yellow-500/20' 
                            : 'text-red-400 bg-red-500/20'}\
                      `}
                    >
                      {impl.availability}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CapabilityRegistry;