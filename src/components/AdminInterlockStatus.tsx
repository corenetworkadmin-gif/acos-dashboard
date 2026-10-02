import { useState } from 'react';
import { Badge } from "@/components/ui/badge";
import { LucideIcon, Shield, Lock, AlertTriangle, Activity } from 'lucide-react';

const AdminInterlockStatus = () => {
  const [interlockEngaged, setInterlockEngaged] = useState(false);
  const [adminActivity, setAdminActivity] = useState([
    { time: "10:30:15", action: "Admin panel opened", status: "completed" },
    { time: "10:25:03", action: "Capability modified: file.write", status: "completed" },
    { time: "10:20:45", action: "System update initiated", status: "completed" },
  ]);

  const toggleInterlock = () => {
    setInterlockEngaged(!interlockEngaged);
    // Simulate admin activity log
    setAdminActivity(prev => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        action: interlockEngaged ? "Admin panel closed" : "Admin panel opened",
        status: "completed",
      }
    ].slice(-3)); // Keep only last 3
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-3">
        <Shield className="w-5 h-5 text-cyan-400" />
        <h3 className="font-semibold text-cyan-300">Administrator Control Interlock</h3>
      </div>
      <div className="bg-black/30 border border-white/10 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-cyan-300">Interlock Status:</span>
          <Badge
            variant="secondary"
            className={interlockEngaged
              ? "bg-red-500/20 text-red-400"
              : "bg-green-500/20 text-green-400"}
          >
            {interlockEngaged ? "ENGAGED" : "DISENGAGED"}
          </Badge>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={toggleInterlock}
            className={`flex-1 px-4 py-2 rounded hover:bg-white/10 transition-colors ${
              interlockEngaged
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-green-500/20 text-green-400 hover:bg-green-500/30"
            }`}
          >
            {interlockEngaged ? "Disengage" : "Engage"}
          </button>
        </div>
        {!interlockEngaged && (
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
          <Activity className="w-4 h-4 text-cyan-400" />
          <h4 className="font-semibold text-cyan-300">Recent Admin Activity</h4>
        </div>
        <div className="space-y-2">
          {adminActivity.map((act) => (
            <div key={act.time} className="flex items-center space-x-2 text-cyan-300 text-sm">
              <AlertTriangle className="w-3 h-3" />
              <span>{act.time}</span>
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