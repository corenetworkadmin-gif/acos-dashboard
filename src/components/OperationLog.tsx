import { useState, useEffect } from 'react';
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LucideIcon, CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';

const OperationLog = () => {
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate fetching operation logs
    const mockOperations = [
      { id: 1, timestamp: new Date(Date.now() - 5 * 60 * 1000), capability: "chat.send", action: "Send message", status: "completed" },
      { id: 2, timestamp: new Date(Date.now() - 12 * 60 * 1000), capability: "file.read", action: "Read configuration", status: "completed" },
      { id: 3, timestamp: new Date(Date.now() - 20 * 60 * 1000), capability: "network.request", action: "API call to localhost", status: "completed" },
      { id: 4, timestamp: new Date(Date.now() - 30 * 60 * 1000), capability: "system.update", action: "Check for updates", status: "completed" },
      { id: 5, timestamp: new Date(Date.now() - 45 * 60 * 1000), capability: "memory.allocate", action: "Allocate buffer", status: "completed" },
    ];
    setOperations(mockOperations);
    setLoading(false);
  }, []);

  const statusBadge = (status: string) => {
    const variants: Record<string, string> = {
      completed: "bg-green-500/20 text-green-400",
      running: "bg-yellow-500/20 text-yellow-400",
      failed: "bg-red-500/20 text-red-400",
      pending: "bg-blue-500/20 text-blue-400",
    };
    return <Badge variant="secondary" className={variants[status] || variants.pending}>
      {status}
    </Badge>;
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 mx-auto mb-4 text-cyan-400 animate-spin" />
        <p className="text-cyan-400">Loading operation logs...</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">Time</TableHead>
          <TableHead>Capability</TableHead>
          <TableHead className="w-32">Action</TableHead>
          <TableHead className="w-20">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {operations.map((op) => (
          <TableRow key={op.id} className="hover:bg-white/5">
            <TableCell className="text-cyan-300">
              <Clock className="w-4 h-4 mr-2" /> {op.timestamp.toLocaleTimeString()}
            </TableCell>
            <TableCell className="text-cyan-300">{op.capability}</TableCell>
            <TableCell className="text-cyan-300">{op.action}</TableCell>
            <TableCell>{statusBadge(op.status)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default OperationLog;