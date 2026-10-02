import { useState, useEffect } from 'react';
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LucideIcon, CheckCircle, XCircle, Loader2, Clock, RefreshCw } from 'lucide-react';
import { acosSimulationService } from '../services/acosSimulation';

const OperationLog = () => {
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadOperations();
    
    // Set up periodic refresh to simulate real-time updates
    const interval = setInterval(() => {
      if (!refreshing) {
        loadOperations();
      }
    }, 5000); // Refresh every 5 seconds
    
    return () => clearInterval(interval);
  }, [refreshing]);

  const loadOperations = async () => {
    setLoading(true);
    try {
      const ops = acosSimulationService.getOperations();
      setOperations(ops);
    } catch (error) {
      console.error('Failed to load operations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadOperations();
    } finally {
      setRefreshing(false);
    }
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, string> = {
      COMPLETED: "bg-green-500/20 text-green-400",
      RUNNING: "bg-yellow-500/20 text-yellow-400",
      REQUESTED: "bg-blue-500/20 text-blue-400",
      VALIDATING: "bg-blue-500/20 text-blue-400",
      AUTHORIZED: "bg-blue-500/20 text-blue-400",
      ADMITTED: "bg-blue-500/20 text-blue-400",
      RESERVING_RESOURCES: "bg-blue-500/20 text-blue-400",
      COMPLETING: "bg-blue-500/20 text-blue-400",
      WAITING_FOR_AUTHORIZATION: "bg-orange-500/20 text-orange-400",
      DENIED: "bg-red-500/20 text-red-400",
      CANCELLED: "bg-red-500/20 text-red-400",
      TIMEOUT: "bg-red-500/20 text-red-400",
      FAILED: "bg-red-500/20 text-red-400",
      ABORTED: "bg-red-500/20 text-red-400",
      RECOVERY_REQUIRED: "bg-purple-500/20 text-purple-400",
    };
    return <Badge variant="secondary" className={variants[status] || variants.REQUESTED}>
      {status}
    </Badge>;
  };

  const getLifecycleColor = (state: string) => {
    const colors: Record<string, string> = {
      REQUESTED: 'text-blue-400',
      VALIDATING: 'text-blue-400',
      AUTHORIZED: 'text-blue-400',
      ADMITTED: 'text-blue-400',
      RESERVING_RESOURCES: 'text-blue-400',
      RUNNING: 'text-yellow-400',
      COMPLETING: 'text-blue-400',
      COMPLETED: 'text-green-400',
      WAITING_FOR_AUTHORIZATION: 'text-orange-400',
      DENIED: "bg-red-500/20 text-red-400",
      CANCELLED: "bg-red-500/20 text-red-400",
      TIMEOUT: "bg-red-500/20 text-red-400",
      FAILED: "bg-red-500/20 text-red-400",
      ABORTED: "bg-red-500/20 text-red-400",
      RECOVERY_REQUIRED: "bg-purple-500/20 text-purple-400",
    };
    return colors[state] || 'text-white';
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 mx-auto mb-4 text-cyan-400 animate-spin" />
        <p className="text-cyan-400">Loading operation logs...</p>
      </div>
    );
  }

  if (operations.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-cyan-400">No operations found</p>
        <button 
          onClick={handleRefresh}
          className="mt-4 px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded hover:bg-cyan-500/30"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-cyan-300 flex items-center space-x-2">
          <LucideIcon className="w-5 h-5" type="list" />
          Operation Log
        </h3>
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
      
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Time</TableHead>
            <TableHead className="w-20">Capability</TableHead>
            <TableHead className="w-24">Action</TableHead>
            <TableHead className="w-16">Lifecycle</TableHead>
            <TableHead className="w-12">Auth</TableHead>
            <TableHead className="w-10">Sec</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {operations.slice(0, 10).map((op) => (
            <TableRow key={op.id} className="hover:bg-white/5">
              <TableCell className="text-cyan-300 flex items-center space-x-2">
                <Clock className="w-4 h-4" /> 
                <span className="text-xs">{new Date(op.timestamp).toLocaleTimeString()}</span>
              </TableCell>
              <TableCell className="text-cyan-300 text-sm">{op.capability}</TableCell>
              <TableCell className="text-cyan-300 text-sm max-w-[120px] truncate" title={op.action}>
                {op.action}
              </TableCell>
              <TableCell className={`text-sm ${getLifecycleColor(op.lifecycleState)}`}>
                {op.lifecycleState}
              </TableCell>
              <TableCell className="text-center text-sm">
                <Badge 
                  variant="secondary" 
                  className={op.authorizationResult === 'APPROVED' 
                    ? "bg-green-500/20 text-green-400" 
                    : op.authorizationResult === 'DENIED'
                      ? "bg-red-500/20 text-red-400"
                      : "bg-yellow-500/20 text-yellow-400"}
                >
                  {op.authorizationResult}
                </Badge>
              </TableCell>
              <TableCell className="text-center text-sm">
                <Badge 
                  variant="secondary" 
                  className={op.securityState === 'NORMAL' 
                    ? "bg-green-500/20 text-green-400" 
                    : op.securityState === 'RESTRICTED' || op.securityState === 'CONFIDENTIAL'
                      ? "bg-yellow-500/20 text-yellow-400"
                      : op.securityState === 'ISOLATED' || op.securityState === 'EMERGENCY_ISOLATION'
                        ? "bg-red-500/20 text-red-400"
                        : "bg-blue-500/20 text-blue-400"}
                >
                  {op.securityState}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      
      {operations.length > 10 && (
        <div className="text-center text-cyan-400 text-sm pt-2">
          Showing 10 of {operations.length} operations
        </div>
      )}
    </div>
  );
};

export default OperationLog;