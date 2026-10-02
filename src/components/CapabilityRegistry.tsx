import { useState } from 'react';
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LucideIcon, Settings, Check, X } from 'lucide-react';

const capabilities = [
  { id: 1, name: "chat.send", description: "Send messages to users", enabled: true },
  { id: 2, name: "file.read", description: "Read files from companion home", enabled: true },
  { id: 3, name: "file.write", description: "Write files to companion home", enabled: false },
  { id: 4, name: "network.request", description: "Make HTTP requests", enabled: true },
  { id: 5, name: "system.update", description: "Check and apply system updates", enabled: true },
  { id: 6, name: "memory.allocate", description: "Allocate companion memory", enabled: true },
  { id: 7, name: "device.camera", description: "Access camera hardware", enabled: false },
  { id: 8, name: "device.microphone", description: "Access microphone hardware", enabled: false },
];

const CapabilityRegistry = () => {
  const [capList, setCapList] = useState(capabilities);

  return (
    <div className="space-y-4">
      <p className="text-cyan-300 text-sm">
        Configure which capabilities are available to the AI companion.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Capability</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-16">Status</TableHead>
            <TableHead className="w-16">Control</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {capList.map((cap) => (
            <TableRow key={cap.id} className="hover:bg-white/5">
              <TableCell className="flex items-center space-x-2 text-cyan-300">
                <Settings className="w-4 h-4" />
                <span>{cap.name}</span>
              </TableCell>
              <TableCell className="text-cyan-300">{cap.description}</TableCell>
              <TableCell className="text-center">
                <Badge
                  variant="secondary"
                  className={cap.enabled
                    ? "bg-green-500/20 text-green-400"
                    : "bg-red-500/20 text-red-400"}
                >
                  {cap.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </TableCell>
              <TableCell className="text-center">
                <Switch
                  checked={cap.enabled}
                  onCheckedChange={(checked) => setCapList(prev => 
                    prev.map(c => c.id === cap.id ? {...c, enabled: checked} : c)
                  )}
                  className="w-10"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default CapabilityRegistry;