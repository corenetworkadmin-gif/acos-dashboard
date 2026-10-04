import { useState, useEffect } from 'react';
import { Badge } from "@/components/ui/badge";
import { acosSimulationService } from '../services/acosSimulation';

const AdminInterlockStatus = () => {
  const [interlock, setInterlock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adminActivity, setAdminActivity] = useState([]);

  useEffect(() => {
    loadInterlockStatus();
  }, []);

  const loadInterlockStatus = async () => {
    setLoading(true);
    try {
      const [interlockData, activityData] = await Promise.all([
        acosSimulationService.getAdminInterlock(),
        acosSimulationService.getAdminActivity()
      ]);
      setInterlock(interlockData);
      setAdminActivity(activityData);
    } catch (error) {
      console.error('Failed to load admin interlock status:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleInterlock = async () => {
    if (!interlock) return;
    
    try {
      const updatedInterlock = await acosSimulationService.setAdminInterlockEngaged(
        !interlock.engaged
      );
      setInterlock(updatedInterlock);
    } catch (error) {
      console.error('Failed to toggle interlock:', error);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-cyan-400">Loading admin interlock status...</p>
      </div>
    );
  }

  if (!interlock) {
    return (
      <div className="text-center py-8">
        <p className="text-cyan-400">Admin interlock data not available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-3">
        <span className="text-cyan-400">Administrator Control Interlock</span>
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
            onClick={toggleInterlock}
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
      </div>
      <div className="mt-4">
        <div className="flex items-center space-x-2 mb-2">
          <span className="text-cyan-400">Recent Admin Activity</span>
        </div>
        <div className="space-y-2">
          {adminActivity.map((act) => (
            <div key={act.timestamp} className="flex items-center space-x-2 text-cyan-300 text-sm">
              <span className="w-3 h-3 rounded bg-gray-500/20"></span>
              <span>{new Date(act.timestamp).toLocaleTimeString()}</span>
              <span className="mx-2">→</span>
              <span>{act.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminInterlockStatus;