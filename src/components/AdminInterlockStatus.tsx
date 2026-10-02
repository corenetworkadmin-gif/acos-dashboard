import { useState, useEffect } from 'react';
import { Badge } from "@/components/ui/badge";
import { LucideIcon, Shield, Lock, AlertTriangle, Activity, Loader2, RefreshCw } from 'lucide-react';
import { acosSimulationService } from '../services/acosSimulation';

const AdminInterlockStatus = () => {
  const [interlock, setInterlock] = useState(null);
  const [adminActivity, setAdminActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadInterlockStatus();
    
    // Set up periodic refresh
    const interval = setInterval(() => {
      if (!refreshing) {
        loadInterlockStatus();
      }
    }, 5000); // Refresh every 5 seconds
    
    return () => clearInterval(interval);
  }, [refreshing]);

  const loadInterlockStatus = async () => {
    setLoading(true);
    try {
      const interlockState = acosSimulationService.getAdminInterlock();
      const activity = acosSimulationService.getAdminActivity();
      setInterlock(interlockState);
      setAdminActivity(activity);
    } catch (error) {
      console.error('Failed to load interlock status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadInterlockStatus();
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleInterlock = async () => {
    if (!interlock) return;
    
    try {
      const updatedInterlock = acosSimulationService.setAdminInterlockEngaged(!interlock.engaged);
      setInterlock(updatedInterlock);
    } catch (error) {
      console.error('Failed to toggle interlock:', error);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 mx-auto mb-4 text-cyan-400 animate-spin" />
        <p className="text-cyan-400">Loading interlock status...</p>
      </div>
    );
  }

  if (!interlock) {
    return (
      <div className="text-center py-8">
        <p className="text-cyan-400">Interlock data not available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Shield className="w-5 h-5 text-cyan-400" />
          <h3 className="font-semibold text-cyan-300">Administrator Control Interlock</h3>
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
      
      <div className="bg-black/30 border border-white/10 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-cyan-300">Interlock Status:</span>
          <Badge
            variant="secondary"
            className={interlock.engaged
              ? "bg-red-500/20 text-red-400"
              : "bg-green-500/20 text-green-400"}
          >
            {interlock.engaged ? "ENGAGED" : "DISENGAGED"}
          </Badge>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleToggleInterlock}
            className={`flex-1 px-4 py-2 rounded hover:bg-white/10 transition-colors ${
              interlock.engaged
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-green-500/20 text-green-400 hover:bg-green-500/30"
            }`}
          >
            {interlock.engaged ? "Disengage" : "Engage"}
          </button>
        </div>
        {!interlock.engaged && (
          <div className="mt-4 p-3 bg-white/5 rounded">
            <p className="text-cyan-300 text-sm">
              When engaged, the administrator control interlock prevents the companion from:
            </p>
            <ul className="mt-2 space-y-1 pl-5 text-cyan-300 text-sm">
              <li>Observing administrator UI or input</li>
              <li>Manipulating administrator interface</li>
              <li>Performing background work during admin sessions</li>
              <li>Accessing administrator authentication material</li>
            </ul>
          </div>
        )}
        {interlock.engaged && (
          <div className="mt-4 p-3 bg-white/5 rounded">
            <p className="text-cyan-300 text-sm">
              Administrator control is active:
            </p>
            <ul className="mt-2 space-y-1 pl-5 text-cyan-300 text-sm">
              <li>Companion is paused and cannot execute new operations</li>
              <li>Network access is isolated from companion</li>
              <li>Administrator UI is accessible, companion UI is restricted</li>
              <li>All companion operations require explicit administrator approval</li>
            </ul>
          </div>
        )}
      </div>
      
      <div className="mt-4">
        <div className="flex items-center space-x-2 mb-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h4 className="font-semibold text-cyan-300">Recent Admin Activity</h4>
        </div>
        
        <div className="space-y-2">
          {adminActivity.slice(0, 5).map((act) => (
            <div key={act.timestamp} className="flex items-center space-x-2 text-cyan-300 text-sm">
              <AlertTriangle className="w-3 h-3" />
              <span className="text-xs">{new Date(act.timestamp).toLocaleTimeString()}</span>
              <span className="mx-2">→</span>
              <span className="max-w-[200px] truncate" title={act.details || act.action}>
                {act.action}
              </span>
              {act.details && (
                <span className="ml-2 text-xs text-cyan-400">({act.details})</span>
              )}
            </div>
          ))}
          
          {adminActivity.length > 5 && (
            <div className="text-center text-cyan-400 text-sm pt-2">
              Showing 5 of {adminActivity.length} activities
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminInterlockStatus;